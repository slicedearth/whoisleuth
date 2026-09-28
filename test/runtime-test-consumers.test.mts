import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ICruiseResult } from 'dependency-cruiser';
import {
  describeRuntimeImportGaps,
  indexRuntimeConsumers,
} from '../tools/runtime-test-consumers.mts';

type TestModule = {
  source: string;
  dependencies: Array<{
    module: string;
    resolved: string;
    couldNotResolve?: boolean;
    typeOnly?: boolean;
    preCompilationOnly?: boolean;
  }>;
};
const graph = (modules: TestModule[]) => ({ modules }) as Pick<ICruiseResult, 'modules'>;
const edge = (resolved: string) => ({ module: resolved, resolved });

test('unresolved imports retain their consumers without selecting unrelated tests', () => {
  const index = indexRuntimeConsumers(
    graph([
      { source: 'test/direct.test.mts', dependencies: [edge('packages/changed.mts')] },
      { source: 'test/uncertain.test.mts', dependencies: [edge('packages/importer.mts')] },
      { source: 'test/transitive.test.mts', dependencies: [edge('test/uncertain.test.mts')] },
      { source: 'test/unrelated.test.mts', dependencies: [] },
      {
        source: 'packages/importer.mts',
        dependencies: [
          { module: './missing.mts', resolved: './missing.mts', couldNotResolve: true },
        ],
      },
      { source: 'packages/changed.mts', dependencies: [] },
    ]),
    100,
  );
  const inventory = [
    'test/direct.test.mts',
    'test/uncertain.test.mts',
    'test/transitive.test.mts',
    'test/unrelated.test.mts',
  ];
  const result = index.select(['packages/changed.mts', 'packages/another.mts'], inventory, false);
  assert.deepEqual(result.consumers.get('packages/changed.mts'), inventory.slice(0, 3));
  assert.deepEqual(result.consumers.get('packages/another.mts'), inventory.slice(1, 3));
  assert.deepEqual(result.uncertainConsumers, inventory.slice(1, 3));
  assert.deepEqual(index.unresolved, [
    { source: 'packages/importer.mts', specifier: './missing.mts' },
  ]);
  assert.deepEqual(result.fallbackPaths, []);
});

test('missing inventory roots and unresolved aliases remain conservative through cycles', () => {
  const index = indexRuntimeConsumers(
    graph([
      { source: 'test/cycle.test.mts', dependencies: [edge('packages/a.mts')] },
      { source: 'test/unrelated.test.mts', dependencies: [] },
      { source: 'packages/a.mts', dependencies: [edge('packages/b.mts')] },
      {
        source: 'packages/b.mts',
        dependencies: [
          edge('packages/a.mts'),
          { module: '$lib/unknown', resolved: '$lib/unknown', couldNotResolve: true },
        ],
      },
    ]),
    100,
  );
  const inventory = ['test/cycle.test.mts', 'test/unrelated.test.mts', 'test/missing.test.mts'];
  assert.deepEqual(
    index
      .select(['packages/anything.mts'], inventory, false)
      .consumers.get('packages/anything.mts'),
    [inventory[0], inventory[2]],
  );
  const fallback = index.select(['packages/unreferenced.mts'], inventory);
  assert.deepEqual(fallback.consumers.get('packages/unreferenced.mts'), inventory);
  assert.deepEqual(fallback.fallbackPaths, ['packages/unreferenced.mts']);
});

test('erased types and package imports do not create unknown local runtime edges', () => {
  const index = indexRuntimeConsumers(
    graph([
      { source: 'test/known.test.mts', dependencies: [edge('packages/changed.mts')] },
      {
        source: 'test/types.test.mts',
        dependencies: [
          { ...edge('./type.mts'), couldNotResolve: true, typeOnly: true },
          { ...edge('./generated.mts'), couldNotResolve: true, preCompilationOnly: true },
          { ...edge('node:fs'), couldNotResolve: true },
        ],
      },
    ]),
    100,
  );
  assert.deepEqual(index.unresolved, []);
  assert.deepEqual(
    index
      .select(['packages/changed.mts'], ['test/known.test.mts', 'test/types.test.mts'])
      .consumers.get('packages/changed.mts'),
    ['test/known.test.mts'],
  );
});

test('bounded graph failures and import diagnostics remain actionable without source content', () => {
  assert.throws(
    () => indexRuntimeConsumers(graph([{ source: 'a', dependencies: [] }]), 0),
    /inventory bound/u,
  );
  assert.equal(describeRuntimeImportGaps([]), '');
  const message = describeRuntimeImportGaps(
    Array.from({ length: 10 }, (_, i) => ({
      source: `source-${i}\n`,
      specifier: `./${'x'.repeat(400)}`,
    })),
  );
  assert.ok(message.includes('source-0? -> ./'));
  assert.ok(message.includes('2 further edges'));
  assert.ok(!message.includes('source-8'));
  assert.ok(!message.includes('\n'));
  assert.ok(message.length < 3000);
});
