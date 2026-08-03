import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import contactRouteHandler, {
  config,
  runContactRouteRequest,
} from '../netlify/functions/contact-route.mts';

describe('contact route function', () => {
  test('declares the public path and bounded edge rate limit', () => {
    assert.deepEqual(config, {
      path: '/api/contact-route',
      rateLimit: {
        windowLimit: 60,
        windowSize: 600,
        aggregateBy: ['ip', 'domain'],
      },
    });
  });

  test('returns a public fail-closed configuration without leaking environment values', async () => {
    const response = await runContactRouteRequest(new Request('https://example.test/api/contact-route'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.available, false);
    assert.equal(JSON.stringify(body).includes('@'), false);
  });

  test('requires same-origin POST and rejects fields outside the narrow contract', async () => {
    const crossSite = await runContactRouteRequest(new Request('https://example.test/api/contact-route', {
      method: 'POST',
      headers: {
        Host: 'example.test',
        Origin: 'https://other.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ category: 'privacy', token: 'token' }),
    }));
    assert.equal(crossSite.status, 403);

    const extraField = await runContactRouteRequest(new Request('https://example.test/api/contact-route', {
      method: 'POST',
      headers: {
        Host: 'example.test',
        Origin: 'https://example.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ category: 'privacy', token: 'token', message: 'must stay local' }),
    }));
    assert.equal(extraField.status, 400);
  });

  test('sanitizes unsupported methods and unexpected errors', async () => {
    const method = await contactRouteHandler(new Request('https://example.test/api/contact-route', {
      method: 'PUT',
    }));
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('allow'), 'GET, POST');
  });
});
