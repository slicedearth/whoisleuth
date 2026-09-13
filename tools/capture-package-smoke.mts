#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import type { Browser, Route } from 'playwright';

// Runtime imports come only from the installed archive. The source imports below
// are erased type annotations, not a fallback to the development checkout.
const root = path.resolve(process.argv[2] ?? '', 'runtime');
if (!process.argv[2]) throw new Error('An installed capture package is required.');
const capture: typeof import('../packages/web-capture/capture.mts') = await import(pathToFileURL(path.join(root, 'packages/web-capture/capture.mjs')).href);
const compare: typeof import('../packages/web-capture/compare.mts') = await import(pathToFileURL(path.join(root, 'packages/web-capture/compare.mjs')).href);
const executable = path.join(root, 'packages/web-capture/bin/whoisleuth-capture.mjs');
const temporary = await mkdtemp(path.join(tmpdir(), 'whoisleuth-installed-capture-'));
const checks: string[] = [];

function screenshot(): Buffer {
  const chunk = (type: string, bytes: Buffer) => {
    const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
    const content = Buffer.concat([Buffer.from(type), bytes]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(content));
    return Buffer.concat([size, content, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1024); header.writeUInt32BE(768, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((1024 * 4 + 1) * 768);
  for (let y = 0; y < 768; y++) for (let x = 0; x < 1024; x++) {
    const offset = y * (1024 * 4 + 1) + 1 + x * 4;
    pixels[offset] = (x * 91 + y * 151) % 256; pixels[offset + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

function fixtureBrowser(): Browser {
  let route: ((value: Route) => Promise<void>) | undefined;
  const page = {
    on() {},
    async goto(url: string) {
      assert.ok(route);
      await route({
        request: () => ({ url: () => url, method: () => 'GET', headers: () => ({ accept: 'text/html', cookie: '<private-cookie-fixture>', authorization: '<private-authorisation-fixture>' }) }),
        fulfill: async () => {}, abort: async () => { throw new Error('Fixture route unexpectedly aborted.'); },
      } as unknown as Route);
    },
    waitForTimeout: async () => {}, url: () => 'https://example.test/', title: async () => 'Example',
    evaluate: async (_callback: unknown, value?: unknown) => value === undefined ? true : {
      structure: 'html body main', visibleText: '<private-body-fixture>', structureTruncated: false, textTruncated: false,
      elementCount: 3, formCount: 0, inputCount: 0, scriptCount: 0, imageCount: 0,
    },
    screenshot: async () => screenshot(), close: async () => {},
  };
  return {
    version: () => '151.0.0.0',
    newContext: async () => ({ addInitScript: async () => {}, route: async (_pattern: string, handler: typeof route) => { route = handler; }, routeWebSocket: async () => {}, newPage: async () => page, close: async () => {} }),
    close: async () => {},
  } as unknown as Browser;
}

try {
  const output = path.join(temporary, 'capture');
  assert.throws(() => capture.parseCaptureArguments(['https://example.test', '--output-dir', output]), /authorize-rendered-capture/u);
  for (const url of ['https://192.0.2.1/', 'https://user:pass@example.test/']) {
    assert.throws(() => capture.parseCaptureArguments([url, '--output-dir', output, '--authorize-rendered-capture']));
  }
  checks.push('authorisation, IP-literal and credential rejection');
  let requests = 0;
  const manifest = await capture.captureRenderedPage({ targetUrl: 'https://example.test/', outputDirectory: output, timeoutMs: 10_000 }, {
    launchBrowser: async () => fixtureBrowser(), resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
    fetchResource: async (_url, options) => {
      requests++;
      const headers = new Headers(options.headers);
      assert.equal(headers.get('cookie'), null); assert.equal(headers.get('authorization'), null);
      const application = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      assert.match(headers.get('user-agent') ?? '', new RegExp(`^WHOISleuth/${application.version.replaceAll('.', '\\.')} `));
      return new Response('<!doctype html><title>Example</title>', { headers: { 'content-type': 'text/html' } });
    }, now: () => '2026-08-01T00:00:00.000Z',
  });
  assert.equal(requests, 1); assert.equal(manifest.captures[0]?.completeness, 'complete');
  assert.deepEqual(manifest.captures[0]?.conditions, { browser: 'chromium', browserVersion: '151.0.0.0', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, locale: 'en-US', timezone: 'UTC', colourScheme: 'light' });
  const manifestPath = path.join(output, 'manifest.json');
  const original = await readFile(manifestPath, 'utf8');
  const dom = await readFile(path.join(output, 'dom-digest.json'), 'utf8');
  assert.doesNotMatch(original + dom, /private-body-fixture|private-cookie-fixture|private-authorisation-fixture/u);
  if (process.platform !== 'win32') {
    for (const name of ['manifest.json', 'screenshot.png', 'dom-digest.json']) assert.equal((await stat(path.join(output, name))).mode & 0o777, 0o600);
  }
  checks.push('synthetic capture with compiled anchored writer', 'credential exclusion and private artefacts');

  const otherDirectory = path.join(temporary, 'other');
  await cp(output, otherDirectory, { recursive: true, errorOnExist: true });
  const otherManifest = path.join(otherDirectory, 'manifest.json');
  await assert.rejects(() => compare.compareRenderedCaptures(manifestPath, manifestPath), /different manifest files/u);
  checks.push('self-comparison rejection');
  const compared = await compare.compareRenderedCaptures(manifestPath, otherManifest);
  assert.equal(compared.screenshot.state, 'same');
  assert.equal(compared.renderedDom.structure.state, 'same');
  assert.deepEqual(compared.integrity.left, { screenshot: true, perceptualHash: true, domDigest: true });
  const command = execFileSync(process.execPath, [...process.execArgv, executable, 'compare', manifestPath, otherManifest, '--json'], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
  assert.equal(JSON.parse(command).screenshot.state, 'same');
  checks.push('offline comparison and installed JSON command');
  const maskedCommand = execFileSync(process.execPath, [...process.execArgv, executable, 'compare', manifestPath, otherManifest, '--mask', '0,0,1024,768', '--json'], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
  const masked = JSON.parse(maskedCommand);
  assert.equal(masked.pixelChanges.state, 'all_excluded'); assert.equal(masked.pixelChanges.changedPercent, null);
  assert.equal(masked.observationContext.independence, 'not_verified');
  assert.equal(masked.observationContext.rows.find((row: { id: string }) => row.id === 'viewport').state, 'same');
  checks.push('declared capture conditions and full exclusion without a false agreement');

  for (const [name, mutate, expected] of [
    ['future manifest', (value: typeof manifest) => { value.schemaVersion = 999 as typeof value.schemaVersion; }, /version|unsupported/iu],
    ['traversing artefact', (value: typeof manifest) => { value.captures[0]!.artifacts[0]!.fileName = '../screenshot.png'; }, /plain file name/u],
  ] as const) {
    const invalid = JSON.parse(original) as typeof manifest; mutate(invalid);
    await writeFile(manifestPath, JSON.stringify(invalid));
    await assert.rejects(() => compare.compareRenderedCaptures(manifestPath, otherManifest), expected);
    checks.push(name + ' rejection');
  }
  await writeFile(manifestPath, original);
  const screenshotPath = path.join(output, 'screenshot.png');
  const bytes = await readFile(screenshotPath); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  await writeFile(screenshotPath, bytes);
  await assert.rejects(() => compare.compareRenderedCaptures(manifestPath, otherManifest), /integrity verification/u);
  checks.push('corrupted artefact rejection');
  if (process.argv[3] === '--browser') {
    const launcher: typeof import('../packages/web-capture/browser.mts') = await import(pathToFileURL(path.join(root, 'packages/web-capture/browser.mjs')).href);
    let observedRequests = 0;
    const rendered = await capture.captureRenderedPage({ targetUrl: 'https://example.test/', outputDirectory: path.join(temporary, 'rendered'), timeoutMs: 20_000 }, {
      launchBrowser: launcher.launchCaptureBrowser,
      resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      fetchResource: async url => {
        assert.equal(new URL(url).hostname, 'example.test'); observedRequests++;
        return new Response('<!doctype html><title>Before</title><main>Fixture page</main><script>document.title="Rendered fixture"</script>', { headers: { 'content-type': 'text/html' } });
      },
    });
    assert.ok(observedRequests > 0);
    assert.equal(rendered.captures[0]?.page.title, 'Rendered fixture');
    assert.equal(rendered.captures[0]?.completeness, 'complete');
    assert.deepEqual(rendered.captures[0]?.requestDomains, ['example.test']);
    checks.push('sandboxed installed browser with fixture-only transport');
  }
  process.stdout.write(JSON.stringify(checks) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
