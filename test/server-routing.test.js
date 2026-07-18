const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { app } = require('../server.mts');

const canonicalRouteRedirects = [
  ['/lookup/', '/lookup'],
  ['/discover/', '/discover'],
  ['/bulk/', '/bulk'],
  ['/monitor/', '/monitor'],
  ['/brands/', '/brands'],
  ['/privacy/', '/privacy'],
  ['/demo/', '/demo'],
  ['/login/', '/login'],
];

let server;
let origin;

before(async () => {
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('canonical route redirects', () => {
  test('redirect each allowlisted trailing-slash route to its fixed local path', async () => {
    for (const [sourcePath, canonicalPath] of canonicalRouteRedirects) {
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
  });
});
