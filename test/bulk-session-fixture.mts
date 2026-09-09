import { BULK_SESSION_SCHEMA, BULK_SESSION_SCHEMA_VERSION } from '../packages/contracts/workspace-portability.mts';
import { MAX_BULK_SESSION_STORE_BYTES, normalizeBulkSessionStore, serializeBulkSessionStore } from '../packages/workspace/bulk-session-model.mts';
import { relationshipObservation } from '../packages/comparison/relationship-evidence.mts';

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

/** Current per-source provenance, including a positive but incomplete TLS source. */
export function richSourceQualifiedBulkSessionStore(count = 2_000) {
  const store = normalizeBulkSessionStore(richBulkSessionStore(count));
  const observedAt = '2026-08-01T01:00:00.000Z';
  for (const row of store.sessions[0]!.results) {
    row.observedAt = observedAt;
    row.relationship = relationshipObservation({
      nameservers: row.nameservers,
      dns: { ...row.dns, version: 1, source: 'dns', observedAt, complete: true, truncated: false },
      tls: { version: 1, profileVersion: 2, source: 'tls', status: 'partial', observedAt,
        complete: false, truncated: false, certificate: { fingerprintSha256: 'a'.repeat(64) } },
    });
  }
  return store;
}

export function bulkStoreAtCapacity() {
  const store = normalizeBulkSessionStore(richBulkSessionStore());
  let remaining = MAX_BULK_SESSION_STORE_BYTES - Buffer.byteLength(serializeBulkSessionStore(store));
  for (const field of ['error', 'registrar', 'activity', 'pageTitle'] as const) {
    for (const row of store.sessions[0]!.results) {
      const added = Math.min(250 - (row[field]?.length ?? 0), remaining);
      row[field] = `${row[field] ?? ''}${'x'.repeat(added)}`;
      remaining -= added;
    }
  }
  if (remaining !== 0 || Buffer.byteLength(serializeBulkSessionStore(store)) !== MAX_BULK_SESSION_STORE_BYTES) {
    throw new Error('The Bulk fixture did not retain its exact capacity.');
  }
  return store;
}
