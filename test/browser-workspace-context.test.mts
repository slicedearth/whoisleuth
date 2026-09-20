import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  captureBrowserWorkspace, requireBrowserWorkspaceId, scopedWorkspaceStorage,
  clearProtectedBrowserWorkspaceSession, protectBrowserWorkspaceSession, workspaceSessionStorage,
} from '../frontend/src/lib/browser-workspace-context.ts';
import {
  browserWorkspaceDatabaseName, browserWorkspaceName, createBrowserWorkspaceDirectory, readBrowserWorkspace,
} from '../frontend/src/lib/browser-workspace-directory.ts';

const FIRST = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const ROW = Object.freeze({ id: FIRST, name: 'Investigation A', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', revision: 1, state: 'ready' });

test('a loaded page never retargets its captured workspace or retries an unreadable selection', () => {
  let selected: string | null = FIRST;
  const current = captureBrowserWorkspace(() => selected);
  assert.equal(current(), FIRST);
  selected = SECOND;
  assert.equal(current(), FIRST);
  assert.equal(captureBrowserWorkspace(() => selected)(), SECOND);
  assert.equal(captureBrowserWorkspace(() => null)(), 'default');
  let reads = 0;
  const unavailable = captureBrowserWorkspace(() => { reads++; if (reads === 1) throw new Error('denied'); return FIRST; });
  assert.throws(unavailable, /selection could not be read/);
  assert.throws(unavailable, /selection could not be read/);
  assert.equal(reads, 1);
  const invalid = captureBrowserWorkspace(() => 'unknown');
  assert.throws(invalid, /Choose a workspace explicitly/);
});

test('workspace keys preserve original defaults and separate identical named preference and session keys', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const original = scopedWorkspaceStorage(storage, 'default');
  const first = scopedWorkspaceStorage(storage, FIRST);
  const second = scopedWorkspaceStorage(storage, SECOND);
  original.setItem('guide', 'original'); first.setItem('guide', 'first'); second.setItem('guide', 'second');
  assert.equal(values.get('guide'), 'original');
  assert.deepEqual([original.getItem('guide'), first.getItem('guide'), second.getItem('guide')], ['original', 'first', 'second']);
  first.removeItem('guide');
  assert.deepEqual([original.getItem('guide'), first.getItem('guide'), second.getItem('guide')], ['original', null, 'second']);
  assert.throws(() => scopedWorkspaceStorage(storage, '../default'), /identity is invalid/);
});

test('only the explicit default or canonical random workspace identities select a namespace', () => {
  assert.equal(requireBrowserWorkspaceId('default'), 'default');
  assert.equal(requireBrowserWorkspaceId(FIRST), FIRST);
  assert.equal(browserWorkspaceDatabaseName(FIRST), `whoisleuth-workspace-${FIRST}-v1`);
  assert.throws(() => browserWorkspaceDatabaseName('default'), /existing database/);
  for (const invalid of [null, undefined, {}, 3, '', 'DEFAULT', '../default', '00000000-0000-1000-8000-000000000001', `${FIRST} `]) {
    assert.throws(() => requireBrowserWorkspaceId(invalid), /identity is invalid/);
  }
});

test('directory metadata is exact, bounded and copied rather than accepting unrecognised state', () => {
  assert.deepEqual(readBrowserWorkspace(ROW), ROW);
  assert.notEqual(readBrowserWorkspace(ROW), ROW);
  assert.ok(Object.isFrozen(readBrowserWorkspace(ROW)));
  assert.equal(readBrowserWorkspace({ ...ROW, state: 'deleting', revision: 2 }).state, 'deleting');
  assert.equal(browserWorkspaceName('  Review A  '), 'Review A');
  assert.equal(browserWorkspaceName('x'.repeat(100)), 'x'.repeat(100));
  for (const invalid of ['', ' ', 'x'.repeat(101), 'name\nline', 'name\u0000', 1, null]) assert.throws(() => browserWorkspaceName(invalid));
  for (const invalid of [null, [], { ...ROW, extra: true }, { ...ROW, name: ' padded ' }, { ...ROW, revision: 0 }, { ...ROW, revision: 1.5 }, { ...ROW, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...ROW, state: 'unknown' }, { ...ROW, createdAt: '2026-09-01' }, { ...ROW, updatedAt: '2026-08-01T00:00:00.000Z' }, { ...ROW, id: 'default' }]) {
    assert.throws(() => readBrowserWorkspace(invalid));
  }
});

test('unsupported capabilities and invalid operation deadlines fail before creating named data', async () => {
  for (const timeoutMs of [0, -1, 10_001, 1.5, NaN]) assert.throws(() => createBrowserWorkspaceDirectory({ timeoutMs }), /timeout/);
  const directory = createBrowserWorkspaceDirectory({ locks: null });
  assert.equal(directory.supported(), false);
  await assert.rejects(directory.create('Example'), /require browser Web Locks/);
  await assert.rejects(directory.list(), /IndexedDB is unavailable/);
  await assert.rejects(directory.ready('default'), /existing database/);
  await assert.rejects(directory.remove(readBrowserWorkspace(ROW), FIRST), /Switch away/);
});

test('encrypted workspace tab material stays in memory and is cleared when locking', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Encrypted transient state must not reach session storage.'); } });
  try {
    protectBrowserWorkspaceSession();
    const storage = workspaceSessionStorage();
    storage.setItem('fixture-handoff', 'private.example');
    assert.equal(storage.getItem('fixture-handoff'), 'private.example');
    clearProtectedBrowserWorkspaceSession();
    assert.equal(storage.getItem('fixture-handoff'), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
