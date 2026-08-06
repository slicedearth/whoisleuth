import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Browser, BrowserContext, Page, Route } from '@playwright/test';

import { WHOISLEUTH_USER_AGENT } from '../../lib/outbound-identity.mts';
import { imagePerceptualHash } from '../../lib/perceptual-hash.mts';
import { readBytesCapped, resolvePublicAddresses, safeFetchDetailed } from '../../lib/safe-fetch.mts';
import {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_MANIFEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
  WEB_CAPTURE_DOM_DIGEST_SCHEMA,
  WEB_CAPTURE_DOM_DIGEST_VERSION,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
} from '../../lib/web-capture-contract.mts';
export {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_MANIFEST_BYTES,
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
export const MAX_CAPTURE_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_CAPTURE_TRANSFER_BYTES = 24 * 1024 * 1024;
export const VIEWPORT = Object.freeze({ width: 1024, height: 768 });

type PublicAddressRecord = Readonly<{ address: string; family: number }>;
type CaptureFetchResource = (
  url: string,
  options: RequestInit,
  addresses: readonly PublicAddressRecord[],
) => Promise<Response>;

type CaptureArguments = Readonly<{
  targetUrl: string;
  outputDirectory: string;
  timeoutMs: number;
}>;

type CaptureDependencies = Readonly<{
  launchBrowser(): Promise<Browser>;
  resolveAddresses?: typeof resolvePublicAddresses;
  fetchResource?: CaptureFetchResource;
  readResponse?: typeof readBytesCapped;
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

const REQUEST_HEADER_ALLOWLIST = Object.freeze([
  'accept',
  'accept-language',
  'range',
] as const);

const RESPONSE_HEADER_ALLOWLIST = Object.freeze([
  'accept-ranges',
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'cache-control',
  'content-language',
  'content-security-policy',
  'content-security-policy-report-only',
  'content-type',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'etag',
  'expires',
  'last-modified',
  'location',
  'permissions-policy',
  'referrer-policy',
  'timing-allow-origin',
  'vary',
  'x-content-type-options',
] as const);

function boundedHeader(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048 || /[\u0000-\u0008\u000a-\u001f\u007f]/u.test(value)) return null;
  return value;
}

function requestHeaders(route: Route): Record<string, string> {
  const source = route.request().headers();
  const headers: Record<string, string> = { 'User-Agent': WHOISLEUTH_USER_AGENT };
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = boundedHeader(source[name]);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = boundedHeader(response.headers.get(name));
    if (value !== null) headers[name] = value;
  }
  return headers;
}

async function defaultFetchResource(
  url: string,
  options: RequestInit,
  addresses: readonly PublicAddressRecord[],
): Promise<Response> {
  const expectedHostname = new URL(url).hostname.toLowerCase().replace(/\.$/u, '');
  const result = await safeFetchDetailed(url, options, {
    maxRedirects: 0,
    resolvePublicAddresses: async (hostname) => {
      if (hostname.toLowerCase().replace(/\.$/u, '') !== expectedHostname) {
        throw new Error('Rendered capture refused an unexpected redirect hostname.');
      }
      return [...addresses];
    },
  });
  return result.response;
}

async function installRequestBoundary(
  context: BrowserContext,
  page: Page,
  resolveAddresses: typeof resolvePublicAddresses,
  fetchResource: CaptureFetchResource,
  readResponse: typeof readBytesCapped,
  timeoutMs: number,
) {
  const checkedHosts = new Set<string>();
  let requestCount = 0;
  let blockedRequestCount = 0;
  let hostLimitReached = false;
  let responseByteLimitReached = false;
  let transferredBytes = 0;
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
      }
      // Resolve on every request rather than only the first request for a host.
      // The exact validated records are then injected into safeFetchDetailed,
      // so the request cannot perform a second attacker-controlled DNS lookup.
      const addresses = await resolveAddresses(hostname);
      const method = route.request().method();
      const response = await fetchResource(parsed.toString(), {
        method,
        headers: requestHeaders(route),
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
      }, addresses);
      const body = method === 'HEAD'
        ? { bytes: Buffer.alloc(0), bytesRead: 0, truncated: false }
        : await readResponse(response, MAX_CAPTURE_RESPONSE_BYTES);
      if (body.truncated || transferredBytes + body.bytesRead > MAX_CAPTURE_TRANSFER_BYTES) {
        responseByteLimitReached = true;
        throw new Error('response byte limit reached');
      }
      transferredBytes += body.bytesRead;
      checkedHosts.add(hostname);
      await route.fulfill({
        status: response.status,
        headers: responseHeaders(response),
        body: body.bytes,
      });
    } catch {
      blockedRequestCount += 1;
      await route.abort('blockedbyclient');
    }
  });
  page.on('download', (download) => { void download.cancel(); });
  return {
    checkedHosts,
    stats: () => ({
      requestCount,
      blockedRequestCount,
      hostLimitReached,
      responseByteLimitReached,
      transferredBytes,
    }),
  };
}

async function disableBrowserOnlyNetworkApis(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // Playwright routing covers browser HTTP(S) requests and WebSockets are
    // blocked separately. These APIs can otherwise establish browser-managed
    // transports that do not pass through the pinned HTTP(S) collector.
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
      try {
        Object.defineProperty(globalThis, name, {
          value: undefined,
          configurable: false,
          enumerable: false,
          writable: false,
        });
      } catch {
        // A browser that exposes a non-configurable implementation remains
        // covered by the disposable, network-restricted execution requirement.
      }
    }
  });
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
    await disableBrowserOnlyNetworkApis(context);
    const page = await context.newPage();
    const requestBoundary = await installRequestBoundary(
      context,
      page,
      dependencies.resolveAddresses ?? resolvePublicAddresses,
      dependencies.fetchResource ?? defaultFetchResource,
      dependencies.readResponse ?? readBytesCapped,
      argumentsValue.timeoutMs,
    );
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: argumentsValue.timeoutMs });
    await page.waitForTimeout(Math.min(750, Math.max(100, Math.round(argumentsValue.timeoutMs / 20))));
    const finalUrl = captureUrl(page.url());
    const title = boundedPlainText(await page.title(), 300);
    const dom = await projectDom(page);
    const screenshot = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
    const screenshotBuffer = Buffer.from(screenshot);
    if (!screenshotBuffer.length || screenshotBuffer.length > MAX_WEB_CAPTURE_SCREENSHOT_BYTES) {
      throw new Error('Rendered screenshot is empty or exceeds the 10 MiB artefact bound.');
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
    if (domBytes.length > MAX_WEB_CAPTURE_DOM_DIGEST_BYTES) throw new Error('DOM digest exceeds the 1 MiB artefact bound.');
    const screenshotName = 'screenshot.png';
    const domName = 'dom-digest.json';
    await privateWrite(path.join(temporaryDirectory, screenshotName), screenshotBuffer);
    await privateWrite(path.join(temporaryDirectory, domName), domBytes);
    const requestStats = requestBoundary.stats();
    const limitations = [
      'Rendered collection executed page JavaScript in a disposable browser context and may have disclosed the target to its public resource operators.',
      'Downloads, service workers, WebSockets, WebRTC, WebTransport, non-read methods, non-HTTP(S), credentialed, non-default-port, private-address, excess-host, excess-request, excess-response, and excess-transfer traffic was blocked.',
      'Each request was resolved and connection-pinned by the shared safe-fetch transport before its bounded response was supplied to the disposable browser; cookies, authorisation headers, and request bodies were not forwarded.',
      `Each response was capped at ${MAX_CAPTURE_RESPONSE_BYTES} bytes and the capture was capped at ${MAX_CAPTURE_TRANSFER_BYTES} transferred response bytes.`,
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
    if (manifestBytes.length > MAX_WEB_CAPTURE_MANIFEST_BYTES) {
      throw new Error(`Rendered capture manifest exceeds the ${MAX_WEB_CAPTURE_MANIFEST_BYTES}-byte limit.`);
    }
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
