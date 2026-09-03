import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LookupCaseController,
  type LookupCaseApi,
} from '../frontend/src/lib/controllers/lookup-case-controller.ts';
import { createCase, updateCase } from '../frontend/src/lib/analysis/case-model.ts';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/evidence-export.ts';
import type { ResolvedAbuseRecipient } from '../frontend/src/lib/analysis/abuse-recipient-resolver.ts';
import type { CheckpointFact } from '../frontend/src/lib/analysis/case-evidence-checkpoint.ts';

function unused(): Promise<never> {
  throw new Error('Unused test dependency');
}

function fixtureFact(field = 'dns.mx'): CheckpointFact {
  return {
    version: 1 as const,
    field,
    category: 'dns',
    label: 'MX hosts',
    value: 'mx.case-context.example',
    source: 'DNS',
    sourceState: 'success' as const,
    observedAt: '2026-07-29T01:00:00.000Z',
    collectionDepth: 'deep' as const,
    completeness: 'complete' as const,
    truncated: false,
    limitations: [],
    sourceSchema: {
      collection: 'lookup_result' as const,
      schema: 'whoisleuth.lookup-evidence',
      version: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    },
  };
}

function fixtureApi(overrides: Partial<LookupCaseApi> = {}): LookupCaseApi {
  return {
    getByDomain: unused,
    open: unused,
    addNote: unused,
    edit: unused,
    ...overrides,
  };
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
    const result = await controller.recordCheckpoint(record, [fixtureFact()], ['dns.mx']);

    assert.match(result.status, /Saved 1 analyst-selected checkpoint fact/u);
    const patch = patches[0];
    assert.ok(patch);
    assert.ok(Array.isArray(patch.evidencePins));
    assert.equal(patch.evidencePins.length, 1);
  });

  test('opens replay evidence as a historical imported snapshot', async () => {
    let records = [] as ReturnType<typeof createCase>[];
    const edits: Array<Parameters<LookupCaseApi['edit']>[1]> = [];
    const api = fixtureApi({
      open: async (input) => {
        const existing = records.find((record) => record.domain === input.domain);
        if (existing) return { record: existing, cases: records, created: false, pruned: 0 };
        const record = createCase(input, '2026-08-20T00:00:00.000Z');
        records = [record];
        return { record, cases: records, created: true, pruned: 0 };
      },
      edit: async (id, patch) => {
        edits.push(patch);
        const updated = updateCase(records, id, patch, '2026-08-21T00:00:00.000Z');
        records = updated.cases;
        return { ...updated, pruned: 0 };
      },
    });
    const controller = new LookupCaseController(api);
    const evidence = {
      capturedAt: '2026-07-31T00:00:00.000Z',
      inputHostname: 'portal.example.test',
      availability: 'registered',
    };

    const created = await controller.openReplay('example.test', evidence);
    assert.match(created.status, /Created a browser-local Case/u);
    assert.equal(created.record?.source, 'manual');
    assert.equal(created.record?.evidenceHistory[0]?.source, 'import');
    assert.equal(created.record?.evidenceHistory[0]?.capturedAt, '2026-07-31T00:00:00.000Z');
    assert.equal(created.record?.evidenceHistory[0]?.inputHostname, 'portal.example.test');
    assert.equal(created.record?.evidenceHistory[0]?.scanDepth, 'unknown');

    const refreshed = await controller.openReplay('example.test', {
      ...evidence,
      pageTitle: 'Later imported evidence',
    });
    assert.match(refreshed.status, /Added the historical replay evidence/u);
    assert.equal(edits[0]?.source, undefined);
    assert.equal((edits[0]?.evidence as Record<string, unknown>).source, 'import');
    assert.equal((edits[0]?.evidence as Record<string, unknown>).scanDepth, 'unknown');
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

  test('handles absent create context, bounded pruning, and both open failure forms', async () => {
    const record = createCase({ domain: 'case-context.example' }, '2026-07-29T01:00:00.000Z');
    assert.deepEqual(await new LookupCaseController(fixtureApi()).open('', {}, 'fast'), { record: null, status: '' });

    const created = await new LookupCaseController(fixtureApi({
      open: async () => ({ record, cases: [record], created: true, pruned: 1 }),
    })).open(record.domain, {}, 'fast');
    assert.match(created.status, /pruned 1 old evidence snapshot/u);

    const existing = await new LookupCaseController(fixtureApi({
      open: async () => ({ record, cases: [record], created: false, pruned: 0 }),
      edit: async () => ({ record, cases: [record], pruned: 2 }),
    })).open(record.domain, {}, 'deep');
    assert.match(existing.status, /pruned 2 old evidence snapshots/u);

    const explicit = await new LookupCaseController(fixtureApi({
      open: async () => { throw new Error('Case storage denied.'); },
    })).open(record.domain, {}, 'fast');
    assert.equal(explicit.status, 'Case storage denied.');
    const fallback = await new LookupCaseController(fixtureApi({
      open: async () => { throw 'unknown failure'; },
    })).open(record.domain, {}, 'fast');
    assert.equal(fallback.status, 'Could not open the case.');
  });

  test('validates notes and preserves the retained record across write failures', async () => {
    const record = createCase({ domain: 'case-context.example' }, '2026-07-29T01:00:00.000Z');
    const controller = new LookupCaseController(fixtureApi());
    assert.deepEqual(await controller.appendNote(null, 'note'), { record: null, status: '' });
    assert.deepEqual(await controller.appendNote(record, '   '), { record, status: 'A note cannot be empty.' });

    const saved = await new LookupCaseController(fixtureApi({
      addNote: async (_id, note) => {
        assert.equal(note, 'reviewed note');
        return { record, cases: [record], pruned: 1 };
      },
    })).appendNote(record, ' reviewed note ');
    assert.equal(saved.clearNote, true);
    assert.match(saved.status, /pruned 1 old evidence snapshot/u);

    const explicit = await new LookupCaseController(fixtureApi({
      addNote: async () => { throw new Error('Note write denied.'); },
    })).appendNote(record, 'note');
    assert.deepEqual(explicit, { record, status: 'Note write denied.' });
    const fallback = await new LookupCaseController(fixtureApi({
      addNote: async () => { throw null; },
    })).appendNote(record, 'note');
    assert.deepEqual(fallback, { record, status: 'Could not add the note.' });
  });

  test('records a disposition and reviewed reason together', async () => {
    const record = createCase({ domain: 'case-context.example' }, '2026-07-29T01:00:00.000Z');
    const controller = new LookupCaseController(fixtureApi());
    assert.match((await controller.classify(null, 'suspicious', 'insufficient_evidence')).status, /Create or open/u);
    assert.match((await controller.classify(record, 'suspicious', '')).status, /Select the reviewed reason/u);

    const patches: Array<Parameters<LookupCaseApi['edit']>[1]> = [];
    const saved = await new LookupCaseController(fixtureApi({
      edit: async (_id, patch) => {
        patches.push(patch);
        const updated = updateCase([record], record.id, patch, '2026-07-29T01:01:00.000Z');
        return { ...updated, pruned: 1 };
      },
    })).classify(record, 'suspicious', 'insufficient_evidence');
    assert.deepEqual(patches[0], {
      disposition: 'suspicious',
      reviewReasonCode: 'insufficient_evidence',
    });
    assert.equal(saved.record?.disposition, 'suspicious');
    assert.equal(saved.record?.reviewReasonCode, 'insufficient_evidence');
    assert.match(saved.status, /pruned 1 old evidence snapshot/u);

    const cleared = await new LookupCaseController(fixtureApi({
      edit: async (_id, patch) => {
        patches.push(patch);
        const updated = updateCase([record], record.id, patch, '2026-07-29T01:02:00.000Z');
        return { ...updated, pruned: 0 };
      },
    })).classify(record, 'unreviewed', 'confirmed_malware');
    assert.deepEqual(patches[1], { disposition: 'unreviewed', reviewReasonCode: '' });
    assert.equal(cleared.record?.reviewReasonCode, null);

    const explicit = await new LookupCaseController(fixtureApi({
      edit: async () => { throw new Error('Classification write denied.'); },
    })).classify(record, 'suspicious', 'other_reviewed');
    assert.equal(explicit.status, 'Classification write denied.');
    const fallback = await new LookupCaseController(fixtureApi({
      edit: async () => { throw false; },
    })).classify(record, 'suspicious', 'other_reviewed');
    assert.equal(fallback.status, 'Could not save the analyst classification.');
  });

  test('records one reviewed response route and rejects absent or duplicate actions', async () => {
    const record = createCase({ domain: 'case-context.example' }, '2026-07-29T01:00:00.000Z');
    const route: ResolvedAbuseRecipient = {
      id: 'registrar-email',
      kind: 'network_hosting',
      channel: 'email',
      contact: 'abuse@provider.example',
      source: 'RDAP',
      observedAt: null,
      limitations: ['Delivery was not tested.'],
      actionType: 'network_hosting_report',
    };
    const controller = new LookupCaseController(fixtureApi());
    assert.match((await controller.recordRecipient(null, route)).status, /Create or open/u);

    const duplicate = updateCase([record], record.id, { action: {
      type: route.actionType,
      recipient: route.contact.toUpperCase(),
      contactSource: route.source,
      contactLimitations: [...route.limitations],
      state: 'planned',
    } }, '2026-07-29T01:01:00.000Z').record;
    assert.match((await controller.recordRecipient(duplicate, route)).status, /already recorded/u);

    const patches: Array<Parameters<LookupCaseApi['edit']>[1]> = [];
    const saved = await new LookupCaseController(fixtureApi({
      edit: async (_id, value) => {
        patches.push(value);
        return { record, cases: [record], pruned: 2 };
      },
    })).recordRecipient(record, route);
    assert.deepEqual(patches[0]?.action, {
      type: 'network_hosting_report',
      recipient: 'abuse@provider.example',
      contactSource: 'RDAP',
      routeObservedAt: null,
      contactLimitations: ['Delivery was not tested.'],
      state: 'planned',
    });
    assert.match(saved.status, /observed endpoint network-registration contact.*pruned 2/iu);

    const explicit = await new LookupCaseController(fixtureApi({
      edit: async () => { throw new Error('Route write denied.'); },
    })).recordRecipient(record, route);
    assert.equal(explicit.status, 'Route write denied.');
    const fallback = await new LookupCaseController(fixtureApi({
      edit: async () => { throw undefined; },
    })).recordRecipient(record, route);
    assert.equal(fallback.status, 'Could not record the response route.');
  });

  test('requires observed checkpoint facts and records reviewed transition plans', async () => {
    const record = createCase({ domain: 'case-context.example' }, '2026-07-29T01:00:00.000Z');
    const controller = new LookupCaseController(fixtureApi());
    assert.match((await controller.recordCheckpoint(null, [], [])).status, /Create or open/u);
    assert.match((await controller.recordCheckpoint(record, [fixtureFact()], [])).status, /Select at least one/u);

    const saved = await new LookupCaseController(fixtureApi({
      edit: async () => ({ record, cases: [record], pruned: 2 }),
    })).recordCheckpoint(record, [fixtureFact()], ['dns.mx'], { 'dns.mx': 'change' });
    assert.match(saved.status, /1 analyst-selected checkpoint fact with a reviewed transition plan.*pruned 2/iu);

    const explicit = await new LookupCaseController(fixtureApi({
      edit: async () => { throw new Error('Checkpoint write denied.'); },
    })).recordCheckpoint(record, [fixtureFact()], ['dns.mx']);
    assert.equal(explicit.status, 'Checkpoint write denied.');
    const fallback = await new LookupCaseController(fixtureApi({
      edit: async () => { throw false; },
    })).recordCheckpoint(record, [fixtureFact()], ['dns.mx']);
    assert.equal(fallback.status, 'Could not save the evidence checkpoint.');
  });

  test('keeps brief handoff failures bounded and pluralizes the recorded summary', async () => {
    const record = createCase({ domain: 'case-context.example' }, '2026-07-29T01:00:00.000Z');
    const brief = {
      target: record.domain,
      taskLabel: 'Ownership review',
      generatedAt: '2026-07-29T01:30:00.000Z',
      contradictionCount: 1,
      unknownCount: 2,
    };
    assert.match((await new LookupCaseController(fixtureApi()).recordBriefHandoff(null, brief)).status, /Create or open/u);
    const patches: Array<Parameters<LookupCaseApi['edit']>[1]> = [];
    const saved = await new LookupCaseController(fixtureApi({
      edit: async (_id, value) => {
        patches.push(value);
        return { record, cases: [record], pruned: 1 };
      },
    })).recordBriefHandoff(record, brief);
    assert.deepEqual(patches[0]?.trailEvent, {
      kind: 'handoff',
      summary: 'Prepared Ownership review brief for case-context.example with 1 contradiction and 2 unknown records.',
      target: 'Local investigation brief generated 2026-07-29T01:30:00.000Z',
    });
    assert.match(saved.status, /pruned 1 old evidence snapshot/u);

    const explicit = await new LookupCaseController(fixtureApi({
      edit: async () => { throw new Error('Brief write denied.'); },
    })).recordBriefHandoff(record, brief);
    assert.equal(explicit.status, 'Brief write denied.');
    const fallback = await new LookupCaseController(fixtureApi({
      edit: async () => { throw 0; },
    })).recordBriefHandoff(record, brief);
    assert.equal(fallback.status, 'Could not record the investigation brief handoff.');
  });
});
