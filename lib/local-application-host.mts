import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  buildClearCookie, buildSessionCookie, COOKIE_NAME, createSessionToken,
  isPermittedAuthenticatedNetworkRequest, isTrustedOrigin, isValidSessionToken, parseCookies,
} from './auth.mts';
import { readBoundedRegularFileWithin, decodeBoundedUtf8 } from './bounded-file.mts';
import { PRERENDERED_ROUTES } from './prerendered-routes.mts';
import { HTTP_BASELINE_CONTENT_SECURITY_POLICY } from './security-headers.mts';
import { LocalWorkspaceError } from './local-application-errors.mts';
import { LocalApplicationWorker } from './local-application-worker-client.mts';
import { capabilityReport } from './capabilities.mts';
import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';
import { createRateLimitChecker, API_RATE_LIMIT, LOGIN_RATE_LIMIT, type RateLimitChecker } from './rate-limit.mts';
import { exact, array, digest } from '../packages/evidence/artifact-structure.mts';
import { MAX_SELECTED_FILES } from '../packages/contracts/selected-file-limits.mts';
import {
  LOCAL_APPLICATION_PROTOCOL_VERSION, LOCAL_APPLICATION_MAX_TRANSFER_BYTES, LOCAL_APPLICATION_READ_REQUEST_BYTES,
  localApplicationCollections, localApplicationOperationId,
  parseLocalApplicationJson, type LocalApplicationStorageRequest,
} from '../packages/workspace/local-application-protocol.mts';

const MARKER = '<meta name="whoisleuth-local-application" content="1">';
const REQUEST_DEADLINE_MS = 60_000;
const MAX_WAITING_REQUESTS = 32;
let running = false;

function localError(cause: unknown, response: Response): void {
  if (response.headersSent || response.destroyed) return;
  const error = cause instanceof LocalWorkspaceError ? cause : new LocalWorkspaceError('INVALID_LOCAL_DATA', 'The local request failed validation. No transaction was saved.');
  const bodyTooLarge = cause instanceof Error && 'type' in cause && cause.type === 'entity.too.large';
  const status = bodyTooLarge ? 413 : error.code === 'LOCAL_DATA_CONFLICT' ? 409 : error.code === 'LOCAL_DATA_BUSY' ? 429
    : error.code === 'LOCAL_DATA_COMMIT_UNKNOWN' ? 503 : 400;
  response.status(status).json({ error: error.message, code: error.code, committed: error.code === 'LOCAL_DATA_COMMIT_UNKNOWN' ? 'unknown' : false });
}

function rateLimit(check: RateLimitChecker) {
  return (_request: Request, response: Response, next: NextFunction) => {
    // Origin admission has already restricted every request to this instance's
    // literal loopback address. No forwarded identity can create another bucket.
    const result = check('loopback');
    if (result.allowed) { next(); return; }
    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    localError(new LocalWorkspaceError('LOCAL_DATA_BUSY', 'Too many local requests. Wait before retrying; no transaction was accepted.'), response);
  };
}

/** Queue before body accumulation; one bounded storage response is active at a time. */
function storageAdmission() {
  let active = false;
  const waiting: Array<() => void> = [];
  return (request: Request, response: Response, next: NextFunction) => {
    if (waiting.length >= MAX_WAITING_REQUESTS) { localError(new LocalWorkspaceError('LOCAL_DATA_BUSY', 'The local workspace is busy. Retry after the current operation finishes.'), response); return; }
    let started = false, released = false;
    const timeout = setTimeout(() => response.destroy(), REQUEST_DEADLINE_MS);
    const release = () => {
      if (released) return;
      // Disconnecting a client does not cancel an already accepted write.
      // Keep its admission slot until the worker reports the outcome.
      if (started && response.locals.localStorageOperation) return;
      released = true; clearTimeout(timeout);
      response.off('finish', release); response.off('close', release);
      if (started) { active = false; waiting.shift()?.(); }
      else { const index = waiting.indexOf(start); if (index >= 0) waiting.splice(index, 1); }
    };
    response.locals.releaseLocalStorage = release;
    const start = () => {
      if (released || request.destroyed || response.destroyed) { waiting.shift()?.(); return; }
      active = true; started = true; next();
    };
    response.once('finish', release); response.once('close', release);
    if (active) waiting.push(start); else start();
  };
}

export type LocalApplicationInstance = Readonly<{
  origin: string; launchUrl: string; workspaceId: string; directory: string;
  close(): Promise<void>;
}>;

export async function startLocalApplication(options: Readonly<{
  workspace: string; buildDirectory: string; application: Express;
  create?: boolean; port?: number; offline?: boolean;
}>): Promise<LocalApplicationInstance> {
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError('Local port must be between 0 and 65535.');
  if (running) throw new Error('Only one local application may own session configuration in this process.');
  running = true;
  let worker: LocalApplicationWorker | undefined, server: Server | undefined;
  const sessionEnvironment = new Map(['SITE_PASSWORD', 'SESSION_SECRET', 'SESSION_MAX_AGE_DAYS'].map(key => [key, process.env[key]]));
  const restoreEnvironment = () => {
    for (const [key, value] of sessionEnvironment) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    running = false;
  };
  try {
    // Static routes derive from the existing owner. The fixed marker selects
    // the local adapter; hashes, scripts, CSP metadata and assets stay intact.
    const html = new Map<string, string>();
    for (const route of PRERENDERED_ROUTES) {
      const name = route === '/' ? 'index.html' : `${route.slice(1)}.html`;
      const source = decodeBoundedUtf8(await readBoundedRegularFileWithin(options.buildDirectory, name, { maximumBytes: 2 * 1024 * 1024, label: 'Application page' }));
      if (!source.includes('</head>') || source.includes(MARKER)) throw new TypeError('Application page is not an unmodified production build.');
      html.set(route, source.replace('</head>', `${MARKER}</head>`));
    }
    worker = new LocalApplicationWorker(options.workspace, options.create ?? false);
    const storage = worker, identity = await storage.ready;
    const perform = async (response: Response, request: LocalApplicationStorageRequest) => {
      response.locals.localStorageOperation = true;
      try { return await storage.request(request); }
      finally {
        response.locals.localStorageOperation = false;
        if (response.destroyed) response.locals.releaseLocalStorage?.();
      }
    };
    localApplicationOperationId(identity.workspaceId);
    for (const [route, content] of html) html.set(route, content.replace(MARKER, `${MARKER}<meta name="whoisleuth-local-workspace" content="${identity.workspaceId}">`));
    // This separate process never authenticates with a hosting password or
    // signing key inherited from its shell. Nothing is written to configuration.
    process.env.SITE_PASSWORD = randomBytes(32).toString('hex');
    process.env.SESSION_SECRET = randomBytes(32).toString('hex');
    process.env.SESSION_MAX_AGE_DAYS = '1';
    const launchToken = randomBytes(32).toString('hex');
    let origin = '', host = '', cookieName = '';
    const app = express(); app.disable('x-powered-by');
    app.use((request, response, next) => {
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY'); response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Robots-Tag', 'noindex, nofollow');
      response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      response.setHeader('Content-Security-Policy', HTTP_BASELINE_CONTENT_SECURITY_POLICY);
      const hostHeaders = request.rawHeaders.filter((_value, index, headers) => index % 2 === 0 && headers[index]?.toLowerCase() === 'host');
      if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.host !== host || hostHeaders.length !== 1
        || request.path.includes('%') || request.path.includes('\\') || request.path.split('/').some(part => part === '.' || part === '..')
        || Object.keys(request.headers).some(name => name.startsWith('x-forwarded-') || name === 'forwarded')
        || request.headers.origin !== undefined && request.headers.origin !== origin
        || request.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site']))) {
        response.status(403).json({ error: 'Local application origin check failed.' }); return;
      }
      next();
    });
    const sameOrigin = (request: Request, response: Response, next: NextFunction) => {
      if (!isPermittedAuthenticatedNetworkRequest(request.headers, { protocol: 'http' })) { response.status(403).json({ error: 'Same-origin local request required.' }); return; }
      next();
    };
    const authenticated = (request: Request, response: Response, next: NextFunction) => {
      if (!isValidSessionToken(parseCookies(request.headers.cookie)[cookieName])) { response.status(401).json({ error: 'Open the launch link from the running local application.' }); return; }
      next();
    };
    const sessionCookie = (value: string) => value.replace(`${COOKIE_NAME}=`, `${cookieName}=`);
    const launchRateLimit = rateLimit(createRateLimitChecker(LOGIN_RATE_LIMIT, 1));
    const apiRateLimit = rateLimit(createRateLimitChecker(API_RATE_LIMIT, 1));
    const smallBody = express.raw({ type: 'application/json', inflate: false, limit: LOCAL_APPLICATION_READ_REQUEST_BYTES });
    app.post('/api/local-session', launchRateLimit, sameOrigin, express.raw({ type: 'application/json', inflate: false, limit: 256 }), (request, response) => {
      try {
        if (!isTrustedOrigin(request.headers, { protocol: 'http' }) || !Buffer.isBuffer(request.body)) throw new TypeError('Invalid local session request.');
        const input = exact(parseLocalApplicationJson(request.body, 256), ['token'], 'Local session');
        if (typeof input.token !== 'string' || !/^[a-f0-9]{64}$/u.test(input.token) || !timingSafeEqual(Buffer.from(input.token), Buffer.from(launchToken))) { response.status(401).json({ error: 'Invalid launch link.' }); return; }
        response.setHeader('Set-Cookie', sessionCookie(buildSessionCookie(createSessionToken(), { secure: false }))); response.json({ ok: true });
      } catch (cause) { localError(cause, response); }
    });
    app.get('/api/session', apiRateLimit, sameOrigin, (request, response) => response.json({ authenticated: isValidSessionToken(parseCookies(request.headers.cookie)[cookieName]) }));
    app.use('/api', apiRateLimit, sameOrigin, authenticated);
    if (options.offline) app.get('/api/capabilities', (_request, response) => {
      const report = capabilityReport('express');
      const networked = new Set<string>(CAPABILITY_MANIFEST.capabilities.filter(item => item.networkMode !== 'none').map(item => item.id));
      response.json({ ...report, features: report.features.map(item => networked.has(item.id)
        ? { ...item, status: 'disabled', reason: 'Collection is disabled in this offline local application.' } : item) });
    });
    app.post('/api/login', (_request, response) => response.status(403).json({ error: 'Use this instance’s launch link; hosting passwords are not accepted.' }));
    app.post('/api/logout', (request, response) => {
      if (!isTrustedOrigin(request.headers, { protocol: 'http' })) { response.status(403).json({ error: 'Same-origin local request required.' }); return; }
      response.setHeader('Set-Cookie', sessionCookie(buildClearCookie({ secure: false }))); response.json({ ok: true });
    });
    app.get('/api/local-workspace/info', (_request, response) => response.json({ version: LOCAL_APPLICATION_PROTOCOL_VERSION,
      workspaceId: identity.workspaceId, directory: identity.directory, storage: 'filesystem', encryptedAtRest: false, offline: options.offline ?? false }));
    app.use('/api/local-workspace', (request, response, next) => {
      if (request.headers['x-workspace-id'] !== identity.workspaceId) { response.status(409).json({ error: 'The selected filesystem workspace changed. Reload before continuing.', code: 'LOCAL_DATA_WORKSPACE_CHANGED', committed: false }); return; }
      next();
    }, storageAdmission());
    for (const operation of ['manifests', 'capture'] as const) app.post(`/api/local-workspace/${operation}`, smallBody, async (request, response) => {
      try {
        if (!Buffer.isBuffer(request.body)) throw new TypeError('JSON body required.');
        const input = exact(parseLocalApplicationJson(request.body, LOCAL_APPLICATION_READ_REQUEST_BYTES), ['collections'], 'Workspace read');
        const value = await perform(response, { operation, collections: localApplicationCollections(input.collections) });
        if (operation === 'capture') {
          if (!(value instanceof Uint8Array)) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Invalid workspace capture response.');
          response.type('application/json').send(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        } else response.json((value as unknown[]).map(item => item ?? null));
      } catch (cause) { localError(cause, response); }
    });
    app.post('/api/local-workspace/files', smallBody, async (request, response) => {
      try {
        if (!Buffer.isBuffer(request.body)) throw new TypeError('JSON body required.');
        const input = exact(parseLocalApplicationJson(request.body, LOCAL_APPLICATION_READ_REQUEST_BYTES), ['collection', 'keys'], 'Workspace files');
        if (input.collection !== 'cases') throw new TypeError('Only Cases retain files.');
        const keys = array(input.keys, 'Selected files', MAX_SELECTED_FILES).map(key => { digest(key, 'Retained file key'); return key as string; });
        const files = await perform(response, { operation: 'files', collection: 'cases', keys });
        if (!(files instanceof Uint8Array)) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Invalid workspace file response.');
        response.type('application/zip').send(Buffer.from(files.buffer, files.byteOffset, files.byteLength));
      } catch (cause) { localError(cause, response); }
    });
    app.get('/api/local-workspace/receipt/:id', async (request, response) => {
      try { response.json({ operationId: localApplicationOperationId(request.params.id), digest: await perform(response, { operation: 'receipt', operationId: request.params.id as string }) }); }
      catch (cause) { localError(cause, response); }
    });
    app.post('/api/local-workspace/commit', express.raw({ type: 'application/zip', inflate: false, limit: LOCAL_APPLICATION_MAX_TRANSFER_BYTES }), async (request, response) => {
      let accepted = false;
      try {
        if (!Buffer.isBuffer(request.body)) throw new TypeError('A workspace transaction ZIP is required.');
        const bytes = Uint8Array.from(request.body); request.body = undefined;
        accepted = true;
        response.json(await perform(response, { operation: 'commit', bytes }));
      } catch (cause) {
        localError(accepted && !(cause instanceof LocalWorkspaceError)
          ? new LocalWorkspaceError('LOCAL_DATA_COMMIT_UNKNOWN', 'The workspace write outcome could not be confirmed. Review saved records before another change.') : cause, response);
      }
    });
    app.use('/api/local-workspace', (_request, response) => response.status(404).json({ error: 'Unknown local workspace operation.', code: 'INVALID_LOCAL_DATA', committed: false }));
    app.use('/api', (request, response, next) => {
      if (options.offline && request.path !== '/capabilities') { response.status(503).json({ error: 'This local instance is offline. Collection requests are disabled.', errorCode: 'LOCAL_APPLICATION_OFFLINE' }); return; }
      const token = parseCookies(request.headers.cookie)[cookieName];
      request.headers.cookie = `${COOKIE_NAME}=${encodeURIComponent(token ?? '')}`;
      next();
    });
    for (const [route, content] of html) {
      const alias = route === '/' ? '/index.html' : `${route}.html`;
      app.get(alias, (_request, response) => response.redirect(308, route));
      app.get(route, (_request, response) => response.type('html').send(content));
    }
    app.use((request, response, next) => { if (request.path.endsWith('.html')) { response.sendStatus(404); return; } next(); });
    app.get('/robots.txt', (_request, response) => response.type('text').send('User-agent: *\nDisallow: /\n'));
    app.use(options.application);
    app.use((cause: unknown, _request: Request, response: Response, _next: NextFunction) => localError(cause, response));
    server = createServer({ maxHeaderSize: 16_384, requestTimeout: REQUEST_DEADLINE_MS, headersTimeout: 10_000, keepAliveTimeout: 5_000 }, app);
    server.maxHeadersCount = 64; server.maxConnections = 64; server.maxRequestsPerSocket = 256;
    const boundServer = server;
    await new Promise<void>((resolve, reject) => { boundServer.once('error', reject); boundServer.listen(port, '127.0.0.1', () => { boundServer.off('error', reject); resolve(); }); });
    const address = boundServer.address();
    if (!address || typeof address === 'string') throw new Error('The local loopback address is unavailable.');
    host = `127.0.0.1:${address.port}`; origin = `http://${host}`; cookieName = `wrt_local_${address.port}`;
    let closing: Promise<void> | undefined;
    return { origin, launchUrl: `${origin}/login#${launchToken}`, ...identity,
      close() {
        closing ??= (async () => {
          const timeout = setTimeout(() => boundServer.closeAllConnections(), 5_000);
          try { await new Promise<void>((resolve, reject) => boundServer.close(error => error ? reject(error) : resolve())); }
          finally { clearTimeout(timeout); try { await storage.close(); } finally { restoreEnvironment(); } }
        })();
        return closing;
      },
    };
  } catch (cause) {
    server?.closeAllConnections(); server?.close();
    try { await worker?.close(); } catch { /* Preserve the original startup failure. */ }
    finally { restoreEnvironment(); }
    throw cause;
  }
}
