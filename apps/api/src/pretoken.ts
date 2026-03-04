import type {
  PreTokenGenerationTriggerEvent,
  PreTokenGenerationTriggerHandler,
} from 'aws-lambda';

import { db } from '@serverless-saas/database';
import { users } from '@serverless-saas/database/schema/auth';
import { eq } from 'drizzle-orm';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { roles } from '@serverless-saas/database/schema/authorization';
import { subscriptions } from '@serverless-sass/databse/schema/billing';

const cognitoId = event.username
const email = event.request.userAttributes.email;
const name = event.request.userAttributes.name;


const user = await.db.query.users.findfirst({
  where: eq(users.cognitoId,cognitoId)
})

if (!user) {
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
}
}


const membership = await db.query.memberships.findFirst({
  where: eq(memberships.userId,user.id)
})

if (!membership) {
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
 }
}

const role = await db.query.roles.findFirst({
  where: eq(roles.id,membership.roleId)
})

if (!role) {
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        'custom:tenantId': '',
        'custom:role': '',
        'custom:plan': 'free',
      },
    },
  },
  return event;
 }
}

 * Cognito Pre Token Generation Lambda
 *
 * Runs synchronously on every login — must complete within 5s.
 * Stamps tenantId, role, and plan as custom claims into the JWT.
 *
 * TODO: implement DB lookup once @serverless-saas/database package is ready.
 */
export const handler: PreTokenGenerationTriggerHandler = async (
  event: PreTokenGenerationTriggerEvent
) => {
   
  // TODO: Query memberships + subscriptions for this cognitoId
  // const context = await resolveTenantContext(event.request.userAttributes.sub);

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

export const handler: PreTokenGenerationTriggerHandler = async (
  event: PreTokenGenerationTriggerEvent
) => {

  // TODO: Query memberships + subscriptions for this cognitoId
  // const context = await resolveTenantContext(event.request.userAttributes.sub);

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

