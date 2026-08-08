import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOOKUP_EVIDENCE_REPLAY_MAX_BYTES,
  LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES,
  parseLookupEvidenceReplay,
} from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';
import {
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/evidence-export.ts';

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: LOOKUP_EVIDENCE_SCHEMA,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    generatedAt: '2026-07-31T00:00:00.000Z',
    application: {
      name: 'WHOISleuth',
      version: '1.34.1',
      projectUrl: 'https://github.com/slicedearth/whoisleuth',
    },
    query: { submitted: 'example.test', registrableDomain: 'example.test', type: 'domain' },
    diagnostics: {
      rdap: { status: 'success', fetchedAt: '2026-07-31T00:00:00.000Z' },
      whois: { status: 'partial', queriedAt: '2026-07-31T00:00:00.000Z' },
    },
    sources: {
      rdap: {
        status: 'success',
        parsed: {
          domain: 'example.test',
          registrar: { name: 'Example Registrar' },
          nameservers: ['ns1.example.test'],
          lifecycle: { createdIso: '2025-01-01T00:00:00.000Z' },
        },
      },
      whois: { status: 'partial', parsed: { domain: 'example.test' } },
      reverseDns: null,
      network: null,
      securityTxt: null,
      sslbl: null,
    },
    analysis: {
      availability: {
        state: 'registered',
        confidence: 'high',
        dns: { status: 'success', records: {} },
        http: { status: 'success', finalUrl: 'https://example.test/' },
        tls: {
          status: 'success',
          complete: true,
          connectedAddress: '192.0.2.10',
          authorization: { authorized: true, error: null },
          hostname: { matches: true, error: null },
          certificate: {
            fingerprintSha256: 'a'.repeat(64),
            validFrom: '2026-07-01T00:00:00.000Z',
            validTo: '2026-10-01T00:00:00.000Z',
            subjectAltNames: { dnsNames: ['example.test'] },
          },
        },
        pageIdentity: { status: 'success', title: '<script>alert(1)</script>' },
        technologyProfile: { status: 'success', findings: [{ name: 'Example CMS' }] },
      },
      registryComparison: {
        fields: [{ label: 'Statuses', status: 'conflict' }],
      },
      registrarPublicationComparison: null,
    },
    ...overrides,
  };
}

test('replay validates and summarizes a current first-party export without raw rendering', async () => {
  const replay = await parseLookupEvidenceReplay(JSON.stringify(evidence()));
  assert.equal(replay.target, 'example.test');
  assert.equal(replay.availability, 'registered');
  assert.equal(replay.digestSha256.length, 64);
  assert.equal(replay.digestVerified, false);
  assert.equal(replay.generatorVersion, '1.34.1');
  assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'success'));
  assert.ok(replay.facts.some((fact) => fact.id === 'technology.detected'
    && fact.sourceId === 'technology'
    && fact.sourceState === 'success'
    && fact.label === 'Detected technology'
    && fact.value === 'Example CMS'));
  assert.ok(replay.facts.some((fact) => fact.id === 'registration.registrar'
    && fact.sourceId === 'rdap'
    && fact.sourceState === 'success'));
  assert.ok(replay.contradictions.some((value) => value.includes('Statuses')));
  assert.ok(replay.unknowns.some((value) => value.includes('WHOIS')));
  assert.ok(replay.recommendedSteps.some((value) => value.includes('historical evidence')));
  assert.ok(replay.graph.edges.some((edge) => edge.kind === 'presents-certificate'));
  assert.ok(replay.graph.edges.some((edge) => edge.kind === 'reviewed-hostname-match'));
  assert.ok(replay.graph.edges.some((edge) => edge.kind === 'reviewed-runtime-trust'));
  assert.equal(JSON.stringify(replay).includes('<script>'), true);
});

test('replay verifies an explicitly supplied checksum and rejects a mismatch', async () => {
  const input = JSON.stringify(evidence());
  const calculated = await parseLookupEvidenceReplay(input);
  const verified = await parseLookupEvidenceReplay(input, {
    expectedSha256: calculated.digestSha256.toUpperCase(),
  });
  assert.equal(verified.digestVerified, true);
  await assert.rejects(
    () => parseLookupEvidenceReplay(input, { expectedSha256: '0'.repeat(64) }),
    /does not match/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(input, { expectedSha256: 'invalid' }),
    /64 hexadecimal/u,
  );
});

test('replay fails closed for foreign, future, malformed, and oversized documents', async () => {
  await assert.rejects(() => parseLookupEvidenceReplay('{'), /valid JSON/u);
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({ schema: 'other' }))),
    /not a WHOISleuth/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({ schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION + 1 }))),
    /Only Lookup evidence schema/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay('x'.repeat(LOOKUP_EVIDENCE_REPLAY_MAX_BYTES + 1)),
    /limited to 5 MB/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: Array.from({ length: LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES + 1 }, () => null),
    }))),
    /structured entries/u,
  );
});
