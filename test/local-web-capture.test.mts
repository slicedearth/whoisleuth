import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import zlib from 'node:zlib';

import type { Browser, Route } from '@playwright/test';

import {
  MAX_CAPTURE_TRANSFER_BYTES,
  WEB_CAPTURE_MANIFEST_VERSION,
  captureRenderedPage,
  parseCaptureArguments,
} from '../packages/web-capture/capture.mts';
import {
  WEB_CAPTURE_COMPARISON_SCHEMA,
  compareRenderedCaptures,
  formatRenderedCaptureComparison,
  parseCaptureCompareArguments,
} from '../packages/web-capture/compare.mts';
import { parseWebCaptureManifest } from '../frontend/src/lib/analysis/web-capture-import.ts';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function patternedPng(width = 64, height = 64, flat = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * (stride + 1) + 1 + x * 4;
      const value = flat ? 128 : (x * 91 + y * 151) % 256;
      raw[offset] = value;
      raw[offset + 1] = value;
      raw[offset + 2] = value;
      raw[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function fakeRoute(url: string) {
  return {
    request: () => ({
      url: () => url,
      method: () => 'GET',
      headers: () => ({ accept: 'text/html', cookie: 'must-not-leave-browser=1', authorization: 'Bearer secret' }),
    }),
    fulfill: async () => {},
    abort: async () => { throw new Error('ERR_FAILED'); },
  } as unknown as Route;
}

const fakeFetchResource = async (url: string) => new Response(
  url.endsWith('.js?secret=discarded') ? 'void 0;' : '<!doctype html><title>Fixture</title>',
  { status: 200, headers: { 'content-type': url.includes('.js') ? 'text/javascript' : 'text/html' } },
);

function fakeBrowser(options: {
  hostname?: string;
  title?: string;
  finalUrl?: string;
  structure?: string;
  visibleText?: string;
  elementCount?: number;
  flatScreenshot?: boolean;
  onInitScript?: () => void;
} = {}) {
  let routeHandler: ((route: Route) => Promise<void>) | null = null;
  const page = {
    on: () => {},
    goto: async () => {
      await routeHandler?.(fakeRoute(`https://${options.hostname ?? 'example.test'}/entry?discard=this`));
      await routeHandler?.(fakeRoute(`https://${options.hostname ?? 'example.test'}/style.css`));
      await routeHandler?.(fakeRoute('https://static.example.test/asset.js?secret=discarded'));
    },
    waitForTimeout: async () => {},
    url: () => options.finalUrl ?? `https://${options.hostname ?? 'example.test'}/final?private=value`,
    title: async () => options.title ?? ' Example sign in ',
    evaluate: async () => ({
      structure: options.structure ?? 'html body main form input button',
      visibleText: options.visibleText ?? 'private rendered page text',
      structureTruncated: false, textTruncated: false,
      elementCount: options.elementCount ?? 6, formCount: 1, inputCount: 2, scriptCount: 0, imageCount: 0,
    }),
    screenshot: async () => patternedPng(64, 64, options.flatScreenshot === true),
  };
  const context = {
    addInitScript: async () => { options.onInitScript?.(); },
    route: async (_pattern: string, handler: (route: Route) => Promise<void>) => { routeHandler = handler; },
    routeWebSocket: async () => {},
    newPage: async () => page,
  };
  return {
    newContext: async () => context,
    close: async () => {},
  } as unknown as Browser;
}

describe('optional local rendered capture package', () => {
  test('requires explicit authorisation and a new bounded output directory', () => {
    assert.throws(() => parseCaptureArguments(['https://example.test', '--output-dir', 'capture']), /authorize-rendered-capture/u);
    assert.throws(() => parseCaptureArguments(['http://user:secret@example.test', '--output-dir', 'capture', '--authorize-rendered-capture']), /credentials/u);
    assert.deepEqual(parseCaptureArguments([
      'https://example.test', '--output-dir', './capture', '--authorize-rendered-capture', '--timeout-ms', '5000',
    ]), {
      targetUrl: 'https://example.test/',
      outputDirectory: path.resolve('./capture'),
      timeoutMs: 5000,
    });
  });

  test('writes import-compatible private metadata without retaining DOM text or request paths', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-test-'));
    const destination = path.join(parent, 'capture');
    let initScriptCalls = 0;
    const resolved: string[] = [];
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({ onInitScript: () => { initScriptCalls += 1; } }),
        fetchResource: async (url, options) => {
          const headers = new Headers(options.headers);
          assert.equal(headers.get('cookie'), null);
          assert.equal(headers.get('authorization'), null);
          assert.equal(headers.get('accept'), 'text/html');
          return fakeFetchResource(url);
        },
        resolveAddresses: async (hostname) => {
          resolved.push(hostname);
          return [{ address: '192.0.2.1', family: 4 }];
        },
        now: () => '2026-08-01T00:00:00.000Z',
      });
      assert.equal(manifest.schemaVersion, WEB_CAPTURE_MANIFEST_VERSION);
      assert.equal(initScriptCalls, 1);
      assert.deepEqual(resolved, ['example.test', 'example.test', 'static.example.test']);
      const capture = manifest.captures[0]!;
      assert.equal(capture.completeness, 'complete');
      assert.equal(capture.artifacts[0]?.perceptualHash?.length, 16);
      const imported = parseWebCaptureManifest(manifest);
      assert.equal(imported.findings.length, 1);
      const manifestText = await readFile(path.join(destination, 'manifest.json'), 'utf8');
      const digestText = await readFile(path.join(destination, 'dom-digest.json'), 'utf8');
      assert.doesNotMatch(`${manifestText}${digestText}`, /private rendered|discarded|private=value|entry\?|asset\.js/u);
      assert.equal((await stat(path.join(destination, 'screenshot.png'))).size > 0, true);
      await assert.rejects(() => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, { launchBrowser: async () => fakeBrowser(), fetchResource: fakeFetchResource, resolveAddresses: async () => [] }), /EEXIST|ENOTEMPTY|exist/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('compares two verified local captures offline without exposing paths or retained page text', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-compare-test-'));
    const leftDirectory = path.join(parent, 'left');
    const rightDirectory = path.join(parent, 'right');
    try {
      await captureRenderedPage({
        targetUrl: 'https://left.example.test/', outputDirectory: leftDirectory, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({ hostname: 'left.example.test', title: 'Account', visibleText: 'left private text' }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        now: () => '2026-08-01T00:00:00.000Z',
      });
      await captureRenderedPage({
        targetUrl: 'https://right.example.test/', outputDirectory: rightDirectory, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({
          hostname: 'right.example.test', title: 'Account', visibleText: 'right private text',
          structure: 'html body main section form input button', elementCount: 7,
        }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.2', family: 4 }],
        now: () => '2026-08-01T00:05:00.000Z',
      });
      const leftManifest = path.join(leftDirectory, 'manifest.json');
      const rightManifest = path.join(rightDirectory, 'manifest.json');
      assert.deepEqual(parseCaptureCompareArguments([leftManifest, rightManifest, '--json']), {
        leftManifest, rightManifest, output: 'json',
      });
      const comparison = await compareRenderedCaptures(leftManifest, rightManifest, '2026-08-01T00:10:00.000Z');
      assert.equal(comparison.schema, WEB_CAPTURE_COMPARISON_SCHEMA);
      assert.equal(comparison.screenshot.state, 'same');
      assert.equal(comparison.renderedDom.structure.state, 'different');
      assert.equal(comparison.renderedDom.visibleText.state, 'different');
      assert.equal(comparison.page.title.state, 'same');
      assert.equal(comparison.page.requestDomains.state, 'overlap');
      assert.deepEqual(comparison.page.requestDomains.shared, ['static.example.test']);
      assert.equal(comparison.renderedDom.counts.elements.delta, 1);
      assert.deepEqual(comparison.integrity.left, { screenshot: true, perceptualHash: true, domDigest: true });
      assert.match(formatRenderedCaptureComparison(comparison), /Rendered capture comparison/u);
      assert.doesNotMatch(JSON.stringify(comparison), /private text|capture-compare-test|manifest\.json/u);

      const originalRightManifest = await readFile(rightManifest, 'utf8');
      const rightDomPath = path.join(rightDirectory, 'dom-digest.json');
      const originalRightDom = await readFile(rightDomPath, 'utf8');
      const unsafeManifest = JSON.parse(originalRightManifest);
      unsafeManifest.captures[0].artifacts[1].fileName = '../dom-digest.json';
      await writeFile(rightManifest, `${JSON.stringify(unsafeManifest)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /plain file name/u);
      await writeFile(rightManifest, originalRightManifest);
      const invalidDimensions = JSON.parse(originalRightManifest);
      invalidDimensions.captures[0].artifacts[0].width = 0;
      await writeFile(rightManifest, `${JSON.stringify(invalidDimensions)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /width is outside/u);
      const invalidDomImageField = JSON.parse(originalRightManifest);
      invalidDomImageField.captures[0].artifacts[1].perceptualHash = 'not-a-hash';
      await writeFile(rightManifest, `${JSON.stringify(invalidDomImageField)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /cannot include image-only fields/u);
      const missingLimitations = JSON.parse(originalRightManifest);
      missingLimitations.captures[0].limitations = [];
      await writeFile(rightManifest, `${JSON.stringify(missingLimitations)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /limitations must contain/u);
      const mismatchedDom = JSON.parse(originalRightDom);
      mismatchedDom.capturedAt = '2026-08-01T00:06:00.000Z';
      const mismatchedDomText = `${JSON.stringify(mismatchedDom, null, 2)}\n`;
      const mismatchedManifest = JSON.parse(originalRightManifest);
      const domArtifact = mismatchedManifest.captures[0].artifacts[1];
      domArtifact.bytes = Buffer.byteLength(mismatchedDomText);
      domArtifact.sha256 = createHash('sha256').update(mismatchedDomText).digest('hex');
      await writeFile(rightDomPath, mismatchedDomText);
      await writeFile(rightManifest, `${JSON.stringify(mismatchedManifest)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /time does not match/u);
      await writeFile(rightManifest, originalRightManifest);
      await writeFile(rightDomPath, '{}\n');
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /size does not match|integrity verification/u);
      await writeFile(rightDomPath, originalRightDom);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('keeps an unavailable screenshot perceptual hash distinct from a visual difference', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-flat-test-'));
    const leftDirectory = path.join(parent, 'left');
    const rightDirectory = path.join(parent, 'right');
    try {
      const captures: Array<readonly [string, string]> = [
        ['flat-left.example.test', leftDirectory],
        ['flat-right.example.test', rightDirectory],
      ];
      for (const [domain, destination] of captures) {
        await captureRenderedPage({ targetUrl: `https://${domain}/`, outputDirectory: destination, timeoutMs: 5000 }, {
          launchBrowser: async () => fakeBrowser({ hostname: domain, flatScreenshot: true }),
          fetchResource: fakeFetchResource,
          resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
          now: () => '2026-08-01T00:00:00.000Z',
        });
      }
      const comparison = await compareRenderedCaptures(
        path.join(leftDirectory, 'manifest.json'),
        path.join(rightDirectory, 'manifest.json'),
      );
      assert.equal(comparison.screenshot.state, 'same');
      assert.equal(comparison.screenshot.method, 'Exact SHA-256 equality');
      assert.equal(comparison.screenshot.hammingDistance, null);
      assert.equal(comparison.screenshot.agreementPercent, null);
      assert.equal(comparison.integrity.left.perceptualHash, true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('fails closed when cumulative response bytes exceed the capture budget', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-budget-test-'));
    const destination = path.join(parent, 'capture');
    try {
      await assert.rejects(() => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser(),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        readResponse: async () => ({
          bytes: Buffer.alloc(0),
          bytesRead: MAX_CAPTURE_TRANSFER_BYTES + 1,
          truncated: false,
        }),
      }), /ERR_FAILED|navigation|aborted|blocked/u);
      await assert.rejects(() => stat(destination), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
