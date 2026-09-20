import { createHash } from 'node:crypto';
import { faviconTransparencyFixtures, ICON_SIZE } from './favicon-image-fixtures.mts';
import { WEB_CAPTURE_MANIFEST_SCHEMA, WEB_CAPTURE_MANIFEST_VERSION, WEB_CAPTURE_DOM_DIGEST_SCHEMA, WEB_CAPTURE_DOM_DIGEST_VERSION } from '../packages/contracts/web-capture.mts';

const WHEN = '2026-09-01T00:00:00.000Z';
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

export function captureReviewFixture() {
  const screenshot = new Uint8Array(faviconTransparencyFixtures()[0]!.bytes);
  const dom = Buffer.from(JSON.stringify({ schema: WEB_CAPTURE_DOM_DIGEST_SCHEMA, version: WEB_CAPTURE_DOM_DIGEST_VERSION,
    domain: 'capture.example', capturedAt: WHEN, counts: { elements: 1, forms: 0, controls: 0, scripts: 0, images: 1 },
    structure: { algorithm: 'sha256', value: '1'.repeat(64), truncated: false },
    visibleText: { algorithm: 'sha256', value: '2'.repeat(64), bytes: 0, truncated: false },
    limitations: ['Synthetic capture.'],
  }));
  const manifest = { schema: WEB_CAPTURE_MANIFEST_SCHEMA, schemaVersion: WEB_CAPTURE_MANIFEST_VERSION,
    source: { name: 'Synthetic capture', reference: null, collectedAt: WHEN },
    captures: [{ domain: 'capture.example', capturedAt: WHEN, completeness: 'partial', limitations: ['Synthetic capture.'],
      page: { title: 'Example page', finalOrigin: 'https://capture.example' }, technologies: [], requestDomains: [],
      artifacts: [
        { kind: 'screenshot', fileName: 'screenshot.png', mimeType: 'image/png', sha256: digest(screenshot), bytes: screenshot.length, width: ICON_SIZE, height: ICON_SIZE },
        { kind: 'dom_digest', fileName: 'dom-digest.json', mimeType: 'application/json', sha256: digest(dom), bytes: dom.length },
      ],
    }],
  };
  return { manifest, screenshot, dom, manifestBytes: Buffer.from(JSON.stringify(manifest)) };
}
