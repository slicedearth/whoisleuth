#!/usr/bin/env node

import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readTextCapped, safeFetchDetailed } from '../lib/safe-fetch.mts';

type CheckStatus = 'pass' | 'fail' | 'unsupported' | 'inconclusive';
type SelfCheckId =
  | 'public_homepage'
  | 'anonymous_session'
  | 'protected_workspace_redirect'
  | 'login_failure'
  | 'direct_login_function'
  | 'capability_protection'
  | 'scheduled_monitor_management'
  | 'security_headers'
  | 'sensitive_cache_control'
  | 'scheduled_monitor_posture';
type SelfCheckResult = Readonly<{
  id: SelfCheckId;
  label: string;
  status: CheckStatus;
  detail: string;
  remediation?: string;
}>;
type ProbeId =
  | 'homepage'
  | 'session'
  | 'workspace'
  | 'login'
  | 'direct_login'
  | 'capabilities'
  | 'scheduled_monitor';
type ProbeDefinition = Readonly<{
  id: ProbeId;
  path: string;
  method: 'GET' | 'POST';
  body?: string;
}>;
type ProbeObservation = Readonly<{
  id: ProbeId;
  status: number | null;
  headers: Readonly<Record<string, string>>;
  body: string;
  truncated: boolean;
  redirects: number;
  error: string | null;
}>;
type FetchOnce = (url: string, init: RequestInit) => Promise<Response>;
type SelfCheckOptions = Readonly<{
  fetchOnce?: FetchOnce;
  now?: () => Date;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
}>;

const DEPLOYMENT_SELF_CHECK_SCHEMA = 'whoisleuth.deployment-self-check';
const DEPLOYMENT_SELF_CHECK_VERSION = 1;
const MAX_DEPLOYMENT_ORIGIN_LENGTH = 2048;
const MAX_SELF_CHECK_REQUESTS = 10;
const MAX_SELF_CHECK_REDIRECTS = 1;
const MAX_SELF_CHECK_RESPONSE_BYTES = 64 * 1024;
const SELF_CHECK_REQUEST_TIMEOUT_MS = 5000;
const SELF_CHECK_TOTAL_TIMEOUT_MS = 20_000;
const MAX_SELF_CHECK_DETAIL_LENGTH = 320;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
});

const PROBES: readonly ProbeDefinition[] = Object.freeze([
  { id: 'homepage', path: '/', method: 'GET' },
  { id: 'session', path: '/api/session', method: 'GET' },
  { id: 'workspace', path: '/monitor', method: 'GET' },
  {
    id: 'login',
    path: '/api/login',
    method: 'POST',
    body: JSON.stringify({ password: null }),
  },
  { id: 'direct_login', path: '/.netlify/functions/login', method: 'GET' },
  { id: 'capabilities', path: '/api/capabilities', method: 'GET' },
  { id: 'scheduled_monitor', path: '/api/scheduled-monitor', method: 'GET' },
]);

function boundedText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim() : '';
  return (text || fallback).slice(0, MAX_SELF_CHECK_DETAIL_LENGTH);
}

function normalizeDeploymentOrigin(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_DEPLOYMENT_ORIGIN_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Provide one bounded HTTPS deployment origin, for example https://console.example.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError('The deployment origin must be a valid absolute HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') throw new TypeError('The deployment self-check accepts HTTPS origins only.');
  if (parsed.username || parsed.password) throw new TypeError('The deployment origin must not contain credentials.');
  const unwrappedHostname = parsed.hostname.replace(/^\[|\]$/gu, '');
  if (!parsed.hostname || isIP(unwrappedHostname)) throw new TypeError('The deployment origin must use a hostname, not an IP literal.');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TypeError('The deployment origin must not contain a path, query string, or fragment.');
  }
  return parsed.origin;
}

function boundedTimeout(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function headersRecord(headers: Headers): Readonly<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const [name, value] of headers.entries()) output[name.toLowerCase()] = value;
  return Object.freeze(output);
}

function sameOriginRedirect(origin: string, currentUrl: string, location: string): string | null {
  try {
    const next = new URL(location, currentUrl);
    if (next.origin !== origin || next.username || next.password || next.search || next.hash) return null;
    return next.toString();
  } catch {
    return null;
  }
}

async function defaultFetchOnce(url: string, init: RequestInit): Promise<Response> {
  const result = await safeFetchDetailed(url, init, { maxRedirects: 0 });
  return result.response;
}

async function collectProbe(
  origin: string,
  definition: ProbeDefinition,
  context: {
    fetchOnce: FetchOnce;
    requestTimeoutMs: number;
    totalDeadline: number;
    requestCount: { value: number };
  },
): Promise<ProbeObservation> {
  let currentUrl = new URL(definition.path, origin).toString();
  let redirects = 0;
  while (true) {
    if (context.requestCount.value >= MAX_SELF_CHECK_REQUESTS) {
      return { id: definition.id, status: null, headers: {}, body: '', truncated: false, redirects, error: 'The fixed request limit was reached.' };
    }
    const remainingMs = context.totalDeadline - Date.now();
    if (remainingMs <= 0) {
      return { id: definition.id, status: null, headers: {}, body: '', truncated: false, redirects, error: 'The total self-check deadline was reached.' };
    }
    context.requestCount.value += 1;
    const controller = new AbortController();
    const timeoutMs = Math.min(context.requestTimeoutMs, remainingMs);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await context.fetchOnce(currentUrl, {
        method: definition.method,
        headers: definition.method === 'POST'
          ? { 'Content-Type': 'application/json', Origin: origin }
          : { Accept: definition.id === 'homepage' || definition.id === 'workspace' ? 'text/html' : 'application/json' },
        ...(definition.body ? { body: definition.body } : {}),
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = response.headers.get('location');
      if (definition.method === 'GET' && REDIRECT_STATUSES.has(response.status) && location && redirects < MAX_SELF_CHECK_REDIRECTS) {
        const nextUrl = sameOriginRedirect(origin, currentUrl, location);
        if (!nextUrl) {
          await response.body?.cancel().catch(() => {});
          return {
            id: definition.id,
            status: response.status,
            headers: headersRecord(response.headers),
            body: '',
            truncated: false,
            redirects,
            error: 'A redirect left the configured deployment origin or was malformed.',
          };
        }
        await response.body?.cancel().catch(() => {});
        currentUrl = nextUrl;
        redirects += 1;
        continue;
      }
      const captured = await readTextCapped(response, MAX_SELF_CHECK_RESPONSE_BYTES);
      return {
        id: definition.id,
        status: response.status,
        headers: headersRecord(response.headers),
        body: captured.text,
        truncated: captured.truncated,
        redirects,
        error: null,
      };
    } catch (error) {
      return {
        id: definition.id,
        status: null,
        headers: {},
        body: '',
        truncated: false,
        redirects,
        error: boundedText(error instanceof Error ? error.message : error, 'The request failed.'),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJsonObject(observation: ProbeObservation): Record<string, unknown> | null {
  if (observation.truncated || !observation.body) return null;
  try {
    const parsed: unknown = JSON.parse(observation.body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function check(
  id: SelfCheckId,
  label: string,
  status: CheckStatus,
  detail: string,
  remediation?: string,
): SelfCheckResult {
  return Object.freeze({
    id,
    label,
    status,
    detail: boundedText(detail, 'No detail was available.'),
    ...(remediation ? { remediation: boundedText(remediation, 'Review the deployment configuration.') } : {}),
  });
}

function unavailableCheck(id: SelfCheckId, label: string, observation: ProbeObservation): SelfCheckResult | null {
  if (!observation.error && !observation.truncated) return null;
  return check(
    id,
    label,
    'inconclusive',
    observation.error || 'The response exceeded the fixed 64 KiB inspection limit.',
    'Run the check again after confirming deployment reachability; do not interpret this as a pass or failure.',
  );
}

function evaluatePublicHomepage(observation: ProbeObservation): SelfCheckResult {
  const unavailable = unavailableCheck('public_homepage', 'Public homepage', observation);
  if (unavailable) return unavailable;
  const contentType = observation.headers['content-type'] || '';
  const valid = observation.status === 200 && /^text\/html\b/iu.test(contentType) && /WHOISleuth/iu.test(observation.body);
  return valid
    ? check('public_homepage', 'Public homepage', 'pass', 'The public overview returned bounded HTML without authentication.')
    : check('public_homepage', 'Public homepage', 'fail', `Expected WHOISleuth HTML with HTTP 200; received HTTP ${observation.status ?? 'unknown'}.`, 'Confirm the custom domain, publish directory, and public route configuration.');
}

function evaluateAnonymousSession(observation: ProbeObservation): SelfCheckResult {
  const unavailable = unavailableCheck('anonymous_session', 'Anonymous session state', observation);
  if (unavailable) return unavailable;
  const body = parseJsonObject(observation);
  const valid = observation.status === 200 && body?.authenticated === false;
  return valid
    ? check('anonymous_session', 'Anonymous session state', 'pass', 'The session endpoint reported an unauthenticated state without issuing a session.')
    : check('anonymous_session', 'Anonymous session state', 'fail', `Expected authenticated=false with HTTP 200; received HTTP ${observation.status ?? 'unknown'}.`, 'Check the canonical session redirect and function response contract.');
}

function evaluateProtectedWorkspace(observation: ProbeObservation): SelfCheckResult {
  const unavailable = unavailableCheck('protected_workspace_redirect', 'Protected workspace redirect', observation);
  if (unavailable) return unavailable;
  if (observation.status && observation.status >= 300 && observation.status < 400) {
    return check('protected_workspace_redirect', 'Protected workspace redirect', 'pass', 'The protected workspace redirected before rendering.');
  }
  if (observation.status === 200 && /noindex\s*,?\s*nofollow/iu.test(observation.body)) {
    return check(
      'protected_workspace_redirect',
      'Protected workspace redirect',
      'inconclusive',
      'The prerendered workspace shell is non-indexable; its session check and redirect require a browser to execute.',
      'Run the existing browser smoke test to confirm anonymous navigation lands on sign-in.',
    );
  }
  return check('protected_workspace_redirect', 'Protected workspace redirect', 'fail', `The workspace returned unexpected HTTP ${observation.status ?? 'unknown'} content.`, 'Confirm the protected layout still checks /api/session before showing console content.');
}

function evaluateLoginFailure(observation: ProbeObservation): SelfCheckResult {
  const unavailable = unavailableCheck('login_failure', 'Login failure contract', observation);
  if (unavailable) return unavailable;
  const body = parseJsonObject(observation);
  const valid = observation.status === 401
    && body?.error === 'Incorrect password'
    && !observation.headers['set-cookie'];
  return valid
    ? check('login_failure', 'Login failure contract', 'pass', 'A fixed invalid credential value returned bounded JSON without setting a session cookie.')
    : check('login_failure', 'Login failure contract', 'fail', `Expected an HTTP 401 JSON failure without Set-Cookie; received HTTP ${observation.status ?? 'unknown'}.`, 'Review the login origin guard, password check, and failure response.');
}

function evaluateDirectLogin(observation: ProbeObservation): SelfCheckResult {
  const unavailable = unavailableCheck('direct_login_function', 'Direct login-function path', observation);
  if (unavailable) return unavailable;
  return observation.status === 404
    ? check('direct_login_function', 'Direct login-function path', 'pass', 'The provider default login-function path was not published.')
    : check('direct_login_function', 'Direct login-function path', 'fail', `Expected HTTP 404 from the provider default path; received HTTP ${observation.status ?? 'unknown'}.`, 'Confirm the login function keeps its custom /api/login path and the deployment applied it.');
}

function evaluateProtectedApi(
  observation: ProbeObservation,
  id: 'capability_protection' | 'scheduled_monitor_management',
  label: string,
): SelfCheckResult {
  const unavailable = unavailableCheck(id, label, observation);
  if (unavailable) return unavailable;
  const body = parseJsonObject(observation);
  const valid = observation.status === 401 && body?.error === 'Authentication required';
  return valid
    ? check(id, label, 'pass', 'The endpoint rejected an anonymous request with bounded JSON.')
    : check(id, label, 'fail', `Expected an HTTP 401 authentication boundary; received HTTP ${observation.status ?? 'unknown'}.`, 'Confirm the canonical function redirect and function-level authentication guard.');
}

function normalizedHeader(value: string | undefined): string {
  return (value || '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function evaluateSecurityHeaders(observations: readonly ProbeObservation[]): SelfCheckResult {
  const requiredIds: readonly ProbeId[] = ['homepage', 'session', 'login', 'capabilities', 'scheduled_monitor'];
  const unavailable = requiredIds.filter((id) => observations.find((item) => item.id === id)?.error);
  if (unavailable.length) {
    return check('security_headers', 'Security response headers', 'inconclusive', `Could not inspect all fixed responses: ${unavailable.join(', ')}.`, 'Repeat the check when every fixed endpoint is reachable.');
  }
  const missing: string[] = [];
  for (const id of requiredIds) {
    const observation = observations.find((item) => item.id === id);
    if (!observation) {
      missing.push(`${id}:response`);
      continue;
    }
    for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
      if (normalizedHeader(observation.headers[name]) !== normalizedHeader(expected)) missing.push(`${id}:${name}`);
    }
    const hstsMaxAge = /(?:^|;)\s*max-age=(\d+)/iu.exec(observation.headers['strict-transport-security'] || '');
    if (!hstsMaxAge || Number(hstsMaxAge[1]) < 31_536_000) missing.push(`${id}:strict-transport-security`);
  }
  return missing.length === 0
    ? check('security_headers', 'Security response headers', 'pass', 'Public and authentication-boundary responses carried the expected browser security headers.')
    : check('security_headers', 'Security response headers', 'fail', `Missing or unexpected headers: ${missing.join(', ')}.`, 'Set the shared function headers and static edge headers before exposing the deployment broadly.');
}

function evaluateCacheControl(observations: readonly ProbeObservation[]): SelfCheckResult {
  const requiredIds: readonly ProbeId[] = ['session', 'login', 'capabilities', 'scheduled_monitor'];
  const unavailable = requiredIds.filter((id) => observations.find((item) => item.id === id)?.error);
  if (unavailable.length) {
    return check('sensitive_cache_control', 'Sensitive response caching', 'inconclusive', `Could not inspect all fixed API responses: ${unavailable.join(', ')}.`, 'Repeat the check when every fixed endpoint is reachable.');
  }
  const missing = requiredIds.filter((id) => {
    const value = observations.find((item) => item.id === id)?.headers['cache-control'] || '';
    return !value.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store');
  });
  return missing.length === 0
    ? check('sensitive_cache_control', 'Sensitive response caching', 'pass', 'Session, login, capability, and hosted-monitor responses explicitly used no-store.')
    : check('sensitive_cache_control', 'Sensitive response caching', 'fail', `Cache-Control no-store was absent from: ${missing.join(', ')}.`, 'Set no-store in the application response helper instead of relying on edge defaults.');
}

function evaluateObservations(observations: readonly ProbeObservation[]): readonly SelfCheckResult[] {
  const byId = (id: ProbeId) => observations.find((item) => item.id === id)
    || { id, status: null, headers: {}, body: '', truncated: false, redirects: 0, error: 'The fixed probe did not run.' } as ProbeObservation;
  return Object.freeze([
    evaluatePublicHomepage(byId('homepage')),
    evaluateAnonymousSession(byId('session')),
    evaluateProtectedWorkspace(byId('workspace')),
    evaluateLoginFailure(byId('login')),
    evaluateDirectLogin(byId('direct_login')),
    evaluateProtectedApi(byId('capabilities'), 'capability_protection', 'Capability endpoint protection'),
    evaluateProtectedApi(byId('scheduled_monitor'), 'scheduled_monitor_management', 'Scheduled-monitor management protection'),
    evaluateSecurityHeaders(observations),
    evaluateCacheControl(observations),
    check(
      'scheduled_monitor_posture',
      'Scheduled-monitor configuration posture',
      'unsupported',
      'Detailed capability posture is intentionally unavailable without an authenticated session.',
      'Inspect the capability card after sign-in; credentialed deployment checks remain a separate workflow.',
    ),
  ]);
}

function countStatuses(checks: readonly SelfCheckResult[]): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = { pass: 0, fail: 0, unsupported: 0, inconclusive: 0 };
  for (const item of checks) counts[item.status] += 1;
  return counts;
}

async function runDeploymentSelfCheck(value: unknown, options: SelfCheckOptions = {}) {
  const origin = normalizeDeploymentOrigin(value);
  const now = options.now || (() => new Date());
  const requestTimeoutMs = boundedTimeout(options.requestTimeoutMs, SELF_CHECK_REQUEST_TIMEOUT_MS, SELF_CHECK_REQUEST_TIMEOUT_MS);
  const totalTimeoutMs = boundedTimeout(options.totalTimeoutMs, SELF_CHECK_TOTAL_TIMEOUT_MS, SELF_CHECK_TOTAL_TIMEOUT_MS);
  const startedAt = Date.now();
  const requestCount = { value: 0 };
  const observations: ProbeObservation[] = [];
  for (const definition of PROBES) {
    observations.push(await collectProbe(origin, definition, {
      fetchOnce: options.fetchOnce || defaultFetchOnce,
      requestTimeoutMs,
      totalDeadline: startedAt + totalTimeoutMs,
      requestCount,
    }));
  }
  const checks = evaluateObservations(observations);
  return Object.freeze({
    schema: DEPLOYMENT_SELF_CHECK_SCHEMA,
    version: DEPLOYMENT_SELF_CHECK_VERSION,
    generatedAt: now().toISOString(),
    origin,
    summary: Object.freeze(countStatuses(checks)),
    bounds: Object.freeze({
      requestLimit: MAX_SELF_CHECK_REQUESTS,
      requestCount: requestCount.value,
      redirectLimit: MAX_SELF_CHECK_REDIRECTS,
      responseByteLimit: MAX_SELF_CHECK_RESPONSE_BYTES,
      requestTimeoutMs,
      totalTimeoutMs,
    }),
    checks,
  });
}

function formatDeploymentSelfCheck(report: Awaited<ReturnType<typeof runDeploymentSelfCheck>>): string {
  const lines = [
    'WHOISleuth deployment self-check',
    `Origin: ${report.origin}`,
    `Summary: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.inconclusive} inconclusive, ${report.summary.unsupported} unsupported`,
    '',
  ];
  for (const item of report.checks) {
    lines.push(`${item.status.toUpperCase().padEnd(12)} ${item.label}`);
    lines.push(`  ${item.detail}`);
    if (item.remediation) lines.push(`  Next: ${item.remediation}`);
  }
  lines.push('', `Requests: ${report.bounds.requestCount}/${report.bounds.requestLimit}; response cap: ${report.bounds.responseByteLimit} bytes`);
  return `${lines.join('\n')}\n`;
}

function parseArguments(args: readonly string[]): { origin: string; json: boolean } {
  let origin: string | null = null;
  let json = false;
  for (const arg of args) {
    if (arg === '--json') {
      if (json) throw new TypeError('--json may be supplied only once.');
      json = true;
    } else if (arg.startsWith('-')) {
      throw new TypeError(`Unknown option: ${arg}`);
    } else if (origin) {
      throw new TypeError('Provide exactly one deployment origin.');
    } else {
      origin = arg;
    }
  }
  if (!origin) throw new TypeError('Usage: npm run deployment:self-check -- https://console.example [--json]');
  return { origin, json };
}

async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArguments(args);
    const report = await runDeploymentSelfCheck(parsed.origin);
    process.stdout.write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatDeploymentSelfCheck(report));
    return report.summary.fail > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${boundedText(error instanceof Error ? error.message : error, 'Deployment self-check failed.')}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export {
  DEPLOYMENT_SELF_CHECK_SCHEMA,
  DEPLOYMENT_SELF_CHECK_VERSION,
  MAX_DEPLOYMENT_ORIGIN_LENGTH,
  MAX_SELF_CHECK_DETAIL_LENGTH,
  MAX_SELF_CHECK_REDIRECTS,
  MAX_SELF_CHECK_REQUESTS,
  MAX_SELF_CHECK_RESPONSE_BYTES,
  SELF_CHECK_REQUEST_TIMEOUT_MS,
  SELF_CHECK_TOTAL_TIMEOUT_MS,
  evaluateObservations,
  formatDeploymentSelfCheck,
  main,
  normalizeDeploymentOrigin,
  parseArguments,
  runDeploymentSelfCheck,
};
export type { CheckStatus, FetchOnce, ProbeObservation, SelfCheckOptions, SelfCheckResult };
