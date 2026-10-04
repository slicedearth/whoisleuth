import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import type { Route } from '@playwright/test';

import {
  MAX_CAPTURE_HOSTS,
  MAX_CAPTURE_REQUESTS,
  MAX_CAPTURE_RESPONSE_BYTES,
  MAX_CAPTURE_TRANSFER_BYTES,
  WEB_CAPTURE_MANIFEST_VERSION,
  browserNetworkIntrinsicsAreDisabled,
  captureRenderedPage,
  createCaptureInterruption,
  disableBrowserNetworkIntrinsics,
  installDomProjectionIntrinsics,
  parseCaptureArguments,
  sanitizeCaptureText,
  type CaptureBrowser,
} from '../packages/web-capture/capture.mts';
import { startAnchoredArtifactWriter } from '../packages/web-capture/anchored-artifact-writer.mts';
import { launchCaptureBrowser } from '../packages/web-capture/browser.mts';
import {
  WEB_CAPTURE_COMPARISON_SCHEMA,
  compareRenderedCaptures,
  formatRenderedCaptureComparison,
  parseCaptureCompareArguments,
} from '../packages/web-capture/compare.mts';
import { parseWebCaptureManifest } from '../frontend/src/lib/analysis/web-capture-import.ts';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CAPTURE_ENTRY = fileURLToPath(new URL('../packages/web-capture/bin/whoisleuth-capture.mts', import.meta.url));

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

const MAIN_FRAME = {};
function fakeRoute(url: string, options: { rejectAbort?: boolean; navigation?: boolean; method?: string; resourceType?: string } = {}) {
  let aborted = false;
  const route = {
    request: () => ({
      url: () => url,
      method: () => options.method ?? 'GET',
      resourceType: () => options.resourceType ?? (url.includes('.js') ? 'script' : options.navigation ? 'document' : 'stylesheet'),
      isNavigationRequest: () => Boolean(options.navigation),
      frame: () => MAIN_FRAME,
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

function controlledDeadlineScheduler() {
  let callback: (() => void) | null = null;
  const timer = Object.freeze({}) as ReturnType<typeof setTimeout>;
  return {
    scheduler: Object.freeze({
      schedule(candidate: () => void, delayMs: number) {
        assert.equal(callback, null);
        assert.ok(delayMs >= 1_000);
        callback = candidate;
        return timer;
      },
      cancel(candidate: ReturnType<typeof setTimeout>) {
        assert.equal(candidate, timer);
        callback = null;
      },
    }),
    expire() {
      assert.ok(callback);
      const candidate = callback;
      callback = null;
      candidate();
    },
  };
}

// Behaviour fixtures advance their deadline explicitly. Their screenshot
// construction and host scheduling are not capture-latency assertions.
function captureFixturePage(...[argumentsValue, dependencies]: Parameters<typeof captureRenderedPage>) {
  return captureRenderedPage(argumentsValue, {
    deadlineScheduler: controlledDeadlineScheduler().scheduler,
    ...dependencies,
  });
}

const CAPTURE_SCREENSHOTS = {
  patterned: patternedPng(1024, 768),
  flat: patternedPng(1024, 768, true),
};

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
  subresourceRequests?: { url: string; method?: string; resourceType?: string; navigation?: boolean }[];
  concurrentSubresources?: boolean;
  detachedSubresources?: boolean;
  closeSubresourceUrl?: string;
  rejectCloseSubresourceAbort?: boolean;
  stallDomProjection?: boolean;
  networkApisDisabled?: boolean;
  blockedDirectConnections?: number;
} = {}) {
  let routeHandler: ((route: Route) => Promise<void>) | null = null;
  const page = {
    on: () => {},
    mainFrame: () => MAIN_FRAME,
    goto: async () => {
      if (!routeHandler) return;
      const handleRoute = routeHandler;
      const mainRequest = fakeRoute(`https://${options.hostname ?? 'example.test'}/entry?discard=this`, { navigation: true });
      await handleRoute(mainRequest.route);
      if (mainRequest.wasAborted()) throw new Error('navigation aborted');
      const subresources = options.subresourceRequests ?? (options.subresourceUrls ?? [
        `https://${options.hostname ?? 'example.test'}/style.css`,
        'https://static.example.test/asset.js?secret=discarded',
      ]).map(url => ({ url }));
      const handleSubresource = async (value: { url: string; method?: string; resourceType?: string; navigation?: boolean }) => {
        const request = fakeRoute(value.url, value);
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
      if (argument === '__whoisleuthPageObservationsV1') return { elements: [], partial: false, clipboardWriteAttempts: 0 };
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
    screenshot: async () => Buffer.from(options.flatScreenshot ? CAPTURE_SCREENSHOTS.flat : CAPTURE_SCREENSHOTS.patterned),
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
    version: () => '151.0.0.0',
    blockedDirectConnections: () => options.blockedDirectConnections ?? 0,
    once: () => {},
    close: async () => {},
  } as unknown as CaptureBrowser;
}

describe('optional local rendered capture package', () => {
  test('keeps the browser sandbox and a bounded launch deadline without fallback', async () => {
    const instance = fakeBrowser();
    const result = await launchCaptureBrowser(5000, { launch: async options => {
      assert.equal(options?.headless, true);
      assert.equal(options.chromiumSandbox, true);
      assert.ok(options.timeout! > 0 && options.timeout! <= 5000);
      assert.match(options.proxy!.server, /^http:\/\/127\.0\.0\.1:\d+$/u);
      assert.equal(options.proxy!.bypass, '<-loopback>');
      assert.ok(options.args?.includes('--dns-prefetch-disable'));
      assert.ok(options.args?.includes('--disable-quic'));
      return instance;
    } });
    assert.equal(result, instance);
    await result.close();
    for (const timeout of [0, -1, Infinity, 30001]) assert.throws(() => launchCaptureBrowser(timeout), /bounded deadline/u);
    await assert.rejects(() => launchCaptureBrowser(1000, { launch: async () => { throw new Error('Sandbox unavailable'); } }), /Sandbox unavailable/u);
  });
  test('entry point fails closed with bounded usage for incomplete capture and comparison commands', () => {
    for (const args of [['https://example.test'], ['compare']]) {
      const result = spawnSync(process.execPath, [CAPTURE_ENTRY, ...args], {
        cwd: path.dirname(CAPTURE_ENTRY),
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(result.status, 2);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^Capture error: Usage: whoisleuth-capture/u);
      assert.ok(Buffer.byteLength(result.stderr, 'utf8') < 1_024);
    }
  });

  test('help and version work offline without a browser installation', () => {
    for (const args of [[], ['--help'], ['-h'], ['compare', '--help'], ['--version']]) {
      const result = spawnSync(process.execPath, [CAPTURE_ENTRY, ...args], {
        encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(tmpdir(), 'absent-capture-browser-fixture') },
      });
      assert.equal(result.status, 0); assert.equal(result.stderr, '');
      if (args[0] === '--version') assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/u);
      else assert.match(result.stdout, /Compare verifies selected local artefacts and makes no network requests/u);
    }
  });

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
      await assert.rejects(() => captureFixturePage({
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
      const capture = () => captureFixturePage({
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

  test('rejects a replaced capture destination without mutating the substitute', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-replacement-test-'));
    const destination = path.join(parent, 'capture');
    const reserved = path.join(parent, 'reserved-capture');
    const substitute = path.join(parent, 'substitute');
    await mkdir(substitute, { mode: 0o700 });
    try {
      await assert.rejects(() => captureFixturePage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => {
          await rename(destination, reserved);
          await symlink(substitute, destination, 'dir');
          return fakeBrowser();
        },
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      }), /output directory identity changed/iu);
      await assert.rejects(() => stat(path.join(substitute, 'screenshot.png')), /ENOENT/u);
      await assert.rejects(() => stat(path.join(substitute, 'dom-digest.json')), /ENOENT/u);
      await assert.rejects(() => stat(path.join(substitute, 'manifest.json')), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('anchors relative artefact writes to the reserved directory inode', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-anchor-test-'));
    const destination = path.join(parent, 'capture');
    const moved = path.join(parent, 'moved-capture');
    await mkdir(destination, { mode: 0o700 });
    const identity = await stat(destination);
    let writer: Awaited<ReturnType<typeof startAnchoredArtifactWriter>> | null = await startAnchoredArtifactWriter(
      destination,
      { dev: identity.dev, ino: identity.ino },
      typeof process.getuid === 'function' ? process.getuid() : null,
    );
    try {
      await rename(destination, moved);
      await mkdir(destination, { mode: 0o700 });
      await writer.write('dom-digest.json', Buffer.from('{}\n'), new AbortController().signal, () => {});
      assert.equal(await readFile(path.join(moved, 'dom-digest.json'), 'utf8'), '{}\n');
      await assert.rejects(() => stat(path.join(destination, 'dom-digest.json')), /ENOENT/u);
      await writer.finish(true);
      writer = null;
      await assert.rejects(() => stat(path.join(moved, 'dom-digest.json')), /ENOENT/u);
    } finally {
      writer?.terminate();
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('preserves unrelated files added to a failed reserved capture directory', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-cleanup-test-'));
    const destination = path.join(parent, 'capture');
    const unrelated = path.join(destination, 'unrelated.txt');
    try {
      await assert.rejects(() => captureFixturePage({
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

  for (const stopping of ['deadline', 'interruption'] as const) test(`removes an owned private artefact whose write crosses ${stopping}`, async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-write-deadline-test-'));
    const destination = path.join(parent, 'capture');
    const deadline = controlledDeadlineScheduler();
    const controller = new AbortController();
    let writeStarted!: () => void;
    const writing = new Promise<void>((resolve) => { writeStarted = resolve; });
    try {
      const capture = captureRenderedPage({
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
            writeStarted();
            await new Promise<void>((_resolve, reject) => {
              const abort = () => reject(signal.reason);
              if (signal.aborted) abort();
              else signal.addEventListener('abort', abort, { once: true });
            });
          } finally {
            await handle.close();
          }
        },
        deadlineScheduler: deadline.scheduler,
        signal: controller.signal,
      });
      await writing;
      if (stopping === 'deadline') deadline.expire();
      else controller.abort(new Error('Fixture interruption'));
      await assert.rejects(capture, /total-run deadline|Fixture interruption/u);
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

  test('bounds explicit observer declarations and repeatable comparison exclusions', () => {
    const capture = ['https://example.test', '--output-dir', 'selected', '--authorize-rendered-capture'];
    assert.deepEqual(Object.fromEntries(Object.entries(parseCaptureArguments([...capture, '--observer', 'Analyst A', '--vantage', 'Office'])).filter(([key]) => key.endsWith('Label'))), { observerLabel: 'Analyst A', vantageLabel: 'Office' });
    for (const tail of [['--observer'], ['--observer', 'a'.repeat(81)], ['--vantage', 'A', '--vantage', 'B'], ['--observer', 'A\u0000B']]) {
      assert.throws(() => parseCaptureArguments([...capture, ...tail]));
    }
    assert.deepEqual(parseCaptureCompareArguments(['left.json', 'right.json', '--mask', '0,0,1,1', '--mask', '1,2,3,4']).masks, [
      { kind: 'redact', x: 0, y: 0, width: 1, height: 1 }, { kind: 'redact', x: 1, y: 2, width: 3, height: 4 },
    ]);
    for (const coordinates of ['0,0,0,1', '-1,0,1,1', '0,0,1.5,1', '0,0,10001,1', '0,0,1,1,1']) {
      assert.throws(() => parseCaptureCompareArguments(['left.json', 'right.json', '--mask', coordinates]));
    }
    assert.equal(parseCaptureCompareArguments(['left.json', 'right.json', ...Array.from({ length: 64 }, () => ['--mask', '0,0,1,1']).flat()]).masks?.length, 64);
    assert.throws(() => parseCaptureCompareArguments(['left.json', 'right.json', ...Array.from({ length: 65 }, () => ['--mask', '0,0,1,1']).flat()]));
  });

  test('writes import-compatible private metadata without retaining DOM text or request paths', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-test-'));
    const destination = path.join(parent, 'capture');
    let initScriptCalls = 0;
    const resolved: string[] = [];
    try {
      const manifest = await captureFixturePage({
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
      assert.equal(initScriptCalls, 3);
      assert.deepEqual(resolved, ['example.test', 'example.test', 'static.example.test']);
      const capture = manifest.captures[0]!;
      assert.equal(capture.completeness, 'complete');
      assert.deepEqual(capture.conditions, { browser: 'chromium', browserVersion: '151.0.0.0', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, locale: 'en-US', timezone: 'UTC', colourScheme: 'light' });
      assert.equal(capture.artifacts[0]?.perceptualHash?.length, 16);
      const imported = parseWebCaptureManifest(manifest);
      assert.ok(imported.findings.length >= 1);
      assert.equal(capture.pageBehaviour.requests.length, 2);
      assert.deepEqual(capture.pageBehaviour.requests.map(item => [item.kind, item.origin]), [['navigation', 'https://example.test'], ['script', 'https://static.example.test']]);
      assert.equal(capture.pageBehaviour.requests[1]!.contentSha256, createHash('sha256').update('void 0;').digest('hex'));
      const manifestText = await readFile(path.join(destination, 'manifest.json'), 'utf8');
      const digestText = await readFile(path.join(destination, 'dom-digest.json'), 'utf8');
      assert.doesNotMatch(`${manifestText}${digestText}`, /private rendered|discarded|private=value|entry\?|asset\.js/u);
      assert.equal((await stat(path.join(destination, 'screenshot.png'))).size > 0, true);
      await assert.rejects(() => captureFixturePage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, { launchBrowser: async () => fakeBrowser(), fetchResource: fakeFetchResource, resolveAddresses: async () => [] }), /EEXIST|ENOTEMPTY|exist/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('retains a partial error-frame capture only after an admitted navigation and a recorded refusal', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-refusal-'));
    try {
      for (const method of ['POST', 'GET']) {
        const manifest = await captureFixturePage({ targetUrl: 'https://example.test/', outputDirectory: path.join(parent, method), timeoutMs: 5000 }, {
          launchBrowser: async () => fakeBrowser({ finalUrl: 'chrome-error://chromewebdata/', subresourceRequests: [{ url: 'https://refused.example.test/private?secret=value', method, navigation: true }] }),
          resolveAddresses: async hostname => { if (hostname === 'refused.example.test') throw new Error('refused fixture destination'); return [{ address: '192.0.2.1', family: 4 }]; },
          fetchResource: async (url, options) => { assert.equal(options.method, 'GET'); assert.equal(new URL(url).hostname, 'example.test'); return fakeFetchResource(url); },
        });
        const captured = manifest.captures[0]!;
        assert.equal(captured.completeness, 'partial');
        assert.deepEqual(captured.page, { title: null, finalOrigin: null });
        assert.deepEqual(captured.artifacts.map(item => item.kind), ['screenshot']);
        assert.equal(captured.pageBehaviour.state, 'partial');
        assert.deepEqual(captured.pageBehaviour.elements, []);
        assert.equal(captured.pageBehaviour.requests[0]?.kind, 'navigation');
        assert.equal(captured.pageBehaviour.coverage.attempts.filter(row => row.channel === 'navigation' && row.state !== 'observed').length, 1);
        assert.match(captured.limitations.join(' '), /screenshot shows the resulting browser state/u);
        assert.doesNotMatch(JSON.stringify(manifest), /secret=value|refused\.example/u);
        assert.ok(parseWebCaptureManifest(manifest).findings.length > 0);
        await assert.rejects(readFile(path.join(parent, method, 'dom-digest.json')), { code: 'ENOENT' });
      }
      await assert.rejects(compareRenderedCaptures(path.join(parent, 'POST', 'manifest.json'), path.join(parent, 'GET', 'manifest.json')),
        /partial capture has no target-page DOM evidence/u);
      for (const [name, finalUrl, requests] of [
        ['unexplained-error', 'chrome-error://chromewebdata/', []],
        ['unexpected-scheme', 'data:text/html,not-evidence', [{ url: 'https://example.test/', method: 'POST', navigation: true }]],
      ] as const) {
        await assert.rejects(captureFixturePage({ targetUrl: 'https://example.test/', outputDirectory: path.join(parent, name), timeoutMs: 5000 }, {
          launchBrowser: async () => fakeBrowser({ finalUrl, subresourceRequests: [...requests] }),
          resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }], fetchResource: fakeFetchResource,
        }), /must use HTTP/u);
      }
      await assert.rejects(captureFixturePage({ targetUrl: 'https://example.test/', outputDirectory: path.join(parent, 'initial-failure'), timeoutMs: 5000 }, {
        launchBrowser: async () => fakeBrowser(),
        resolveAddresses: async () => { throw new Error('private resolver detail'); }, fetchResource: fakeFetchResource,
      }), { message: 'Initial capture navigation was blocked or unavailable. No capture files were retained.' });
      await assert.rejects(stat(path.join(parent, 'initial-failure')), { code: 'ENOENT' });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  test('round-trips the exact host, title, and artifact bounds into partitioned Case findings', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-import-bound-test-'));
    const destination = path.join(parent, 'capture');
    const title = 'T'.repeat(300);
    const subresourceUrls = Array.from(
      { length: MAX_CAPTURE_HOSTS - 1 },
      (_, index) => `https://asset-${String(index).padStart(2, '0')}.example.test/resource.js`,
    );
    try {
      const manifest = await captureFixturePage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({ title, subresourceUrls }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        now: () => '2026-08-01T00:00:00.000Z',
      });
      assert.equal(manifest.captures[0]?.requestDomains.length, MAX_CAPTURE_HOSTS);
      assert.equal(manifest.captures[0]?.artifacts.length, 2);
      const imported = parseWebCaptureManifest(manifest);
      const retained = imported.findings.map((finding) => finding.summary).join(' ');
      assert.ok(imported.findings.length > 1);
      assert.ok(retained.includes(title));
      for (const domain of manifest.captures[0]?.requestDomains ?? []) assert.ok(retained.includes(domain), domain);
      for (const artifact of manifest.captures[0]?.artifacts ?? []) assert.ok(retained.includes(artifact.fileName));
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('removes C1 and bidirectional controls from retained page titles', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-title-test-'));
    const destination = path.join(parent, 'capture');
    try {
      const manifest = await captureFixturePage({
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

  test('preserves exact selected paths and separately attributed source caveats', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-selection-test-'));
    const directories = [path.join(parent, ' left  input '), path.join(parent, 'left input'), path.join(parent, 'right')];
    try {
      for (const [index, directory] of directories.entries()) {
        await captureFixturePage({ targetUrl: `https://capture-${index}.example.test/`, outputDirectory: directory, timeoutMs: 5000 }, {
          launchBrowser: async () => fakeBrowser({ hostname: `capture-${index}.example.test` }),
          fetchResource: fakeFetchResource,
          resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
          now: () => '2026-08-01T00:00:00.000Z',
        });
      }
      for (const [index, directory] of [directories[0]!, directories[2]!].entries()) {
        const side = index === 0 ? 'left' : 'right';
        const manifestPath = path.join(directory, 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const domPath = path.join(directory, 'dom-digest.json');
        const dom = JSON.parse(await readFile(domPath, 'utf8'));
        manifest.captures[0].limitations = [`${side} capture caveat`];
        dom.limitations = [`${side} DOM caveat`];
        const domBytes = Buffer.from(`${JSON.stringify(dom)}\n`);
        await writeFile(domPath, domBytes);
        const artifact = manifest.captures[0].artifacts.find((value: { kind: string }) => value.kind === 'dom_digest');
        artifact.bytes = domBytes.byteLength;
        artifact.sha256 = createHash('sha256').update(domBytes).digest('hex');
        await writeFile(manifestPath, JSON.stringify(manifest));
      }
      const left = path.join(directories[0]!, 'manifest.json'), right = path.join(directories[2]!, 'manifest.json');
      assert.equal(parseCaptureCompareArguments([left, right]).leftManifest, left);
      const comparison = await compareRenderedCaptures(left, right);
      assert.equal(comparison.left.domain, 'capture-0.example.test');
      assert.deepEqual(comparison.sourceLimitations, {
        left: { capture: ['left capture caveat'], domDigest: ['left DOM caveat'] },
        right: { capture: ['right capture caveat'], domDigest: ['right DOM caveat'] },
      });
      const terminal = formatRenderedCaptureComparison(comparison);
      for (const label of ['left capture: left capture caveat', 'right capture: right capture caveat', 'left DOM digest: left DOM caveat', 'right DOM digest: right DOM caveat']) assert.ok(terminal.includes(label));
      assert.ok(comparison.limitations.some(value => value.includes('no network request')));
      assert.equal(comparison.partial, false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('compares two verified local captures offline without exposing paths or retained page text', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-compare-test-'));
    const leftDirectory = path.join(parent, 'left');
    const rightDirectory = path.join(parent, 'right');
    try {
      await captureFixturePage({
        targetUrl: 'https://left.example.test/', outputDirectory: leftDirectory, timeoutMs: 5000,
      }, {
        launchBrowser: async () => fakeBrowser({ hostname: 'left.example.test', title: 'Account', visibleText: 'left private text' }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        now: () => '2026-08-01T00:00:00.000Z',
      });
      await captureFixturePage({
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
      assert.equal(comparison.version, 5);
      assert.equal(comparison.screenshot.state, 'same');
      assert.equal(comparison.renderedDom.structure.state, 'different');
      assert.equal(comparison.renderedDom.visibleText.state, 'different');
      assert.deepEqual(comparison.page.title, { state: 'different' });
      assert.equal(comparison.page.requestDomains.state, 'overlap');
      assert.deepEqual(comparison.page.requestDomains.shared, ['static.example.test']);
      assert.equal(comparison.renderedDom.counts.elements.delta, 1);
      assert.deepEqual(comparison.integrity.left, { screenshot: true, perceptualHash: true, domDigest: true });
      assert.match(formatRenderedCaptureComparison(comparison), /Rendered capture comparison/u);
      assert.equal(comparison.pixelChanges.state, 'same_pixels');
      assert.equal(comparison.pixelChanges.comparedPixels, 1024 * 768);
      assert.equal(comparison.observationContext.time.spanMilliseconds, 300000);
      assert.equal(comparison.observationContext.independence, 'not_verified');
      assert.equal(comparison.observationContext.labels, 'incomplete');
      const excluded = await compareRenderedCaptures(leftManifest, rightManifest, '2026-08-01T00:10:00.000Z', [{ kind: 'redact', x: 0, y: 0, width: 1024, height: 768 }]);
      assert.equal(excluded.pixelChanges.state, 'all_excluded');
      assert.equal(excluded.pixelChanges.changedPercent, null);
      assert.match(formatRenderedCaptureComparison(excluded), /Excluded region: 0,0,1024,768/u);
      await assert.rejects(() => compareRenderedCaptures(leftManifest, rightManifest, undefined, [{ kind: 'redact', x: 1024, y: 0, width: 1, height: 1 }]));
      assert.doesNotMatch(JSON.stringify(comparison), /private text|capture-compare-test|manifest\.json|Account|Review/u);

      const originalLeftManifest = await readFile(leftManifest, 'utf8');
      const originalRightManifest = await readFile(rightManifest, 'utf8');
      const legacy = JSON.parse(originalRightManifest);
      delete legacy.captures[0].conditions;
      await writeFile(rightManifest, JSON.stringify(legacy));
      const legacyComparison = await compareRenderedCaptures(leftManifest, rightManifest);
      assert.equal(legacyComparison.observationContext.rows.find(row => row.id === 'viewport')?.state, 'unknown');
      assert.equal(legacyComparison.pixelChanges.state, 'same_pixels');
      await writeFile(rightManifest, originalRightManifest);
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
      const captureAt = async (outputDirectory: string) => captureFixturePage({
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

  test('enforces one total-run deadline across renderer lifecycle work', { timeout: 60_000 }, async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-deadline-test-'));
    const destination = path.join(parent, 'capture');
    try {
      await assert.rejects(() => captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 1_000,
      }, {
        launchBrowser: async () => fakeBrowser({ stallDomProjection: true }),
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      }), /total-run deadline/u);
      await assert.rejects(() => stat(destination), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  for (const stopping of ['deadline', 'interruption'] as const) test(`closes a browser acquired after ${stopping} exactly once`, async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-late-browser-test-'));
    const destination = path.join(parent, 'capture');
    const deadline = controlledDeadlineScheduler();
    const controller = new AbortController();
    let resolveLaunch!: (browser: CaptureBrowser) => void;
    let signalLaunch!: () => void;
    let signalClose!: () => void;
    const launchStarted = new Promise<void>((resolve) => { signalLaunch = resolve; });
    const browserClosed = new Promise<void>((resolve) => { signalClose = resolve; });
    let closeCount = 0;
    let contextCount = 0;
    let launchTimeout = 0;
    const lateBrowser = {
      newContext: async () => { contextCount += 1; throw new Error('late browser must not create a context'); },
      close: async () => { closeCount += 1; signalClose(); },
    } as unknown as CaptureBrowser;
    try {
      const capture = captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 1_000,
      }, {
        launchBrowser: async (timeoutMs) => {
          launchTimeout = timeoutMs;
          signalLaunch();
          return new Promise<CaptureBrowser>((resolve) => { resolveLaunch = resolve; });
        },
        writeArtifact: async () => { throw new Error('late browser must not write artefacts'); },
        deadlineScheduler: deadline.scheduler,
        signal: controller.signal,
      });
      await launchStarted;
      assert.ok(launchTimeout > 0 && launchTimeout <= 1_000);
      if (stopping === 'deadline') deadline.expire();
      else controller.abort(new Error('Fixture interruption'));
      await assert.rejects(capture, /total-run deadline|Fixture interruption/u);
      resolveLaunch(lateBrowser);
      await browserClosed;
      assert.equal(closeCount, 1);
      assert.equal(contextCount, 0);
      await assert.rejects(() => stat(destination), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  for (const stopping of ['deadline', 'interruption'] as const) test(`cleans an anchored writer acquired after ${stopping} exactly once`, async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-late-writer-test-'));
    const destination = path.join(parent, 'capture');
    const deadline = controlledDeadlineScheduler();
    const controller = new AbortController();
    type Writer = Awaited<ReturnType<typeof startAnchoredArtifactWriter>>;
    let resolveWriter!: (writer: Writer) => void;
    let signalStart!: () => void;
    let signalFinish!: () => void;
    const writerStarted = new Promise<void>((resolve) => { signalStart = resolve; });
    const writerFinished = new Promise<void>((resolve) => { signalFinish = resolve; });
    let finishCount = 0;
    let terminateCount = 0;
    const lateWriter: Writer = {
      write: async () => { throw new Error('late writer must not write artefacts'); },
      finish: async (cleanup) => {
        assert.equal(cleanup, true);
        finishCount += 1;
        signalFinish();
      },
      terminate: () => { terminateCount += 1; },
    };
    try {
      const capture = captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 1_000,
      }, {
        launchBrowser: async () => { throw new Error('late writer must stop browser launch'); },
        startArtifactWriter: async () => {
          signalStart();
          return new Promise<Writer>((resolve) => { resolveWriter = resolve; });
        },
        deadlineScheduler: deadline.scheduler,
        signal: controller.signal,
      });
      await writerStarted;
      if (stopping === 'deadline') deadline.expire();
      else controller.abort(new Error('Fixture interruption'));
      await assert.rejects(capture, /total-run deadline|Fixture interruption/u);
      resolveWriter(lateWriter);
      await writerFinished;
      assert.equal(finishCount, 1);
      assert.equal(terminateCount, 0);
      await assert.rejects(() => stat(destination), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  for (const stopping of ['deadline', 'interruption'] as const) test(`aborts an admitted direct resource fetch at ${stopping}`, async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-fetch-deadline-test-'));
    const destination = path.join(parent, 'capture');
    const deadline = controlledDeadlineScheduler();
    const controller = new AbortController();
    let requestAborted = false;
    let requestStarted!: () => void;
    const requesting = new Promise<void>((resolve) => { requestStarted = resolve; });
    try {
      const capture = captureRenderedPage({
        targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 1_000,
      }, {
        launchBrowser: async () => fakeBrowser(),
        fetchResource: async (_url, options) => new Promise<Response>((_resolve, reject) => {
          const signal = options.signal;
          if (!signal) throw new Error('Capture request did not receive its total-run signal.');
          requestStarted();
          signal.addEventListener('abort', () => {
            requestAborted = true;
            reject(signal.reason);
          }, { once: true });
        }),
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        deadlineScheduler: deadline.scheduler,
        signal: controller.signal,
      });
      await requesting;
      if (stopping === 'deadline') deadline.expire();
      else controller.abort(new Error('Fixture interruption'));
      await assert.rejects(capture, /total-run deadline|Fixture interruption/u);
      assert.equal(requestAborted, true);
      await assert.rejects(() => stat(destination), /ENOENT/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('requests cleanup on first signal, exposes emergency second signal and detaches handlers', async () => {
    const events = new EventEmitter();
    let emergencies = 0;
    const interruption = createCaptureInterruption(events, () => { emergencies += 1; });
    events.emit('SIGINT');
    assert.equal(interruption.signal.aborted, true);
    assert.equal(emergencies, 0);
    events.emit('SIGTERM');
    assert.equal(emergencies, 1);
    interruption.clear();
    assert.equal(events.listenerCount('SIGINT'), 0);
    assert.equal(events.listenerCount('SIGTERM'), 0);
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-preabort-test-'));
    try {
      const destination = path.join(parent, 'not-created');
      await assert.rejects(captureRenderedPage({ targetUrl: 'https://example.test/', outputDirectory: destination, timeoutMs: 1000 }, {
        signal: interruption.signal,
        launchBrowser: async () => { throw new Error('Pre-aborted capture must not launch'); },
      }), /interrupted/u);
      await assert.rejects(stat(destination), /ENOENT/u);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  test('handles real isolated process-group interrupts without launching a browser', { timeout: 10_000, skip: process.platform === 'win32' }, async context => {
    const captureModule = new URL('../packages/web-capture/capture.mts', import.meta.url).href;
    for (const emergency of [false, true]) {
      const child = spawn(process.execPath, ['--input-type=module', '-e', `
        import { createCaptureInterruption } from ${JSON.stringify(captureModule)};
        const interruption = createCaptureInterruption();
        const hold = setInterval(() => {}, 1000);
        interruption.signal.addEventListener('abort', () => {
          process.stdout.write('cleanup requested\\n');
          if (!${emergency}) { clearInterval(hold); interruption.clear(); process.exitCode = 130; }
        });
        process.stdout.write('ready\\n');
      `], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      context.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
      let output = '';
      child.stdout.on('data', bytes => { output += String(bytes); });
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      const waitFor = (text: string) => new Promise<void>((resolve, reject) => {
        if (output.includes(text)) { resolve(); return; }
        const data = () => { if (output.includes(text)) { child.stdout.off('data', data); child.off('close', exited); resolve(); } };
        const exited = () => { child.stdout.off('data', data); reject(new Error('Interrupt fixture exited before readiness')); };
        child.stdout.on('data', data);
        child.once('close', exited);
      });
      await waitFor('ready\n');
      assert.ok(child.pid);
      process.kill(-child.pid, 'SIGINT');
      await waitFor('cleanup requested\n');
      if (emergency) process.kill(-child.pid, 'SIGINT');
      assert.deepEqual(await closed, { code: 130, signal: null });
      assert.equal(output.split('cleanup requested').length - 1, 1);
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
        await captureFixturePage({ targetUrl: `https://${domain}/`, outputDirectory: destination, timeoutMs: 5000 }, {
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
      const manifest = await captureFixturePage({
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
      const manifest = await captureFixturePage({
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
      const manifest = await captureFixturePage({
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
      const manifest = await captureFixturePage({
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
      const manifest = await captureFixturePage({
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
      assert.deepEqual(manifest.captures[0]!.pageBehaviour.coverage.attempts.at(-1), { position: 4, channel: 'script', method: 'read', origin: null, state: 'refused', reason: 'shutdown', collectionStarted: false });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('seals direct-connection accounting after browser shutdown and retains no destination', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-direct-test-'));
    let closed = false;
    const instance = {
      ...fakeBrowser(),
      close: async () => { closed = true; },
      blockedDirectConnections: () => { assert.equal(closed, true); return 2; },
    };
    try {
      const manifest = await captureFixturePage({
        targetUrl: 'https://example.test/', outputDirectory: path.join(parent, 'capture'), timeoutMs: 5000,
      }, {
        launchBrowser: async () => instance,
        fetchResource: fakeFetchResource,
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      });
      assert.equal(manifest.captures[0]?.completeness, 'partial');
      assert.ok(manifest.captures[0]?.limitations.some(value => value.startsWith('Additional direct browser')));
      assert.equal(manifest.captures[0]!.pageBehaviour.coverage.directConnectionRefusals, 2);
      assert.equal(parseWebCaptureManifest(manifest).findings.length, 1);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  test('does not retain a browser-requested host that fails public-address validation', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-rejected-host-test-'));
    const destination = path.join(parent, 'capture');
    try {
      const manifest = await captureFixturePage({
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
      assert.equal(manifest.captures[0]!.pageBehaviour.coverage.attempts[1]!.origin, null);
      assert.equal(manifest.captures[0]!.pageBehaviour.coverage.attempts[1]!.collectionStarted, false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('records request channels without collecting non-read attempts or retaining their destinations', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'capture-channel-test-'));
    const collected: string[] = [];
    try {
      const manifest = await captureFixturePage({ targetUrl: 'https://example.test/', outputDirectory: path.join(parent, 'capture'), timeoutMs: 5000 }, {
        launchBrowser: async () => fakeBrowser({ subresourceRequests: [
          { url: 'https://api.example.test/private?token=sentinel', resourceType: 'fetch' },
          { url: 'https://api.example.test/request', resourceType: 'xhr' },
          { url: 'https://beacon.example.test/private?token=sentinel', resourceType: 'ping', method: 'POST' },
        ] }),
        resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
        fetchResource: async url => { collected.push(url); return fakeFetchResource(url); },
      });
      assert.equal(collected.length, 3);
      assert.equal(collected.some(url => new URL(url).hostname === 'beacon.example.test'), false);
      const coverage = manifest.captures[0]!.pageBehaviour.coverage;
      assert.deepEqual(coverage.attempts.map(row => [row.channel, row.state, row.collectionStarted]), [
        ['navigation', 'observed', true], ['fetch', 'observed', true], ['xhr', 'observed', true], ['beacon', 'refused', false],
      ]);
      assert.equal(coverage.attempts[3]!.origin, null);
      assert.doesNotMatch(JSON.stringify(coverage), /private|sentinel|beacon\.example/u);
      assert.equal(manifest.captures[0]!.completeness, 'partial');
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  test('bounds and records browser-requested hosts even when their bodies are refused', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-host-budget-test-'));
    const destination = path.join(parent, 'capture');
    const resolved = new Set<string>();
    try {
      const manifest = await captureFixturePage({
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
      await assert.rejects(() => captureFixturePage({
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
