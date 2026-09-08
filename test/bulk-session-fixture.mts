import { BULK_SESSION_SCHEMA, BULK_SESSION_SCHEMA_VERSION } from '../packages/contracts/workspace-portability.mts';

/** A settled, mail-bearing workload with per-row objects, arrays and sources. */
export function richBulkSessionStore(count = 2_000) {
  const observedAt = '2026-08-01T00:00:00.000Z';
  const profileContext = { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' };
  const results = Array.from({ length: count }, (_, index) => ({
    domain: `item${String(index).padStart(4, '0')}.example`,
    status: 'complete',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Example Registrar',
    activity: 'Observed static page',
    risk: null,
    opportunity: null,
    mutationTypes: ['substitution'],
    scanDepth: 'deep',
    nameservers: [`ns${index % 4}.example.test`],
    hasMx: true,
    hasNullMx: false,
    hasSpf: true,
    hasDmarc: true,
    activityStatus: 'active',
    pageTitle: 'Example page',
    hasPasswordField: false,
    hasActiveBrandProfile: false,
    dns: { status: 'success', records: { a: ['192.0.2.20'], aaaa: [], cname: [], caa: [] } },
    relationship: { version: 2, nameservers: [`ns${index % 4}.example.test`], truncated: false },
    sourceCoverage: [{ source: 'dns', state: 'complete' }, { source: 'rdap', state: 'complete' }],
    profileContext: { ...profileContext },
  }));
  return {
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions: [{
      id: 'rich-bulk',
      name: 'Retained Bulk workload',
      mode: 'deep',
      state: 'complete',
      inputDigest: `sha256:${'d'.repeat(64)}`,
      domains: results.map((row) => row.domain),
      results,
      startedAt: observedAt,
      updatedAt: observedAt,
      completedAt: observedAt,
      profileContext,
    }],
  };
}
