const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_SCHEMA,
  MAX_FINDINGS,
  MAX_INPUT_FINDINGS,
  MAX_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_CACHE_TTL_MS,
  defineThreatIntelligenceProvider,
  normalizeThreatIntelligenceTarget,
  createThreatIntelligenceResult,
  buildThreatIntelligenceProviderMatrix,
} = require('../lib/threat-intelligence-contract.mts');

function provider(overrides = {}) {
  return defineThreatIntelligenceProvider({
    id: 'fixture_feed',
    label: 'Fixture feed',
    capabilities: ['domain_lookup', 'url_lookup'],
    targets: { domain: 'registrable_domain', url: 'hostname' },
    interaction: 'lookup_only',
    terms: {
      reviewedAt: '2026-07-15T00:00:00Z',
      termsUrl: 'https://provider.invalid/terms',
      privacyUrl: 'https://provider.invalid/privacy',
      commercialUse: 'allowed',
      attribution: 'required',
      caching: 'bounded',
      queryRetention: 'limited',
      redistribution: 'restricted',
    },
    limits: {
      timeoutMs: 5000,
      maxResponseBytes: 256 * 1024,
      cacheTtlMs: 60_000,
      concurrency: 2,
      dailyRequests: 100,
      monthlyRequests: 1000,
    },
    ...overrides,
  });
}

function finding(overrides = {}) {
  return {
    id: 'fixture-1',
    category: 'phishing',
    severity: 'high',
    confidence: 'medium',
    providerVerdict: 'listed',
    detail: 'Provider-published fixture observation.',
    firstObservedAt: '2026-07-10T00:00:00Z',
    lastObservedAt: '2026-07-14T00:00:00Z',
    referenceUrl: 'https://provider.invalid/record/fixture-1',
    tags: ['credential-lure', 'fixture'],
    ...overrides,
  };
}

describe('threat-intelligence provider definition', () => {
  test('creates a deeply bounded versioned provider policy', () => {
    const value = provider();
    assert.equal(value.version, THREAT_INTELLIGENCE_CONTRACT_VERSION);
    assert.deepEqual(value.capabilities, ['domain_lookup', 'url_lookup']);
    assert.deepEqual(value.targets, { domain: 'registrable_domain', url: 'hostname' });
    assert.equal(value.interaction, 'lookup_only');
    assert.equal(value.terms.reviewedAt, '2026-07-15T00:00:00.000Z');
    assert.equal(value.limits.cacheTtlMs, 60_000);
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.isFrozen(value.terms), true);
  });

  test('rejects unknown fields so credentials cannot hide in definitions', () => {
    assert.throws(() => provider({ apiKey: 'secret' }), /unknown field: apiKey/);
    assert.throws(() => provider({ terms: { ...provider().terms, apiKey: 'secret' } }), /unknown field: apiKey/);
    assert.throws(() => provider({ limits: { ...provider().limits, endpoint: 'secret' } }), /unknown field: endpoint/);
  });

  test('requires a bounded identifier, label, unique capabilities, and supported targets', () => {
    assert.throws(() => provider({ id: '../unsafe' }), /identity is invalid/);
    assert.throws(() => provider({ id: `provider_${'x'.repeat(60)}` }), /identity is invalid/);
    assert.throws(() => provider({ label: '\n' }), /identity is invalid/);
    assert.throws(() => provider({ capabilities: ['domain_lookup', 'domain_lookup'] }), /unique/);
    assert.throws(() => provider({ capabilities: ['domain_lookup'], targets: { url: 'hostname' } }), /requires a domain target/);
    assert.throws(() => provider({ capabilities: ['domain_lookup'], targets: { domain: 'registrable_domain', url: 'hostname' } }), /URL targets require/);
    assert.throws(() => provider({ targets: { ip: 'address' } }), /unknown field: ip/);
  });

  test('permits lookup-only interaction and rejects active submission', () => {
    assert.throws(() => provider({ interaction: 'submit_for_analysis' }), /lookup-only/);
  });

  test('requires reviewed HTTPS terms and enumerated policy decisions', () => {
    assert.throws(() => provider({ terms: { ...provider().terms, reviewedAt: 'unknown' } }), /valid review timestamp/);
    assert.throws(() => provider({ terms: { ...provider().terms, termsUrl: 'http://provider.invalid/terms' } }), /HTTPS policy URLs/);
    assert.throws(() => provider({ terms: { ...provider().terms, commercialUse: 'probably' } }), /Commercial-use policy is invalid/);
    assert.throws(() => provider({ terms: { ...provider().terms, termsUrl: `https://provider.invalid/${'ü'.repeat(1000)}` } }), /HTTPS policy URLs/);
  });

  test('enforces request, response, concurrency, cache, and usage bounds', () => {
    assert.throws(() => provider({ limits: { ...provider().limits, timeoutMs: MAX_TIMEOUT_MS + 1 } }), /Provider timeout/);
    assert.throws(() => provider({ limits: { ...provider().limits, maxResponseBytes: MAX_RESPONSE_BYTES + 1 } }), /Provider response cap/);
    assert.throws(() => provider({ limits: { ...provider().limits, cacheTtlMs: MAX_CACHE_TTL_MS + 1 } }), /Provider cache TTL/);
    assert.throws(() => provider({ limits: { ...provider().limits, concurrency: 11 } }), /Provider concurrency/);
    assert.throws(() => provider({ limits: { ...provider().limits, monthlyRequests: 99 } }), /monthly request budget/);
  });

  test('forbids caching when provider terms prohibit or do not establish it', () => {
    for (const caching of ['prohibited', 'unknown']) {
      assert.throws(() => provider({ terms: { ...provider().terms, caching } }), /cache TTL must be zero/);
    }
    assert.equal(provider({
      terms: { ...provider().terms, caching: 'prohibited', queryRetention: 'none' },
      limits: { ...provider().limits, cacheTtlMs: 0 },
    }).limits.cacheTtlMs, 0);
  });
});

describe('threat-intelligence target exposure', () => {
  test('normalizes domain input to the registrable A-label', () => {
    assert.deepEqual(
      normalizeThreatIntelligenceTarget({ type: 'domain', value: 'Login.BÜCHER.example.' }, 'registrable_domain'),
      { type: 'domain', value: 'xn--bcher-kva.example', exposure: 'registrable_domain' },
    );
  });

  test('makes URL exposure explicit and strips fragments', () => {
    const input = { type: 'url', value: 'https://Login.Example.test/path?q=token#private' };
    assert.equal(normalizeThreatIntelligenceTarget(input, 'registrable_domain').value, 'example.test');
    assert.equal(normalizeThreatIntelligenceTarget(input, 'hostname').value, 'login.example.test');
    assert.equal(normalizeThreatIntelligenceTarget(input, 'origin').value, 'https://login.example.test');
    assert.equal(normalizeThreatIntelligenceTarget(input, 'full_url').value, 'https://login.example.test/path?q=token');
  });

  test('rejects credentials, non-web schemes, IP hosts, controls, and incompatible exposure', () => {
    assert.throws(() => normalizeThreatIntelligenceTarget({ type: 'url', value: 'https://user:pass@example.test/' }, 'full_url'), /URL target is invalid/);
    assert.throws(() => normalizeThreatIntelligenceTarget({ type: 'url', value: 'file:///tmp/secret' }, 'full_url'), /URL target is invalid/);
    assert.throws(() => normalizeThreatIntelligenceTarget({ type: 'url', value: 'https://127.0.0.1/' }, 'origin'), /registrable domain/);
    assert.throws(() => normalizeThreatIntelligenceTarget({ type: 'url', value: 'https://example.test/\nsecret' }, 'full_url'), /URL target is invalid/);
    assert.throws(() => normalizeThreatIntelligenceTarget({ type: 'url', value: `https://example.test/${'ü'.repeat(1000)}` }, 'full_url'), /canonical length limit/);
    assert.throws(() => normalizeThreatIntelligenceTarget({ type: 'domain', value: 'example.test' }, 'full_url'), /exposure is invalid/);
  });
});

describe('threat-intelligence result normalization', () => {
  test('produces separately attributed findings without a global safety verdict', () => {
    const result = createThreatIntelligenceResult(
      provider(),
      { type: 'domain', value: 'example.test' },
      { state: 'success', findings: [finding()] },
      '2026-07-15T01:02:03Z',
    );
    assert.equal(result.schema, THREAT_INTELLIGENCE_SCHEMA);
    assert.equal(result.version, THREAT_INTELLIGENCE_CONTRACT_VERSION);
    assert.deepEqual(result.provider, { id: 'fixture_feed', label: 'Fixture feed' });
    assert.equal(result.state, 'success');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].category, 'phishing');
    assert.equal(Object.hasOwn(result, 'safe'), false);
    assert.equal(Object.hasOwn(result, 'malicious'), false);
    assert.equal(result.observation.complete, true);
    assert.match(result.observation.limitations[0], /attributed context/i);
  });

  test('keeps a provider miss neutral and explicit', () => {
    const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, { state: 'not_found' });
    assert.equal(result.state, 'not_found');
    assert.deepEqual(result.findings, []);
    assert.equal(result.observation.complete, true);
    assert.match(result.observation.limitations.join(' '), /not evidence that the target is safe/i);
  });

  test('keeps skipped, unsupported, rate-limited, unavailable, and error distinct', () => {
    for (const state of ['skipped', 'unsupported', 'rate_limited', 'unavailable', 'error']) {
      const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, {
        state,
        upstreamStatus: state === 'rate_limited' ? 429 : undefined,
        retryAfterSeconds: state === 'rate_limited' ? 60 : undefined,
      });
      assert.equal(result.state, state);
      assert.equal(result.findings.length, 0);
      assert.equal(result.observation.complete, false);
    }
  });

  test('does not allow terminal failure states to hide retained findings', () => {
    const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, {
      state: 'error',
      findings: [finding()],
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.findings.length, 1);
    assert.equal(result.observation.complete, false);
  });

  test('does not convert an empty success into a provider miss', () => {
    const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, { state: 'success' });
    assert.equal(result.state, 'error');
    assert.equal(result.observation.complete, false);
  });

  test('retains provider-declared source truncation as an explicit partial observation', () => {
    const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, {
      state: 'success',
      truncated: true,
      findings: [finding()],
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.observation.complete, false);
    assert.equal(result.observation.truncated, true);
  });

  test('normalizes, sorts, deduplicates, and bounds provider findings', () => {
    const findings = Array.from({ length: MAX_FINDINGS + 5 }, (_, index) => finding({
      id: `finding-${index}`,
      firstObservedAt: '2026-07-01T00:00:00Z',
      lastObservedAt: `2026-07-${String((index % 20) + 1).padStart(2, '0')}T00:00:00Z`,
      tags: Array.from({ length: 30 }, (__, tagIndex) => `tag-${tagIndex}`),
    }));
    findings.push(findings[0]);
    findings.push({ category: 'not-supported' });
    const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, {
      state: 'success', findings,
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.findings.length, MAX_FINDINGS);
    assert.equal(result.findings[0].tags.length, 20);
    assert.equal(result.observation.truncated, true);
    assert.match(result.observation.limitations.join(' '), /omitted/);
  });

  test('caps traversal of pathological input arrays', () => {
    const findings = Array.from({ length: MAX_INPUT_FINDINGS + 10 }, (_, index) => finding({ id: `input-${index}` }));
    const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, { state: 'success', findings });
    assert.equal(result.state, 'partial');
    assert.equal(result.findings.length, MAX_FINDINGS);
    assert.equal(result.observation.diagnostics.discarded >= 10, true);
  });

  test('deduplicates provider IDs deterministically regardless of response order', () => {
    const older = finding({ id: 'same-record', detail: 'Older detail', lastObservedAt: '2026-07-12T00:00:00Z' });
    const newer = finding({ id: 'same-record', detail: 'Newer detail', lastObservedAt: '2026-07-15T00:00:00Z' });
    const forward = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, {
      state: 'success', findings: [older, newer],
    });
    const reverse = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, {
      state: 'success', findings: [newer, older],
    });
    assert.deepEqual(forward.findings, reverse.findings);
    assert.equal(forward.findings[0].detail, 'Newer detail');
  });

  test('rejects malformed dates and insecure references without retaining their fields', () => {
    const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, {
      state: 'success',
      findings: [
        finding({ id: 'bad-date', firstObservedAt: 'later', lastObservedAt: '2026-07-15T00:00:00Z' }),
        finding({ id: 'bad-order', firstObservedAt: '2026-07-15T00:00:00Z', lastObservedAt: '2026-07-14T00:00:00Z' }),
        finding({ id: 'bad-url', referenceUrl: 'http://provider.invalid/record' }),
        finding({ id: 'good' }),
      ],
    });
    assert.equal(result.state, 'partial');
    assert.deepEqual(result.findings.map((item) => item.id), ['good']);
  });

  test('bounds detail, verdict, tags, limitations, status, and retry metadata', () => {
    const result = createThreatIntelligenceResult(provider(), { type: 'domain', value: 'example.test' }, {
      state: 'rate_limited',
      detail: 'x'.repeat(1000),
      upstreamStatus: 999,
      retryAfterSeconds: 100_000,
      limitations: Array.from({ length: 20 }, (_, index) => `limitation-${index}`),
    });
    assert.equal(result.detail.length, 500);
    assert.equal(result.upstreamStatus, null);
    assert.equal(result.retryAfterSeconds, null);
    assert.equal(result.observation.limitations.length, 10);
  });

  test('does not mutate provider input, target input, or result input', () => {
    const definition = provider();
    const target = { type: 'domain', value: 'Example.test' };
    const input = { state: 'success', findings: [finding()] };
    const before = JSON.stringify({ target, input });
    createThreatIntelligenceResult(definition, target, input);
    assert.equal(JSON.stringify({ target, input }), before);
  });

  test('rejects forged provider objects even when they claim the current version', () => {
    const definition = provider();
    assert.throws(() => createThreatIntelligenceResult(
      { ...definition },
      { type: 'domain', value: 'example.test' },
      { state: 'not_found' },
    ), /versioned threat-intelligence provider definition/);
  });
});

describe('provider capability and terms matrix', () => {
  test('sorts definitions and exposes only reviewed non-secret contract fields', () => {
    const first = provider({ id: 'z_feed', label: 'Z feed' });
    const second = provider({ id: 'a_feed', label: 'A feed' });
    const matrix = buildThreatIntelligenceProviderMatrix([first, second]);
    assert.deepEqual(matrix.map((item) => item.id), ['a_feed', 'z_feed']);
    assert.equal(matrix[0].terms.termsUrl, 'https://provider.invalid/terms');
    assert.equal(JSON.stringify(matrix).includes('secret'), false);
    const forged = { ...first, terms: { ...first.terms, apiKey: 'secret' }, limits: { ...first.limits, token: 'secret' } };
    assert.throws(() => buildThreatIntelligenceProviderMatrix([forged]), /unique versioned definitions/);
  });

  test('rejects duplicate, unversioned, and over-limit matrix entries', () => {
    const definition = provider();
    assert.throws(() => buildThreatIntelligenceProviderMatrix([definition, definition]), /unique/);
    assert.throws(() => buildThreatIntelligenceProviderMatrix([{ ...definition, version: 99 }]), /unique versioned/);
    assert.throws(() => buildThreatIntelligenceProviderMatrix(Array(101).fill(definition)), /bounded array/);
  });
});
