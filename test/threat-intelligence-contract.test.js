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
  CURATED_CONNECTOR_CONTRACT_VERSION,
  CURATED_CONNECTOR_RESULT_SCHEMA,
  MAX_CONNECTOR_ENTITIES,
  MAX_CONNECTOR_RELATIONSHIPS,
  MAX_CONNECTOR_INPUT_ENTITIES,
  MAX_CONNECTOR_INPUT_RELATIONSHIPS,
  MAX_CONNECTOR_FIXTURE_BYTES,
  defineThreatIntelligenceProvider,
  defineCuratedConnector,
  normalizeThreatIntelligenceTarget,
  normalizeCuratedConnectorTarget,
  createThreatIntelligenceResult,
  createCuratedConnectorResult,
  buildThreatIntelligenceProviderMatrix,
  buildCuratedConnectorMatrix,
  runCuratedConnectorFixture,
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

function connector(overrides = {}) {
  return defineCuratedConnector({
    id: 'fixture_connector',
    label: 'Fixture connector',
    kinds: ['discovery', 'enrichment'],
    inputs: [
      { type: 'domain', exposure: 'registrable_domain' },
      { type: 'hostname', exposure: 'hostname' },
      { type: 'url', exposure: 'origin' },
      { type: 'ipv4', exposure: 'ip_address' },
      { type: 'ipv6', exposure: 'ip_address' },
      { type: 'asn', exposure: 'asn' },
      { type: 'certificate', exposure: 'certificate_fingerprint' },
    ],
    outputs: {
      entities: ['domain', 'hostname', 'ipv4', 'ipv6', 'certificate'],
      relationships: [
        'domain_resolves_to_ip',
        'domain_uses_nameserver',
        'domain_uses_mail_server',
        'domain_presented_certificate',
        'certificate_names_domain',
        'ip_hosts_domain',
        'domain_related_to_domain',
      ],
    },
    collection: 'third_party',
    credentials: { mode: 'required', scopes: ['records:read'] },
    terms: {
      reviewedAt: '2026-07-19T00:00:00Z',
      termsUrl: 'https://connector.invalid/terms',
      privacyUrl: 'https://connector.invalid/privacy',
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
      maxEntities: 50,
      maxRelationships: 80,
    },
    enabledByDefault: false,
    ...overrides,
  });
}

function connectorEntity(key, type, value, overrides = {}) {
  return {
    key,
    type,
    value,
    label: String(value),
    attributes: {},
    ...overrides,
  };
}

function connectorRelationship(type, fromKey, toKey, overrides = {}) {
  return {
    type,
    fromKey,
    toKey,
    classification: 'direct',
    method: 'Provider fixture record',
    firstObservedAt: '2026-07-18T00:00:00Z',
    lastObservedAt: '2026-07-19T00:00:00Z',
    complete: true,
    truncated: false,
    limitations: [],
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

describe('curated connector definition', () => {
  test('creates a frozen, versioned, disabled-by-default capability policy', () => {
    const value = connector();
    assert.equal(value.version, CURATED_CONNECTOR_CONTRACT_VERSION);
    assert.deepEqual(value.kinds, ['discovery', 'enrichment']);
    assert.equal(value.collection, 'third_party');
    assert.equal(value.enabledByDefault, false);
    assert.deepEqual(value.credentials, { mode: 'required', scopes: ['records:read'] });
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.isFrozen(value.inputs), true);
    assert.equal(Object.isFrozen(value.outputs), true);
    assert.equal(Object.isFrozen(value.credentials), true);
    assert.equal(Object.isFrozen(value.terms), true);
    assert.equal(Object.isFrozen(value.limits), true);
  });

  test('rejects hidden fields, auto-enable attempts, invalid kinds, inputs, and credentials', () => {
    assert.throws(() => connector({ endpoint: 'https://connector.invalid/api' }), /unknown field: endpoint/);
    assert.throws(() => connector({ enabledByDefault: true }), /disabled by default/);
    assert.throws(() => connector({ kinds: ['enrichment', 'enrichment'] }), /unique/);
    assert.throws(() => connector({ inputs: [{ type: 'domain', exposure: 'full_url' }] }), /input exposure is invalid/);
    assert.throws(() => connector({
      inputs: [
        { type: 'domain', exposure: 'registrable_domain' },
        { type: 'domain', exposure: 'registrable_domain' },
      ],
    }), /input types must be unique/);
    assert.throws(() => connector({ credentials: { mode: 'none', scopes: ['records:read'] } }), /inconsistent/);
    assert.throws(() => connector({ credentials: { mode: 'required', scopes: [] } }), /inconsistent/);
    assert.throws(() => connector({ credentials: { mode: 'required', scopes: ['Records Read'] } }), /scopes are invalid/);
  });

  test('requires relationship declarations to include compatible bounded entity outputs', () => {
    assert.throws(() => connector({
      outputs: { entities: ['domain', 'certificate'], relationships: ['domain_resolves_to_ip'] },
    }), /lacks compatible entity outputs/);
    assert.throws(() => connector({
      outputs: { entities: ['domain'], relationships: ['domain_related_to_domain', 'domain_related_to_domain'] },
    }), /outputs must be unique/);
    assert.throws(() => connector({
      outputs: { entities: [], relationships: [] },
    }), /at least one normalized entity type/);
  });

  test('enforces connector request, cache, output, and quota bounds', () => {
    assert.throws(() => connector({ limits: { ...connector().limits, maxEntities: MAX_CONNECTOR_ENTITIES + 1 } }), /entity cap/);
    assert.throws(() => connector({ limits: { ...connector().limits, maxRelationships: MAX_CONNECTOR_RELATIONSHIPS + 1 } }), /relationship cap/);
    assert.throws(() => connector({ limits: { ...connector().limits, maxRelationships: 0 } }), /positive relationship cap/);
    assert.throws(() => connector({ limits: { ...connector().limits, monthlyRequests: 99 } }), /monthly request budget/);
    assert.throws(() => connector({
      terms: { ...connector().terms, caching: 'prohibited' },
      limits: { ...connector().limits, cacheTtlMs: 60_000 },
    }), /cache TTL must be zero/);
  });
});

describe('curated connector target normalization', () => {
  test('normalizes each supported entity type and its declared exposure', () => {
    assert.deepEqual(
      normalizeCuratedConnectorTarget({ type: 'domain', value: 'Login.Example.test.' }, 'registrable_domain'),
      { type: 'domain', value: 'example.test', exposure: 'registrable_domain' },
    );
    assert.equal(
      normalizeCuratedConnectorTarget({ type: 'hostname', value: 'Login.Example.test.' }, 'hostname').value,
      'login.example.test',
    );
    assert.equal(
      normalizeCuratedConnectorTarget({ type: 'url', value: 'https://Login.Example.test/path?q=private#fragment' }, 'origin').value,
      'https://login.example.test',
    );
    assert.equal(normalizeCuratedConnectorTarget({ type: 'ipv4', value: '192.0.2.10' }, 'ip_address').value, '192.0.2.10');
    assert.equal(normalizeCuratedConnectorTarget({ type: 'ipv6', value: '2001:db8::10' }, 'ip_address').type, 'ipv6');
    assert.equal(normalizeCuratedConnectorTarget({ type: 'asn', value: 'as64500' }, 'asn').value, 'AS64500');
    assert.equal(
      normalizeCuratedConnectorTarget({ type: 'certificate', value: `AA:${'bb'.repeat(31)}` }, 'certificate_fingerprint').value,
      `aa${'bb'.repeat(31)}`,
    );
  });

  test('rejects incompatible types, values, exposures, credentials, and certificate formats', () => {
    assert.throws(() => normalizeCuratedConnectorTarget({ type: 'domain', value: '192.0.2.10' }, 'registrable_domain'), /incompatible/);
    assert.throws(() => normalizeCuratedConnectorTarget({ type: 'ipv4', value: '2001:db8::10' }, 'ip_address'), /incompatible/);
    assert.throws(() => normalizeCuratedConnectorTarget({ type: 'url', value: 'https://user:pass@example.test/' }, 'origin'), /URL target is invalid/);
    assert.throws(() => normalizeCuratedConnectorTarget({ type: 'certificate', value: 'not-a-fingerprint' }, 'certificate_fingerprint'), /certificate target is invalid/);
    assert.throws(() => normalizeCuratedConnectorTarget({ type: 'hostname', value: 'host.example.test' }, 'full_url'), /target exposure is invalid/);
  });
});

describe('curated connector result normalization', () => {
  test('produces bounded attributed entities and semantically typed relationships', () => {
    const result = createCuratedConnectorResult(
      connector(),
      { type: 'domain', value: 'example.test' },
      {
        state: 'success',
        entities: [
          connectorEntity('target', 'domain', 'example.test', { attributes: { source_record: 'fixture-1' } }),
          connectorEntity('address', 'ipv4', '192.0.2.10'),
          connectorEntity('certificate', 'certificate', 'a'.repeat(64)),
        ],
        relationships: [
          connectorRelationship('domain_resolves_to_ip', 'target', 'address'),
          connectorRelationship('domain_presented_certificate', 'target', 'certificate'),
        ],
      },
      '2026-07-19T01:02:03Z',
    );
    assert.equal(result.schema, CURATED_CONNECTOR_RESULT_SCHEMA);
    assert.equal(result.version, CURATED_CONNECTOR_CONTRACT_VERSION);
    assert.deepEqual(result.connector, {
      id: 'fixture_connector',
      label: 'Fixture connector',
      kinds: ['discovery', 'enrichment'],
      collection: 'third_party',
    });
    assert.equal(result.state, 'success');
    assert.equal(result.entities.length, 3);
    assert.equal(result.relationships.length, 2);
    assert.ok(result.relationships.every((item) => result.entities.some((entity) => entity.id === item.from)));
    assert.ok(result.relationships.every((item) => result.entities.some((entity) => entity.id === item.to)));
    assert.equal(Object.hasOwn(result, 'safe'), false);
    assert.equal(Object.hasOwn(result, 'malicious'), false);
    assert.equal(result.observation.complete, true);
    assert.equal(result.observation.observedAt, '2026-07-19T01:02:03.000Z');
    assert.match(result.observation.limitations[0], /investigation pivots/i);
  });

  test('keeps misses and all failure states explicit and neutral', () => {
    const definition = connector();
    const miss = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, { state: 'not_found' });
    assert.equal(miss.state, 'not_found');
    assert.deepEqual(miss.entities, []);
    assert.deepEqual(miss.relationships, []);
    assert.equal(miss.observation.complete, true);
    assert.match(miss.observation.limitations.join(' '), /not evidence.*absent or safe/i);

    for (const state of ['unsupported', 'skipped', 'rate_limited', 'unavailable', 'error']) {
      const result = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, { state });
      assert.equal(result.state, state);
      assert.equal(result.observation.complete, false);
      assert.equal(Object.hasOwn(result, 'safe'), false);
    }
  });

  test('does not let terminal states hide output or infer a miss from an empty success', () => {
    const definition = connector();
    const retained = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, {
      state: 'error',
      entities: [connectorEntity('target', 'domain', 'example.test')],
    });
    assert.equal(retained.state, 'partial');
    assert.equal(retained.entities.length, 1);
    assert.equal(retained.observation.complete, false);

    const empty = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, { state: 'success' });
    assert.equal(empty.state, 'error');
    assert.equal(empty.observation.complete, false);
  });

  test('rejects semantically incompatible, dangling, malformed, and self relationships as partial', () => {
    const result = createCuratedConnectorResult(connector(), { type: 'domain', value: 'example.test' }, {
      state: 'success',
      entities: [
        connectorEntity('first', 'domain', 'example.test'),
        connectorEntity('second', 'domain', 'second.test'),
        connectorEntity('address', 'ipv4', '192.0.2.10'),
      ],
      relationships: [
        connectorRelationship('domain_resolves_to_ip', 'address', 'first'),
        connectorRelationship('domain_resolves_to_ip', 'first', 'missing'),
        connectorRelationship('domain_related_to_domain', 'first', 'first'),
        connectorRelationship('domain_related_to_domain', 'first', 'second', { firstObservedAt: 'later' }),
      ],
    });
    assert.equal(result.state, 'partial');
    assert.deepEqual(result.relationships, []);
    assert.equal(result.observation.diagnostics.discarded_relationships, 4);
    assert.equal(result.observation.truncated, true);
  });

  test('bounds entity, relationship, attribute, and source-declared partial output', () => {
    const definition = connector({
      outputs: { entities: ['domain'], relationships: ['domain_related_to_domain'] },
      limits: { ...connector().limits, maxEntities: 3, maxRelationships: 1 },
    });
    const attributes = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`field_${index}`, `value-${index}`]));
    attributes.field_0 = 'x'.repeat(301);
    const result = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, {
      state: 'success',
      truncated: true,
      limitations: ['x'.repeat(501)],
      entities: [
        connectorEntity('first', 'domain', 'first.test', { attributes }),
        connectorEntity('second', 'domain', 'second.test'),
        connectorEntity('third', 'domain', 'third.test'),
      ],
      relationships: [
        connectorRelationship('domain_related_to_domain', 'first', 'second', { limitations: ['x'.repeat(501)] }),
        connectorRelationship('domain_related_to_domain', 'second', 'first', { method: 'Reverse fixture relationship' }),
      ],
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.entities.length, 3);
    assert.equal(result.relationships.length, 1);
    assert.equal(Object.keys(result.entities.find((item) => item.canonical === 'first.test')?.attributes || {}).length, 20);
    assert.equal(result.observation.diagnostics.discarded_entities, 0);
    assert.ok(result.observation.diagnostics.discarded_attributes >= 5);
    assert.ok(result.observation.diagnostics.discarded_relationships >= 1);
    assert.equal(result.observation.diagnostics.discarded_metadata, 2);
    assert.equal(result.observation.truncated, true);

    const entityCapped = createCuratedConnectorResult(connector({
      outputs: { entities: ['domain'], relationships: [] },
      limits: { ...connector().limits, maxEntities: 1, maxRelationships: 0 },
    }), { type: 'domain', value: 'example.test' }, {
      state: 'success',
      entities: [
        connectorEntity('first', 'domain', 'first.test'),
        connectorEntity('second', 'domain', 'second.test'),
      ],
    });
    assert.equal(entityCapped.entities.length, 1);
    assert.equal(entityCapped.state, 'partial');
    assert.equal(entityCapped.observation.diagnostics.discarded_entities, 1);
  });

  test('caps traversal of pathological input arrays before normalization', () => {
    const definition = connector({
      outputs: { entities: ['domain'], relationships: [] },
      limits: { ...connector().limits, maxEntities: MAX_CONNECTOR_ENTITIES, maxRelationships: 0 },
    });
    const entities = Array.from({ length: MAX_CONNECTOR_INPUT_ENTITIES + 5 }, (_, index) => (
      connectorEntity(`entity-${index}`, 'domain', `entity-${index}.test`)
    ));
    const relationships = Array.from({ length: MAX_CONNECTOR_INPUT_RELATIONSHIPS + 5 }, () => ({}));
    const result = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, {
      state: 'success', entities, relationships,
    });
    assert.equal(result.entities.length, MAX_CONNECTOR_ENTITIES);
    assert.equal(result.state, 'partial');
    assert.ok(result.observation.diagnostics.discarded_entities >= MAX_CONNECTOR_INPUT_ENTITIES - MAX_CONNECTOR_ENTITIES + 5);
    assert.equal(result.observation.diagnostics.discarded_relationships, MAX_CONNECTOR_INPUT_RELATIONSHIPS + 5);
  });

  test('sorts and deduplicates deterministically without mutating adapter output', () => {
    const definition = connector({ outputs: { entities: ['domain'], relationships: ['domain_related_to_domain'] } });
    const entities = [
      connectorEntity('z-alias', 'domain', 'second.test', { label: 'Z alias' }),
      connectorEntity('a-alias', 'domain', 'second.test', { label: 'A alias' }),
      connectorEntity('first', 'domain', 'first.test'),
    ];
    const relationships = [connectorRelationship('domain_related_to_domain', 'first', 'z-alias')];
    const input = { state: 'success', entities, relationships };
    const before = structuredClone(input);
    const forward = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, input);
    const reverse = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, {
      state: 'success', entities: [...entities].reverse(), relationships: [...relationships].reverse(),
    });
    assert.deepEqual(forward.entities, reverse.entities);
    assert.deepEqual(forward.relationships, reverse.relationships);
    assert.deepEqual(input, before);
    assert.equal(forward.entities.length, 2);
    assert.equal(forward.entities.find((item) => item.canonical === 'second.test').label, 'A alias');
    assert.equal(forward.state, 'partial');
  });

  test('marks conflicting duplicate relationship observations partial instead of choosing silently', () => {
    const definition = connector({ outputs: { entities: ['domain'], relationships: ['domain_related_to_domain'] } });
    const result = createCuratedConnectorResult(definition, { type: 'domain', value: 'example.test' }, {
      state: 'success',
      entities: [
        connectorEntity('first', 'domain', 'first.test'),
        connectorEntity('second', 'domain', 'second.test'),
      ],
      relationships: [
        connectorRelationship('domain_related_to_domain', 'first', 'second'),
        connectorRelationship('domain_related_to_domain', 'first', 'second', {
          firstObservedAt: '2026-07-17T00:00:00Z',
        }),
      ],
    });
    assert.equal(result.relationships.length, 1);
    assert.equal(result.state, 'partial');
    assert.equal(result.observation.diagnostics.discarded_relationships, 1);
  });

  test('rejects unsupported targets and forged connector definitions', () => {
    const definition = connector({ inputs: [{ type: 'domain', exposure: 'registrable_domain' }] });
    assert.throws(() => createCuratedConnectorResult(definition, { type: 'asn', value: 'AS64500' }, { state: 'not_found' }), /does not support/);
    assert.throws(() => createCuratedConnectorResult(
      { ...definition },
      { type: 'domain', value: 'example.test' },
      { state: 'not_found' },
    ), /versioned curated connector definition/);
    assert.throws(() => createCuratedConnectorResult(
      definition,
      { type: 'domain', value: 'example.test' },
      { state: 'not_found' },
      'not-a-date',
    ), /observation timestamp is invalid/);
  });
});

describe('curated connector capability matrix', () => {
  test('sorts definitions and exposes reviewed policy without runtime secrets', () => {
    const matrix = buildCuratedConnectorMatrix([
      connector({ id: 'z_connector', label: 'Z connector' }),
      connector({ id: 'a_connector', label: 'A connector' }),
    ]);
    assert.deepEqual(matrix.map((item) => item.id), ['a_connector', 'z_connector']);
    assert.equal(matrix[0].enabledByDefault, false);
    assert.equal(matrix[0].credentials.mode, 'required');
    assert.deepEqual(matrix[0].credentials.scopes, ['records:read']);
    assert.equal(JSON.stringify(matrix).includes('apiKey'), false);
    assert.equal(JSON.stringify(matrix).includes('token'), false);
  });

  test('rejects duplicate, forged, and over-limit entries', () => {
    const definition = connector();
    assert.throws(() => buildCuratedConnectorMatrix([definition, definition]), /unique/);
    assert.throws(() => buildCuratedConnectorMatrix([{ ...definition }]), /unique versioned definitions/);
    assert.throws(() => buildCuratedConnectorMatrix(Array(101).fill(definition)), /bounded array/);
  });
});

describe('curated connector fixture harness', () => {
  test('normalizes the same offline JSON fixture twice and returns deterministic output', () => {
    const definition = connector({ outputs: { entities: ['domain'], relationships: [] } });
    let calls = 0;
    const result = runCuratedConnectorFixture(definition, {
      id: 'domain-record',
      target: { type: 'domain', value: 'example.test' },
      observedAt: '2026-07-19T00:00:00Z',
      json: JSON.stringify({ records: [{ name: 'Found.Example.test' }] }),
    }, (payload, target, ...rest) => {
      calls += 1;
      assert.equal(Object.isFrozen(target), true);
      assert.deepEqual(rest, []);
      return {
        state: 'success',
        entities: [connectorEntity('record', 'domain', payload.records[0].name)],
        relationships: [],
      };
    });
    assert.equal(calls, 2);
    assert.equal(result.state, 'success');
    assert.equal(result.entities[0].canonical, 'example.test');
    assert.equal(result.observation.observedAt, '2026-07-19T00:00:00.000Z');
  });

  test('rejects malformed, over-limit, asynchronous, and nondeterministic fixtures', () => {
    const definition = connector({ outputs: { entities: ['domain'], relationships: [] } });
    const base = {
      id: 'domain-record',
      target: { type: 'domain', value: 'example.test' },
      observedAt: '2026-07-19T00:00:00Z',
      json: '{}',
    };
    assert.throws(() => runCuratedConnectorFixture(definition, { ...base, json: '{' }, () => ({})), /JSON is invalid/);
    assert.throws(() => runCuratedConnectorFixture(definition, {
      ...base, json: 'x'.repeat(MAX_CONNECTOR_FIXTURE_BYTES + 1),
    }, () => ({})), /must not exceed/);
    assert.throws(() => runCuratedConnectorFixture(definition, base, async () => ({})), /must be synchronous/);
    let calls = 0;
    assert.throws(() => runCuratedConnectorFixture(definition, base, () => ({
      state: 'success',
      detail: `call-${calls += 1}`,
      entities: [connectorEntity('record', 'domain', 'example.test')],
    })), /not deterministic/);
  });

  test('rejects unsupported targets, hidden fixture fields, and forged definitions', () => {
    const definition = connector({ inputs: [{ type: 'domain', exposure: 'registrable_domain' }] });
    const fixture = {
      id: 'domain-record',
      target: { type: 'domain', value: 'example.test' },
      observedAt: '2026-07-19T00:00:00Z',
      json: '{}',
    };
    assert.throws(() => runCuratedConnectorFixture(definition, { ...fixture, fetch: true }, () => ({})), /unknown field: fetch/);
    assert.throws(() => runCuratedConnectorFixture(definition, {
      ...fixture, target: { type: 'asn', value: 'AS64500' },
    }, () => ({})), /target is unsupported/);
    assert.throws(() => runCuratedConnectorFixture({ ...definition }, fixture, () => ({})), /versioned curated connector definition/);
  });
});
