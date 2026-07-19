import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEPLOYMENT_SELF_CHECK_SCHEMA,
  MAX_DEPLOYMENT_ORIGIN_LENGTH,
  MAX_SELF_CHECK_REQUESTS,
  formatDeploymentSelfCheck,
  normalizeDeploymentOrigin,
  parseArguments,
  runDeploymentSelfCheck,
} from '../tools/deployment-self-check.mts';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
};

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function html(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', ...headers },
  });
}

function healthyFetch(overrides = {}) {
  const calls = [];
  const responses = {
    '/': () => html(200, '<!doctype html><title>WHOISleuth</title><main>WHOISleuth</main>'),
    '/api/session': () => json(200, { authenticated: false }),
    '/monitor': () => html(200, '<meta name="robots" content="noindex, nofollow"><p>Opening console</p>'),
    '/api/login': () => json(401, { error: 'Incorrect password' }),
    '/.netlify/functions/login': () => html(404, '<h1>Page not found</h1>'),
    '/api/capabilities': () => json(401, { error: 'Authentication required' }),
    '/api/scheduled-monitor': () => json(401, { error: 'Authentication required' }),
    ...overrides,
  };
  return {
    calls,
    fetchOnce: async (url, init) => {
      const parsed = new URL(url);
      calls.push({ url, init });
      const response = responses[parsed.pathname];
      if (!response) throw new Error('Unexpected fixture request');
      return response(init);
    },
  };
}

describe('deployment origin validation', () => {
  test('accepts and canonicalizes one HTTPS hostname origin', () => {
    assert.equal(normalizeDeploymentOrigin(' https://Console.Example:443/ '), 'https://console.example');
    assert.deepEqual(parseArguments(['https://console.example', '--json']), { origin: 'https://console.example', json: true });
  });

  test('rejects non-HTTPS, credentials, IP literals, paths, queries, fragments, controls, and oversized values', () => {
    for (const value of [
      'http://console.example',
      'https://user:secret@console.example',
      'https://127.0.0.1',
      'https://[::1]',
      'https://console.example/lookup',
      'https://console.example?mode=test',
      'https://console.example/#fragment',
      'https://console.example\n',
      `https://${'x'.repeat(MAX_DEPLOYMENT_ORIGIN_LENGTH)}.example`,
    ]) assert.throws(() => normalizeDeploymentOrigin(value));
  });

  test('rejects missing, repeated, and unknown CLI arguments', () => {
    assert.throws(() => parseArguments([]), /Usage/);
    assert.throws(() => parseArguments(['https://one.example', 'https://two.example']), /exactly one/);
    assert.throws(() => parseArguments(['https://one.example', '--json', '--json']), /only once/);
    assert.throws(() => parseArguments(['https://one.example', '--verbose']), /Unknown option/);
  });
});

describe('deployment boundary report', () => {
  test('checks only fixed same-origin paths and keeps credentialed posture separate', async () => {
    const fixture = healthyFetch();
    const report = await runDeploymentSelfCheck('https://console.example', {
      fetchOnce: fixture.fetchOnce,
      now: () => new Date('2026-07-19T02:00:00.000Z'),
    });

    assert.equal(report.schema, DEPLOYMENT_SELF_CHECK_SCHEMA);
    assert.equal(report.version, 1);
    assert.equal(report.generatedAt, '2026-07-19T02:00:00.000Z');
    assert.deepEqual(report.summary, { pass: 8, fail: 0, unsupported: 1, inconclusive: 1 });
    assert.equal(report.bounds.requestCount, 7);
    assert.equal(report.bounds.requestLimit, MAX_SELF_CHECK_REQUESTS);
    assert.deepEqual(fixture.calls.map((call) => new URL(call.url).pathname), [
      '/', '/api/session', '/monitor', '/api/login', '/.netlify/functions/login', '/api/capabilities', '/api/scheduled-monitor',
    ]);
    assert.ok(fixture.calls.every((call) => new URL(call.url).origin === 'https://console.example'));

    const login = fixture.calls.find((call) => new URL(call.url).pathname === '/api/login');
    assert.equal(login.init.headers.Origin, 'https://console.example');
    assert.equal(JSON.parse(login.init.body).password, null);
    assert.equal(report.checks.find((item) => item.id === 'scheduled_monitor_posture').status, 'unsupported');
    assert.equal(report.checks.find((item) => item.id === 'protected_workspace_redirect').status, 'inconclusive');
    assert.equal(JSON.stringify(report).includes('"password":'), false);
    assert.equal(JSON.stringify(report).includes('/api/login'), false);
  });

  test('reports concrete header, cache, auth, and direct-path regressions as failures', async () => {
    const fixture = healthyFetch({
      '/api/session': () => json(200, { authenticated: true }, { 'Cache-Control': 'no-cache', 'X-Frame-Options': 'SAMEORIGIN' }),
      '/api/login': () => json(200, { ok: true }, { 'Set-Cookie': 'session=unexpected' }),
      '/.netlify/functions/login': () => json(405, { error: 'Method not allowed' }),
      '/api/capabilities': () => json(200, { version: 1, features: [] }),
      '/api/scheduled-monitor': () => json(200, { status: 'ready' }),
    });
    const report = await runDeploymentSelfCheck('https://console.example', { fetchOnce: fixture.fetchOnce });
    const failed = report.checks.filter((item) => item.status === 'fail').map((item) => item.id);
    assert.deepEqual(failed, [
      'anonymous_session',
      'login_failure',
      'direct_login_function',
      'capability_protection',
      'scheduled_monitor_management',
      'security_headers',
      'sensitive_cache_control',
    ]);
    assert.equal(report.summary.fail, 7);
  });

  test('keeps network failures, oversized responses, and browser-only redirects explicit and non-conclusive', async () => {
    const fixture = healthyFetch({
      '/': () => { throw new Error(`offline\n${'x'.repeat(1000)}`); },
      '/api/session': () => new Response('x'.repeat(70 * 1024), { status: 200, headers: SECURITY_HEADERS }),
      '/monitor': () => html(302, '', { Location: 'https://other.example/login' }),
    });
    const report = await runDeploymentSelfCheck('https://console.example', { fetchOnce: fixture.fetchOnce });
    assert.equal(report.checks.find((item) => item.id === 'public_homepage').status, 'inconclusive');
    assert.equal(report.checks.find((item) => item.id === 'anonymous_session').status, 'inconclusive');
    assert.equal(report.checks.find((item) => item.id === 'protected_workspace_redirect').status, 'inconclusive');
    assert.ok(report.checks.every((item) => item.detail.length <= 320));
    assert.equal(JSON.stringify(report).includes('x'.repeat(321)), false);
  });

  test('follows at most one same-origin GET redirect and never sends the login body elsewhere', async () => {
    const fixture = healthyFetch({
      '/': () => html(302, '', { Location: '/overview' }),
      '/overview': () => html(200, '<title>WHOISleuth</title>'),
    });
    const report = await runDeploymentSelfCheck('https://console.example', { fetchOnce: fixture.fetchOnce });
    assert.equal(report.checks.find((item) => item.id === 'public_homepage').status, 'pass');
    assert.equal(report.bounds.requestCount, 8);
    assert.equal(fixture.calls.filter((call) => call.init.method === 'POST').length, 1);
  });

  test('refuses redirected query strings without contacting the redirected target', async () => {
    const fixture = healthyFetch({
      '/': () => html(302, '', { Location: '/overview?source=redirect' }),
    });
    const report = await runDeploymentSelfCheck('https://console.example', { fetchOnce: fixture.fetchOnce });
    const homepage = report.checks.find((item) => item.id === 'public_homepage');
    assert.equal(homepage.status, 'inconclusive');
    assert.equal(fixture.calls.some((call) => new URL(call.url).search), false);
  });

  test('formats a stable redacted operator report', async () => {
    const fixture = healthyFetch();
    const report = await runDeploymentSelfCheck('https://console.example', { fetchOnce: fixture.fetchOnce });
    const output = formatDeploymentSelfCheck(report);
    assert.match(output, /^WHOISleuth deployment self-check/m);
    assert.match(output, /8 pass, 0 fail, 1 inconclusive, 1 unsupported/);
    assert.match(output, /PASS\s+Public homepage/);
    assert.match(output, /UNSUPPORTED\s+Scheduled-monitor configuration posture/);
    assert.doesNotMatch(output, /invalid-password/);
  });
});
