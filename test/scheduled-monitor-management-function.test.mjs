import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildSessionCookie, createSessionToken } from '../lib/auth.mts';
import {
  ENABLE_ENV,
  KEY_ENV,
  NAMESPACE_ENV,
  SCHEDULED_MONITOR_STORE_NAME,
} from '../lib/scheduled-monitor-configuration.mts';
import { MANAGEMENT_ERROR_CODES } from '../lib/scheduled-monitor-management.mts';
import { SCHEDULED_MONITOR_UNAVAILABLE_CODE } from '../lib/scheduled-monitor-runtime.mts';
import scheduledMonitorManagementHandler, * as scheduledMonitorManagementModule from '../netlify/functions/scheduled-monitor-management.mts';
import {
  MAX_SCHEDULED_MONITOR_MANAGEMENT_BODY_BYTES,
  readRequestBodyCapped,
  runScheduledMonitorManagementFunction,
  runScheduledMonitorManagementRequest,
} from '../netlify/functions/scheduled-monitor-management.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'scheduled-management-test-password';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'scheduled-management-test-session-secret';

const NOW = '2026-07-16T12:00:00.000Z';
const key = randomBytes(32).toString('base64');
const namespace = 'whoisleuth:scheduled-monitor:management-function-test';

function readyEnv() {
  return {
    [ENABLE_ENV]: '1',
    [KEY_ENV]: key,
    [NAMESPACE_ENV]: namespace,
  };
}

function authenticatedHeaders(overrides = {}) {
  const cookie = buildSessionCookie(createSessionToken()).split(';')[0];
  return {
    cookie,
    origin: 'https://console.example',
    host: 'console.example',
    ...overrides,
  };
}

function event(httpMethod = 'GET', body = null, headers = authenticatedHeaders()) {
  return { httpMethod, body, headers };
}

function fixtureEntry(domains = ['alpha.invalid']) {
  return {
    updatedAt: NOW,
    results: domains.map((domain) => ({
      domain,
      scanDepth: 'fast',
      availability: 'registered',
      mutationTypes: [],
    })),
    baseline: [],
    history: [],
  };
}

class FakeBlobStore {
  entry = null;
  reads = 0;
  writes = 0;

  async getWithMetadata() {
    this.reads += 1;
    return this.entry;
  }

  async set(_key, value, options) {
    this.writes += 1;
    const current = this.entry?.etag || null;
    if ((options.onlyIfNew === true && current !== null)
      || (options.onlyIfMatch !== undefined && options.onlyIfMatch !== current)) {
      return { modified: false };
    }
    const etag = `"v${this.writes}"`;
    this.entry = { data: value, etag, metadata: {} };
    return { modified: true, etag };
  }
}

test('exports only the modern Fetch handler as the deployment boundary', () => {
  assert.equal(typeof scheduledMonitorManagementHandler, 'function');
  assert.equal(Object.hasOwn(scheduledMonitorManagementModule, 'handler'), false);
});

test('the canonical API route maps only to the authenticated management function', async () => {
  const config = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.match(config, /from = "\/api\/scheduled-monitor"\s+to = "\/\.netlify\/functions\/scheduled-monitor-management"/u);
  assert.doesNotMatch(config, /from = "\/api\/scheduled-monitor"\s+to = "\/\.netlify\/functions\/scheduled-monitor"/u);
});

test('rejects unsupported methods, missing authentication, and cross-site mutations before Blob construction', async () => {
  let constructions = 0;
  const options = {
    env: readyEnv(),
    blobStoreFactory: () => { constructions += 1; return new FakeBlobStore(); },
  };
  const method = await runScheduledMonitorManagementFunction(event('DELETE'), options);
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.Allow, 'GET, POST');

  const unauthenticated = await runScheduledMonitorManagementFunction(event('GET', null, {}), options);
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.parse(unauthenticated.body).errorCode, 'AUTH_REQUIRED');

  const crossSite = await runScheduledMonitorManagementFunction(event(
    'POST',
    JSON.stringify({ action: 'delete', id: 'watchlist-00000001' }),
    authenticatedHeaders({ origin: 'https://other.example' }),
  ), options);
  assert.equal(crossSite.statusCode, 403);
  assert.equal(JSON.parse(crossSite.body).errorCode, 'CROSS_SITE_REQUEST_BLOCKED');
  assert.equal(constructions, 0);
});

test('disabled configuration fails closed without constructing or reading a Blob store', async () => {
  let constructions = 0;
  const response = await runScheduledMonitorManagementFunction(event(), {
    env: {},
    blobStoreFactory: () => { constructions += 1; return new FakeBlobStore(); },
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(body.errorCode, SCHEDULED_MONITOR_UNAVAILABLE_CODE);
  assert.match(body.error, /not enabled/i);
  assert.equal(constructions, 0);
});

test('the web boundary rejects non-published and missing deploy provenance before Blob construction', async () => {
  let constructions = 0;
  const options = {
    env: readyEnv(),
    blobStoreFactory: () => { constructions += 1; return new FakeBlobStore(); },
  };
  for (const context of [{ deploy: { context: 'deploy-preview', published: false } }, {}]) {
    const response = await runScheduledMonitorManagementRequest(new Request(
      'https://console.example/api/scheduled-monitor',
      { headers: authenticatedHeaders() },
    ), context, options);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).errorCode, SCHEDULED_MONITOR_UNAVAILABLE_CODE);
  }
  assert.equal(constructions, 0);
});

test('the published web boundary preserves authenticated management behavior', async () => {
  let constructions = 0;
  const response = await runScheduledMonitorManagementRequest(new Request(
    'https://console.example/api/scheduled-monitor',
    { headers: authenticatedHeaders() },
  ), { deploy: { context: 'production', published: true } }, {
    env: readyEnv(),
    blobStoreFactory: () => { constructions += 1; return new FakeBlobStore(); },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await response.json()).state.watchlists, []);
  assert.equal(constructions, 1);
});

test('the web boundary caps declared and streamed request bodies before Blob construction', async () => {
  const declared = await runScheduledMonitorManagementRequest(new Request(
    'https://console.example/api/scheduled-monitor',
    {
      method: 'POST',
      headers: authenticatedHeaders({
        'content-length': String(MAX_SCHEDULED_MONITOR_MANAGEMENT_BODY_BYTES + 1),
      }),
      body: '{}',
    },
  ), { deploy: { published: true } }, {
    env: readyEnv(),
    blobStoreFactory: () => { throw new Error('Blob construction must not occur'); },
  });
  assert.equal(declared.status, 413);

  const chunk = new Uint8Array(600 * 1024);
  const streamed = await readRequestBodyCapped(new Request(
    'https://console.example/api/scheduled-monitor',
    {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: 'half',
    },
  ));
  assert.equal(streamed.status, 'too_large');
});

test('invalid and oversized bodies fail before Blob construction', async () => {
  let constructions = 0;
  const options = {
    env: readyEnv(),
    blobStoreFactory: () => { constructions += 1; return new FakeBlobStore(); },
  };
  const malformed = await runScheduledMonitorManagementFunction(event('POST', '{'), options);
  assert.equal(malformed.statusCode, 400);
  assert.equal(JSON.parse(malformed.body).errorCode, MANAGEMENT_ERROR_CODES.INVALID_REQUEST);

  const oversized = await runScheduledMonitorManagementFunction(event(
    'POST',
    'x'.repeat(MAX_SCHEDULED_MONITOR_MANAGEMENT_BODY_BYTES + 1),
  ), options);
  assert.equal(oversized.statusCode, 413);
  assert.equal(JSON.parse(oversized.body).errorCode, 'REQUEST_TOO_LARGE');
  assert.equal(constructions, 0);
});

test('creates, reads, pauses, resumes, replaces, and deletes through one encrypted store', async () => {
  const store = new FakeBlobStore();
  const names = [];
  let sequence = 0;
  const options = {
    env: readyEnv(),
    blobStoreFactory: (name) => { names.push(name); return store; },
    now: () => Date.parse(NOW),
    randomUUID: () => `generated-${String(++sequence).padStart(8, '0')}`,
  };
  const create = await runScheduledMonitorManagementFunction(event('POST', JSON.stringify({
    action: 'create',
    name: 'Priority domains',
    entry: fixtureEntry(),
    intervalHours: 24,
  })), options);
  const created = JSON.parse(create.body);
  assert.equal(create.statusCode, 200);
  assert.equal(create.headers['Cache-Control'], 'no-store');
  assert.equal(created.action, 'created');
  assert.equal(created.state.watchlists[0].domainCount, 1);
  assert.equal(store.entry.data.includes('alpha.invalid'), false);

  const id = created.id;
  for (const command of [
    { action: 'update', id, enabled: false },
    { action: 'update', id, enabled: true },
    { action: 'update', id, entry: fixtureEntry(['beta.invalid']) },
  ]) {
    const response = await runScheduledMonitorManagementFunction(
      event('POST', JSON.stringify(command)),
      options,
    );
    assert.equal(response.statusCode, 200);
  }

  const read = await runScheduledMonitorManagementFunction(event(), options);
  const current = JSON.parse(read.body);
  assert.equal(read.statusCode, 200);
  assert.equal(current.state.watchlists[0].entry.results[0].domain, 'beta.invalid');
  assert.equal(current.state.watchlists[0].enabled, true);
  assert.equal(current.capacity.projectedLookupsPerWeek, 7);

  const removed = await runScheduledMonitorManagementFunction(event('POST', JSON.stringify({
    action: 'delete', id,
  })), options);
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(JSON.parse(removed.body).state.watchlists, []);
  assert.ok(names.every((name) => name === SCHEDULED_MONITOR_STORE_NAME));
});

test('maps expected conflicts and hides unexpected storage failures', async () => {
  const store = new FakeBlobStore();
  const options = {
    env: readyEnv(),
    blobStoreFactory: () => store,
    now: () => Date.parse(NOW),
    randomUUID: () => 'generated-00000001',
  };
  const command = {
    action: 'create', name: 'Priority domains', entry: fixtureEntry(), intervalHours: 24,
  };
  assert.equal((await runScheduledMonitorManagementFunction(
    event('POST', JSON.stringify(command)), options,
  )).statusCode, 200);
  const duplicate = await runScheduledMonitorManagementFunction(
    event('POST', JSON.stringify(command)), options,
  );
  assert.equal(duplicate.statusCode, 409);
  assert.equal(JSON.parse(duplicate.body).errorCode, MANAGEMENT_ERROR_CODES.NAME_CONFLICT);

  const failed = await runScheduledMonitorManagementFunction(event(), {
    env: readyEnv(),
    blobStoreFactory: () => ({
      async getWithMetadata() { throw new Error('private provider detail'); },
      async set() { return { modified: false }; },
    }),
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.includes('private provider detail'), false);
  assert.equal(JSON.parse(failed.body).errorCode, SCHEDULED_MONITOR_UNAVAILABLE_CODE);
});

test('applies a dedicated authenticated-session rate ceiling before Blob work', async () => {
  const headers = authenticatedHeaders();
  let constructions = 0;
  let response;
  for (let index = 0; index < 61; index += 1) {
    response = await runScheduledMonitorManagementFunction(event('GET', null, headers), {
      env: {},
      blobStoreFactory: () => { constructions += 1; return new FakeBlobStore(); },
    });
    if (response.statusCode === 429) break;
  }
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.ok(Number(response.headers['Retry-After']) >= 1);
  assert.equal(JSON.parse(response.body).errorCode, 'RATE_LIMITED');
  assert.equal(constructions, 0);
});
