import type {
  PreTokenGenerationTriggerEvent,
  PreTokenGenerationTriggerHandler,
} from 'aws-lambda';

/**
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
        'custom:plan': '',
      },
    },
  };

  return event;
};
