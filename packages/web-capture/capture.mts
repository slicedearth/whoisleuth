import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Browser, BrowserContext, Page, Route } from '@playwright/test';

import { imagePerceptualHash } from '../../lib/perceptual-hash.mts';
import { resolvePublicAddresses } from '../../lib/safe-fetch.mts';
import {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
  WEB_CAPTURE_DOM_DIGEST_SCHEMA,
  WEB_CAPTURE_DOM_DIGEST_VERSION,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
} from '../../lib/web-capture-contract.mts';
export {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
  WEB_CAPTURE_DOM_DIGEST_SCHEMA,
  WEB_CAPTURE_DOM_DIGEST_VERSION,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
} from '../../lib/web-capture-contract.mts';
export const MAX_CAPTURE_REQUESTS = 100;
export const MAX_CAPTURE_HOSTS = 30;
export const MAX_CAPTURE_URL_LENGTH = 2048;
export const MAX_CAPTURE_TIMEOUT_MS = 30_000;
export const VIEWPORT = Object.freeze({ width: 1024, height: 768 });

type CaptureArguments = Readonly<{
  targetUrl: string;
  outputDirectory: string;
  timeoutMs: number;
}>;

type CaptureDependencies = Readonly<{
  launchBrowser(): Promise<Browser>;
  resolveAddresses?: typeof resolvePublicAddresses;
  now?: () => string;
}>;

type DomProjection = Readonly<{
  structure: string;
  visibleText: string;
  structureTruncated: boolean;
  textTruncated: boolean;
  elementCount: number;
  formCount: number;
  inputCount: number;
  scriptCount: number;
  imageCount: number;
}>;

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function boundedPlainText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function captureUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value || value.length > MAX_CAPTURE_URL_LENGTH) {
    throw new Error(`Capture URL must be between 1 and ${MAX_CAPTURE_URL_LENGTH} characters.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Capture URL must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) {
    throw new Error('Capture URL must use HTTP(S) without credentials or a non-default port.');
  }
  return parsed;
}

function outputDirectory(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Output directory must be one bounded local path.');
  }
  return path.resolve(value);
}

export function parseCaptureArguments(argv: readonly string[]): CaptureArguments {
  let targetUrl: string | null = null;
  let destination: string | null = null;
  let authorised = false;
  let timeoutMs = 20_000;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output-dir') {
      if (destination !== null) throw new Error('--output-dir may be supplied only once.');
      destination = argv[++index] ?? null;
      if (!destination || destination.startsWith('-')) throw new Error('--output-dir requires one new directory path.');
    } else if (argument === '--timeout-ms') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1_000 || value > MAX_CAPTURE_TIMEOUT_MS) {
        throw new Error(`--timeout-ms must be an integer from 1000 to ${MAX_CAPTURE_TIMEOUT_MS}.`);
      }
      timeoutMs = value;
    } else if (argument === '--authorize-rendered-capture') {
      if (authorised) throw new Error('--authorize-rendered-capture may be supplied only once.');
      authorised = true;
    } else if (argument?.startsWith('-')) {
      throw new Error(`Unknown capture option "${argument}".`);
    } else if (argument && targetUrl === null) {
      targetUrl = argument;
    } else {
      throw new Error('Rendered capture accepts exactly one target URL.');
    }
  }
  if (!targetUrl || !destination || !authorised) {
    throw new Error('Usage: whoisleuth-capture <url> --output-dir <new-directory> --authorize-rendered-capture [--timeout-ms <1000-30000>]');
  }
  return { targetUrl: captureUrl(targetUrl).toString(), outputDirectory: outputDirectory(destination), timeoutMs };
}

async function projectDom(page: Page): Promise<DomProjection> {
  return page.evaluate(() => {
    const maximumCharacters = 256 * 1024;
    const maximumElements = 20_000;
    const elements = document.querySelectorAll('*');
    const tags: string[] = [];
    for (let index = 0; index < Math.min(elements.length, maximumElements); index += 1) {
      const element = elements.item(index);
      if (element) tags.push(element.tagName.toLowerCase());
    }
    const structureValue = tags.join(' ');
    const textParts: string[] = [];
    let textLength = 0;
    let textTruncated = false;
    if (document.body) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (textLength < maximumCharacters) {
        const node = walker.nextNode();
        if (!node) break;
        const value = node.nodeValue ?? '';
        const remaining = maximumCharacters - textLength;
        textParts.push(value.slice(0, remaining));
        textLength += Math.min(value.length, remaining);
        if (value.length > remaining) {
          textTruncated = true;
          break;
        }
      }
      textTruncated ||= walker.nextNode() !== null;
    }
    const textValue = textParts.join('');
    return {
      structure: structureValue.slice(0, maximumCharacters),
      visibleText: textValue,
      structureTruncated: structureValue.length > maximumCharacters || elements.length > maximumElements,
      textTruncated,
      elementCount: Math.min(elements.length, maximumElements),
      formCount: document.forms.length,
      inputCount: document.querySelectorAll('input, select, textarea, button').length,
      scriptCount: document.scripts.length,
      imageCount: document.images.length,
    };
  });
}

async function privateWrite(filePath: string, value: string | Buffer): Promise<void> {
  await writeFile(filePath, value, { flag: 'wx', mode: 0o600 });
}

async function installRequestBoundary(
  context: BrowserContext,
  page: Page,
  resolveAddresses: typeof resolvePublicAddresses,
) {
  const checkedHosts = new Set<string>();
  let requestCount = 0;
  let blockedRequestCount = 0;
  let hostLimitReached = false;
  await context.routeWebSocket('**/*', async (webSocket) => {
    blockedRequestCount += 1;
    await webSocket.close({ code: 1008, reason: 'WHOISleuth local capture blocks WebSockets' });
  });
  await context.route('**/*', async (route: Route) => {
    requestCount += 1;
    if (requestCount > MAX_CAPTURE_REQUESTS) {
      blockedRequestCount += 1;
      await route.abort('blockedbyclient');
      return;
    }
    try {
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        throw new Error('non-read request blocked');
      }
      const parsed = captureUrl(route.request().url());
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
      if (!checkedHosts.has(hostname)) {
        if (checkedHosts.size >= MAX_CAPTURE_HOSTS) {
          hostLimitReached = true;
          throw new Error('request-host limit reached');
        }
        await resolveAddresses(hostname);
        checkedHosts.add(hostname);
      }
      await route.continue();
    } catch {
      blockedRequestCount += 1;
      await route.abort('blockedbyclient');
    }
  });
  page.on('download', (download) => { void download.cancel(); });
  return {
    checkedHosts,
    stats: () => ({ requestCount, blockedRequestCount, hostLimitReached }),
  };
}

export async function captureRenderedPage(
  argumentsValue: CaptureArguments,
  dependencies: CaptureDependencies,
) {
  const target = captureUrl(argumentsValue.targetUrl);
  const targetDirectory = outputDirectory(argumentsValue.outputDirectory);
  const parentDirectory = path.dirname(targetDirectory);
  await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
  try {
    await lstat(targetDirectory);
    throw new Error(`Capture output directory already exists: ${targetDirectory}.`);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code !== 'ENOENT') throw error;
  }
  const temporaryDirectory = await mkdtemp(path.join(parentDirectory, '.whoisleuth-capture-'));
  await chmod(temporaryDirectory, 0o700);
  let browser: Browser | null = null;
  try {
    browser = await dependencies.launchBrowser();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      serviceWorkers: 'block',
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
    });
    const page = await context.newPage();
    const requestBoundary = await installRequestBoundary(
      context,
      page,
      dependencies.resolveAddresses ?? resolvePublicAddresses,
    );
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: argumentsValue.timeoutMs });
    await page.waitForTimeout(Math.min(750, Math.max(100, Math.round(argumentsValue.timeoutMs / 20))));
    const finalUrl = captureUrl(page.url());
    const title = boundedPlainText(await page.title(), 300);
    const dom = await projectDom(page);
    const screenshot = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
    const screenshotBuffer = Buffer.from(screenshot);
    if (!screenshotBuffer.length || screenshotBuffer.length > MAX_WEB_CAPTURE_SCREENSHOT_BYTES) {
      throw new Error('Rendered screenshot is empty or exceeds the 10 MiB artifact bound.');
    }
    const capturedAt = dependencies.now?.() ?? new Date().toISOString();
    const domDigest = {
      schema: WEB_CAPTURE_DOM_DIGEST_SCHEMA,
      version: WEB_CAPTURE_DOM_DIGEST_VERSION,
      capturedAt,
      domain: target.hostname.toLowerCase(),
      counts: {
        elements: dom.elementCount,
        forms: dom.formCount,
        controls: dom.inputCount,
        scripts: dom.scriptCount,
        images: dom.imageCount,
      },
      structure: { algorithm: 'sha256', value: sha256(dom.structure), truncated: dom.structureTruncated },
      visibleText: { algorithm: 'sha256', value: sha256(dom.visibleText), bytes: Buffer.byteLength(dom.visibleText), truncated: dom.textTruncated },
      limitations: ['No DOM markup, visible text, form values, request paths, query strings, headers, bodies, cookies, or credentials are retained.'],
    };
    const domBytes = Buffer.from(`${JSON.stringify(domDigest, null, 2)}\n`);
    if (domBytes.length > MAX_WEB_CAPTURE_DOM_DIGEST_BYTES) throw new Error('DOM digest exceeds the 1 MiB artifact bound.');
    const screenshotName = 'screenshot.png';
    const domName = 'dom-digest.json';
    await privateWrite(path.join(temporaryDirectory, screenshotName), screenshotBuffer);
    await privateWrite(path.join(temporaryDirectory, domName), domBytes);
    const requestStats = requestBoundary.stats();
    const limitations = [
      'Rendered collection executed page JavaScript in a disposable browser context and may have disclosed the target to its public resource operators.',
      'Downloads, service workers, WebSockets, non-read methods, non-HTTP(S), credentialed, non-default-port, private-address, excess-host, and excess-request traffic was blocked.',
      'Each request hostname was checked for public addresses before first use, but Playwright did not pin the browser connection to the validated address, so DNS rebinding remains a residual risk.',
      'The screenshot perceptual hash is an investigative similarity signal and does not establish copying, ownership, intent, safety, or maliciousness.',
    ];
    const manifest = {
      schema: WEB_CAPTURE_MANIFEST_SCHEMA,
      schemaVersion: WEB_CAPTURE_MANIFEST_VERSION,
      source: { name: 'WHOISleuth local rendered capture', reference: null, collectedAt: capturedAt },
      captures: [{
        domain: target.hostname.toLowerCase(),
        capturedAt,
        completeness: requestStats.blockedRequestCount || dom.structureTruncated || dom.textTruncated ? 'partial' : 'complete',
        limitations,
        page: { title: title || null, finalOrigin: finalUrl.origin.toLowerCase() },
        requestDomains: [...requestBoundary.checkedHosts].sort().slice(0, MAX_CAPTURE_HOSTS),
        technologies: [],
        artifacts: [{
          kind: 'screenshot', fileName: screenshotName, mimeType: 'image/png',
          sha256: sha256(screenshotBuffer), perceptualHash: imagePerceptualHash(screenshotBuffer),
          bytes: screenshotBuffer.length, width: VIEWPORT.width, height: VIEWPORT.height,
        }, {
          kind: 'dom_digest', fileName: domName, mimeType: 'application/json',
          sha256: sha256(domBytes), bytes: domBytes.length,
        }],
      }],
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await privateWrite(path.join(temporaryDirectory, 'manifest.json'), manifestBytes);
    await rename(temporaryDirectory, targetDirectory);
    return manifest;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await browser?.close().catch(() => {});
  }
}
