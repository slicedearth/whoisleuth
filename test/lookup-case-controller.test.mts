import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LookupCaseController,
  type LookupCaseApi,
} from '../frontend/src/lib/controllers/lookup-case-controller.ts';
import { createCase } from '../frontend/src/lib/analysis/case-model.ts';

function unused(): Promise<never> {
  throw new Error('Unused test dependency');
}

describe('Lookup case controller', () => {
  test('returns an empty result when there is no domain context', async () => {
    const api: LookupCaseApi = {
      getByDomain: unused,
      open: unused,
      addNote: unused,
      edit: unused,
    };
    const controller = new LookupCaseController(api);

    assert.deepEqual(await controller.refresh(''), {
      record: null,
      status: '',
    });
  });

  test('returns a clear status after browser-local case context loads', async () => {
    const api: LookupCaseApi = {
      getByDomain: async () => null,
      open: unused,
      addNote: unused,
      edit: unused,
    };
    const controller = new LookupCaseController(api);

    assert.deepEqual(await controller.refresh('case-context.example'), {
      record: null,
      status: '',
    });
  });

  test('keeps browser-local case failure separate from collected evidence', async () => {
    const api: LookupCaseApi = {
      getByDomain: async () => {
        throw new Error('IndexedDB unavailable');
      },
      open: unused,
      addNote: unused,
      edit: unused,
    };
    const controller = new LookupCaseController(api);

    assert.deepEqual(await controller.refresh('case-context.example'), {
      record: null,
      status:
        'Browser-local case context is unavailable. The collected lookup evidence remains available.',
    });
  });

  test('persists one explicit checkpoint batch through the existing case boundary', async () => {
    const record = createCase({ domain: 'case-context.example' }, '2026-07-29T01:00:00.000Z');
    const patches: Array<Parameters<LookupCaseApi['edit']>[1]> = [];
    const api: LookupCaseApi = {
      getByDomain: unused,
      open: unused,
      addNote: unused,
      edit: async (_id, value) => {
        patches.push(value);
        return { record, pruned: 0 };
      },
    };
    const controller = new LookupCaseController(api);
    const result = await controller.recordCheckpoint(record, [{
      version: 1,
      field: 'dns.mx',
      category: 'dns',
      label: 'MX hosts',
      value: 'mx.case-context.example',
      source: 'DNS',
      sourceState: 'success',
      observedAt: '2026-07-29T01:00:00.000Z',
      collectionDepth: 'deep',
      completeness: 'complete',
      truncated: false,
      limitations: [],
      sourceSchema: {
        collection: 'lookup_result',
        schema: 'whoisleuth.lookup-evidence',
        version: 21,
      },
    }], ['dns.mx']);

    assert.match(result.status, /Saved 1 analyst-selected checkpoint fact/u);
    const patch = patches[0];
    assert.ok(patch);
    assert.ok(Array.isArray(patch.evidencePins));
    assert.equal(patch.evidencePins.length, 1);
  });
});
