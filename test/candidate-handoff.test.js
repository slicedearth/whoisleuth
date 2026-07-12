const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// Tests the framework-neutral handoff core directly (CI runs Node 20, which
// cannot load the .ts wrapper). buildHandoff is exactly what saveCandidateHandoff
// serializes; parseHandoff is exactly what loadCandidateHandoff runs on the raw
// sessionStorage value - so passing a hand-built object to parseHandoff models a
// hostile payload written straight into sessionStorage.
let core;
before(async () => {
  core = await import('../frontend/src/lib/candidate-handoff-core.js');
});

// Models the full save -> sessionStorage -> load path.
function roundTrip(source, candidates, generated) {
  const stored = JSON.parse(JSON.stringify(core.buildHandoff(source, candidates, generated, '2026-07-12T00:00:00.000Z')));
  return core.parseHandoff(stored);
}

function ctCandidate(overrides = {}) {
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
  test('optional CT metadata round-trips through save/load', () => {
    const loaded = roundTrip('certificate-transparency', [ctCandidate()]);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.candidates.length, 1);
    const ct = loaded.candidates[0].certificateTransparency;
    assert.deepStrictEqual(ct.hostnames, ['a.example.com', 'login.example.com']);
    assert.equal(ct.firstObservedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(ct.lastObservedAt, '2026-06-01T00:00:00.000Z');
    assert.equal(ct.certificateCount, 3);
  });

  test('version-1 candidate without CT metadata round-trips unchanged', () => {
    const loaded = roundTrip('typosquat', [{ domain: 'plain.example', source: 'seed', mutationTypes: ['keyword'] }]);
    assert.equal(loaded.candidates.length, 1);
    assert.equal('certificateTransparency' in loaded.candidates[0], false);
    assert.deepStrictEqual(loaded.candidates[0].mutationTypes, ['keyword']);
  });

  test('unknown nested keys are removed on save', () => {
    const stored = core.buildHandoff('certificate-transparency', [
      ctCandidate({ certificateTransparency: { hostnames: ['a.example.com'], firstObservedAt: null, lastObservedAt: null, certificateCount: 1, junk: 'x' } }),
    ]);
    assert.deepStrictEqual(Object.keys(stored.candidates[0].certificateTransparency).sort(), [
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
    const ct = loaded.candidates[0].certificateTransparency;
    assert.equal(ct.hostnames.length, 50);
    assert.ok(ct.hostnames.every((h) => h.length <= 253));
  });

  test('invalid timestamps are rejected', () => {
    const loaded = roundTrip('certificate-transparency', [
      ctCandidate({ certificateTransparency: { hostnames: ['a.example.com'], firstObservedAt: 'garbage', lastObservedAt: '2026-06-01T00:00:00Z', certificateCount: 1 } }),
    ]);
    const ct = loaded.candidates[0].certificateTransparency;
    assert.equal(ct.firstObservedAt, null);
    assert.equal(ct.lastObservedAt, '2026-06-01T00:00:00.000Z');
  });

  test('certificate count is clamped', () => {
    const loaded = roundTrip('certificate-transparency', [
      ctCandidate({ certificateTransparency: { hostnames: ['a.example.com'], firstObservedAt: null, lastObservedAt: null, certificateCount: 9e12 } }),
    ]);
    assert.equal(loaded.candidates[0].certificateTransparency.certificateCount, 1_000_000);
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
      version: 1, createdAt: '2026-07-12T00:00:00.000Z', source: 'manual',
      candidates: [
        { domain: 'ev il.com', source: 's', mutationTypes: [] },
        { domain: 'evil\x00.com', source: 's', mutationTypes: [] },
        { domain: 'a\tb.com', source: 's', mutationTypes: [] },
        { domain: 'good.example', source: 's', mutationTypes: [] },
      ],
    };
    const loaded = core.parseHandoff(stored);
    assert.deepStrictEqual(loaded.candidates.map((c) => c.domain), ['good.example']);
  });

  test('a URL/path payload is canonicalized to its bare hostname', () => {
    const stored = {
      version: 1, createdAt: '2026-07-12T00:00:00.000Z', source: 'manual',
      candidates: [{ domain: 'https://evil.example.com/login?x=1', source: 's', mutationTypes: [] }],
    };
    const loaded = core.parseHandoff(stored);
    assert.deepStrictEqual(loaded.candidates.map((c) => c.domain), ['evil.example.com']);
  });

  test('invalid labels, undotted names, and IPs are dropped', () => {
    const stored = {
      version: 1, createdAt: '2026-07-12T00:00:00.000Z', source: 'manual',
      candidates: [
        { domain: '-bad.example', source: 's', mutationTypes: [] },
        { domain: 'bad-.example', source: 's', mutationTypes: [] },
        { domain: 'localhost', source: 's', mutationTypes: [] },
        { domain: '10.0.0.1', source: 's', mutationTypes: [] },
        { domain: 'ok.example', source: 's', mutationTypes: [] },
      ],
    };
    const loaded = core.parseHandoff(stored);
    assert.deepStrictEqual(loaded.candidates.map((c) => c.domain), ['ok.example']);
  });

  test('parseHandoff rejects non-v1, bad-source, and non-array payloads', () => {
    assert.equal(core.parseHandoff(null), null);
    assert.equal(core.parseHandoff({ version: 2, source: 'manual', candidates: [] }), null);
    assert.equal(core.parseHandoff({ version: 1, source: 'nope', candidates: [] }), null);
    assert.equal(core.parseHandoff({ version: 1, source: 'manual', candidates: 'x' }), null);
  });

  test('candidate input processing is bounded by the handoff limit', () => {
    const many = [];
    for (let i = 0; i < core.MAX_HANDOFF_CANDIDATES + 50; i++) many.push({ domain: `d${i}.example`, source: 's', mutationTypes: [] });
    const stored = core.buildHandoff('manual', many, undefined, '2026-07-12T00:00:00.000Z');
    assert.equal(stored.candidates.length, core.MAX_HANDOFF_CANDIDATES);
  });
});
