import { createHash } from 'node:crypto';
import { lstat, mkdir, open, rmdir, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

import type { Browser, BrowserContext, Page, Route } from 'playwright';
import { installPageObservationBoundary, collectPageElements, buildPageBehaviour } from './page-observation-boundary.mts';
import type { PageRequestObservation } from '../investigation/page-behaviour.mts';
import { CAPTURE_REQUEST_CHANNELS, MAX_CAPTURE_CHANNEL_OBSERVATIONS, emptyCaptureCoverage, type CaptureRequestAttempt, type CaptureRequestChannel } from '../investigation/capture-coverage.mts';
import { CAPTURE_NAVIGATION_PLAN_SCHEMA, CAPTURE_NAVIGATION_PLAN_VERSION, MAX_CAPTURE_NAVIGATION_PLAN_BYTES, MAX_CAPTURE_NAVIGATION_STEPS,
  type CaptureNavigationStep } from '../contracts/capture-navigation.mts';
import { captureArtifactName, readCaptureNavigation } from '../investigation/capture-navigation.mts';
import { parseBoundedJson } from '../analysis/bounded-json.mts';
import { exact } from '../evidence/artifact-structure.mts';

import { WHOISLEUTH_USER_AGENT } from '../../lib/outbound-identity.mts';
import { inspectDecodedImage } from '../../lib/perceptual-hash.mts';
import { readCaptureConditions, readObservationLabel } from '../comparison/capture-context.mts';
import { readBytesCapped, resolvePublicAddresses, safeFetchDetailed } from '../../lib/safe-fetch.mts';
import {
  startAnchoredArtifactWriter,
  type AnchoredArtifactIdentity,
  type AnchoredArtifactWriter,
} from './anchored-artifact-writer.mts';
import {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_DOM_ELEMENTS,
  MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS,
  MAX_WEB_CAPTURE_MANIFEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
  MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES,
  WEB_CAPTURE_DOM_DIGEST_SCHEMA,
  WEB_CAPTURE_DOM_DIGEST_VERSION,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
  MAX_CAPTURE_REQUESTS, MAX_CAPTURE_HOSTS, MAX_CAPTURE_URL_LENGTH, MAX_CAPTURE_TIMEOUT_MS, MAX_CAPTURE_RESPONSE_BYTES, MAX_CAPTURE_TRANSFER_BYTES,
} from '../contracts/web-capture.mts';
export {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_DOM_ELEMENTS,
  MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS,
  MAX_WEB_CAPTURE_MANIFEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
  MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES,
  WEB_CAPTURE_DOM_DIGEST_SCHEMA,
  WEB_CAPTURE_DOM_DIGEST_VERSION,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
  MAX_CAPTURE_REQUESTS, MAX_CAPTURE_HOSTS, MAX_CAPTURE_URL_LENGTH, MAX_CAPTURE_TIMEOUT_MS, MAX_CAPTURE_RESPONSE_BYTES, MAX_CAPTURE_TRANSFER_BYTES,
} from '../contracts/web-capture.mts';
export const VIEWPORT = Object.freeze({ width: 1024, height: 768 });

type PublicAddressRecord = Readonly<{ address: string; family: number }>;
type CaptureFetchResource = (
  url: string,
  options: RequestInit,
  addresses: readonly PublicAddressRecord[],
) => Promise<Response>;

type CaptureDeadlineScheduler = Readonly<{
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
}>;

const SYSTEM_CAPTURE_DEADLINE_SCHEDULER: CaptureDeadlineScheduler = Object.freeze({
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (timer) => clearTimeout(timer),
});

type CaptureArguments = Readonly<{
  targetUrl: string;
  outputDirectory: string;
  timeoutMs: number;
  observerLabel?: string;
  vantageLabel?: string;
  navigationPlanSource?: string;
  navigationTargets?: readonly string[];
}>;

type CaptureDependencies = Readonly<{
  signal?: AbortSignal;
  launchBrowser(timeoutMs: number): Promise<CaptureBrowser>;
  startArtifactWriter?: typeof startAnchoredArtifactWriter;
  resolveAddresses?: typeof resolvePublicAddresses;
  fetchResource?: CaptureFetchResource;
  readResponse?: typeof readBytesCapped;
  writeArtifact?: typeof privateWrite;
  now?: () => string;
  deadlineScheduler?: CaptureDeadlineScheduler;
}>;

export type CaptureBrowser = Browser & Readonly<{
  blockedDirectConnections(): number;
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
type NormalizedDomProjection = DomProjection & Readonly<{ visibleTextBytes: number }>;
type CaptureDeadline = Readonly<{
  run<T>(operation: Promise<T>): Promise<T>;
  signal: AbortSignal;
  expired(): boolean;
  clear(): void;
}>;

function createCaptureDeadline(
  timeoutMs: number,
  onTimeout: () => void | Promise<void>,
  scheduler: CaptureDeadlineScheduler = SYSTEM_CAPTURE_DEADLINE_SCHEDULER,
  callerSignal?: AbortSignal,
): CaptureDeadline {
  let didExpire = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  const timeoutError = new Error(`Rendered capture exceeded its ${timeoutMs} ms total-run deadline.`);
  let interrupt: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    const stop = (reason: unknown) => {
      if (didExpire) return;
      didExpire = true;
      controller.abort(reason);
      void Promise.resolve(onTimeout()).catch(() => {});
      reject(reason);
    };
    interrupt = () => stop(callerSignal?.reason ?? new Error('Rendered capture interrupted.'));
    callerSignal?.addEventListener('abort', interrupt, { once: true });
    if (callerSignal?.aborted) interrupt();
    timer = scheduler.schedule(() => {
      stop(timeoutError);
    }, timeoutMs);
  });
  // Cancellation can precede the first race (during output reservation).
  // Observe immediately without replacing the original rejecting promise.
  void timeout.catch(() => {});
  return Object.freeze({
    run<T>(operation: Promise<T>) { return Promise.race([operation, timeout]); },
    signal: controller.signal,
    expired() { return didExpire; },
    clear() {
      if (timer) scheduler.cancel(timer);
      timer = null;
      if (interrupt) callerSignal?.removeEventListener('abort', interrupt);
    },
  });
}

/** The first signal requests owned cleanup; a second explicitly forces exit. */
export function createCaptureInterruption(
  events: {
    on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
    off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  } = process,
  emergencyExit: () => void = () => process.exit(130),
) {
  const controller = new AbortController();
  const interrupt = () => {
    if (controller.signal.aborted) emergencyExit();
    else controller.abort(new Error('Rendered capture interrupted; owned output cleanup requested.'));
  };
  events.on('SIGINT', interrupt);
  events.on('SIGTERM', interrupt);
  return {
    signal: controller.signal,
    clear() { events.off('SIGINT', interrupt); events.off('SIGTERM', interrupt); },
  };
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

function boundedUtf8Text(value: unknown): { text: string; bytes: number; truncated: boolean } {
  if (typeof value !== 'string') return { text: '', bytes: 0, truncated: value !== undefined && value !== null };
  // Limit the string window before walking code points so a dependency-
  // injected projection cannot bypass the browser-side character bound.
  const candidate = value.slice(0, MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES);
  let bytes = 0;
  let end = 0;
  for (const character of candidate) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES) break;
    bytes += characterBytes;
    end += character.length;
  }
  return {
    text: candidate.slice(0, end),
    bytes,
    truncated: end < value.length,
  };
}

function normalizeDomProjection(value: DomProjection): NormalizedDomProjection {
  const visibleText = boundedUtf8Text(value?.visibleText);
  const count = (candidate: unknown) => Number.isSafeInteger(candidate) && Number(candidate) >= 0
    ? Math.min(Number(candidate), MAX_WEB_CAPTURE_DOM_ELEMENTS)
    : 0;
  const rawStructure = typeof value?.structure === 'string' ? value.structure : '';
  return {
    structure: rawStructure.slice(0, MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS),
    visibleText: visibleText.text,
    structureTruncated: value?.structureTruncated === true
      || rawStructure.length > MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS
      || [value?.elementCount, value?.formCount, value?.inputCount, value?.scriptCount, value?.imageCount]
        .some((candidate) => Number.isSafeInteger(candidate) && Number(candidate) > MAX_WEB_CAPTURE_DOM_ELEMENTS),
    textTruncated: value?.textTruncated === true || visibleText.truncated,
    visibleTextBytes: visibleText.bytes,
    elementCount: count(value?.elementCount),
    formCount: count(value?.formCount),
    inputCount: count(value?.inputCount),
    scriptCount: count(value?.scriptCount),
    imageCount: count(value?.imageCount),
  };
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

const TERMINAL_UNSAFE_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;
const TERMINAL_UNSAFE_GLOBAL_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu;

export function hasTerminalUnsafeCharacters(value: string): boolean {
  return TERMINAL_UNSAFE_RE.test(value);
}

export function sanitizeCaptureText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value
      .replace(TERMINAL_UNSAFE_GLOBAL_RE, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, maximum)
    : '';
}

/** JSON-quoted paths preserve exact whitespace and safely escape terminal controls. */
export function formatCaptureSuccess(domain: string, directory: string): string {
  if (!directory || directory.length > 2048) throw new TypeError('Capture output path exceeds its display bound.');
  const quote = (value: string) => JSON.stringify(value).replace(TERMINAL_UNSAFE_GLOBAL_RE,
    character => character.split('').map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''));
  return `Captured ${sanitizeCaptureText(domain, 253)} to ${quote(directory)}\nManifest: ${quote(path.join(directory, 'manifest.json'))}\n`;
}

function captureUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value || value.length > MAX_CAPTURE_URL_LENGTH
    || hasTerminalUnsafeCharacters(value)) {
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

function canonicalHost(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
}

function canonicalUrlHost(url: URL): string {
  return canonicalHost(url.hostname);
}

function captureTargetUrl(value: unknown): URL {
  const parsed = captureUrl(value);
  if (isIP(canonicalUrlHost(parsed))) {
    throw new Error('Rendered capture targets must use a domain hostname so the resulting evidence remains compatible with domain Cases.');
  }
  return parsed;
}

function outputDirectory(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || hasTerminalUnsafeCharacters(value)) {
    throw new Error('Output directory must be one bounded local path.');
  }
  return path.resolve(value);
}

export function parseCaptureArguments(argv: readonly string[]): CaptureArguments {
  let targetUrl: string | null = null;
  let destination: string | null = null;
  let authorised = false;
  let timeoutMs = 20_000;
  let navigationPlanSource: string | undefined;
  const labels: { observerLabel?: string; vantageLabel?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output-dir') {
      if (destination !== null) throw new Error('--output-dir may be supplied only once.');
      destination = argv[++index] ?? null;
      if (!destination || destination.startsWith('-')) throw new Error('--output-dir requires one new directory path.');
    } else if (argument === '--navigation-plan') {
      const value = argv[++index];
      if (navigationPlanSource !== undefined || !value || value.startsWith('-')) throw new Error('--navigation-plan requires one selected local plan file.');
      navigationPlanSource = outputDirectory(value);
    } else if (argument === '--observer' || argument === '--vantage') {
      const key = argument === '--observer' ? 'observerLabel' : 'vantageLabel';
      if (labels[key] !== undefined) throw new Error(`${argument} may be supplied only once.`);
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires one declared label.`);
      labels[key] = readObservationLabel(value)!;
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
    throw new Error('Usage: whoisleuth-capture <url> --output-dir <new-directory> --authorize-rendered-capture [--navigation-plan <selected-plan.json>] [--timeout-ms <1000-30000>]');
  }
  return { targetUrl: captureTargetUrl(targetUrl).toString(), outputDirectory: outputDirectory(destination), timeoutMs, ...labels,
    ...(navigationPlanSource ? { navigationPlanSource } : {}) };
}

/** The plan chooses URLs, never executable controls, scripts or form actions. */
export function parseCaptureNavigationPlan(raw: string): readonly string[] {
  const value = exact(parseBoundedJson(raw, { maximumBytes: MAX_CAPTURE_NAVIGATION_PLAN_BYTES, label: 'Selected navigation plan' }), ['schema', 'version', 'urls'], 'Selected navigation plan');
  if (value.schema !== CAPTURE_NAVIGATION_PLAN_SCHEMA || value.version !== CAPTURE_NAVIGATION_PLAN_VERSION || !Array.isArray(value.urls)
    || !value.urls.length || value.urls.length >= MAX_CAPTURE_NAVIGATION_STEPS) throw new TypeError(`A navigation plan requires 1–${MAX_CAPTURE_NAVIGATION_STEPS - 1} explicitly selected subsequent URLs.`);
  return value.urls.map(captureTargetUrl).map(url => url.toString());
}

async function projectDom(page: Page): Promise<NormalizedDomProjection> {
  const projected = await page.evaluate(({ boundaryName, maximumCharacters, maximumElements }) => {
    const boundary = (globalThis as unknown as Record<string, unknown>)[boundaryName];
    if (typeof boundary !== 'function') {
      throw new Error('Rendered DOM projection boundary was unavailable.');
    }
    return boundary({ maximumCharacters, maximumElements });
  }, {
    boundaryName: DOM_PROJECTION_BOUNDARY_NAME,
    maximumCharacters: MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS,
    maximumElements: MAX_WEB_CAPTURE_DOM_ELEMENTS,
  });
  return normalizeDomProjection(projected);
}

type OwnedArtifactIdentity = AnchoredArtifactIdentity;

function sameArtifactIdentity(left: OwnedArtifactIdentity, right: OwnedArtifactIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertPrivateDirectoryReservation(
  reservation: Awaited<ReturnType<typeof lstat>>,
  expectedUid: number | null,
): void {
  if (!reservation.isDirectory()
    || (expectedUid !== null && Number(reservation.uid) !== expectedUid)
    || (process.platform !== 'win32' && (Number(reservation.mode) & 0o077) !== 0)) {
    throw new Error('Capture output directory could not be reserved as a private directory owned by the current user.');
  }
}

async function assertPublishedDirectoryIdentity(
  targetDirectory: string,
  reservation: OwnedArtifactIdentity,
): Promise<void> {
  let current: Awaited<ReturnType<typeof lstat>>;
  try {
    current = await lstat(targetDirectory);
  } catch {
    throw new Error('Capture output directory identity changed before artefact publication completed.');
  }
  if (!current.isDirectory() || !sameArtifactIdentity(current, reservation)) {
    throw new Error('Capture output directory identity changed before artefact publication completed.');
  }
}

async function privateWrite(
  filePath: string,
  value: string | Buffer,
  signal: AbortSignal,
  onCreated: (identity: OwnedArtifactIdentity) => void,
): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    const identity = await handle.stat();
    onCreated({ dev: identity.dev, ino: identity.ino });
    await handle.writeFile(value, { signal });
  } finally {
    await handle.close();
  }
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
  const expectedHostname = canonicalUrlHost(new URL(url));
  const result = await safeFetchDetailed(url, options, {
    maxRedirects: 0,
    resolvePublicAddresses: async (hostname) => {
      if (canonicalHost(hostname) !== expectedHostname) {
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
  totalSignal: AbortSignal,
) {
  const seenRequestHosts = new Set<string>();
  const retainedPublicRequestHosts = new Set<string>();
  let requestCount = 0;
  let blockedRequestCount = 0;
  let hostLimitReached = false;
  let responseByteLimitReached = false;
  let transferredBytes = 0;
  let reservedTransferBytes = 0;
  let acceptingRequests = true;
  const pendingRequests = new Set<Promise<void>>();
  const pageRequests: PageRequestObservation[] = [];
  const attempts: CaptureRequestAttempt[] = [];
  let omittedAttempts = 0, websocketRefusals = 0;
  let admittedMainFrame = false, refusedMainFrame = false;
  let stageStart = 0, stageBlockedStart = 0, stageBytesStart = 0, stageOmittedStart = 0, stageWebsocketStart = 0;
  function requestChannel(route: Route): CaptureRequestChannel {
    const request = route.request();
    if (request.isNavigationRequest()) {
      try { return request.frame() === page.mainFrame() ? 'navigation' : 'frame'; }
      catch { return 'document'; }
    }
    const type = request.resourceType(), channel = type === 'ping' ? 'beacon' : type === 'eventsource' ? 'event_source' : type;
    return (CAPTURE_REQUEST_CHANNELS as readonly string[]).includes(channel) ? channel as CaptureRequestChannel : 'other';
  }
  function attempt(route: Route, position: number): CaptureRequestAttempt {
    const method = route.request().method();
    return { position, channel: requestChannel(route), method: !method ? 'unknown' : ['GET', 'HEAD'].includes(method) ? 'read' : 'non_read',
      origin: null, state: 'unavailable', reason: 'address_or_transport', collectionStarted: false };
  }
  function retainAttempt(value: CaptureRequestAttempt) {
    if (value.channel === 'navigation') {
      if (value.state === 'observed') admittedMainFrame = true;
      else refusedMainFrame = true;
    }
    if (value.position <= MAX_CAPTURE_CHANNEL_OBSERVATIONS) attempts.push(value);
    else omittedAttempts = Math.min(1_000_000, omittedAttempts + 1);
  }

  const reserveResponseBytes = (): number => {
    const remaining = MAX_CAPTURE_TRANSFER_BYTES - transferredBytes - reservedTransferBytes;
    const allowance = Math.min(MAX_CAPTURE_RESPONSE_BYTES, Math.max(0, remaining));
    reservedTransferBytes += allowance;
    return allowance;
  };
  const settleResponseBytes = (allowance: number, bytesRead: number): void => {
    reservedTransferBytes -= allowance;
    transferredBytes += Math.min(allowance, Math.max(0, bytesRead));
  };
  await context.routeWebSocket('**/*', async (webSocket) => {
    blockedRequestCount += 1;
    websocketRefusals = Math.min(1_000_000, websocketRefusals + 1);
    await webSocket.close({ code: 1008, reason: 'WHOISleuth local capture blocks WebSockets' });
  });
  const handleRoute = async (route: Route) => {
    requestCount += 1;
    const position = requestCount;
    let observation = attempt(route, position);
    if (requestCount > MAX_CAPTURE_REQUESTS) {
      blockedRequestCount += 1;
      retainAttempt({ ...observation, state: 'refused', reason: 'request_bound' });
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }
    try {
      totalSignal.throwIfAborted();
      const frame = route.request().frame();
      if (frame !== page.mainFrame() && frame.page() !== page) {
        observation = { ...observation, state: 'refused', reason: 'shutdown' };
        throw new Error('request does not belong to the selected page');
      }
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        observation = { ...observation, state: 'refused', reason: 'method' };
        throw new Error('non-read request blocked');
      }
      const parsed = captureUrl(route.request().url());
      const hostname = canonicalUrlHost(parsed);
      if (!seenRequestHosts.has(hostname)) {
        if (seenRequestHosts.size >= MAX_CAPTURE_HOSTS) {
          hostLimitReached = true;
          observation = { ...observation, state: 'refused', reason: 'host_bound' };
          throw new Error('request-host limit reached');
        }
        // Admit a new browser-requested hostname synchronously. Route handlers
        // may overlap, so delaying this reservation until after DNS or response
        // work would let concurrent or refused requests bypass the host bound.
        seenRequestHosts.add(hostname);
      }
      // Resolve on every request rather than only the first request for a host.
      // The exact validated records are then injected into safeFetchDetailed,
      // so the request cannot perform a second attacker-controlled DNS lookup.
      const addresses = await abortable(resolveAddresses(hostname), totalSignal);
      // Do not retain an unvalidated destination merely to fill a ledger cell.
      observation = { ...observation, origin: parsed.origin };
      retainedPublicRequestHosts.add(hostname);
      const method = route.request().method();
      const requestSignal = AbortSignal.any([
        totalSignal,
        AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
      ]);
      observation = { ...observation, collectionStarted: true };
      const response = await abortable(fetchResource(parsed.toString(), {
        method,
        headers: requestHeaders(route),
        redirect: 'manual',
        signal: requestSignal,
      }, addresses), requestSignal);
      const body = method === 'HEAD'
        ? { bytes: Buffer.alloc(0), bytesRead: 0, truncated: false }
        : await (async () => {
            const allowance = reserveResponseBytes();
            if (allowance <= 0) {
              responseByteLimitReached = true;
              observation = { ...observation, state: 'refused', reason: 'response_bound' };
              await response.body?.cancel().catch(() => {});
              throw new Error('response byte limit reached');
            }
            let settled = false;
            try {
              const value = await abortable(readResponse(response, allowance), requestSignal);
              const validBytesRead = Number.isSafeInteger(value.bytesRead)
                && value.bytesRead >= 0
                && value.bytesRead <= allowance;
              // A truncated or malformed reader result is conservatively
              // charged for its complete reservation. This prevents refused
              // responses from resetting the shared capture budget.
              settleResponseBytes(allowance, value.truncated || !validBytesRead ? allowance : value.bytesRead);
              settled = true;
              if (!validBytesRead) throw new Error('response byte accounting was invalid');
              return value;
            } catch (error) {
              if (!settled) settleResponseBytes(allowance, allowance);
              await response.body?.cancel().catch(() => {});
              throw error;
            }
          })();
      if (body.truncated) {
        responseByteLimitReached = true;
        observation = { ...observation, state: 'refused', reason: 'response_bound' };
        throw new Error('response byte limit reached');
      }
      await route.fulfill({
        status: response.status,
        headers: responseHeaders(response),
        body: body.bytes,
      });
      observation = { ...observation, state: 'observed', reason: null };
      const kind = ['script', 'navigation', 'frame', 'document'].includes(observation.channel) ? observation.channel as PageRequestObservation['kind'] : null;
      if (kind) pageRequests.push({ position, kind, origin: parsed.origin,
        contentSha256: kind === 'script' && method === 'GET' && response.status >= 200 && response.status < 300 ? sha256(body.bytes) : null,
        status: response.status, cspEnforced: response.headers.has('content-security-policy'), cspReportOnly: response.headers.has('content-security-policy-report-only') });
    } catch {
      blockedRequestCount += 1;
      await route.abort('blockedbyclient').catch(() => {});
    } finally {
      retainAttempt(observation);
    }
  };
  await context.route('**/*', (route: Route) => {
    if (!acceptingRequests) {
      requestCount += 1;
      blockedRequestCount += 1;
      retainAttempt({ ...attempt(route, requestCount), state: 'refused', reason: 'shutdown' });
      const refusal = route.abort('blockedbyclient').catch(() => {});
      pendingRequests.add(refusal);
      void refusal.then(
        () => pendingRequests.delete(refusal),
        () => pendingRequests.delete(refusal),
      );
      return refusal;
    }
    const pending = handleRoute(route);
    pendingRequests.add(pending);
    // Do not use an unobserved promise returned by finally(): a rejected route
    // would create a second rejected promise and can terminate the CLI under
    // strict unhandled-rejection handling.
    void pending.then(
      () => pendingRequests.delete(pending),
      () => pendingRequests.delete(pending),
    );
    return pending;
  });
  return {
    beginPage(next: Page) {
      if (pendingRequests.size) throw new Error('Previous capture requests must settle before selecting another page.');
      page = next;
      stageStart = requestCount; stageBlockedStart = blockedRequestCount; stageBytesStart = transferredBytes;
      stageOmittedStart = omittedAttempts; stageWebsocketStart = websocketRefusals;
      admittedMainFrame = false; refusedMainFrame = false; acceptingRequests = true;
      page.on('download', download => { void download.cancel(); });
    },
    totals() { return { requestAttempts: requestCount, responseBytesCharged: transferredBytes, publicRequestHosts: retainedPublicRequestHosts.size }; },
    canRetainRefusedNavigation() { return admittedMainFrame && refusedMainFrame; },
    hasRefusedNavigation() { return refusedMainFrame; },
    beginSeal() {
      acceptingRequests = false;
    },
    async seal() {
      acceptingRequests = false;
      while (pendingRequests.size > 0) {
        await Promise.allSettled([...pendingRequests]);
      }
      return {
        requestHosts: [...new Set(attempts.filter(item => item.position > stageStart && item.origin).map(item => canonicalUrlHost(new URL(item.origin!))))].sort().slice(0, MAX_CAPTURE_HOSTS),
        pageRequests: pageRequests.filter(item => item.position > stageStart),
        coverage: { ...emptyCaptureCoverage(), attempts: attempts.filter(item => item.position > stageStart).sort((a, b) => a.position - b.position),
          omittedAttempts: omittedAttempts - stageOmittedStart, websocketRefusals: websocketRefusals - stageWebsocketStart },
        stats: {
          requestCount: requestCount - stageStart,
          blockedRequestCount: blockedRequestCount - stageBlockedStart,
          hostLimitReached,
          responseByteLimitReached,
          transferredBytes: transferredBytes - stageBytesStart,
        },
      };
    },
  };
}

export function disableBrowserNetworkIntrinsics(
  scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
  // Playwright routing covers browser HTTP(S) requests and WebSockets are
  // blocked separately. These APIs can otherwise establish browser-managed
  // transports that do not pass through the pinned HTTP(S) collector.
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport', 'Worker', 'SharedWorker']) {
    try {
      Object.defineProperty(scope, name, {
        value: undefined,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    } catch {
      // The explicit verification below turns a non-configurable live API
      // into a fail-closed capture before any target navigation.
    }
    if (scope[name] !== undefined) {
      throw new Error(`Rendered capture could not disable the browser-managed ${name} transport.`);
    }
  }
}

export function browserNetworkIntrinsicsAreDisabled(
  scopeValue?: unknown,
): boolean {
  const scope = scopeValue && typeof scopeValue === 'object'
    ? scopeValue as Record<string, unknown>
    : globalThis as unknown as Record<string, unknown>;
  return ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport', 'Worker', 'SharedWorker']
    .every((name) => scope[name] === undefined);
}

async function disableBrowserOnlyNetworkApis(context: BrowserContext): Promise<void> {
  await context.addInitScript(disableBrowserNetworkIntrinsics);
}

const DOM_PROJECTION_BOUNDARY_NAME = '__whoisleuthBoundedDomProjectionV1';

export function installDomProjectionIntrinsics({ boundaryName, maximumCharacters: fixedMaximumCharacters, maximumElements: fixedMaximumElements }: {
  boundaryName: string;
  maximumCharacters: number;
  maximumElements: number;
}): void {
    const apply = Reflect.apply;
    const createTreeWalker = Document.prototype.createTreeWalker;
    const nextNode = TreeWalker.prototype.nextNode;
    const tagName = Object.getOwnPropertyDescriptor(Element.prototype, 'tagName')?.get;
    const nodeValue = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeValue')?.get;
    const arrayPush = Array.prototype.push;
    const arrayJoin = Array.prototype.join;
    const stringSlice = String.prototype.slice;
    const stringToLowerCase = String.prototype.toLowerCase;
    const isSafeInteger = Number.isSafeInteger;
    const minimum = Math.min;
    const capturedDocument = document;

    if (!tagName || !nodeValue) {
      throw new Error('Rendered DOM projection could not capture native DOM accessors.');
    }
    if (!isSafeInteger(fixedMaximumCharacters) || fixedMaximumCharacters < 1
      || !isSafeInteger(fixedMaximumElements) || fixedMaximumElements < 1) {
      throw new Error('Rendered DOM projection received invalid fixed bounds.');
    }

    const project = ({ maximumCharacters, maximumElements }: {
      maximumCharacters: number;
      maximumElements: number;
    }) => {
      if (!isSafeInteger(maximumCharacters) || maximumCharacters < 1 || maximumCharacters > fixedMaximumCharacters
        || !isSafeInteger(maximumElements) || maximumElements < 1 || maximumElements > fixedMaximumElements) {
        throw new Error('Rendered DOM projection received invalid bounds.');
      }

      const structureParts: string[] = [];
      let structureLength = 0;
      let structureTruncated = false;
      let elementCount = 0;
      let formCount = 0;
      let inputCount = 0;
      let scriptCount = 0;
      let imageCount = 0;
      let body: Element | null = null;
      const elementWalker = apply(createTreeWalker, capturedDocument, [capturedDocument, 1]);
      let element = apply(nextNode, elementWalker, []) as Element | null;
      while (element && elementCount < maximumElements) {
        elementCount += 1;
        const rawTag = apply(tagName, element, []) as string;
        const classification = apply(stringToLowerCase, apply(stringSlice, rawTag, [0, 16]), []) as string;
        const separatorLength = structureLength ? 1 : 0;
        if (maximumCharacters - structureLength > separatorLength) {
          if (structureLength) {
            apply(arrayPush, structureParts, [' ']);
            structureLength += 1;
          }
          const remaining = maximumCharacters - structureLength;
          const retainedTag = apply(stringToLowerCase, apply(stringSlice, rawTag, [0, remaining]), []) as string;
          if (retainedTag) {
            apply(arrayPush, structureParts, [retainedTag]);
            structureLength += retainedTag.length;
          }
          if (rawTag.length > remaining) structureTruncated = true;
        } else {
          structureTruncated = true;
        }
        if (classification === 'body') body = element;
        if (classification === 'form') formCount += 1;
        if (classification === 'input' || classification === 'select' || classification === 'textarea' || classification === 'button') inputCount += 1;
        if (classification === 'script') scriptCount += 1;
        if (classification === 'img') imageCount += 1;
        element = apply(nextNode, elementWalker, []) as Element | null;
      }
      const elementTraversalTruncated = element !== null;
      const structureValue = apply(arrayJoin, structureParts, ['']) as string;
      const textParts: string[] = [];
      let textLength = 0;
      let textNodes = 0;
      let textTruncated = false;
      if (body) {
        const textWalker = apply(createTreeWalker, capturedDocument, [body, 4]);
        while (textLength < maximumCharacters && textNodes < maximumElements) {
          const node = apply(nextNode, textWalker, []) as Node | null;
          if (!node) break;
          textNodes += 1;
          const candidate = apply(nodeValue, node, []);
          const value = typeof candidate === 'string' ? candidate : '';
          const remaining = maximumCharacters - textLength;
          apply(arrayPush, textParts, [apply(stringSlice, value, [0, remaining]) as string]);
          textLength += minimum(value.length, remaining);
          if (value.length > remaining) {
            textTruncated = true;
            break;
          }
        }
        textTruncated ||= apply(nextNode, textWalker, []) !== null;
      }
      const textValue = apply(arrayJoin, textParts, ['']) as string;
      return {
        structure: structureValue,
        visibleText: textValue,
        structureTruncated: structureTruncated || elementTraversalTruncated,
        textTruncated,
        elementCount,
        formCount,
        inputCount,
        scriptCount,
        imageCount,
      };
    };

    Object.defineProperty(globalThis, boundaryName, {
      value: project,
      configurable: false,
      enumerable: false,
      writable: false,
    });
}

async function installDomProjectionBoundary(context: BrowserContext): Promise<void> {
  await context.addInitScript(installDomProjectionIntrinsics, {
    boundaryName: DOM_PROJECTION_BOUNDARY_NAME,
    maximumCharacters: MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS,
    maximumElements: MAX_WEB_CAPTURE_DOM_ELEMENTS,
  });
}

export async function captureRenderedPage(
  argumentsValue: CaptureArguments,
  dependencies: CaptureDependencies,
) {
  dependencies.signal?.throwIfAborted();
  if (!Number.isInteger(argumentsValue.timeoutMs) || argumentsValue.timeoutMs < 1_000 || argumentsValue.timeoutMs > MAX_CAPTURE_TIMEOUT_MS) {
    throw new Error(`Rendered capture total-run timeout must be between 1000 and ${MAX_CAPTURE_TIMEOUT_MS} ms.`);
  }
  const target = captureTargetUrl(argumentsValue.targetUrl);
  if (argumentsValue.navigationPlanSource && argumentsValue.navigationTargets === undefined) throw new TypeError('Read and validate the selected navigation plan before capture.');
  if (argumentsValue.navigationTargets !== undefined && (!Array.isArray(argumentsValue.navigationTargets) || argumentsValue.navigationTargets.length >= MAX_CAPTURE_NAVIGATION_STEPS)) throw new TypeError('Selected navigation exceeds its step bound.');
  // Validate the complete selection before creating any directory or request.
  const targets = [target, ...(argumentsValue.navigationTargets ?? []).map(captureTargetUrl)];
  const observerLabel = readObservationLabel(argumentsValue.observerLabel), vantageLabel = readObservationLabel(argumentsValue.vantageLabel);
  const targetDirectory = outputDirectory(argumentsValue.outputDirectory);
  const parentDirectory = path.dirname(targetDirectory);
  await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
  try {
    await mkdir(targetDirectory, { mode: 0o700 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'EEXIST') throw new Error('Capture output directory already exists.');
    throw error;
  }
  const reservationStats = await lstat(targetDirectory);
  const captureStartedAt = Date.now();
  const expectedUid = typeof process.getuid === 'function' ? process.getuid() : null;
  assertPrivateDirectoryReservation(reservationStats, expectedUid);
  const reservation = { dev: reservationStats.dev, ino: reservationStats.ino };
  const ownedArtifacts = new Map<string, OwnedArtifactIdentity>();
  const pendingArtifactWrites = new Set<Promise<void>>();
  let anchoredWriter: AnchoredArtifactWriter | null = null;
  let browser: CaptureBrowser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const deadline = createCaptureDeadline(argumentsValue.timeoutMs, async () => {
    await Promise.allSettled([
      page?.close({ runBeforeUnload: false }),
      context?.close(),
      browser?.close(),
    ].filter((operation): operation is Promise<void> => Boolean(operation)));
  }, dependencies.deadlineScheduler, dependencies.signal);
  const remainingTimeoutMs = () => Math.max(
    1,
    argumentsValue.timeoutMs - Math.max(0, Date.now() - captureStartedAt),
  );
  async function writeArtifact(fileName: string, value: string | Buffer): Promise<void> {
    if (!dependencies.writeArtifact) await assertPublishedDirectoryIdentity(targetDirectory, reservation);
    const operation = dependencies.writeArtifact
      ? dependencies.writeArtifact(
          path.join(targetDirectory, fileName),
          value,
          deadline.signal,
          (identity) => ownedArtifacts.set(fileName, identity),
        )
      : anchoredWriter?.write(
          fileName,
          value,
          deadline.signal,
          (identity) => ownedArtifacts.set(fileName, identity),
        ) ?? Promise.reject(new Error('Anchored capture artefact writer is unavailable.'));
    pendingArtifactWrites.add(operation);
    void operation.then(
      () => pendingArtifactWrites.delete(operation),
      () => pendingArtifactWrites.delete(operation),
    );
    await deadline.run(operation);
  }
  try {
    deadline.signal.throwIfAborted();
    if (!dependencies.writeArtifact) {
      const writerAcquisition = (dependencies.startArtifactWriter ?? startAnchoredArtifactWriter)(
        targetDirectory,
        reservation,
        expectedUid,
      );
      void writerAcquisition.then((lateWriter) => {
        if (!deadline.expired() || anchoredWriter === lateWriter) return;
        void lateWriter.finish(true).catch(() => lateWriter.terminate());
      }, () => {});
      anchoredWriter = await deadline.run(writerAcquisition);
      await deadline.run(assertPublishedDirectoryIdentity(targetDirectory, reservation));
    }
    const browserAcquisition = dependencies.launchBrowser(remainingTimeoutMs());
    void browserAcquisition.then((lateBrowser) => {
      if (!deadline.expired() || browser === lateBrowser) return;
      void lateBrowser.close().catch(() => {});
    }, () => {});
    browser = await deadline.run(browserAcquisition);
    context = await deadline.run(browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light',
      serviceWorkers: 'block',
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
    }));
    await deadline.run(installDomProjectionBoundary(context));
    await deadline.run(disableBrowserOnlyNetworkApis(context));
    await deadline.run(installPageObservationBoundary(context));
    page = await deadline.run(context.newPage());
    const requestBoundary = await deadline.run(installRequestBoundary(
      context,
      page,
      dependencies.resolveAddresses ?? resolvePublicAddresses,
      dependencies.fetchResource ?? defaultFetchResource,
      dependencies.readResponse ?? readBytesCapped,
      argumentsValue.timeoutMs,
      deadline.signal,
    ));
    async function capturePage(selected: URL, index: number) {
      if (!page) page = await deadline.run(context!.newPage());
      if (!await deadline.run(page.evaluate(browserNetworkIntrinsicsAreDisabled))) throw new Error('Selected capture page could not verify disabled browser transports.');
      requestBoundary.beginPage(page);
      try {
        await deadline.run(page.goto(selected.toString(), { waitUntil: 'domcontentloaded', timeout: remainingTimeoutMs() }));
      } catch (cause) {
        if (deadline.expired() || !requestBoundary.hasRefusedNavigation()) throw cause;
        if (index === 0) throw new Error('Initial capture navigation was blocked or unavailable. No capture files were retained.');
        requestBoundary.beginSeal();
        await deadline.run(page.close({ runBeforeUnload: false })); page = null;
        await deadline.run(requestBoundary.seal());
        return null;
      }
      await deadline.run(page.waitForTimeout(Math.min(750, Math.max(100, Math.round(argumentsValue.timeoutMs / 20)))));
      const browserUrl = page.url();
      const unavailableMainFrame = browserUrl === 'chrome-error://chromewebdata/' && requestBoundary.canRetainRefusedNavigation();
      const finalUrl = unavailableMainFrame ? null : captureUrl(browserUrl);
      const title = unavailableMainFrame ? null : sanitizeCaptureText(await deadline.run(page.title()), 300);
      const dom = unavailableMainFrame ? null : await deadline.run(projectDom(page));
      const pageElements = unavailableMainFrame ? { elements: [], partial: true, clipboardWriteAttempts: 0 } : await deadline.run(collectPageElements(page));
      const screenshotBuffer = Buffer.from(await deadline.run(page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' })));
      if (!screenshotBuffer.length || screenshotBuffer.length > MAX_WEB_CAPTURE_SCREENSHOT_BYTES) throw new Error('Rendered screenshot is empty or exceeds the aggregate 10 MiB artefact bound.');
      const screenshotInspection = inspectDecodedImage(screenshotBuffer);
      if (!screenshotInspection.decodable || screenshotInspection.width !== VIEWPORT.width || screenshotInspection.height !== VIEWPORT.height) throw new Error('Rendered screenshot must be a decodable PNG matching the fixed capture viewport.');
      const capturedAt = dependencies.now?.() ?? new Date().toISOString();
      // No old page or pending response may enter the next selected stage.
      requestBoundary.beginSeal();
      await deadline.run(page.close({ runBeforeUnload: false })); page = null;
      const sealedBoundary = await deadline.run(requestBoundary.seal());
      return { target: selected, unavailableMainFrame, finalUrl, title, dom, pageElements, screenshotBuffer, screenshotInspection, capturedAt, sealedBoundary };
    }
    const staged: Array<NonNullable<Awaited<ReturnType<typeof capturePage>>>> = [];
    const steps: CaptureNavigationStep[] = [];
    let stopped = false, screenshotBytes = 0;
    for (const [index, selected] of targets.entries()) {
      const beforeCapture = staged.length ? staged.length - 1 : null;
      if (stopped) { steps.push({ selectedOrigin: selected.origin, beforeCapture, afterCapture: null, state: 'not_attempted' }); continue; }
      const captured = await capturePage(selected, index);
      if (!captured) { steps.push({ selectedOrigin: selected.origin, beforeCapture, afterCapture: null, state: 'blocked' }); stopped = true; continue; }
      screenshotBytes += captured.screenshotBuffer.length;
      if (screenshotBytes > MAX_WEB_CAPTURE_SCREENSHOT_BYTES) throw new Error('Selected navigation exceeds the aggregate 10 MiB screenshot bound.');
      staged.push(captured);
      steps.push({ selectedOrigin: selected.origin, beforeCapture, afterCapture: staged.length - 1, state: 'captured' });
    }
    // A failed context close invalidates the claim that no further browser
    // request can alter the final completeness state, so fail the capture.
    await deadline.run(context.close());
    context = null;
    const finalBoundary = await deadline.run(requestBoundary.seal());
    if (!stopped) staged[staged.length - 1]!.sealedBoundary = finalBoundary;
    const browserVersion = browser.version();
    // Seal the browser-lifetime barrier too: page/context teardown may create
    // connections after their route handlers have gone away.
    await deadline.run(browser.close());
    const blockedDirectConnections = browser.blockedDirectConnections();
    browser = null;
    const files: Array<{ name: string; bytes: Buffer }> = [];
    let domArtifactBytes = 0;
    const captures = staged.map(({ target, unavailableMainFrame, finalUrl, title, dom, pageElements, screenshotBuffer, screenshotInspection, capturedAt, sealedBoundary }, index) => {
      const requestStats = sealedBoundary.stats;
      const pageBehaviour = buildPageBehaviour(pageElements, sealedBoundary.pageRequests, dom?.visibleText ?? '',
        Boolean(unavailableMainFrame || requestStats.blockedRequestCount || blockedDirectConnections || dom?.structureTruncated || dom?.textTruncated),
        { ...sealedBoundary.coverage, directConnectionRefusals: targets.length === 1 ? Math.min(1_000_000, blockedDirectConnections) : 0 });
      const domDigest = dom ? {
        schema: WEB_CAPTURE_DOM_DIGEST_SCHEMA,
        version: WEB_CAPTURE_DOM_DIGEST_VERSION,
        capturedAt,
        domain: canonicalUrlHost(target),
        counts: {
          elements: dom.elementCount,
          forms: dom.formCount,
          controls: dom.inputCount,
          scripts: dom.scriptCount,
          images: dom.imageCount,
        },
        structure: { algorithm: 'sha256', value: sha256(dom.structure), truncated: dom.structureTruncated },
        visibleText: { algorithm: 'sha256', value: sha256(dom.visibleText), bytes: dom.visibleTextBytes, truncated: dom.textTruncated },
        limitations: [
          'No DOM markup, body text, form values, request paths, query strings, headers, bodies, cookies, or credentials are retained.',
          'Structure digest covers bounded preorder tag sequences, not nesting, attributes, or exact DOM equality. The legacy visibleText field hashes bounded body text nodes, including CSS-hidden or non-rendered text; it is not a visibility claim.',
        ],
      } : null;
      const domBytes = domDigest ? Buffer.from(`${JSON.stringify(domDigest, null, 2)}\n`) : null;
      domArtifactBytes += domBytes?.length ?? 0;
      if (domArtifactBytes > MAX_WEB_CAPTURE_DOM_DIGEST_BYTES) throw new Error('Selected DOM digests exceed the aggregate 1 MiB artefact bound.');
      const screenshotName = captureArtifactName(index, 'screenshot');
      const domName = captureArtifactName(index, 'dom_digest');
      files.push({ name: screenshotName, bytes: screenshotBuffer });
      if (domBytes) files.push({ name: domName, bytes: domBytes });
      const limitations = [
        ...(unavailableMainFrame ? ['The final main frame became unavailable after a blocked or failed navigation. The screenshot shows the resulting browser state, not the admitted target page; no final origin, title, DOM digest or page-element observations are claimed.'] : []),
        'Each admitted exact resource URL, including path and query, is disclosed to its operator. No dedicated path or query field is retained; the page title and screenshot can reproduce page-controlled content including them.',
        'Downloads, service workers, dedicated/shared workers, WebSockets, WebRTC, WebTransport, non-read methods, non-HTTP(S), credentials, non-default ports, private addresses, and traffic over declared bounds were blocked.',
        'Each request was resolved and connection-pinned by the shared safe-fetch transport before its bounded response was supplied to the disposable browser; cookies, authorisation headers, and request bodies were not forwarded.',
        'Direct browser connections were refused by a deny-only loopback proxy through browser shutdown; speculative DNS and direct QUIC were disabled. This does not replace operating-system isolation of untrusted browser code.',
        ...(blockedDirectConnections ? ['Additional direct browser connection attempts were refused; their destinations and content were not retained.'] : []),
        `Each response body was read up to ${MAX_CAPTURE_RESPONSE_BYTES} bytes and the collector processed at most ${MAX_CAPTURE_TRANSFER_BYTES} response-body bytes across the capture; lower-level transport buffering is outside this application-level bound.`,
        `Rendered DOM counts are capped at ${MAX_WEB_CAPTURE_DOM_ELEMENTS} and the body text-node sequence is hashed only through a valid UTF-8 boundary within ${MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES} bytes; reaching either bound leaves the capture partial.`,
        'The screenshot perceptual hash is an investigative similarity signal and does not establish copying, ownership, intent, safety, or maliciousness.',
      ];
    return {
        domain: canonicalUrlHost(target),
        capturedAt,
        conditions: readCaptureConditions({ browser: 'chromium', browserVersion, viewport: VIEWPORT,
          deviceScaleFactor: 1, locale: 'en-US', timezone: 'UTC', colourScheme: 'light' }),
        ...(observerLabel ? { observerLabel } : {}), ...(vantageLabel ? { vantageLabel } : {}),
        completeness: pageBehaviour.state === 'partial' ? 'partial' : 'complete',
        limitations,
        page: { title: title || null, finalOrigin: finalUrl?.origin.toLowerCase() ?? null },
        pageBehaviour,
        requestDomains: sealedBoundary.requestHosts,
        technologies: [],
        artifacts: [{
          kind: 'screenshot', fileName: screenshotName, mimeType: 'image/png',
          sha256: sha256(screenshotBuffer), perceptualHash: screenshotInspection.perceptualHash,
          bytes: screenshotBuffer.length, width: VIEWPORT.width, height: VIEWPORT.height,
        }, ...(domBytes ? [{
          kind: 'dom_digest', fileName: domName, mimeType: 'application/json',
          sha256: sha256(domBytes), bytes: domBytes.length,
        }] : [])],
      };
    });
    const navigation = targets.length > 1 ? { version: 1 as const, profile: 'selected_url_navigation' as const,
      steps, directConnectionRefusals: Math.min(1_000_000, blockedDirectConnections), totals: requestBoundary.totals() } : undefined;
    if (navigation) readCaptureNavigation(navigation, WEB_CAPTURE_MANIFEST_VERSION, captures);
    const manifest = {
      schema: WEB_CAPTURE_MANIFEST_SCHEMA, schemaVersion: WEB_CAPTURE_MANIFEST_VERSION,
      source: { name: 'WHOISleuth local rendered capture', reference: null, collectedAt: captures.at(-1)!.capturedAt },
      captures, ...(navigation ? { navigation } : {}),
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    if (manifestBytes.length > MAX_WEB_CAPTURE_MANIFEST_BYTES) {
      throw new Error(`Rendered capture manifest exceeds the ${MAX_WEB_CAPTURE_MANIFEST_BYTES}-byte limit.`);
    }
    // The manifest is the final commit marker. A reserved directory without it
    // is never a completed capture, and the destination is never replaced.
    for (const file of files) await writeArtifact(file.name, file.bytes);
    await writeArtifact('manifest.json', manifestBytes);
    await deadline.run(assertPublishedDirectoryIdentity(targetDirectory, reservation));
    if (anchoredWriter) {
      await deadline.run(anchoredWriter.finish(false));
      anchoredWriter = null;
    }
    deadline.clear();
    return manifest;
  } catch (error) {
    await Promise.allSettled([...pendingArtifactWrites]);
    if (anchoredWriter) {
      await anchoredWriter.finish(true).catch(() => anchoredWriter?.terminate());
      anchoredWriter = null;
    }
    try {
      const current = await lstat(targetDirectory);
      if (sameArtifactIdentity(current, reservation)) {
        for (const [fileName, identity] of ownedArtifacts) {
          const filePath = path.join(targetDirectory, fileName);
          try {
            const currentFile = await lstat(filePath);
            if (currentFile.dev === identity.dev && currentFile.ino === identity.ino) await unlink(filePath);
          } catch {
            // An absent or replaced path is not owned cleanup work.
          }
        }
        await rmdir(targetDirectory).catch(() => {});
      }
    } catch {
      // The reserved directory may already be absent. Never clean a path whose
      // directory identity no longer matches this capture's reservation.
    }
    throw error;
  } finally {
    if (browser) {
      if (deadline.expired()) void browser.close().catch(() => {});
      else await deadline.run(browser.close()).catch(() => {});
    }
    deadline.clear();
  }
}
