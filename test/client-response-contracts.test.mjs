import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  INVALID_AVAILABILITY_CAPTURE_RESPONSE,
  INVALID_DOMAIN_POSTURE_RESPONSE,
  MAX_AVAILABILITY_KEYS,
  clientHttpErrorMessage,
  parseAvailabilityCaptureResponse,
  parseDomainPostureHttpResponse,
} from '../frontend/src/lib/analysis/client-response-contracts.ts';

const CHECKED_AT = '2026-07-27T00:00:00.000Z';

function availability(overrides = {}) {
  return {
    applicable: true,
    domain: 'example.test',
    state: 'registered',
    confidence: 'high',
    pageIdentity: null,
    faviconHash: null,
    faviconPHash: null,
    ...overrides,
  };
}

function postureCheck(overrides = {}) {
  return {
    id: 'spf',
    label: 'SPF',
    status: 'pass',
    summary: 'Restrictive fail-all policy',
    detail: '',
    records: ['v=spf1 -all'],
    remediation: '',
    ...overrides,
  };
}

function posture(overrides = {}) {
  return {
    domain: 'example.test',
    checkedAt: CHECKED_AT,
    dkimSelectors: [],
    summary: { pass: 1, warning: 0, danger: 0, info: 0 },
    checks: [postureCheck()],
    ...overrides,
  };
}

describe('official-site capture response contract', () => {
  test('accepts a current bounded result for the requested domain without copying it', () => {
    const raw = availability({
      faviconHash: 'a'.repeat(64),
      faviconPHash: '1234567890abcdef',
      pageIdentity: {
        identityVersion: 3,
        source: 'html',
        status: 'success',
        observedAt: CHECKED_AT,
        fingerprints: { fingerprintVersion: 1 },
      },
    });
    const parsed = parseAvailabilityCaptureResponse(raw, 'example.test');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, raw);
  });

  test('accepts a registrable response when the requested official hostname is retained', () => {
    const parsed = parseAvailabilityCaptureResponse(availability({
      domain: 'example.test',
      inputHostname: 'portal.example.test',
      registrableDomain: 'example.test',
    }), 'portal.example.test');
    assert.equal(parsed.ok, true);
  });

  test('rejects malformed, unrelated, oversized, and future-shaped results', () => {
    const oversized = availability();
    for (let index = 0; Object.keys(oversized).length <= MAX_AVAILABILITY_KEYS; index += 1) {
      oversized[`extra${index}`] = index;
    }
    const invalid = [
      null,
      [],
      {},
      availability({ applicable: false }),
      availability({ domain: 'other.test' }),
      availability({ state: 'future_state' }),
      availability({ confidence: 'future_confidence' }),
      availability({ pageIdentity: [] }),
      availability({ pageIdentity: {} }),
      availability({
        pageIdentity: {
          identityVersion: 3,
          source: 'html',
          status: 'success',
          observedAt: CHECKED_AT,
          fingerprints: { fingerprintVersion: 2 },
        },
      }),
      availability({ faviconHash: 'not-a-hash' }),
      availability({ faviconPHash: 'not-a-phash' }),
      oversized,
    ];
    for (const value of invalid) {
      assert.deepEqual(parseAvailabilityCaptureResponse(value, 'example.test'), {
        ok: false,
        error: INVALID_AVAILABILITY_CAPTURE_RESPONSE,
      });
    }
  });
});

describe('official-domain posture response contract', () => {
  test('accepts a complete report whose summary matches its bounded checks', () => {
    const raw = posture();
    const parsed = parseDomainPostureHttpResponse(raw, 'example.test');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, raw);
  });

  test('rejects malformed reports before they reach the posture renderer', () => {
    const invalid = [
      null,
      {},
      posture({ domain: 'other.test' }),
      posture({ checkedAt: 'not-a-time' }),
      posture({ dkimSelectors: 'default' }),
      posture({ summary: { pass: 0, warning: 0, danger: 0, info: 0 } }),
      posture({ summary: { pass: 1, warning: 0, danger: 0, info: 0, future: 0 } }),
      posture({ checks: [] }),
      posture({ checks: [postureCheck({ status: 'future_status' })] }),
      posture({ checks: [postureCheck({ records: 'v=spf1 -all' })] }),
      posture({ checks: [postureCheck(), postureCheck()] }),
    ];
    for (const value of invalid) {
      assert.deepEqual(parseDomainPostureHttpResponse(value, 'example.test'), {
        ok: false,
        error: INVALID_DOMAIN_POSTURE_RESPONSE,
      });
    }
  });
});

test('client HTTP errors are sanitized and bounded', () => {
  const message = clientHttpErrorMessage(
    { error: `Failure\n${'x'.repeat(400)}` },
    503,
    'Request failed',
  );
  assert.equal(message.includes('\n'), false);
  assert.equal(message.length, 240);
  assert.equal(clientHttpErrorMessage({}, 502, 'Request failed'), 'Request failed (502)');
});
