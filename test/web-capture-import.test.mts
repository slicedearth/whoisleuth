import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  WEB_CAPTURE_SUMMARY_SCHEMA,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
  parseWebCaptureManifest,
  parseWebCaptureSummary,
} from '../frontend/src/lib/analysis/web-capture-import.ts';

describe('sanitised web-capture import', () => {
  test('requires explicit zones for current captures and preserves manifest v1 UTC migration', () => {
    const zoneLess = '2026-07-01T12:00:00.000';
    assert.throws(() => parseWebCaptureSummary({
      schema: WEB_CAPTURE_SUMMARY_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Current summary', reference: null, collectedAt: zoneLess },
      captures: [{ domain: 'example.test', capturedAt: zoneLess, pageTitle: 'Fixture page' }],
    }), /explicit timezone/u);

    const manifest = (schemaVersion: number, capturedAt: string) => ({
      schema: WEB_CAPTURE_MANIFEST_SCHEMA,
      schemaVersion,
      source: { name: 'Capture manifest', reference: null, collectedAt: capturedAt },
      captures: [{
        domain: 'example.test',
        capturedAt,
        artifacts: [{
          kind: 'dom_digest', fileName: 'digest.json', mimeType: 'application/json',
          sha256: 'a'.repeat(64), bytes: 100,
        }],
      }],
    });
    assert.throws(() => parseWebCaptureManifest(manifest(WEB_CAPTURE_MANIFEST_VERSION, zoneLess)), /explicit timezone/u);
    const legacy = parseWebCaptureManifest(manifest(1, zoneLess));
    assert.equal(legacy.source.collectedAt, '2026-07-01T12:00:00.000Z');
    assert.equal(legacy.findings[0]?.observedAt, '2026-07-01T12:00:00.000Z');
    assert.equal(
      parseWebCaptureManifest(manifest(WEB_CAPTURE_MANIFEST_VERSION, '2026-07-01T12:00:00.000+01:00')).findings[0]?.observedAt,
      '2026-07-01T11:00:00.000Z',
    );
  });

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

  test('validates bounded capture artifact metadata without accepting artifact bytes', () => {
    const document = parseWebCaptureManifest({
      schema: WEB_CAPTURE_MANIFEST_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Reviewed isolated capture', reference: 'capture-17', collectedAt: '2026-07-01T00:00:00Z' },
      captures: [{
        domain: 'example.test',
        capturedAt: '2026-07-01T00:00:00Z',
        completeness: 'partial',
        limitations: ['Client-side requests may be incomplete.'],
        page: { title: 'Example sign-in', finalOrigin: 'https://example.test' },
        requestDomains: ['static.example.test', 'api.example.test'],
        technologies: ['Example framework'],
        artifacts: [{
          kind: 'screenshot',
          fileName: 'capture.png',
          mimeType: 'image/png',
          sha256: 'a'.repeat(64),
          bytes: 120_000,
          width: 1440,
          height: 900,
        }, {
          kind: 'dom_digest',
          fileName: 'dom-digest.json',
          mimeType: 'application/json',
          sha256: 'b'.repeat(64),
          bytes: 800,
        }],
      }],
    });
    assert.equal(document.findings.length, 1);
    assert.match(document.findings[0]?.summary || '', /api\.example\.test.*1440x900.*DOM digest/isu);
    assert.match(document.findings[0]?.limitations.join(' ') || '', /did not receive artefact bytes/iu);
  });

  test('accepts current screenshot perceptual hashes while retaining version 1 compatibility', () => {
    const current = parseWebCaptureManifest({
      schema: WEB_CAPTURE_MANIFEST_SCHEMA,
      schemaVersion: WEB_CAPTURE_MANIFEST_VERSION,
      source: { name: 'Local capture package', reference: null, collectedAt: '2026-08-01T00:00:00Z' },
      captures: [{
        domain: 'example.test',
        capturedAt: '2026-08-01T00:00:00Z',
        artifacts: [{
          kind: 'screenshot', fileName: 'capture.png', mimeType: 'image/png',
          sha256: 'a'.repeat(64), perceptualHash: '0123456789abcdef', bytes: 100, width: 100, height: 100,
        }],
      }],
    });
    assert.match(current.findings[0]?.summary ?? '', /dHash 0123456789abcdef/u);
    assert.throws(() => parseWebCaptureManifest({
      schema: WEB_CAPTURE_MANIFEST_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Legacy capture', reference: null, collectedAt: null },
      captures: [{
        domain: 'example.test', capturedAt: '2026-08-01T00:00:00Z',
        artifacts: [{
          kind: 'screenshot', fileName: 'capture.png', mimeType: 'image/png',
          sha256: 'a'.repeat(64), perceptualHash: '0123456789abcdef', bytes: 100, width: 100, height: 100,
        }],
      }],
    }), /perceptual hash is unsupported/u);
  });

  test('rejects path traversal, archive payloads, and unsupported artifact declarations', () => {
    const base = {
      schema: WEB_CAPTURE_MANIFEST_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Capture', reference: null, collectedAt: null },
      captures: [{
        domain: 'example.test',
        capturedAt: '2026-07-01T00:00:00Z',
        artifacts: [{
          kind: 'screenshot',
          fileName: '../capture.png',
          mimeType: 'image/png',
          sha256: 'a'.repeat(64),
          bytes: 100,
          width: 10,
          height: 10,
        }],
      }],
    };
    const baseCapture = base.captures[0]!;
    const baseArtifact = baseCapture.artifacts[0]!;
    assert.throws(() => parseWebCaptureManifest(base), /plain file name without a path/iu);
    assert.throws(() => parseWebCaptureManifest({
      ...base,
      captures: [{ ...baseCapture, archive: 'data:application/zip;base64,private' }],
    }), /unsupported fields or archive content/iu);
    assert.throws(() => parseWebCaptureManifest({
      ...base,
      captures: [{
        ...baseCapture,
        artifacts: [{
          ...baseArtifact,
          fileName: 'capture.zip',
          mimeType: 'application/zip',
        }],
      }],
    }), /MIME type is unsupported/iu);
  });
});
