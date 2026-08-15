import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import zlib from 'node:zlib';

import type { Browser, Route } from '@playwright/test';

import {
  MAX_CAPTURE_HOSTS,
  MAX_CAPTURE_REQUESTS,
  MAX_CAPTURE_RESPONSE_BYTES,
  MAX_CAPTURE_TRANSFER_BYTES,
  WEB_CAPTURE_MANIFEST_VERSION,
  browserNetworkIntrinsicsAreDisabled,
  captureRenderedPage,
  disableBrowserNetworkIntrinsics,
  installDomProjectionIntrinsics,
  parseCaptureArguments,
  sanitizeCaptureText,
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

function fakeRoute(url: string, options: { rejectAbort?: boolean } = {}) {
  let aborted = false;
  const route = {
    request: () => ({
      url: () => url,
      method: () => 'GET',
      headers: () => ({ accept: 'text/html', cookie: 'must-not-leave-browser=1', authorization: 'Bearer secret' }),
    }),
    fulfill: async () => {},
    abort: async () => {
      aborted = true;
      if (options.rejectAbort) throw new Error('route already closed');
    },
  } as unknown as Route;
  return { route, wasAborted: () => aborted };
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
  formCount?: number;
  inputCount?: number;
  scriptCount?: number;
  imageCount?: number;
  flatScreenshot?: boolean;
  onInitScript?: () => void;
  subresourceUrls?: string[];
  concurrentSubresources?: boolean;
  detachedSubresources?: boolean;
  closeSubresourceUrl?: string;
  rejectCloseSubresourceAbort?: boolean;
  stallDomProjection?: boolean;
  networkApisDisabled?: boolean;
} = {}) {
  let routeHandler: ((route: Route) => Promise<void>) | null = null;
  const page = {
    on: () => {},
    goto: async () => {
      if (!routeHandler) return;
      const handleRoute = routeHandler;
      const mainRequest = fakeRoute(`https://${options.hostname ?? 'example.test'}/entry?discard=this`);
      await handleRoute(mainRequest.route);
      if (mainRequest.wasAborted()) throw new Error('navigation aborted');
      const subresources = options.subresourceUrls ?? [
        `https://${options.hostname ?? 'example.test'}/style.css`,
        'https://static.example.test/asset.js?secret=discarded',
      ];
      const handleSubresource = async (url: string) => {
        const request = fakeRoute(url);
        await handleRoute(request.route);
      };
      if (options.detachedSubresources) {
        for (const url of subresources) void handleSubresource(url);
      } else if (options.concurrentSubresources) {
        await Promise.all(subresources.map(handleSubresource));
      } else {
        for (const url of subresources) await handleSubresource(url);
      }
    },
    waitForTimeout: async () => {},
    url: () => options.finalUrl ?? `https://${options.hostname ?? 'example.test'}/final?private=value`,
    title: async () => options.title ?? ' Example sign in ',
    evaluate: async (_callback: unknown, argument?: unknown) => {
      if (argument === undefined) return options.networkApisDisabled !== false;
      if (options.stallDomProjection) await new Promise<never>(() => {});
      return {
        structure: options.structure ?? 'html body main form input button',
        visibleText: options.visibleText ?? 'private rendered page text',
        structureTruncated: false, textTruncated: false,
        elementCount: options.elementCount ?? 6,
        formCount: options.formCount ?? 1,
        inputCount: options.inputCount ?? 2,
        scriptCount: options.scriptCount ?? 0,
        imageCount: options.imageCount ?? 0,
      };
    },
    screenshot: async () => patternedPng(1024, 768, options.flatScreenshot === true),
    close: async () => {},
  };
  const context = {
    addInitScript: async () => { options.onInitScript?.(); },
    route: async (_pattern: string, handler: (route: Route) => Promise<void>) => { routeHandler = handler; },
    routeWebSocket: async () => {},
    newPage: async () => page,
    close: async () => {
      if (!routeHandler || !options.closeSubresourceUrl) return;
      const request = fakeRoute(options.closeSubresourceUrl, {
        ...(options.rejectCloseSubresourceAbort === undefined
          ? {}
          : { rejectAbort: options.rejectCloseSubresourceAbort }),
      });
      await routeHandler(request.route);
      assert.equal(request.wasAborted(), true);
    },
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
    assert.throws(
      () => parseCaptureArguments(['https://example.test', '--output-dir', 'safe\u202etxt', '--authorize-rendered-capture']),
      /bounded local path/u,
    );
    assert.throws(
      () => parseCaptureArguments(['https://example.test', '--output-dir', 'safe\ufefftxt', '--authorize-rendered-capture']),
      /bounded local path/u,
    );
    for (const invisible of ['\u00ad', '\u034f']) {
      assert.throws(
        () => parseCaptureArguments(['https://example.test', '--output-dir', `safe${invisible}txt`, '--authorize-rendered-capture']),
        /bounded local path/u,
      );
      assert.throws(
        () => parseCaptureCompareArguments([`left${invisible}.json`, 'right.json']),
        /control characters/u,
      );
    }
    for (const target of [
      'ht\ntps://example.test/',
      'https://exa\u0085mple.test/',
      'https://exa\u00admple.test/',
      'https://exa\u034fmple.test/',
      'https://example.test/pri\u202evate',
    ]) {
      assert.throws(
        () => parseCaptureArguments([target, '--output-dir', 'capture', '--authorize-rendered-capture']),
        /Capture URL/u,
      );
    }
    assert.doesNotThrow(() => parseCaptureArguments([
      'https://example.test', '--output-dir', 'résumé-capture', '--authorize-rendered-capture',
    ]));
    assert.doesNotThrow(() => parseCaptureArguments([
      'https://bücher.example/', '--output-dir', 'capture-unicode', '--authorize-rendered-capture',
    ]));
    assert.deepEqual(parseCaptureArguments([
      'https://example.test', '--output-dir', './capture', '--authorize-rendered-capture', '--timeout-ms', '5000',
    ]), {
      targetUrl: 'https://example.test/',
      outputDirectory: path.resolve('./capture'),
      timeoutMs: 5000,
    });
  });

  test('captures native DOM traversal before target scripts can monkeypatch it', () => {
    const boundaryName = '__whoisleuthFixtureProjection';
    class FixtureNode {
      readonly value: string | null;
      constructor(value: string | null = null) { this.value = value; }
      get nodeValue() { return this.value; }
    }
    class FixtureElement extends FixtureNode {
      readonly name: string;
      constructor(name: string) { super(null); this.name = name; }
      get tagName() { return this.name; }
    }
    class FixtureTreeWalker {
      index = 0;
      readonly nodes: Array<FixtureNode | FixtureElement>;
      constructor(nodes: Array<FixtureNode | FixtureElement>) { this.nodes = nodes; }
      nextNode() { return this.nodes[this.index++] ?? null; }
    }
    const elements = [new FixtureElement('HTML'), new FixtureElement('BODY'), new FixtureElement('FORM'), new FixtureElement('INPUT')];
    const bodyText = [new FixtureNode('retained fixture text')];
    class FixtureDocument {
      createTreeWalker(_root: unknown, type: number) {
        return new FixtureTreeWalker(type === 1 ? elements : bodyText);
      }
    }
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    const previous = new Map<string, unknown>();
    const previousMinimum = Math.min;
    const previousIsSafeInteger = Number.isSafeInteger;
    for (const [name, value] of Object.entries({
      Document: FixtureDocument,
      TreeWalker: FixtureTreeWalker,
      Element: FixtureElement,
      Node: FixtureNode,
      document: new FixtureDocument(),
    })) {
      previous.set(name, globals[name]);
      globals[name] = value;
    }
    try {
      installDomProjectionIntrinsics({ boundaryName, maximumCharacters: 100, maximumElements: 10 });
      FixtureDocument.prototype.createTreeWalker = () => new FixtureTreeWalker([]);
      FixtureTreeWalker.prototype.nextNode = () => null;
      Object.defineProperty(FixtureElement.prototype, 'tagName', { get: () => 'FORGED', configurable: true });
      Object.defineProperty(FixtureNode.prototype, 'nodeValue', { get: () => 'forged text', configurable: true });
      Math.min = () => 0;
      Number.isSafeInteger = () => true;
      const project = globals[boundaryName] as (bounds: { maximumCharacters: number; maximumElements: number }) => Record<string, unknown>;
      assert.deepEqual(project({ maximumCharacters: 100, maximumElements: 10 }), {
        structure: 'html body form input',
        visibleText: 'retained fixture text',
        structureTruncated: false,
        textTruncated: false,
        elementCount: 4,
        formCount: 1,
        inputCount: 1,
        scriptCount: 0,
        imageCount: 0,
      });
      const bounded = project({ maximumCharacters: 10, maximumElements: 10 });
      assert.equal(bounded.structure, 'html body');
      assert.equal(bounded.structureTruncated, true);
      assert.equal(bounded.visibleText, 'retained f');
      assert.equal(bounded.textTruncated, true);
      assert.throws(() => project({ maximumCharacters: 0, maximumElements: 10 }), /invalid bounds/u);
      assert.throws(() => project({ maximumCharacters: 101, maximumElements: 10 }), /invalid bounds/u);
      assert.throws(() => project({ maximumCharacters: 100, maximumElements: 11 }), /invalid bounds/u);
    } finally {
      Math.min = previousMinimum;
      Number.isSafeInteger = previousIsSafeInteger;
      for (const [name, value] of previous) {
        if (value === undefined) delete globals[name];
        else globals[name] = value;
      }
    }
  });

  test('removes worker and browser-managed network APIs before target scripts run', () => {
    const scope: Record<string, unknown> = {
      RTCPeerConnection: class {},
      webkitRTCPeerConnection: class {},
      WebTransport: class {},
      Worker: class {},
      SharedWorker: class {},
    };
    disableBrowserNetworkIntrinsics(scope);
    assert.equal(browserNetworkIntrinsicsAreDisabled(scope), true);
    for (const name of Object.keys(scope)) {
      assert.equal(scope[name], undefined);
      assert.deepEqual(Object.getOwnPropertyDescriptor(scope, name), {
        value: undefined,
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }
    const blockedScope: Record<string, unknown> = {};
    Object.defineProperty(blockedScope, 'Worker', { value: class {}, configurable: false });
    assert.throws(() => disableBrowserNetworkIntrinsics(blockedScope), /could not disable.*Worker/u);
  });

  test('fails before navigation when browser-managed transports remain available', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-network-boundary-test-'));
    try {
      await assert.rejects(() => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: path.join(parent, 'capture'), timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({ networkApisDisabled: false }),
      }), /could not verify.*transports/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('atomically reserves one output directory without replacing a concurrent capture', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-reservation-test-'));
    const destination = path.join(parent, 'capture');
    try {
      const capture = () => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser(),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      });
      const settled = await Promise.allSettled([capture(), capture()]);
      assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
      const rejected = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
      assert.match(String(rejected?.reason), /already exists/u);
      assert.equal((await stat(path.join(destination, 'manifest.json'))).isFile(), true);
      await assert.rejects(() => mkdir(destination), /EEXIST/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('preserves unrelated files added to a failed reserved capture directory', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-cleanup-test-'));
    const destination = path.join(parent, 'capture');
    const unrelated = path.join(destination, 'unrelated.txt');
    try {
      await assert.rejects(() => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => {
          await writeFile(unrelated, 'belongs to another local process');
          throw new Error('fixture launch failure');
        },
      }), /fixture launch failure/u);
      assert.equal(await readFile(unrelated, 'utf8'), 'belongs to another local process');
      assert.equal((await stat(destination)).isDirectory(), true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('removes an owned private artefact whose write crosses the total deadline', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-write-deadline-test-'));
    const destination = path.join(parent, 'capture');
    try {
      await assert.rejects(() => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 1000,
      }, {
        launchBrowser: async () => fakeBrowser(),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        writeArtifact: async (filePath, _value, signal, onCreated) => {
          const handle = await open(filePath, 'wx', 0o600);
          try {
            const identity = await handle.stat();
            onCreated({ dev: identity.dev, ino: identity.ino });
            await new Promise<void>((_resolve, reject) => {
              const abort = () => reject(signal.reason);
              if (signal.aborted) abort();
              else signal.addEventListener('abort', abort, { once: true });
            });
          } finally {
            await handle.close();
          }
        },
      }), /total-run deadline/u);
      await assert.rejects(() => stat(destination), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('rejects IP-literal targets before browser or network work', async () => {
    assert.throws(() => parseCaptureArguments([
      'https://[2606:4700:4700::1111]/', '--output-dir', './capture', '--authorize-rendered-capture',
    ]), /domain hostname/u);
    let launched = false;
    await assert.rejects(() => captureRenderedPage({
      targetUrl: 'https://192.0.2.1/', outputDirectory: path.join(tmpdir(), 'unused-capture'), timeoutMs: 5000,
    }, {
      launchBrowser: async () => { launched = true; return fakeBrowser(); },
    }), /domain hostname/u);
    assert.equal(launched, false);
  });

  test('sanitizes comparator file errors without disclosing selected input paths', async () => {
    const left = path.join(tmpdir(), 'private-left-capture-name', 'manifest.json');
    const right = path.join(tmpdir(), 'private-right-capture-name', 'manifest.json');
    await assert.rejects(
      () => compareRenderedCaptures(left, right),
      (error: unknown) => {
        assert.match(String(error), /Rendered capture manifest could not be read/u);
        assert.doesNotMatch(String(error), /private-left|private-right|manifest\.json|\/tmp/u);
        return true;
      },
    );
  });

  test('sanitizes C1 and bidirectional controls in capture diagnostics', () => {
    assert.equal(
      sanitizeCaptureText('unknown\u0085 option \u061c--unsafe\ufeff', 500),
      'unknown option --unsafe',
    );
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
      assert.match(
        manifest.captures[0]?.limitations.join(' ') ?? '',
        /No dedicated path or query field.*page title and screenshot can reproduce/u,
      );
      assert.equal(initScriptCalls, 2);
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

  test('removes C1 and bidirectional controls from retained page titles', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-title-test-'));
    const destination = path.join(parent, 'capture');
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({ title: 'Account\u0085 review \u202Etxt' }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        now: () => '2026-08-01T00:00:00.000Z',
      });
      assert.equal(manifest.captures[0]?.page.title, 'Account review txt');
      assert.doesNotMatch(JSON.stringify(manifest), /[\u0080-\u009f\u202a-\u202e]/u);
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
          hostname: 'right.example.test', title: 'Review', visibleText: 'right private text',
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
      assert.throws(
        () => parseCaptureCompareArguments([`${leftManifest}\u061c`, rightManifest, '--json']),
        /control characters/u,
      );
      const comparison = await compareRenderedCaptures(leftManifest, rightManifest, '2026-08-01T00:10:00.000Z');
      assert.equal(comparison.schema, WEB_CAPTURE_COMPARISON_SCHEMA);
      assert.equal(comparison.version, 3);
      assert.equal(comparison.screenshot.state, 'same');
      assert.equal(comparison.renderedDom.structure.state, 'different');
      assert.equal(comparison.renderedDom.visibleText.state, 'different');
      assert.deepEqual(comparison.page.title, { state: 'different' });
      assert.equal(comparison.page.requestDomains.state, 'overlap');
      assert.deepEqual(comparison.page.requestDomains.shared, ['static.example.test']);
      assert.equal(comparison.renderedDom.counts.elements.delta, 1);
      assert.deepEqual(comparison.integrity.left, { screenshot: true, perceptualHash: true, domDigest: true });
      assert.match(formatRenderedCaptureComparison(comparison), /Rendered capture comparison/u);
      assert.doesNotMatch(JSON.stringify(comparison), /private text|capture-compare-test|manifest\.json|Account|Review/u);

      const originalLeftManifest = await readFile(leftManifest, 'utf8');
      const originalRightManifest = await readFile(rightManifest, 'utf8');
      await assert.rejects(
        () => compareRenderedCaptures(leftManifest, rightManifest, '2026-08-01T00:10:00'),
        /explicit timezone/u,
      );
      const zoneLessCaptureManifest = JSON.parse(originalRightManifest);
      zoneLessCaptureManifest.captures[0].capturedAt = '2026-08-01T00:05:00';
      await writeFile(rightManifest, `${JSON.stringify(zoneLessCaptureManifest)}\n`);
      await assert.rejects(
        () => compareRenderedCaptures(leftManifest, rightManifest),
        /explicit timezone/u,
      );
      await writeFile(rightManifest, originalRightManifest);
      const invalidUtf8 = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]);
      await writeFile(leftManifest, invalidUtf8);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /not valid JSON/u);
      await writeFile(leftManifest, originalLeftManifest);

      const partialLeftManifest = JSON.parse(originalLeftManifest);
      partialLeftManifest.captures[0].completeness = 'partial';
      await writeFile(leftManifest, `${JSON.stringify(partialLeftManifest)}\n`);
      const partialComparison = await compareRenderedCaptures(leftManifest, rightManifest, '2026-08-01T00:10:00.000Z');
      assert.equal(partialComparison.partial, true);
      assert.equal(partialComparison.page.requestDomains.state, 'unavailable');
      assert.deepEqual(partialComparison.page.requestDomains.shared, ['static.example.test']);
      assert.equal(partialComparison.page.technologies.state, 'unavailable');
      await writeFile(leftManifest, originalLeftManifest);

      const rightDomPath = path.join(rightDirectory, 'dom-digest.json');
      const originalRightDom = await readFile(rightDomPath, 'utf8');
      const zoneLessDom = JSON.parse(originalRightDom);
      zoneLessDom.capturedAt = '2026-08-01T00:05:00';
      const zoneLessDomText = `${JSON.stringify(zoneLessDom, null, 2)}\n`;
      const zoneLessDomManifest = JSON.parse(originalRightManifest);
      const zoneLessDomArtifact = zoneLessDomManifest.captures[0].artifacts[1];
      zoneLessDomArtifact.bytes = Buffer.byteLength(zoneLessDomText);
      zoneLessDomArtifact.sha256 = createHash('sha256').update(zoneLessDomText).digest('hex');
      await writeFile(rightDomPath, zoneLessDomText);
      await writeFile(rightManifest, `${JSON.stringify(zoneLessDomManifest)}\n`);
      await assert.rejects(
        () => compareRenderedCaptures(leftManifest, rightManifest),
        /explicit timezone/u,
      );
      await writeFile(rightDomPath, originalRightDom);
      await writeFile(rightManifest, originalRightManifest);
      const invalidUtf8DomManifest = JSON.parse(originalRightManifest);
      invalidUtf8DomManifest.captures[0].artifacts[1].bytes = invalidUtf8.length;
      invalidUtf8DomManifest.captures[0].artifacts[1].sha256 = createHash('sha256').update(invalidUtf8).digest('hex');
      await writeFile(rightDomPath, invalidUtf8);
      await writeFile(rightManifest, `${JSON.stringify(invalidUtf8DomManifest)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /not valid JSON/u);
      await writeFile(rightDomPath, originalRightDom);
      await writeFile(rightManifest, originalRightManifest);

      const unsafeManifest = JSON.parse(originalRightManifest);
      unsafeManifest.captures[0].artifacts[1].fileName = '../dom-digest.json';
      await writeFile(rightManifest, `${JSON.stringify(unsafeManifest)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /plain file name/u);
      await writeFile(rightManifest, originalRightManifest);
      const invalidDimensions = JSON.parse(originalRightManifest);
      invalidDimensions.captures[0].artifacts[0].width = 0;
      await writeFile(rightManifest, `${JSON.stringify(invalidDimensions)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /width is outside/u);
      const mismatchedDimensions = JSON.parse(originalRightManifest);
      mismatchedDimensions.captures[0].artifacts[0].width = 1023;
      await writeFile(rightManifest, `${JSON.stringify(mismatchedDimensions)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /integrity verification/u);
      const rightScreenshotPath = path.join(rightDirectory, 'screenshot.png');
      const originalRightScreenshot = await readFile(rightScreenshotPath);
      const malformedScreenshot = Buffer.from('not a decodable PNG fixture', 'utf8');
      const malformedScreenshotManifest = JSON.parse(originalRightManifest);
      const malformedScreenshotArtifact = malformedScreenshotManifest.captures[0].artifacts[0];
      malformedScreenshotArtifact.bytes = malformedScreenshot.length;
      malformedScreenshotArtifact.sha256 = createHash('sha256').update(malformedScreenshot).digest('hex');
      malformedScreenshotArtifact.perceptualHash = null;
      await writeFile(rightScreenshotPath, malformedScreenshot);
      await writeFile(rightManifest, `${JSON.stringify(malformedScreenshotManifest)}\n`);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /integrity verification/u);
      await writeFile(rightScreenshotPath, originalRightScreenshot);
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
      for (const mutate of [
        (value: Record<string, any>) => { delete value.structure.truncated; },
        (value: Record<string, any>) => { value.visibleText.truncated = 'false'; },
      ]) {
        const invalidDom = JSON.parse(originalRightDom) as Record<string, any>;
        mutate(invalidDom);
        const invalidDomText = `${JSON.stringify(invalidDom, null, 2)}\n`;
        const invalidManifest = JSON.parse(originalRightManifest);
        const invalidDomArtifact = invalidManifest.captures[0].artifacts[1];
        invalidDomArtifact.bytes = Buffer.byteLength(invalidDomText);
        invalidDomArtifact.sha256 = createHash('sha256').update(invalidDomText).digest('hex');
        await writeFile(rightDomPath, invalidDomText);
        await writeFile(rightManifest, `${JSON.stringify(invalidManifest)}\n`);
        await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /truncation state must be a boolean/u);
      }
      await writeFile(rightManifest, originalRightManifest);
      await writeFile(rightDomPath, '{}\n');
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest), /size does not match|integrity verification/u);
      await writeFile(rightDomPath, originalRightDom);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('produces comparator-compatible partial artefacts at shared DOM and UTF-8 bounds', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-bounds-test-'));
    const destination = path.join(parent, 'capture');
    const secondDestination = path.join(parent, 'capture-second');
    try {
      const captureAt = async (outputDirectory: string) => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({
          visibleText: '😀'.repeat(100_000),
          elementCount: 20_001,
          formCount: 20_001,
          inputCount: 20_001,
          scriptCount: 20_001,
          imageCount: 20_001,
        }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        now: () => '2026-08-01T00:00:00.000Z',
      });
      const manifest = await captureAt(destination);
      await captureAt(secondDestination);
      assert.equal(manifest.captures[0]?.completeness, 'partial');
      const digest = JSON.parse(await readFile(path.join(destination, 'dom-digest.json'), 'utf8'));
      assert.deepEqual(digest.counts, {
        elements: 20_000, forms: 20_000, controls: 20_000, scripts: 20_000, images: 20_000,
      });
      assert.equal(digest.visibleText.bytes, 256 * 1024);
      assert.equal(digest.visibleText.truncated, true);
      assert.equal(digest.structure.truncated, true);
      const comparison = await compareRenderedCaptures(
        path.join(destination, 'manifest.json'),
        path.join(secondDestination, 'manifest.json'),
      );
      assert.equal(comparison.partial, true);
      assert.equal(comparison.renderedDom.visibleText.state, 'unavailable');
      assert.equal(comparison.renderedDom.structure.state, 'unavailable');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('enforces one total-run deadline across renderer lifecycle work', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-deadline-test-'));
    const destination = path.join(parent, 'capture');
    try {
      const startedAt = Date.now();
      await assert.rejects(() => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 1_000,
      }, {
        launchBrowser: async () => fakeBrowser({ stallDomProjection: true }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      }), /total-run deadline/u);
      assert.ok(Date.now() - startedAt < 2_000);
      await assert.rejects(() => stat(destination), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('aborts an admitted direct resource fetch at the shared total deadline', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-fetch-deadline-test-'));
    const destination = path.join(parent, 'capture');
    let requestAborted = false;
    try {
      await assert.rejects(() => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 1_000,
      }, {
        launchBrowser: async () => fakeBrowser(),
        fetchResource: async (_url, options) => new Promise<Response>((_resolve, reject) => {
          const signal = options.signal;
          if (!signal) throw new Error('Capture request did not receive its total-run signal.');
          signal.addEventListener('abort', () => {
            requestAborted = true;
            reject(signal.reason);
          }, { once: true });
        }),
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      }), /total-run deadline/u);
      assert.equal(requestAborted, true);
      await assert.rejects(() => stat(destination), /ENOENT/u);
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

  test('charges refused subresources against the shared response-body budget', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-refused-budget-test-'));
    const destination = path.join(parent, 'capture');
    const consumed: number[] = [];
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({
          subresourceUrls: Array.from({ length: 12 }, (_, index) => `https://static.example.test/asset-${index}.js`),
        }),
        fetchResource: async (url) => new Response('', { status: 200, headers: { 'x-fixture-url': url } }),
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        readResponse: async (response, maximum) => {
          const mainDocument = response.headers.get('x-fixture-url')?.includes('/entry?') === true;
          const bytesRead = mainDocument ? 1 : maximum;
          consumed.push(bytesRead);
          return { bytes: Buffer.alloc(0), bytesRead, truncated: !mainDocument };
        },
      });
      assert.equal(consumed.reduce((total, value) => total + value, 0), MAX_CAPTURE_TRANSFER_BYTES);
      assert.equal(Math.max(...consumed), MAX_CAPTURE_RESPONSE_BYTES);
      assert.equal(consumed.includes(MAX_CAPTURE_RESPONSE_BYTES - 1), true);
      assert.equal(manifest.captures[0]?.completeness, 'partial');
      assert.match(manifest.captures[0]?.limitations.join(' ') ?? '', /processed at most .* response-body bytes/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('reserves one cumulative allowance across concurrent response reads', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-concurrent-budget-test-'));
    const destination = path.join(parent, 'capture');
    const allowances: number[] = [];
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({
          concurrentSubresources: true,
          subresourceUrls: Array.from({ length: 12 }, (_, index) => `https://static.example.test/asset-${index}.js`),
        }),
        fetchResource: async (url) => new Response('', { status: 200, headers: { 'x-fixture-url': url } }),
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        readResponse: async (response, maximum) => {
          const mainDocument = response.headers.get('x-fixture-url')?.includes('/entry?') === true;
          allowances.push(mainDocument ? 1 : maximum);
          await new Promise<void>((resolvePromise) => { setImmediate(resolvePromise); });
          return { bytes: Buffer.alloc(0), bytesRead: mainDocument ? 1 : maximum, truncated: false };
        },
      });
      assert.equal(allowances.reduce((total, value) => total + value, 0), MAX_CAPTURE_TRANSFER_BYTES);
      assert.equal(allowances.every((value) => value <= MAX_CAPTURE_RESPONSE_BYTES), true);
      assert.equal(allowances.includes(MAX_CAPTURE_RESPONSE_BYTES - 1), true);
      assert.equal(manifest.captures[0]?.completeness, 'partial');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('stops admitting browser requests at the exact request ceiling', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-request-limit-test-'));
    const destination = path.join(parent, 'capture');
    const fetched: string[] = [];
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({
          subresourceUrls: Array.from(
            { length: MAX_CAPTURE_REQUESTS + 5 },
            (_, index) => `https://example.test/asset-${index}.js`,
          ),
        }),
        fetchResource: async (url) => {
          fetched.push(url);
          return new Response('', { status: 200 });
        },
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      });
      assert.equal(fetched.length, MAX_CAPTURE_REQUESTS);
      assert.equal(manifest.captures[0]?.completeness, 'partial');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('waits for already-admitted late requests before finalising completeness', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-late-request-test-'));
    const destination = path.join(parent, 'capture');
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({
          detachedSubresources: true,
          subresourceUrls: ['https://static.example.test/late.js'],
        }),
        fetchResource: async (url) => new Response('', { status: 200, headers: { 'x-fixture-url': url } }),
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        readResponse: async (response) => {
          await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 20); });
          const late = response.headers.get('x-fixture-url')?.includes('/late.js') === true;
          return { bytes: Buffer.alloc(0), bytesRead: late ? 1 : 0, truncated: late };
        },
      });
      assert.equal(manifest.captures[0]?.completeness, 'partial');
      assert.deepEqual(manifest.captures[0]?.requestDomains, ['example.test', 'static.example.test']);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('counts and settles a request emitted while the browser context is closing', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-seal-test-'));
    const destination = path.join(parent, 'capture');
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({
          closeSubresourceUrl: 'https://late.example.test/after-seal.js',
          rejectCloseSubresourceAbort: true,
        }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      });

      assert.equal(manifest.captures[0]?.completeness, 'partial');
      assert.equal(manifest.captures[0]?.requestDomains.includes('late.example.test'), false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('does not retain a browser-requested host that fails public-address validation', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-rejected-host-test-'));
    const destination = path.join(parent, 'capture');
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({ subresourceUrls: ['https://blocked.internal.test/script.js'] }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async (hostname) => {
          if (hostname === 'blocked.internal.test') throw new Error('private address rejected');
          return [{ address: '192.0.2.1', family: 4 }];
        },
      });
      assert.equal(manifest.captures[0]?.completeness, 'partial');
      assert.deepEqual(manifest.captures[0]?.requestDomains, ['example.test']);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('bounds and records browser-requested hosts even when their bodies are refused', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-host-budget-test-'));
    const destination = path.join(parent, 'capture');
    const resolved = new Set<string>();
    try {
      const manifest = await captureRenderedPage({
        targetUrl: 'https://entry.example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({
          hostname: 'entry.example.test',
          subresourceUrls: Array.from({ length: 40 }, (_, index) => `https://asset-${index}.example.test/script.js`),
        }),
        fetchResource: async (url) => new Response('', { status: 200, headers: { 'x-fixture-url': url } }),
        resolveAddresses: async (hostname) => {
          resolved.add(hostname);
          return [{ address: '192.0.2.1', family: 4 }];
        },
        readResponse: async (response, maximum) => {
          const mainDocument = response.headers.get('x-fixture-url')?.includes('/entry?') === true;
          return { bytes: Buffer.alloc(0), bytesRead: mainDocument ? 1 : maximum, truncated: !mainDocument };
        },
      });
      const requestDomains = manifest.captures[0]?.requestDomains ?? [];
      assert.equal(resolved.size, MAX_CAPTURE_HOSTS);
      assert.equal(requestDomains.length, MAX_CAPTURE_HOSTS);
      assert.equal(requestDomains.includes('asset-0.example.test'), true);
      assert.equal(requestDomains.includes(`asset-${MAX_CAPTURE_HOSTS}.example.test`), false);
      assert.equal(manifest.captures[0]?.completeness, 'partial');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('fails closed when the main response reports invalid byte accounting', async () => {
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
      }), /navigation|aborted|blocked/u);
      await assert.rejects(() => stat(destination), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
