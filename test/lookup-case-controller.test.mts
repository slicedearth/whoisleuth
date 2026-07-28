import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LookupCaseController,
  type LookupCaseApi,
} from '../frontend/src/lib/controllers/lookup-case-controller.ts';

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
});
