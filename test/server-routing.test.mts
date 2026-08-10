import { readdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { join, relative, sep } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { HTTP_BASELINE_CONTENT_SECURITY_POLICY } from '../lib/security-headers.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { app, sendPrerenderedHtmlFile } = await import('../server.mts');
const {
  CANONICAL_TRAILING_SLASH_REDIRECTS,
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
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/u);
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
});
