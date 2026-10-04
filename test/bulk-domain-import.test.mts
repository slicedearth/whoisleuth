import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BulkDomainImport } from '../frontend/src/lib/controllers/bulk-domain-import.ts';
import { deferred } from './deferred.mts';

test('domain imports belong to the submitted draft and cannot replace edits, admission or disposal', async () => {
  for (const invalidation of ['edit', 'admission', 'dispose'] as const) {
    const held = deferred<string>();
    const published: { input?: string; status: string }[] = [];
    const controller = new BulkDomainImport(value => published.push(value));
    const importing = controller.import({ name: 'first.txt', size: 20, text: () => held.promise });
    if (invalidation === 'dispose') controller.dispose();
    else controller.changed();
    held.resolve('first.example');
    await importing;
    assert.deepEqual(published, []);
  }
});

test('only the newest domain import may publish success or failure', async () => {
  for (const olderFails of [false, true]) {
    const first = deferred<string>();
    const second = deferred<string>();
    const published: { input?: string; status: string }[] = [];
    const controller = new BulkDomainImport(value => published.push(value));
    const a = controller.import({ name: 'first.txt', size: 20, text: () => first.promise });
    const b = controller.import({ name: 'second.txt', size: 20, text: () => second.promise });
    second.resolve('second.example');
    await b;
    if (olderFails) first.reject(new Error('obsolete failure'));
    else first.resolve('first.example');
    await a;
    assert.equal(published.length, 1);
    assert.equal(published[0]?.input, 'second.example');
    assert.match(published[0]!.status, /second.txt/u);
  }
});

test('domain import bounds apply before reading and parser admission is unchanged', async () => {
  const published: { input?: string; status: string }[] = [];
  const controller = new BulkDomainImport(value => published.push(value));
  await controller.import({ name: 'large.txt', size: 2 * 1024 * 1024 + 1, text: async () => assert.fail('oversized file must not be read') });
  assert.match(published[0]!.status, /limited to 2 MB/u);
  await controller.import({ name: 'domains.csv', size: 40, text: async () => 'domain\nfirst.example\nfirst.example\nsecond.example' });
  assert.equal(published[1]?.input, 'first.example\nsecond.example');
  assert.match(published[1]!.status, /using its domain column.*removed 1 duplicate/u);
});
