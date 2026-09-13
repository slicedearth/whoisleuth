import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import express from 'express';
import { startLocalApplication, type LocalApplicationInstance } from '../lib/local-application-host.mts';
import { LOCAL_WORKSPACE_FILE } from '../lib/local-application-store.mts';
import { PRERENDERED_ROUTES } from '../lib/prerendered-routes.mts';
import { BrowserLocalDataProvider } from '../frontend/src/lib/browser-local-data.ts';
import { BROWSER_LOCAL_COLLECTIONS, CASES_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import { createLocalApplicationStorage } from '../frontend/src/lib/local-application-storage.ts';
import { currentCaseFixture } from './support/current-case.mts';
import { COOKIE_NAME, isValidSessionToken, parseCookies } from '../lib/auth.mts';
import { API_RATE_LIMIT, LOGIN_RATE_LIMIT } from '../lib/rate-limit.mts';

async function fixture(run: (value: {
  workspace: string; buildDirectory: string; application: ReturnType<typeof express>; calls: () => number;
}) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-application-test-'));
  const buildDirectory = path.join(root, 'build'), workspace = path.join(root, 'workspace');
  await mkdir(buildDirectory);
  for (const route of PRERENDERED_ROUTES) {
    const filename = path.join(buildDirectory, route === '/' ? 'index.html' : `${route.slice(1)}.html`);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, '<!doctype html><html lang="en"><head><title>Local fixture</title></head><body>Fixture</body></html>');
  }
  let calls = 0;
  const application = express();
  application.get('/api/capabilities', (_request, response) => response.json({ fixture: true }));
  application.post('/api/fixture-collection', (request, response) => {
    calls++; response.json({ fixture: true, authenticated: isValidSessionToken(parseCookies(request.headers.cookie)[COOKIE_NAME]) });
  });
  application.get('/asset.js', (_request, response) => response.type('js').send('export const fixture=true;'));
  try { await run({ workspace, buildDirectory, application, calls: () => calls }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function session(instance: LocalApplicationInstance) {
  const response = await fetch(`${instance.origin}/api/local-session`, { method: 'POST', headers: {
    Origin: instance.origin, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ token: new URL(instance.launchUrl).hash.slice(1) }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/u); assert.match(cookie, /SameSite=Lax/u);
  return cookie.split(';')[0]!;
}

function authenticatedFetch(instance: LocalApplicationInstance, cookie: string): typeof fetch {
  return (input, init) => {
    assert.equal(new URL(String(input)).origin, instance.origin, 'fixture transport must stay on its owned loopback origin');
    const headers = new Headers(init?.headers);
    headers.set('Origin', instance.origin); headers.set('Cookie', cookie);
    return fetch(input, { ...init, headers });
  };
}

function provider(instance: LocalApplicationInstance, fetchImpl: typeof fetch) {
  return new BrowserLocalDataProvider({ storageAdapter: createLocalApplicationStorage(instance.origin, instance.workspaceId, fetchImpl), timeoutMs: 60_000 });
}

test('local admission bounds authentication before parsing and keeps launch attempts separate', async context => fixture(async options => {
  const now = Date.now();
  context.mock.method(Date, 'now', () => now);
  const instance = await startLocalApplication({ ...options, create: true, offline: true });
  try {
    const cookie = await session(instance);
    for (let index = 0; index < API_RATE_LIMIT.limit; index++) {
      const response = await fetch(`${instance.origin}/api/session`, { headers: { Origin: instance.origin } });
      assert.equal(response.status, 200); await response.arrayBuffer();
    }
    const denied = await authenticatedFetch(instance, cookie)(`${instance.origin}/api/local-workspace/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: 'not a transaction',
    });
    assert.equal(denied.status, 429);
    assert.equal(Number(denied.headers.get('retry-after')), API_RATE_LIMIT.windowMs / 1000);
    assert.equal((await denied.json()).committed, false);
    assert.equal(options.calls(), 0);
    // Storage/session traffic cannot consume the separate launch-link bucket.
    await session(instance);
    for (let index = 2; index < LOGIN_RATE_LIMIT.limit; index++) {
      const response = await fetch(`${instance.origin}/api/local-session`, { method: 'POST',
        headers: { Origin: instance.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: '0'.repeat(64) }) });
      assert.equal(response.status, 401); await response.arrayBuffer();
    }
    const launchDenied = await fetch(`${instance.origin}/api/local-session`, { method: 'POST',
      headers: { Origin: instance.origin, 'Content-Type': 'application/json' }, body: 'not JSON' });
    assert.equal(launchDenied.status, 429);
    assert.equal(Number(launchDenied.headers.get('retry-after')), LOGIN_RATE_LIMIT.windowMs / 1000);
    assert.equal((await launchDenied.json()).committed, false);
  } finally { await instance.close(); }
}));

test('local host binds only loopback, authenticates storage, confines origins and leaves collection offline', async () => fixture(async options => {
  const previous = process.env.SESSION_SECRET;
  const instance = await startLocalApplication({ ...options, create: true, offline: true });
  try {
    assert.match(instance.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.equal(new URL(instance.launchUrl).search, '');
    const page = await fetch(`${instance.origin}/dashboard`);
    assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    const html = await page.text();
    assert.match(html, /name="whoisleuth-local-application" content="1"/u);
    assert.ok(html.includes(instance.workspaceId)); assert.ok(!html.includes(instance.directory));
    for (const route of ['/index.html', '/dashboard.html', '/login.html']) {
      const response = await fetch(`${instance.origin}${route}`, { redirect: 'manual' });
      assert.equal(response.status, 308);
    }
    for (const route of ['/missing.html', '/%64ashboard']) assert.ok((await fetch(`${instance.origin}${route}`)).status >= 400);
    for (const headers of [
      { Origin: 'https://outside.example' }, { Host: 'outside.example' }, { 'X-Forwarded-Host': 'outside.example' },
      { Forwarded: 'host=outside.example' }, { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(`${instance.origin}/dashboard`, { headers }, response => {
          response.resume(); response.on('end', () => resolve(response.statusCode!));
        });
        request.on('error', reject); request.end();
      });
      assert.equal(status, 403, JSON.stringify(headers));
    }
    const duplicateHost = await new Promise<number>(resolve => {
      const request = httpRequest(`${instance.origin}/dashboard`, { headers: ['Host', new URL(instance.origin).host, 'Host', new URL(instance.origin).host] }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode!));
      }); request.end();
    });
    assert.equal(duplicateHost, 403);
    assert.equal((await fetch(`${instance.origin}/api/local-workspace/info`, { headers: { Origin: instance.origin } })).status, 401);
    assert.equal((await fetch(`${instance.origin}/api/local-session`, { method: 'POST', headers: { Origin: instance.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: '0'.repeat(64) }) })).status, 401);
    const cookie = await session(instance), send = authenticatedFetch(instance, cookie);
    assert.equal((await send(`${instance.origin}/api/session`)).status, 200);
    const info = await (await send(`${instance.origin}/api/local-workspace/info`)).json();
    assert.equal(info.workspaceId, instance.workspaceId); assert.equal(info.directory, instance.directory);
    assert.equal(info.encryptedAtRest, false); assert.equal(info.offline, true);
    assert.equal((await send(`${instance.origin}/api/fixture-collection`, { method: 'POST' })).status, 503);
    assert.equal(options.calls(), 0);
    const capabilities = await send(`${instance.origin}/api/capabilities`);
    assert.equal(capabilities.status, 200);
    const report = await capabilities.json();
    assert.equal(report.features.find((item: { id: string }) => item.id === 'lookup').status, 'disabled');
    assert.equal(report.features.find((item: { id: string }) => item.id === 'domain_posture').status, 'disabled');
    assert.match(report.features.find((item: { id: string }) => item.id === 'lookup').reason, /offline/u);
    assert.equal((await send(`${instance.origin}/api/local-workspace/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"collections":["cases"]}' })).status, 409);
    assert.equal((await send(`${instance.origin}/api/local-workspace/capture`, { method: 'POST', headers: { 'X-Workspace-Id': instance.workspaceId, 'Content-Type': 'application/json' }, body: ' '.repeat(16_385) })).status, 413);
    const compressed = await send(`${instance.origin}/api/local-workspace/commit`, { method: 'POST', headers: { 'X-Workspace-Id': instance.workspaceId, 'Content-Type': 'application/zip', 'Content-Encoding': 'gzip' }, body: 'invalid' });
    assert.equal(compressed.status, 400);
    assert.equal((await send(`${instance.origin}/api/logout`, { method: 'POST' })).status, 200);
    const loggedOut = await fetch(`${instance.origin}/api/session`, { headers: { Origin: instance.origin } });
    assert.deepEqual(await loggedOut.json(), { authenticated: false });
  } finally { await instance.close(); }
  assert.equal(process.env.SESSION_SECRET, previous);
}));

test('online mode preserves the existing authenticated collection boundary without accepting a hosting password', async () => fixture(async options => {
  const instance = await startLocalApplication({ ...options, create: true });
  try {
    assert.equal((await fetch(`${instance.origin}/api/fixture-collection`, { method: 'POST', headers: { Origin: instance.origin } })).status, 401);
    assert.equal(options.calls(), 0);
    const send = authenticatedFetch(instance, await session(instance));
    const result = await send(`${instance.origin}/api/fixture-collection`, { method: 'POST' });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { fixture: true, authenticated: true });
    assert.equal(options.calls(), 1);
    assert.equal((await send(`${instance.origin}/api/login`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await (await send(`${instance.origin}/api/local-workspace/info`)).json()).offline, false);
  } finally { await instance.close(); }
}));

test('the HTTP storage adapter survives a process restart without reading browser storage', async () => fixture(async options => {
  let instance = await startLocalApplication({ ...options, create: true, offline: true });
  const captures: string[][] = [];
  const transport = async () => {
    const send = authenticatedFetch(instance, await session(instance));
    return ((input, init) => {
      if (new URL(String(input)).pathname.endsWith('/capture')) captures.push(JSON.parse(String(init?.body)).collections);
      return send(input, init);
    }) satisfies typeof fetch;
  };
  let data = provider(instance, await transport());
  const saved = currentCaseFixture(), identity = instance.workspaceId;
  try {
    await data.initialize(BROWSER_LOCAL_COLLECTIONS);
    assert.deepEqual(captures, [BROWSER_LOCAL_COLLECTIONS.map(definition => definition.id)]);
    await data.update(CASES_COLLECTION, () => ({ document: [saved], result: null }));
    await data.close(); await instance.close();
    instance = await startLocalApplication({ ...options, offline: true });
    assert.equal(instance.workspaceId, identity);
    captures.length = 0;
    data = provider(instance, await transport());
    await data.initialize(BROWSER_LOCAL_COLLECTIONS);
    assert.deepEqual(captures, [BROWSER_LOCAL_COLLECTIONS.map(definition => definition.id)]);
    assert.deepEqual(await data.read(CASES_COLLECTION), [saved]);
  } finally { await data.close(); await instance.close(); }
}));

test('a lost acknowledgement uses its exact durable receipt without repeating the write', async () => fixture(async options => {
  const instance = await startLocalApplication({ ...options, create: true, offline: true });
  const send = authenticatedFetch(instance, await session(instance));
  let drop = false, writes = 0, receipts = 0;
  const transport: typeof fetch = async (input, init) => {
    const endpoint = new URL(String(input)).pathname;
    if (endpoint.endsWith('/commit')) writes++;
    if (endpoint.includes('/receipt/')) receipts++;
    const response = await send(input, init);
    if (drop && endpoint.endsWith('/commit')) { await response.body?.cancel(); throw new Error('Fixture connection closed after server response.'); }
    return response;
  };
  const data = provider(instance, transport);
  try {
    await data.initialize(BROWSER_LOCAL_COLLECTIONS); writes = 0; drop = true;
    await data.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null }));
    assert.equal(writes, 1); assert.equal(receipts, 1);
    assert.equal((await data.read(CASES_COLLECTION)).length, 1);
  } finally { await data.close(); await instance.close(); }
}));

test('unavailable acknowledgements and receipts block later mutations while preserving the committed record', async () => fixture(async options => {
  const instance = await startLocalApplication({ ...options, create: true, offline: true });
  const send = authenticatedFetch(instance, await session(instance));
  let drop = false, writes = 0;
  const data = provider(instance, async (input, init) => {
    const endpoint = new URL(String(input)).pathname;
    if (drop && endpoint.includes('/receipt/')) throw new Error('Fixture receipt unavailable.');
    const response = await send(input, init);
    if (endpoint.endsWith('/commit')) { writes++; if (drop) { await response.body?.cancel(); throw new Error('Fixture connection lost.'); } }
    return response;
  });
  try {
    await data.initialize(BROWSER_LOCAL_COLLECTIONS); writes = 0; drop = true;
    await assert.rejects(data.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null })), { code: 'LOCAL_DATA_COMMIT_UNKNOWN' });
    await assert.rejects(data.update(CASES_COLLECTION, () => { assert.fail('uncertain write must not invoke a second updater'); }), { code: 'LOCAL_DATA_COMMIT_UNKNOWN' });
    assert.equal(writes, 1);
    const fresh = provider(instance, send);
    try { await fresh.initialize(BROWSER_LOCAL_COLLECTIONS); assert.equal((await fresh.read(CASES_COLLECTION)).length, 1); }
    finally { await fresh.close(); }
  } finally { await data.close(); await instance.close(); }
}));

test('a confirmed rejection permits a deliberate retry and malformed acknowledgements never claim a failed write', async () => fixture(async options => {
  const instance = await startLocalApplication({ ...options, create: true, offline: true });
  const send = authenticatedFetch(instance, await session(instance));
  let mode: 'normal' | 'reject' | 'empty' = 'normal', writes = 0;
  const data = provider(instance, async (input, init) => {
    const isWrite = new URL(String(input)).pathname.endsWith('/commit');
    if (isWrite && mode === 'reject') return Response.json({ code: 'LOCAL_DATA_WRITE_FAILED', error: 'Fixture disk unavailable.', committed: false }, { status: 400 });
    const response = await send(input, init);
    if (isWrite) { writes++; if (mode === 'empty') { await response.body?.cancel(); return new Response(null); } }
    return response;
  });
  try {
    await data.initialize(BROWSER_LOCAL_COLLECTIONS); writes = 0; mode = 'reject';
    await assert.rejects(data.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null })), { code: 'LOCAL_DATA_WRITE_FAILED' });
    assert.equal(writes, 0); assert.deepEqual(await data.read(CASES_COLLECTION), []);
    mode = 'empty';
    await data.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null }));
    assert.equal(writes, 1); assert.equal((await data.read(CASES_COLLECTION)).length, 1);
  } finally { await data.close(); await instance.close(); }
}));

test('worker startup failures preserve future database bytes and do not strand the host lifecycle', async () => fixture(async options => {
  const first = await startLocalApplication({ ...options, create: true, offline: true }); await first.close();
  const filename = path.join(options.workspace, LOCAL_WORKSPACE_FILE), database = new DatabaseSync(filename);
  database.exec('PRAGMA user_version=99'); database.close();
  const before = await readFile(filename);
  await assert.rejects(startLocalApplication({ ...options, offline: true }), { code: 'LOCAL_DATA_FUTURE_SCHEMA' });
  assert.deepEqual(await readFile(filename), before);
  const next = await startLocalApplication({ ...options, workspace: `${options.workspace}-fresh`, create: true, offline: true });
  await next.close();
}));
