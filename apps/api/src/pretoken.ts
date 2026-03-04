import type {
  PreTokenGenerationTriggerEvent,
  PreTokenGenerationTriggerHandler,
} from 'aws-lambda';

import { db } from '@serverless-saas/database';
import { users } from '@serverless-saas/database/schema/auth';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { roles } from '@serverless-saas/database/schema/authorization';
import { subscriptions } from '@serverless-saas/database/schema/billing';
import { eq, and } from 'drizzle-orm';

/**
 * Cognito Pre Token Generation Lambda
 *
 * Fires synchronously on every login — email/password, Google OAuth, invite flow.
 * Must complete within 5s or Cognito will fail the login.
 *
 * Job: stamp three custom claims into the JWT:
 *   custom:tenantId → which tenant this user belongs to
 *   custom:role     → their role within that tenant
 *   custom:plan     → the tenant's current subscription plan
 *
 * Empty claims are stamped when:
 *   - User exists in Cognito but not in our DB yet (race condition, rare)
 *   - User has no active membership (brand new user, needs onboarding)
 *   - Tenant has no active subscription (should not happen, but handled safely)
 *
 * Empty tenantId is the signal to the frontend to redirect to /onboarding.
 * See ADR-026 for full reasoning.
 */
export const handler: PreTokenGenerationTriggerHandler = async (
  event: PreTokenGenerationTriggerEvent
) => {
  // Extract user identity from Cognito event
  // event.userName is always the Cognito identifier — works for email and Google OAuth
  const cognitoId = event.userName;
  const email = event.request.userAttributes.email;
  const name = event.request.userAttributes.name;

  // Step 1 — find user in our DB by cognitoId
  // User is created here via middleware upsert on first API call (Volca pattern, ADR-024)
  // If not found yet, stamp empty claims — do not throw
  const user = await db.query.users.findFirst({
    where: eq(users.cognitoId, cognitoId)
  });

  if (!user) {
    // User not in DB yet — new signup, middleware will create them on first API call
    return emptyClaimsResponse(event);
  }

  // Step 2 — find tenant membership for this user
  // A user can belong to multiple tenants — we take the first active one
  // Multi-tenant switching handled separately via clientMetadata in future
  const membership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, user.id)
  });

  if (!membership) {
    // User exists but has no tenant yet — needs to complete onboarding
    return emptyClaimsResponse(event);
  }

  // Step 3 — resolve role name from roleId
  // We store roleId on membership, but the JWT needs the role name string
  const role = await db.query.roles.findFirst({
    where: eq(roles.id, membership.roleId)
  });

  if (!role) {
    // Role not found — data integrity issue, fail safely
    return emptyClaimsResponse(event);
  }

  // Step 4 — find active subscription to get the plan
  // Plan drives feature gating across the entire platform (ADR entitlements)
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.tenantId, membership.tenantId),
      eq(subscriptions.status, 'active')
    )
  });

  if (!subscription) {
    // No active subscription — stamp free plan as safe default
    return emptyClaimsResponse(event);
  }

  // Step 5 — stamp real claims into the JWT
  // These claims are read by middleware on every API request
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        'custom:tenantId': membership.tenantId,
        'custom:role': role.name,
        'custom:plan': subscription.plan,
      },
    },
  };

  return event;
};

/**
 * Helper — stamps empty claims and returns event
 * Used for all cases where tenant context cannot be resolved
 * Empty tenantId signals frontend to redirect to /onboarding
 */
const emptyClaimsResponse = (event: PreTokenGenerationTriggerEvent) => {
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        'custom:tenantId': '',
        'custom:role': '',
        'custom:plan': 'free',
      },
    },
  };
  return event;
};