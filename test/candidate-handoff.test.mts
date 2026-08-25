import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../frontend/src/lib/candidate-handoff-core.ts';
import { requiredValue } from './value-assertions.mts';

const HANDOFF_ID = '0123456789abcdef0123456789abcdef';

// Tests the framework-neutral handoff core directly without requiring browser
// sessionStorage. serializeCandidateHandoff is exactly what
// saveCandidateHandoff persists; parseSerializedHandoff is exactly what the
// loader applies, so the round-trip covers both byte admission and schema
// normalisation.
// Models the full save -> sessionStorage -> load path.
type NonEmptyHandoff = Omit<core.CandidateHandoff, 'candidates'> & {
  candidates: [core.Candidate, ...core.Candidate[]];
};

function roundTrip(
  source: core.HandoffSource,
  candidates: readonly unknown[],
  generated?: readonly unknown[],
): NonEmptyHandoff {
  const stored = requiredValue(core.serializeCandidateHandoff(
    source,
    candidates,
    generated,
    '2026-07-12T00:00:00.000Z',
    HANDOFF_ID,
  ));
  const loaded = requiredValue(core.parseSerializedHandoff(stored.serialized));
  assert.ok(loaded.candidates.length > 0);
  return loaded as NonEmptyHandoff;
}

function ctCandidate(overrides: Record<string, unknown> = {}) {
  return {
    domain: 'example.com',
    source: 'example',
    mutationTypes: ['certificate_transparency'],
    certificateTransparency: {
      hostnames: ['a.example.com', 'login.example.com'],
      firstObservedAt: '2026-01-01T00:00:00.000Z',
      lastObservedAt: '2026-06-01T00:00:00.000Z',
      certificateCount: 3,
    },
    ...overrides,
  };
}

describe('candidate handoff CT provenance', () => {
  test('binds direct handoffs exactly while admitting reviewed Discover sources through the shared route', () => {
    assert.equal(core.handoffMatchesNavigationSource('manual', 'manual'), true);
    assert.equal(core.handoffMatchesNavigationSource('manual', 'discover'), false);
    assert.equal(core.handoffMatchesNavigationSource('nameserver', 'discover'), true);
    assert.equal(core.handoffMatchesNavigationSource('certificate-transparency', 'discover'), true);
    assert.equal(core.handoffMatchesNavigationSource('typosquat', 'keyword'), false);
  });

  test('optional CT metadata round-trips through save/load', () => {
    const loaded = roundTrip('certificate-transparency', [ctCandidate()]);
    assert.equal(loaded.version, 2);
    assert.equal(loaded.token, HANDOFF_ID);
    assert.equal(loaded.candidates.length, 1);
    const ct = requiredValue(loaded.candidates[0].certificateTransparency);
    assert.deepStrictEqual(ct.hostnames, ['a.example.com', 'login.example.com']);
    assert.equal(ct.firstObservedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(ct.lastObservedAt, '2026-06-01T00:00:00.000Z');
    assert.equal(ct.certificateCount, 3);
  });

  test('candidate without CT metadata round-trips unchanged', () => {
    const loaded = roundTrip('typosquat', [{ domain: 'plain.example', source: 'seed', mutationTypes: ['keyword'] }]);
    assert.equal(loaded.candidates.length, 1);
    assert.equal('certificateTransparency' in loaded.candidates[0], false);
    assert.deepStrictEqual(loaded.candidates[0].mutationTypes, ['keyword']);
  });

  test('registry nameserver candidates retain their explicit handoff source', () => {
    const loaded = roundTrip('nameserver', [{
      domain: 'matched.example',
      source: 'ns1.infrastructure.example',
      mutationTypes: ['rdap_nameserver_search'],
    }]);
    assert.equal(loaded.source, 'nameserver');
    assert.equal(loaded.candidates[0].domain, 'matched.example');
    assert.deepStrictEqual(loaded.candidates[0].mutationTypes, ['rdap_nameserver_search']);
  });

  test('unknown nested keys are removed on save', () => {
    const stored = core.buildHandoff('certificate-transparency', [
      ctCandidate({ certificateTransparency: { hostnames: ['a.example.com'], firstObservedAt: null, lastObservedAt: null, certificateCount: 1, junk: 'x' } }),
    ], undefined, undefined, HANDOFF_ID);
    assert.deepStrictEqual(Object.keys(requiredValue(requiredValue(stored.candidates[0]).certificateTransparency)).sort(), [
      'certificateCount', 'firstObservedAt', 'hostnames', 'lastObservedAt',
    ]);
  });

  test('malformed CT metadata is discarded without losing the candidate', () => {
    const loaded = roundTrip('certificate-transparency', [ctCandidate({ certificateTransparency: 'not-an-object' })]);
    assert.equal(loaded.candidates.length, 1);
    assert.equal(loaded.candidates[0].domain, 'example.com');
    assert.equal(loaded.candidates[0].certificateTransparency, undefined);
  });

  test('hostname count and length bounds are enforced', () => {
    const hostnames = [];
    for (let i = 0; i < 80; i++) hostnames.push(`h${String(i).padStart(2, '0')}.example.com`);
    hostnames.push(`${'x'.repeat(300)}.example.com`); // overlong, dropped
    const loaded = roundTrip('certificate-transparency', [
      ctCandidate({ certificateTransparency: { hostnames, firstObservedAt: null, lastObservedAt: null, certificateCount: 1 } }),
    ]);
    const ct = requiredValue(loaded.candidates[0].certificateTransparency);
    assert.equal(ct.hostnames.length, 50);
    assert.ok(ct.hostnames.every((h) => h.length <= 253));
  });

  test('invalid timestamps are rejected', () => {
    const loaded = roundTrip('certificate-transparency', [
      ctCandidate({ certificateTransparency: { hostnames: ['a.example.com'], firstObservedAt: 'garbage', lastObservedAt: '2026-06-01T00:00:00Z', certificateCount: 1 } }),
    ]);
    const ct = requiredValue(loaded.candidates[0].certificateTransparency);
    assert.equal(ct.firstObservedAt, null);
    assert.equal(ct.lastObservedAt, '2026-06-01T00:00:00.000Z');
  });

  test('certificate count is clamped', () => {
    const loaded = roundTrip('certificate-transparency', [
      ctCandidate({ certificateTransparency: { hostnames: ['a.example.com'], firstObservedAt: null, lastObservedAt: null, certificateCount: 9e12 } }),
    ]);
    assert.equal(requiredValue(loaded.candidates[0].certificateTransparency).certificateCount, 1_000_000);
  });

  test('mutation provenance and bounded source are retained', () => {
    const loaded = roundTrip('certificate-transparency', [ctCandidate({ source: 'x'.repeat(400) })]);
    const candidate = loaded.candidates[0];
    assert.deepStrictEqual(candidate.mutationTypes, ['certificate_transparency']);
    assert.equal(candidate.source.length, 253);
  });
});

describe('strict domain validation against hostile sessionStorage payloads', () => {
  // Each payload models a value written directly into sessionStorage and then
  // loaded (parseHandoff). Strict normalization must drop or canonicalize it.
  test('whitespace, control-character, and separator domains are dropped', () => {
    const stored = {
      version: 2, token: HANDOFF_ID, createdAt: '2026-07-12T00:00:00.000Z', source: 'manual',
      candidates: [
        { domain: 'ev il.example', source: 's', mutationTypes: [] },
        { domain: 'bad\x00.example', source: 's', mutationTypes: [] },
        { domain: 'a\tb.example', source: 's', mutationTypes: [] },
        { domain: 'good.example', source: 's', mutationTypes: [] },
      ],
    };
    const loaded = requiredValue(core.parseHandoff(stored));
    assert.deepStrictEqual(loaded.candidates.map((c) => c.domain), ['good.example']);
  });

  test('a URL/path payload is canonicalized to its bare hostname', () => {
    const stored = {
      version: 2, token: HANDOFF_ID, createdAt: '2026-07-12T00:00:00.000Z', source: 'manual',
      candidates: [{ domain: 'https://unsafe.example/login?x=1', source: 's', mutationTypes: [] }],
    };
    const loaded = requiredValue(core.parseHandoff(stored));
    assert.deepStrictEqual(loaded.candidates.map((c) => c.domain), ['unsafe.example']);
  });

  test('invalid labels, undotted names, and IPs are dropped', () => {
    const stored = {
      version: 2, token: HANDOFF_ID, createdAt: '2026-07-12T00:00:00.000Z', source: 'manual',
      candidates: [
        { domain: '-bad.example', source: 's', mutationTypes: [] },
        { domain: 'bad-.example', source: 's', mutationTypes: [] },
        { domain: 'localhost', source: 's', mutationTypes: [] },
        { domain: '10.0.0.1', source: 's', mutationTypes: [] },
        { domain: 'ok.example', source: 's', mutationTypes: [] },
      ],
    };
    const loaded = requiredValue(core.parseHandoff(stored));
    assert.deepStrictEqual(loaded.candidates.map((c) => c.domain), ['ok.example']);
  });

  test('parseHandoff rejects unsupported, unbound, bad-source, and non-array payloads', () => {
    assert.equal(core.parseHandoff(null), null);
    assert.equal(core.parseHandoff({ version: 1, token: HANDOFF_ID, source: 'manual', candidates: [] }), null);
    assert.equal(core.parseHandoff({ version: 2, token: 'bad', source: 'manual', candidates: [] }), null);
    assert.equal(core.parseHandoff({ version: 2, token: HANDOFF_ID, source: 'nope', candidates: [] }), null);
    assert.equal(core.parseHandoff({ version: 2, token: HANDOFF_ID, source: 'manual', candidates: 'x' }), null);
    assert.equal(core.parseHandoff({ version: 2, token: HANDOFF_ID, createdAt: 'not-a-date', source: 'manual', candidates: [] }), null);
    assert.equal(core.parseHandoff({ version: 2, token: HANDOFF_ID, createdAt: '2026-07-12T00:00:00', source: 'manual', candidates: [] }), null);
    assert.equal(
      core.parseHandoff({ version: 2, token: HANDOFF_ID, createdAt: '2026-07-12T12:00:00+01:00', source: 'manual', candidates: [] })?.createdAt,
      '2026-07-12T11:00:00.000Z',
    );
    assert.throws(
      () => core.buildHandoff('manual', [], undefined, '2026-07-12T00:00:00', HANDOFF_ID),
      /explicit timezone/u,
    );
  });

  test('rejects malformed and oversized serialized tab values before normalization', () => {
    assert.equal(core.parseSerializedHandoff('{broken'), null);
    assert.equal(
      core.parseSerializedHandoff('x'.repeat(core.MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES + 1)),
      null,
    );
    const valid = JSON.stringify(core.buildHandoff('manual', [{
      domain: 'ok.example', source: 'manual', mutationTypes: [],
    }], undefined, '2026-07-12T00:00:00.000Z', HANDOFF_ID));
    assert.equal(core.parseSerializedHandoff(valid)?.candidates[0]?.domain, 'ok.example');
  });

  test('candidate input processing is bounded by the handoff limit', () => {
    const many = [];
    for (let i = 0; i < core.MAX_HANDOFF_CANDIDATES + 50; i++) many.push({ domain: `d${i}.example`, source: 's', mutationTypes: [] });
    const stored = core.buildHandoff('manual', many, undefined, '2026-07-12T00:00:00.000Z', HANDOFF_ID);
    assert.equal(stored.candidates.length, core.MAX_HANDOFF_CANDIDATES);
  });

  test('caps optional generated context so the saved envelope always round-trips', () => {
    const candidates = [{ domain: 'selected.example', source: 'manual', mutationTypes: [] }];
    const generated = Array.from({ length: core.MAX_GENERATED_CONTEXT }, (_, index) => ({
      domain: `generated-${index}.example`,
      source: 'x'.repeat(core.MAX_SOURCE_LENGTH),
      mutationTypes: Array.from({ length: core.MAX_MUTATION_TYPES }, (_value, typeIndex) => `type-${typeIndex}-${'x'.repeat(60)}`),
    }));
    const stored = requiredValue(core.serializeCandidateHandoff(
      'typosquat',
      candidates,
      generated,
      '2026-07-12T00:00:00.000Z',
      HANDOFF_ID,
    ));
    assert.ok(new TextEncoder().encode(stored.serialized).byteLength <= core.MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES);
    assert.equal(stored.handoff.candidates.length, 1);
    assert.equal(stored.handoff.generatedCandidatesTruncated, true);
    assert.equal(stored.handoff.generatedCandidateTotal, core.MAX_GENERATED_CONTEXT);
    assert.ok((stored.handoff.generatedCandidates?.length ?? 0) < core.MAX_GENERATED_CONTEXT);
    const loaded = requiredValue(core.parseSerializedHandoff(stored.serialized));
    assert.equal(loaded.candidates[0]?.domain, 'selected.example');
    assert.equal(loaded.generatedCandidatesTruncated, true);
    assert.equal(loaded.generatedCandidateTotal, core.MAX_GENERATED_CONTEXT);
  });

  test('refuses a save when selected candidates alone exceed the byte ceiling', () => {
    const candidates = Array.from({ length: core.MAX_HANDOFF_CANDIDATES }, (_, index) => ({
      domain: `selected-${index}.example`,
      source: 'x'.repeat(core.MAX_SOURCE_LENGTH),
      mutationTypes: Array.from({ length: core.MAX_MUTATION_TYPES }, (_value, typeIndex) => `type-${typeIndex}-${'x'.repeat(60)}`),
    }));
    assert.equal(core.serializeCandidateHandoff(
      'manual',
      candidates,
      undefined,
      '2026-07-12T00:00:00.000Z',
      HANDOFF_ID,
    ), null);
  });
});
