import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  WEB_CAPTURE_SUMMARY_SCHEMA,
  parseWebCaptureSummary,
} from '../frontend/src/lib/analysis/web-capture-import.ts';

describe('sanitised web-capture import', () => {
  test('converts bounded capture summaries into separately attributed findings', () => {
    const document = parseWebCaptureSummary({
      schema: WEB_CAPTURE_SUMMARY_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Reviewed browser capture', reference: null, collectedAt: '2026-07-01T00:00:00Z' },
      captures: [{
        domain: 'example.test',
        capturedAt: '2026-07-01T00:00:00Z',
        completeness: 'partial',
        limitations: ['Client-side requests may be incomplete.'],
        pageTitle: 'Example sign-in',
        finalOrigin: 'https://example.test',
        screenshotSha256: 'a'.repeat(64),
        technologies: ['Example framework'],
        networkOrigins: ['https://static.example.test'],
      }],
    });
    assert.equal(document.findings.length, 1);
    assert.ok(document.findings.every((finding) => finding.domain === 'example.test'));
    assert.ok(document.findings.every((finding) => finding.completeness === 'partial'));
    assert.match(document.findings[0]?.limitations.join(' ') ?? '', /did not collect or independently verify/i);
    assert.match(document.findings[0]?.summary ?? '', /Example sign-in.*Example framework.*static\.example\.test.*SHA-256/is);
  });

  test('rejects complete URLs and unsupported raw capture fields', () => {
    assert.throws(() => parseWebCaptureSummary({
      schema: WEB_CAPTURE_SUMMARY_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Capture', reference: null, collectedAt: null },
      captures: [{
        domain: 'example.test',
        capturedAt: '2026-07-01T00:00:00Z',
        finalOrigin: 'https://example.test/private?token=secret',
        rawHtml: '<p>private</p>',
      }],
    }), /unsupported fields|origin without credentials/i);
  });

  test('does not accept embedded screenshot data in place of a digest', () => {
    assert.throws(() => parseWebCaptureSummary({
      schema: WEB_CAPTURE_SUMMARY_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Capture', reference: null, collectedAt: null },
      captures: [{
        domain: 'example.test',
        capturedAt: '2026-07-01T00:00:00Z',
        screenshotSha256: 'data:image/png;base64,private',
      }],
    }), /must be SHA-256/);
  });

  test('applies capture bounds before converting to the external-finding envelope', () => {
    assert.throws(() => parseWebCaptureSummary({
      schema: WEB_CAPTURE_SUMMARY_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Capture', reference: null, collectedAt: null },
      captures: Array.from({ length: 26 }, (_, index) => ({
        domain: `site-${index}.example.test`,
        capturedAt: '2026-07-01T00:00:00Z',
        pageTitle: 'Observed page',
      })),
    }), /25-domain limit/);

    assert.throws(() => parseWebCaptureSummary({
      schema: WEB_CAPTURE_SUMMARY_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Capture', reference: null, collectedAt: null },
      captures: Array.from({ length: 21 }, () => ({
        domain: 'example.test',
        capturedAt: '2026-07-01T00:00:00Z',
        pageTitle: 'Observed page',
      })),
    }), /20-summary per-domain limit/);
  });
});
