import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LookupCaseController,
  type LookupCaseApi,
} from '../frontend/src/lib/controllers/lookup-case-controller.ts';
import { createCase, updateCase } from '../frontend/src/lib/analysis/case-model.ts';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/evidence-export.ts';

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

  test('propagates the exact Lookup hostname only through deliberate Case create and refresh actions', async () => {
    let records = [] as ReturnType<typeof createCase>[];
    let clock = 0;
    const now = () => `2026-08-${String(20 + clock++).padStart(2, '0')}T00:00:00.000Z`;
    const api: LookupCaseApi = {
      getByDomain: async (domain) => records.find((record) => record.domain === domain) ?? null,
      open: async (input) => {
        const existing = records.find((record) => record.domain === input.domain);
        if (existing) return { record: existing, cases: records, created: false, pruned: 0 };
        const record = createCase(input, now());
        records = [record, ...records];
        return { record, cases: records, created: true, pruned: 0 };
      },
      addNote: unused,
      edit: async (id, patch) => {
        const updated = updateCase(records, id, patch, now());
        records = updated.cases;
        return { ...updated, pruned: 0 };
      },
    };
    const controller = new LookupCaseController(api);

    const created = await controller.open('example.test', {
      inputHostname: 'login.example.test',
      availability: 'registered',
    }, 'deep');
    assert.match(created.status, /Opened a new case/iu);
    assert.equal(created.record?.domain, 'example.test');
    assert.equal(created.record?.evidenceHistory[0]?.inputHostname, 'login.example.test');

    const refreshed = await controller.open('example.test', {
      inputHostname: 'account.example.test',
      availability: 'registered',
    }, 'deep');
    assert.match(refreshed.status, /Refreshed the retained Case evidence/iu);
    assert.deepEqual(refreshed.record?.evidenceHistory.map((snapshot) => snapshot.inputHostname), [
      'login.example.test',
      'account.example.test',
    ]);
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
        return { record, cases: [record], pruned: 0 };
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
        version: LOOKUP_EVIDENCE_SCHEMA_VERSION,
      },
    }], ['dns.mx']);

    assert.match(result.status, /Saved 1 analyst-selected checkpoint fact/u);
    const patch = patches[0];
    assert.ok(patch);
    assert.ok(Array.isArray(patch.evidencePins));
    assert.equal(patch.evidencePins.length, 1);
  });

  test('records a deliberate investigation brief handoff without copying evidence into the trail', async () => {
    const record = createCase({ domain: 'case-context.example' }, '2026-07-29T01:00:00.000Z');
    const patches: Array<Parameters<LookupCaseApi['edit']>[1]> = [];
    const api: LookupCaseApi = {
      getByDomain: unused,
      open: unused,
      addNote: unused,
      edit: async (_id, value) => {
        patches.push(value);
        return { record, cases: [record], pruned: 0 };
      },
    };
    const controller = new LookupCaseController(api);
    const result = await controller.recordBriefHandoff(record, {
      target: 'case-context.example',
      taskLabel: 'Incident response',
      generatedAt: '2026-07-29T01:30:00.000Z',
      contradictionCount: 2,
      unknownCount: 1,
    });

    assert.match(result.status, /Recorded the local investigation brief/u);
    assert.deepEqual(patches[0]?.trailEvent, {
      kind: 'handoff',
      summary: 'Prepared Incident response brief for case-context.example with 2 contradictions and 1 unknown record.',
      target: 'Local investigation brief generated 2026-07-29T01:30:00.000Z',
    });
  });
});
