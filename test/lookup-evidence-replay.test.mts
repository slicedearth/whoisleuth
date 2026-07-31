import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOOKUP_EVIDENCE_REPLAY_MAX_BYTES,
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
          connectedAddress: '192.0.2.10',
          certificate: { fingerprintSha256: 'a'.repeat(64) },
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
  assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'success'));
  assert.ok(replay.facts.some((fact) => fact.label === 'Detected technology' && fact.value === 'Example CMS'));
  assert.ok(replay.contradictions.some((value) => value.includes('Statuses')));
  assert.equal(JSON.stringify(replay).includes('<script>'), true);
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
});
