import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BulkShortlistWorkspace } from '../frontend/src/lib/controllers/bulk-shortlist-workspace.ts';
import { fromBulkSessionResult } from '../frontend/src/lib/analysis/bulk-result-model.ts';
import { normalizeBulkSession } from '../packages/workspace/bulk-session-model.mts';
import { normalizeShortlistRecord } from '../packages/workspace/shortlist-model.mts';
import { createAnalystUndoDescriptor } from '../frontend/src/lib/analysis/analyst-undo.ts';
import { richBulkSessionStore } from './bulk-session-fixture.mts';

type Options = ConstructorParameters<typeof BulkShortlistWorkspace>[0];
type Storage = Awaited<ReturnType<Options['loadStorage']>>;
const row = fromBulkSessionResult(
  normalizeBulkSession(richBulkSessionStore(1).sessions[0])!.results[0]!,
);
const record = normalizeShortlistRecord(row.saved)!;
assert.ok(record);
function harness(overrides: Partial<Storage> = {}) {
  let publications = 0,
    loads = 0,
    confirmed = true,
    clears = 0,
    exports = 0;
  const selections: { rows: unknown[]; selected: boolean }[] = [];
  const undos: Parameters<Options['registerUndo']>[0][] = [];
  const imports: unknown[] = [];
  const storage: Storage = {
    loadShortlist: async () => {
      loads++;
      return [];
    },
    setShortlistSelection: async (rows, selected) => {
      selections.push({ rows, selected });
      return {
        records: selected ? [record] : [],
        added: selected ? 1 : 0,
        updated: 0,
        removed: selected ? 0 : 1,
        skipped: 0,
        undo: [{ domain: record.domain, previous: null, expected: record }],
      };
    },
    restoreShortlistSelection: async () => [],
    clearShortlist: async () => {
      clears++;
    },
    exportShortlist: async () => {
      exports++;
    },
    importShortlist: async (value) => {
      imports.push(value);
      return { added: 1, updated: 0, skipped: 0 };
    },
    MAX_SHORTLIST_IMPORT_BYTES: 2 * 1024 * 1024,
    ...overrides,
  };
  const options = {
    loadStorage: async () => storage,
    publish: () => {
      publications++;
    },
    confirm: () => confirmed,
    now: () => '2026-09-20T00:00:00.000Z',
    registerUndo: (input) => {
      undos.push(input);
      return { ...createAnalystUndoDescriptor(input), undo: input.undo };
    },
  } satisfies Options;
  const workspace = new BulkShortlistWorkspace(options);
  return {
    workspace,
    storage,
    options,
    selections,
    imports,
    undos,
    get loads() {
      return loads;
    },
    get publications() {
      return publications;
    },
    get clears() {
      return clears;
    },
    get exports() {
      return exports;
    },
    confirm(value: boolean) {
      confirmed = value;
    },
  };
}

test('shortlist loading is shared and a disposed view cannot publish a late read', async () => {
  const h = harness();
  let release!: (value: Storage) => void,
    imports = 0;
  h.options.loadStorage = () => {
    imports++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = h.workspace.ensureLoaded(),
    second = h.workspace.ensureLoaded();
  assert.equal(imports, 1);
  h.workspace.dispose();
  const publications = h.publications;
  release(h.storage);
  await Promise.all([first, second]);
  assert.equal(h.loads, 0);
  assert.equal(h.publications, publications);
  assert.equal(await h.workspace.select([row]), false);
});

test('selection and toggle retain typed result context and register conflict-aware undo', async () => {
  const h = harness();
  await h.workspace.toggle(row);
  assert.equal(h.selections[0]?.selected, true);
  assert.deepEqual(h.selections[0]?.rows, [
    {
      ...row.saved,
      riskScore: row.risk,
      opportunityScore: row.opportunity,
      savedAt: '2026-09-20T00:00:00.000Z',
    },
  ]);
  assert.match(h.workspace.state.status, /Added/);
  await h.workspace.toggle(row);
  assert.equal(h.selections[1]?.selected, false);
  assert.match(h.workspace.state.status, /Removed/);
  await h.workspace.select([row], false);
  assert.deepEqual(h.selections[2]?.rows, []);
  assert.equal(h.loads, 1);
  h.workspace.dispose();
  const publications = h.publications;
  assert.match(String(await h.undos[0]!.undo()), /Restored/);
  assert.equal(h.publications, publications);
  h.storage.restoreShortlistSelection = async () => {
    throw new Error('Concurrent change');
  };
  await assert.rejects(h.undos[1]!.undo(), /Concurrent change/);
});

test('unavailable context and rejected writes preserve the current list', async () => {
  const h = harness({
    loadShortlist: async () => {
      throw new Error('Unavailable');
    },
  });
  assert.equal(await h.workspace.select([row]), false);
  assert.equal(h.workspace.state.sourceState, 'unavailable');
  assert.equal(h.selections.length, 0);
  const failure = harness({
    loadShortlist: async () => [record],
    setShortlistSelection: async () => {
      throw new Error('Write conflict');
    },
  });
  assert.equal(await failure.workspace.select([row]), false);
  assert.deepEqual(failure.workspace.state.records, [record]);
  assert.equal(failure.workspace.state.status, 'Write conflict');
  assert.equal(failure.undos.length, 0);
});

test('partially admitted selections report skipped rows instead of complete success', async () => {
  const h = harness({
    setShortlistSelection: async () => ({
      records: [record],
      added: 0,
      updated: 1,
      removed: 0,
      skipped: 2,
      undo: [],
    }),
  });
  assert.equal(await h.workspace.select([row]), false);
  assert.match(h.workspace.state.status, /refreshed 1 existing domain; skipped 2/);
  assert.equal(h.undos.length, 0);
});

test('clear requires confirmation and export failures remain visible', async () => {
  const h = harness({ loadShortlist: async () => [record] });
  h.confirm(false);
  await h.workspace.clear();
  assert.equal(h.clears, 0);
  h.confirm(true);
  await h.workspace.clear();
  assert.equal(h.clears, 1);
  assert.deepEqual(h.workspace.state.records, []);
  await h.workspace.download();
  assert.equal(h.exports, 1);
  h.storage.exportShortlist = async () => {
    throw new Error('Download unavailable');
  };
  await h.workspace.download();
  assert.equal(h.workspace.state.status, 'Download unavailable');
});

test('imports enforce the byte limit before reading and retain the committed-versus-refresh distinction', async () => {
  const h = harness();
  await h.workspace.import({
    size: h.storage.MAX_SHORTLIST_IMPORT_BYTES + 1,
    text: async () => {
      assert.fail('Must not read oversized file');
    },
  });
  assert.equal(h.imports.length, 0);
  assert.match(h.workspace.state.status, /limited/);
  await h.workspace.import({ size: 2, text: async () => '{}' });
  assert.deepEqual(h.imports, [{}]);
  assert.match(h.workspace.state.status, /Imported 1 new/);
  await h.workspace.import({ size: 1, text: async () => '{' });
  assert.equal(h.imports.length, 1);
  h.storage.loadShortlist = async () => {
    throw new Error('Read failed');
  };
  await h.workspace.import({ size: 2, text: async () => '{}' });
  assert.equal(h.imports.length, 2);
  assert.equal(h.workspace.state.sourceState, 'unavailable');
  assert.match(h.workspace.state.status, /was saved.*do not import it again/);
  await h.workspace.import({ size: 2, text: async () => '{}' });
  assert.equal(h.imports.length, 2);
});
