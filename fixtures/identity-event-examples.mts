export const IDENTITY_EXAMPLE_APP = '11111111-1111-4111-8111-111111111111';
export const IDENTITY_EXAMPLE_TENANT = '22222222-2222-4222-8222-222222222222';
export function identityEventExample() {
  return { value: [
    { createdDateTime: '2026-01-01T00:05:00Z', status: { errorCode: 0, failureReason: 'private-reason' }, appId: IDENTITY_EXAMPLE_APP,
      resourceTenantId: IDENTITY_EXAMPLE_TENANT, authenticationProtocol: 'deviceCode', userId: 'private-user-id', userPrincipalName: 'private-user@example.test', ipAddress: '192.0.2.1', clientAppUsed: 'Browser', token: '<identity-fixture-token>' },
    { createdDateTime: '2026-01-01T00:06:00Z', status: { errorCode: 50126 }, appId: IDENTITY_EXAMPLE_APP, userId: 'private-user-id' },
    { createdDateTime: 'not-an-instant', status: {}, userId: 'other-private-user', clientAppUsed: 'Browser' },
  ] };
}
export const identityEventScope = () => ({ applicationId: IDENTITY_EXAMPLE_APP, tenantId: IDENTITY_EXAMPLE_TENANT,
  actorLabel: 'Actor 1', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:10:00Z' });
