const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SECURITY_POSTURE_FINDINGS,
  WEBSITE_SECURITY_POSTURE_VERSION,
  analyzeWebsiteSecurityPosture,
} = require('../lib/website-security-posture.mts');

const OBSERVED_AT = '2026-07-22T02:03:04.000Z';

function http(overrides = {}) {
  return {
    source: 'http', status: 'success', complete: true, transportSecurity: 'https', httpsDowngrade: false,
    response: {
      status: 200,
      securityHeaders: {
        strictTransportSecurity: 'max-age=31536000',
        contentSecurityPolicy: "default-src 'self'",
        xFrameOptions: 'DENY',
        xContentTypeOptions: 'nosniff',
        referrerPolicy: 'no-referrer',
      },
    },
    ...overrides,
  };
}

function pageIdentity(overrides = {}) {
  return {
    source: 'html', status: 'success', complete: true,
    forms: { count: 1, postCount: 1, insecureActionCount: 0, externalActionOrigins: [], truncated: false },
    resources: { externalOrigins: ['https://static.example'], truncated: false },
    ...overrides,
  };
}

function tls(overrides = {}) {
  return {
    source: 'tls', status: 'success', complete: true, protocol: 'TLSv1.3',
    authorization: { authorized: true }, hostname: { matches: true }, validity: { status: 'valid' },
    ...overrides,
  };
}

function dns(overrides = {}) {
  return {
    source: 'dns', status: 'success', complete: true,
    records: { caa: [{ critical: 0, tag: 'issue', value: 'ca.example' }] },
    diagnostics: { caa: { status: 'success' } },
    ...overrides,
  };
}

function analyze(overrides = {}) {
  return analyzeWebsiteSecurityPosture({
    http: http(), pageIdentity: pageIdentity(), tls: tls(), dns: dns(), dnssec: 'Signed', observedAt: OBSERVED_AT,
    ...overrides,
  });
}

function byId(result, id) {
  return result.findings.find((item) => item.id === id);
}

describe('passive website security posture', () => {
  test('emits a versioned complete derived observation from existing evidence', () => {
    const result = analyze();
    assert.equal(result.postureVersion, WEBSITE_SECURITY_POSTURE_VERSION);
    assert.equal(result.version, 1);
    assert.equal(result.status, 'success');
    assert.equal(result.source, 'derived');
    assert.equal(result.scanMode, 'deep');
    assert.equal(result.observedAt, OBSERVED_AT);
    assert.equal(result.complete, true);
    assert.equal(result.truncated, false);
    assert.equal(result.summary.potentialExposure, 0);
    assert.equal(byId(result, 'https_transport').state, 'observed');
    assert.equal(byId(result, 'certificate_authorized').tone, 'configured');
    assert.equal(byId(result, 'dnssec_signed').state, 'observed');
    assert.ok(result.findings.length <= MAX_SECURITY_POSTURE_FINDINGS);
  });

  test('reports response-scoped header absences without claiming a vulnerability', () => {
    const result = analyze({
      http: http({ response: { status: 200, securityHeaders: {} } }),
    });
    const csp = byId(result, 'content_security_policy_absent');
    assert.equal(csp.state, 'observed_absence');
    assert.equal(csp.tone, 'review');
    assert.match(csp.detail, /selected response/i);
    assert.match(csp.detail, /not a site-wide vulnerability finding/i);
    assert.equal(result.findings.filter((item) => item.category === 'response headers' && item.state === 'observed_absence').length, 5);
  });

  test('flags cleartext transport and a retained HTTPS downgrade as review signals', () => {
    const result = analyze({
      http: http({ transportSecurity: 'http', httpsDowngrade: true }),
    });
    assert.equal(byId(result, 'cleartext_transport').state, 'potential_exposure');
    assert.equal(byId(result, 'https_downgrade').tone, 'review');
    assert.equal(byId(result, 'strict_transport_security_absent'), undefined);
  });

  test('flags insecure forms and cleartext resource origins from retained static metadata', () => {
    const result = analyze({
      pageIdentity: pageIdentity({
        forms: {
          count: 3, postCount: 2, insecureActionCount: 2,
          externalActionOrigins: ['http://submit.example', 'https://forms.example'], truncated: false,
        },
        resources: {
          externalOrigins: ['http://assets.example', 'http://media.example', 'https://static.example'],
          truncated: false,
        },
      }),
    });
    assert.match(byId(result, 'cleartext_form_actions').detail, /^2 retained form actions/);
    assert.match(byId(result, 'mixed_content_origins').detail, /^2 retained resource origins/);
    assert.equal(byId(result, 'external_form_destinations').state, 'observed');
    assert.doesNotMatch(JSON.stringify(result), /submit\.example|assets\.example|forms\.example/);
  });

  test('reports bounded negative observations only when static evidence is complete', () => {
    const complete = analyze();
    assert.equal(byId(complete, 'cleartext_form_actions_absent').state, 'observed_absence');
    assert.equal(byId(complete, 'mixed_content_origins_absent').state, 'observed_absence');

    const partial = analyze({
      pageIdentity: pageIdentity({ status: 'partial', complete: false }),
    });
    assert.equal(byId(partial, 'cleartext_form_actions_absent'), undefined);
    assert.equal(byId(partial, 'mixed_content_origins_absent'), undefined);
    assert.equal(partial.status, 'partial');
  });

  test('keeps external form destinations neutral rather than treating them as vulnerabilities', () => {
    const result = analyze({
      pageIdentity: pageIdentity({
        forms: { count: 1, postCount: 1, insecureActionCount: 0, externalActionOrigins: ['https://forms.example'], truncated: false },
      }),
    });
    const external = byId(result, 'external_form_destinations');
    assert.equal(external.state, 'observed');
    assert.equal(external.tone, 'neutral');
    assert.match(external.detail, /can be legitimate/i);
  });

  test('distinguishes certificate trust, hostname, validity, and negotiated protocol', () => {
    const result = analyze({
      tls: tls({
        protocol: 'TLSv1.1',
        authorization: { authorized: false, error: 'private untrusted detail' },
        hostname: { matches: false, error: 'private hostname detail' },
        validity: { status: 'expired' },
      }),
    });
    assert.equal(byId(result, 'legacy_tls_negotiated').tone, 'review');
    assert.equal(byId(result, 'certificate_not_authorized').state, 'potential_exposure');
    assert.equal(byId(result, 'certificate_hostname_mismatch').state, 'potential_exposure');
    assert.equal(byId(result, 'certificate_validity_problem').state, 'potential_exposure');
    assert.doesNotMatch(JSON.stringify(result), /private untrusted detail|private hostname detail/);
  });

  test('does not overstate a modern negotiated protocol as full protocol coverage', () => {
    const result = analyze();
    assert.match(byId(result, 'modern_tls_negotiated').detail, /does not enumerate every protocol/i);
    assert.match(result.limitations.join(' '), /one negotiated connection/i);
  });

  test('normalizes established DNSSEC publication vocabularies', () => {
    for (const value of ['Signed', 'signedDelegation', 'signed delegation', 'secure', 'yes', 'active']) {
      assert.equal(byId(analyze({ dnssec: value }), 'dnssec_signed').state, 'observed');
    }
    for (const value of ['Unsigned', 'no', 'inactive']) {
      assert.equal(byId(analyze({ dnssec: value }), 'dnssec_unsigned').state, 'observed_absence');
    }
    assert.equal(byId(analyze({ dnssec: 'unrecognized upstream text' }), 'dnssec_unavailable').state, 'unavailable');
  });

  test('distinguishes observed, absent, and unavailable CAA evidence', () => {
    assert.equal(byId(analyze(), 'caa_observed').state, 'observed');
    assert.equal(byId(analyze({
      dns: dns({ records: { caa: [] }, diagnostics: { caa: { status: 'not_found' } } }),
    }), 'caa_absent').state, 'observed_absence');
    assert.equal(byId(analyze({
      dns: dns({ status: 'partial', complete: false, records: { caa: [] }, diagnostics: { caa: { status: 'error' } } }),
    }), 'caa_unavailable').state, 'unavailable');
  });

  test('collapses missing source families into explicit unavailable findings', () => {
    const result = analyzeWebsiteSecurityPosture({ observedAt: OBSERVED_AT });
    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.deepEqual(result.findings.map((item) => item.id), [
      'http_response_unavailable',
      'static_page_evidence_unavailable',
      'tls_evidence_unavailable',
      'dnssec_unavailable',
      'caa_unavailable',
    ]);
    assert.equal(result.summary.unavailable, 5);
  });

  test('does not convert missing normalized sub-objects into observed absences', () => {
    const result = analyze({
      http: http({ response: { status: 200 } }),
      pageIdentity: pageIdentity({ forms: null, resources: null }),
    });
    assert.equal(byId(result, 'http_headers_unavailable').state, 'unavailable');
    assert.equal(byId(result, 'content_security_policy_absent'), undefined);
    assert.equal(byId(result, 'form_metadata_unavailable').state, 'unavailable');
    assert.equal(byId(result, 'resource_metadata_unavailable').state, 'unavailable');
    assert.equal(byId(result, 'cleartext_form_actions_absent'), undefined);
    assert.equal(byId(result, 'mixed_content_origins_absent'), undefined);
    assert.equal(result.status, 'partial');
  });

  test('bounds retained origin interpretation and does not mutate source evidence', () => {
    const origins = Array.from({ length: 40 }, (_, index) => `http://resource-${index}.example`);
    const input = {
      http: http(),
      pageIdentity: pageIdentity({ resources: { externalOrigins: origins, truncated: false } }),
      tls: tls(), dns: dns(), dnssec: 'Signed', observedAt: OBSERVED_AT,
    };
    const before = structuredClone(input);
    const result = analyzeWebsiteSecurityPosture(input);
    assert.match(byId(result, 'mixed_content_origins').detail, /^30 retained resource origins/);
    assert.deepEqual(input, before);
  });

  test('retains only fixed text and bounded counts from untrusted source objects', () => {
    const secret = 'private-attacker-controlled-value';
    const result = analyze({
      http: http({ response: { status: 200, securityHeaders: { contentSecurityPolicy: secret } } }),
      pageIdentity: pageIdentity({ arbitrary: secret }),
      tls: tls({ arbitrary: secret }),
      dns: dns({ arbitrary: secret }),
    });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.equal(byId(result, 'content_security_policy_observed').state, 'observed');
  });
});
