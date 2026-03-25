import type {
  PreTokenGenerationTriggerEvent,
  PreTokenGenerationTriggerHandler,
} from 'aws-lambda';

import { db } from '@serverless-saas/database';
import { users } from '@serverless-saas/database/schema/auth';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { roles } from '@serverless-saas/database/schema/authorization';
import { subscriptions } from '@serverless-saas/database/schema/billing';
import { eq, and, inArray, desc } from 'drizzle-orm';

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
  // Always use the Cognito sub (UUID) — event.userName for email/password users
  // may be the raw email string, which won't match cognitoId in our DB.
  // event.request.userAttributes.sub is always the stable UUID.
  const cognitoId = event.request.userAttributes.sub;
  console.log('[pretoken] step=start', { cognitoId, userName: event.userName });

  // Step 1 — find user in our DB by cognitoId
  // User is created here via middleware upsert on first API call (Volca pattern, ADR-024)
  // If not found yet, stamp empty claims — do not throw
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.cognitoId, cognitoId))
    .limit(1);

  console.log('[pretoken] step=1/user', { found: !!user, id: user?.id });

  if (!user) {
    // User not in DB yet — new signup, middleware will create them on first API call
    return emptyClaimsResponse(event);
  }

  // Step 2 — find tenant membership for this user
  // If clientMetadata.tenantId is present (e.g. workspace-switch flow), try that tenant first.
  // Falls back to most recently joined active membership if not found or not provided.
  const requestedTenantId = event.request.clientMetadata?.tenantId;

  let membership: typeof memberships.$inferSelect | undefined;

  if (requestedTenantId) {
    [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.tenantId, requestedTenantId),
          eq(memberships.status, 'active')
        )
      )
      .limit(1);
  }

  if (!membership) {
    [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.status, 'active')
        )
      )
      .orderBy(desc(memberships.joinedAt))
      .limit(1);
  }

  console.log('[pretoken] step=2/membership', {
    found: !!membership,
    tenantId: membership?.tenantId,
    status: membership?.status,
    requestedTenantId: requestedTenantId ?? null,
  });

  if (!membership) {
    // User exists but has no tenant yet — needs to complete onboarding
    return emptyClaimsResponse(event);
  }

  // Step 3 — resolve role name from roleId
  // We store roleId on membership, but the JWT needs the role name string
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, membership.roleId))
    .limit(1);

  console.log('[pretoken] step=3/role', { found: !!role, name: role?.name });

  if (!role) {
    // Role not found — data integrity issue, fail safely
    return emptyClaimsResponse(event);
  }

  // Step 4 — find active OR trialing subscription to get the plan
  // Plan drives feature gating across the entire platform (ADR entitlements)
  // IMPORTANT: newly created subscriptions default to 'trialing', not 'active'.
  // Filtering for 'active' only causes this step to always miss after onboarding.
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, membership.tenantId),
        inArray(subscriptions.status, ['active', 'trialing'])
      )
    )
    .limit(1);

  console.log('[pretoken] step=4/subscription', {
    found: !!subscription,
    status: subscription?.status,
    plan: subscription?.plan,
  });

  if (!subscription) {
    // No active or trialing subscription — stamp free plan as safe default
    return emptyClaimsResponse(event);
  }

  // Step 5 — stamp real claims into the JWT
  // These claims are read by middleware on every API request
  // Cast to any because @types/aws-lambda often lags behind V2_0 response shapes
  (event as any).response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: {
          'custom:tenantId': membership.tenantId,
          'custom:role': role.name,
          'custom:plan': subscription.plan,
        },
      },
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          'custom:tenantId': membership.tenantId,
          'custom:role': role.name,
          'custom:plan': subscription.plan,
        },
      },
    },
  };

  console.log('[pretoken] step=5/done — claims stamped', {
    tenantId: membership.tenantId,
    role: role.name,
    plan: subscription.plan,
  });

  return event;
};

/**
 * Helper — stamps empty claims and returns event
 * Used for all cases where tenant context cannot be resolved
 * Empty tenantId signals frontend to redirect to /onboarding
 */
const emptyClaimsResponse = (event: PreTokenGenerationTriggerEvent) => {
  (event as any).response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: {
          'custom:tenantId': '',
          'custom:role': '',
          'custom:plan': 'free',
        },
      },
    },
  };
  return event;
};