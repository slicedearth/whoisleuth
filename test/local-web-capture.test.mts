import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import zlib from 'node:zlib';

import type { Browser, Route } from '@playwright/test';

import {
  WEB_CAPTURE_MANIFEST_VERSION,
  captureRenderedPage,
  parseCaptureArguments,
} from '../packages/web-capture/capture.mts';
import { parseWebCaptureManifest } from '../frontend/src/lib/analysis/web-capture-import.ts';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function patternedPng(width = 64, height = 64) {
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
      const value = (x * 91 + y * 151) % 256;
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
    request: () => ({ url: () => url, method: () => 'GET' }),
    continue: async () => {},
    abort: async () => {},
  } as unknown as Route;
}

function fakeBrowser() {
  let routeHandler: ((route: Route) => Promise<void>) | null = null;
  const page = {
    on: () => {},
    goto: async () => {
      await routeHandler?.(fakeRoute('https://example.test/entry?discard=this'));
      await routeHandler?.(fakeRoute('https://static.example.test/asset.js?secret=discarded'));
    },
    waitForTimeout: async () => {},
    url: () => 'https://example.test/final?private=value',
    title: async () => ' Example sign in ',
    evaluate: async () => ({
      structure: 'html body main form input button', visibleText: 'private rendered page text',
      structureTruncated: false, textTruncated: false,
      elementCount: 6, formCount: 1, inputCount: 2, scriptCount: 0, imageCount: 0,
    }),
    screenshot: async () => patternedPng(),
  };
  const context = {
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
    const resolved: string[] = [];
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser(),
        resolveAddresses: async (hostname) => {
          resolved.push(hostname);
          return [{ address: '192.0.2.1', family: 4 }];
        },
        now: () => '2026-08-01T00:00:00.000Z',
      });
      assert.equal(manifest.schemaVersion, WEB_CAPTURE_MANIFEST_VERSION);
      assert.deepEqual(resolved, ['example.test', 'static.example.test']);
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
      }, { launchBrowser: async () => fakeBrowser(), resolveAddresses: async () => [] }), /EEXIST|ENOTEMPTY|exist/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
