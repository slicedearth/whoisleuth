import { readdirSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { join, relative, sep } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { HTTP_BASELINE_CONTENT_SECURITY_POLICY } from '../lib/security-headers.mts';
import { checkPrerenderedHtmlRateLimit, getClientIp, PRERENDERED_HTML_RATE_LIMIT } from '../lib/rate-limit.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { app, sendPrerenderedHtmlFile, notFoundPageHandler } = await import('../server.mts');
const {
  CANONICAL_TRAILING_SLASH_REDIRECTS,
  PERMANENT_ROUTE_REDIRECTS,
  PRERENDERED_HTML_FILE_OVERRIDES,
  PRERENDERED_ROUTES,
} = await import('../lib/prerendered-routes.mts');
const {
  PUBLIC_RESOURCE_ROUTES,
} = await import('../lib/public-resource-routes.mts');

function routeSourcePages(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...routeSourcePages(filename));
    else if (entry.name === '+page.svelte') files.push(filename);
  }
  return files;
}

function publicRouteForPage(filename: string): string {
  const routeDirectory = relative(join(process.cwd(), 'frontend', 'src', 'routes'), join(filename, '..'));
  const segments = routeDirectory
    .split(sep)
    .filter((segment) => segment && !(segment.startsWith('(') && segment.endsWith(')')));
  return segments.length ? `/${segments.join('/')}` : '/';
}

let server: Server | null = null;
let origin = '';

before(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
});

describe('canonical route redirects', () => {
  test('shared manifest covers every prerendered page source', () => {
    const sourceRoutes = routeSourcePages(join(process.cwd(), 'frontend', 'src', 'routes'))
      .flatMap((filename): string[] => {
        const route = publicRouteForPage(filename);
        return route === '/resources/[slug]' ? [...PUBLIC_RESOURCE_ROUTES] : [route];
      })
      .sort();
    assert.deepEqual([...PRERENDERED_ROUTES].sort(), sourceRoutes);
  });

  test('declares the fixed prerendered file for the public resource hub', () => {
    assert.deepEqual(PRERENDERED_HTML_FILE_OVERRIDES, [['/resources', 'resources.html']]);
  });

  test('redirects the legacy Guide route to the consolidated Resources hub', async () => {
    assert.deepEqual(PERMANENT_ROUTE_REDIRECTS, [
      ['/guide', '/resources'],
      ['/guide/', '/resources'],
    ]);

    for (const sourcePath of ['/guide', '/guide/']) {
      const response = await fetch(`${origin}${sourcePath}?ignored=1`, { redirect: 'manual' });
      assert.equal(response.status, 308, sourcePath);
      assert.equal(response.headers.get('location'), '/resources', sourcePath);
    }
  });

  test('redirect each allowlisted trailing-slash route to its fixed local path', async () => {
    for (const [sourcePath, canonicalPath] of CANONICAL_TRAILING_SLASH_REDIRECTS) {
      const response = await fetch(`${origin}${sourcePath}?next=https%3A%2F%2Foutside.example`, {
        redirect: 'manual',
      });

      assert.equal(response.status, 308, sourcePath);
      assert.equal(response.headers.get('location'), canonicalPath, sourcePath);
    }
  });

  test('does not redirect an unlisted trailing-slash path', async () => {
    const response = await fetch(`${origin}/outside/`, { redirect: 'manual' });

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('content-security-policy'), HTTP_BASELINE_CONTENT_SECURITY_POLICY);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.doesNotMatch(await response.text(), /outside/u);
  });

  test('unknown API endpoints return bounded JSON without reflecting the requested address', async () => {
    for (const method of ['GET', 'POST', 'HEAD']) {
      const response = await fetch(`${origin}/api/missing-private-path?token=private-query`, { method });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('content-type') ?? '', /^application\/json/u);
      if (method === 'HEAD') assert.equal(await response.text(), '');
      else assert.deepEqual(await response.json(), { error: 'Endpoint not found', errorCode: 'NOT_FOUND' });
    }
  });

  test('serves only the fixed missing-page artefact and retains status with or without a build', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'missing-page-'));
    const filename = join(directory, '404.html');
    await writeFile(filename, '<!doctype html><title>Page not found</title><a href="/">Home</a>');
    const isolatedApp = express().use(notFoundPageHandler(filename));
    const listener = await new Promise<Server>(resolve => {
      const value = isolatedApp.listen(0, '127.0.0.1', () => resolve(value));
    });
    try {
      const address = listener.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}/missing?private=query`;
      const found = await fetch(url);
      assert.equal(found.status, 404);
      assert.equal(await found.text(), '<!doctype html><title>Page not found</title><a href="/">Home</a>');
      const head = await fetch(url, { method: 'HEAD' });
      assert.equal(head.status, 404);
      assert.equal(await head.text(), '');
      await rm(filename);
      const missing = await fetch(url);
      assert.equal(missing.status, 404);
      assert.equal(await missing.text(), 'Not found\n');
    } finally {
      await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('falls through without exposing a missing prerendered file path', async () => {
    const missingFile = '/definitely-missing/whoisleuth/resources.html';
    const isolatedApp = express();
    isolatedApp.get('/resources', (_request, response, next) => {
      sendPrerenderedHtmlFile(missingFile, response, next);
    });

    const isolatedServer = await new Promise<Server>((resolve, reject) => {
      const listener = isolatedApp.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });

    try {
      const address = isolatedServer.address();
      assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/resources`);
      const body = await response.text();

      assert.equal(response.status, 404);
      assert.doesNotMatch(body, /ENOENT/u);
      assert.equal(body.includes(missingFile), false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        isolatedServer.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  test('applies the shared response policy at an application boundary', async () => {
    const response = await fetch(`${origin}/api/session`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-security-policy'), HTTP_BASELINE_CONTENT_SECURITY_POLICY);
  });

  test('missing pages enforce the shared HTML admission boundary before their file handler', async (t) => {
    const now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const identity = getClientIp({}, '127.0.0.1');
    const admitted = await fetch(`${origin}/first-missing-page`);
    assert.equal(admitted.status, 404);
    await admitted.text();

    // Fill the actual shared bucket without hundreds of redundant HTTP calls.
    for (let index = 0; index < PRERENDERED_HTML_RATE_LIMIT.limit; index += 1) {
      checkPrerenderedHtmlRateLimit(identity);
    }
    const refused = await fetch(`${origin}/another-missing-page`);
    assert.equal(refused.status, 429);
    assert.equal((await refused.json()).errorCode, 'RATE_LIMITED');
    assert.ok(Number(refused.headers.get('retry-after')) > 0);
    assert.doesNotMatch(refused.headers.get('content-type') ?? '', /text\/html/u);

    const session = await fetch(`${origin}/api/session`);
    assert.equal(session.status, 200, 'HTML capacity must not consume the independent API boundary');
    await session.text();
  });
});
