import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { DOMAIN_HISTORY_INPUT_SCHEMA, PLATFORM_CONTINUITY_INPUT_SCHEMA, STOREFRONT_INPUT_SCHEMA, CONNECTOR_INPUT_SCHEMA, INCIDENT_SEQUENCE_INPUT_SCHEMA } from '../packages/contracts/context-review.mts';
export const CONTEXT_NOW = '2026-09-22T00:00:00.000Z';
export const CONTEXT_BEFORE = '2026-09-20T00:00:00.000Z';
export function historyCase() {
  const webCollectionQuality = { version: 1, page: 'complete', favicon: 'not_collected', combined: 'partial' } as const;
  const before = createCase({ domain: 'example.test', source: 'lookup', evidence: { scanDepth: 'deep', webCollectionQuality, capturedAt: CONTEXT_BEFORE, registrar: 'Example registrar', nameservers: ['ns1.example.test'], hasMx: true, hasSpf: true, hasDmarc: true, pageTitle: 'Earlier site', activityStatus: 'active' } }, CONTEXT_BEFORE);
  return updateCase([before], before.id, { evidence: { scanDepth: 'deep', webCollectionQuality, capturedAt: CONTEXT_NOW, registrar: 'Different registrar', nameservers: ['ns2.example.test'], hasMx: false, hasSpf: false, hasDmarc: false, pageTitle: 'Changed site', activityStatus: 'active' } }, CONTEXT_NOW).record;
}
export function platformObject() {
  return { platformOrigin: 'https://platform.example.test', objectType: 'extension' as const, objectId: 'extension-17', version: '1.0.0', observedAt: CONTEXT_BEFORE, source: 'Analyst-selected manifest', report: 'acknowledged' as const, providerOutcome: 'provider_reports_resolved' as const, recheck: 'still_observed' as const, recheckedAt: CONTEXT_NOW };
}
export function storefrontObservation(hostname = 'official.example.test') {
  return { hostname, observedAt: CONTEXT_BEFORE, source: 'Authorised fixture capture', brandNames: ['Example shop'], contactDomains: ['contact.example.test'], policyHashes: ['a'.repeat(64)], checkoutOrigins: ['https://checkout.example.test'], paymentMethods: ['card'], assetHashes: ['b'.repeat(64)] };
}
export function incidentStage() {
  return { id: 'reported-stage', kind: 'credential_entry' as const, basis: 'reported_action' as const, description: 'The reporter entered a password into the displayed form.',
    occurredAt: null, hostname: 'example.test', source: 'Reporter interview', reference: 'interview-17', referenceSha256: null, completeness: 'unknown' as const, limitations: ['Event time not supplied.'] };
}
export function contextInputs() {
  const record = historyCase();
  return [
    { schema: DOMAIN_HISTORY_INPUT_SCHEMA, version: 1, evidence: { caseExport: { version: CASE_SCHEMA_VERSION, cases: [record] }, caseId: record.id, declarations: { expectedChanges: [{ family: 'dns', start: CONTEXT_BEFORE, end: CONTEXT_NOW, reason: 'Approved nameserver change' }], retiredDependencies: [{ asset: 'www.example.test', dependency: 'retired.example.test', family: 'web', retiredAt: CONTEXT_BEFORE, source: 'Asset register' }] } } },
    { schema: PLATFORM_CONTINUITY_INPUT_SCHEMA, version: 1, evidence: [platformObject(), { ...platformObject(), version: '2.0.0', observedAt: CONTEXT_NOW }] },
    { schema: STOREFRONT_INPUT_SCHEMA, version: 1, evidence: { official: storefrontObservation(), candidate: storefrontObservation('candidate.example.test'), authorisedComparator: true, resellerStatus: 'authorised', resellerSource: 'Rights-holder reseller register' } },
    { schema: CONNECTOR_INPUT_SCHEMA, version: 1, evidence: { current: { mcpServers: { remote: { url: 'https://connector.example.test/private?token=excluded-sentinel', headers: { Authorization: 'excluded-auth-value' }, capabilities: { tools: {} } }, local: { command: '/private/selected/bin/npx', args: ['--yes', '@example/connector@1.0.0', '--secret', 'excluded-argument-value'], env: { KEY: 'excluded-env-value' } } } }, previous: null } },
    { schema: INCIDENT_SEQUENCE_INPUT_SCHEMA, version: 1, evidence: [incidentStage()] },
  ];
}
