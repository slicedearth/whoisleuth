import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  LOOKUP_EVIDENCE_REPLAY_MAX_BYTES,
  LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES,
  parseLookupEvidenceReplay,
} from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';
import {
  buildLookupEvidence,
  LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS,
  LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH,
  LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH,
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/evidence-export.ts';
import { loadLookupEvidenceV25CompatibilityFixtures } from './lookup-evidence-v25-fixtures.mts';

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

test('replay keeps the frozen schema-25 compatibility fixture readable', async () => {
  const input = await readFile(new URL('./fixtures/lookup-evidence-v25.json', import.meta.url), 'utf8');
  const replay = await parseLookupEvidenceReplay(input);
  assert.equal(replay.schemaVersion, 25);
  assert.equal(replay.target, 'legacy.example.test');
  assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'success'));
  assert.ok(replay.sources.some((source) => source.id === 'whois' && source.state === 'complete'));
});

test('replay treats schema-25 diagnostics as authoritative across historical wrapper mismatches', async () => {
  const fixtures = await loadLookupEvidenceV25CompatibilityFixtures();
  for (const fixture of fixtures) {
    const replay = await parseLookupEvidenceReplay(JSON.stringify(fixture.document));
    assert.equal(replay.schemaVersion, 25, fixture.name);
    if (fixture.name === 'fast-whois-skipped') {
      assert.ok(replay.sources.some((source) => source.id === 'whois' && source.state === 'skipped'));
      assert.ok(replay.limitations.some((item) => item.includes('legacy publication wrappers')));
    }
    if (fixture.name === 'unsupported-sources') {
      assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'unsupported'));
      assert.ok(replay.sources.some((source) => source.id === 'whois' && source.state === 'unsupported'));
      assert.ok(!replay.facts.some((fact) => ['rdap', 'whois'].includes(fact.sourceId)));
    }
    if (fixture.name === 'source-errors') {
      assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'error'));
      assert.ok(replay.sources.some((source) => source.id === 'whois' && source.state === 'error'));
    }
    if (fixture.name === 'rdap-not-found') {
      assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'not found'));
      assert.ok(!replay.facts.some((fact) => fact.sourceId === 'rdap'));
    }
  }
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

test('replay preserves unavailable registry states and rejects diagnostic contradictions', async () => {
  const exported = buildLookupEvidence({
    query: 'example.test',
    type: 'domain',
    inputHostname: 'example.test',
    registrableDomain: 'example.test',
    diagnostics: {
      rdap: { status: 'unsupported' },
      whois: { status: 'skipped' },
    },
    availability: { applicable: true, state: 'unknown', confidence: 'low' },
  }, { generatedAt: '2026-07-31T00:00:00.000Z', applicationVersion: '1.47.1' });
  const replay = await parseLookupEvidenceReplay(JSON.stringify(exported));
  assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'unsupported'));
  assert.ok(replay.sources.some((source) => source.id === 'whois' && source.state === 'skipped'));
  assert.ok(replay.unknowns.some((item) => item.startsWith('Registry RDAP: unsupported')));
  assert.ok(replay.unknowns.some((item) => item.startsWith('WHOIS: skipped')));

  const contradictory = structuredClone(exported);
  (contradictory.sources as Record<string, Record<string, unknown>>).rdap!.status = 'success';
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(contradictory)),
    /source states contradict/iu,
  );
});

test('replay attributes complete WHOIS domain and lifecycle facts without marking the source incomplete', async () => {
  const exported = buildLookupEvidence({
    query: 'example.test', type: 'domain', inputHostname: 'example.test',
    registrableDomain: 'example.test', isSubdomain: false,
    diagnostics: {
      rdap: { status: 'unsupported' },
      whois: { status: 'complete', queriedAt: '2026-07-31T00:00:00.000Z' },
      availability: { status: 'complete', resultState: 'registered' },
    },
    whois: {
      parsed: {
        domainName: 'EXAMPLE.TEST', registrar: 'Example Registrar',
        createdDateIso: '2020-01-01T00:00:00.000Z',
        expiryDateIso: '2030-01-01T00:00:00.000Z',
      },
      chain: [{ server: 'whois.example.test', queriedAt: '2026-07-31T00:00:00.000Z', response: 'bounded fixture' }],
    },
    availability: { applicable: true, state: 'registered', confidence: 'medium' },
  }, { generatedAt: '2026-07-31T00:00:00.000Z' });
  const replay = await parseLookupEvidenceReplay(JSON.stringify(exported));
  assert.ok(replay.facts.some((fact) => fact.id === 'registration.domain'
    && fact.value === 'EXAMPLE.TEST' && fact.sourceId === 'whois'));
  assert.ok(replay.facts.some((fact) => fact.id === 'registration.created'
    && fact.value === '2020-01-01T00:00:00.000Z' && fact.sourceId === 'whois'));
  assert.ok(replay.facts.some((fact) => fact.id === 'registration.expires'
    && fact.value === '2030-01-01T00:00:00.000Z' && fact.sourceId === 'whois'));
  assert.ok(!replay.unknowns.some((item) => item.startsWith('WHOIS:')));
});

test('replay never builds positive network relationships from an unavailable network source', async () => {
  const document = evidence();
  (document.sources as Record<string, unknown>).network = {
    contextVersion: 1, version: 1, status: 'unsupported', observedAt: null,
    scanMode: null, source: null, durationMs: null, complete: false, truncated: false,
    limitations: [], diagnostics: null, detail: 'Unavailable fixture',
    endpoint: { address: '192.0.2.10', family: 4, selectedFrom: 'dns_a' },
    rdap: null,
    network: { handle: null, name: 'Injected network', holder: null, cidrs: ['192.0.2.0/24'], startAddress: null, endAddress: null, country: null, networkType: null, databaseUpdatedAt: null },
  };
  const replay = await parseLookupEvidenceReplay(JSON.stringify(document));
  assert.ok(!replay.graph.nodes.some((node) => ['192.0.2.10', 'Injected network', '192.0.2.0/24'].includes(node.label)));
  assert.ok(!replay.graph.edges.some((edge) => ['observed-endpoint', 'registered-with', 'publishes-prefix'].includes(edge.kind)));
});

test('replay fails closed for foreign, future, malformed, and oversized documents', async () => {
  await assert.rejects(() => parseLookupEvidenceReplay('{'), /valid JSON/u);
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence()).replace(
      `"schemaVersion":${LOOKUP_EVIDENCE_SCHEMA_VERSION}`,
      `"nonFinite":1e400,"schemaVersion":${LOOKUP_EVIDENCE_SCHEMA_VERSION}`,
    )),
    /contains a non-finite number/u,
  );
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
    /(?:over-bound array|20000-value limit|container with more than 10000 items)/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: Array.from({ length: LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS + 1 }, () => null),
    }))),
    /(?:over-bound array|container with more than 10000 items)/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: 'x'.repeat(LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH + 1),
    }))),
    /over-bound string/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: { ['x'.repeat(LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH + 1)]: true },
    }))),
    /(?:over-bound object|container with more than 10000 items)/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: Object.fromEntries(Array.from(
        { length: LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS + 1 },
        (_, index) => [`key-${index}`, null],
      )),
    }))),
    /(?:over-bound object|container with more than 10000 items)/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({ extra: { 'unsafe\u0000key': true } }))),
    /over-bound object/u,
  );
});
