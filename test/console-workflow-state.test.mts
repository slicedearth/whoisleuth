import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearConsoleWorkflowState,
  readBulkWorkflowState,
  readLookupWorkflowState,
  writeBulkWorkflowState,
  writeLookupWorkflowState,
  readSelectedConsoleCase,
  selectConsoleCase,
  subscribeSelectedConsoleCase,
  readCaseNavigationContext,
  setCaseNavigationContext,
  readConsoleReferenceView,
  pinConsoleCaseCheckpoint,
  removeConsoleCaseCheckpoint,
  clearConsoleCaseCheckpoints,
  clearConsoleReferenceView,
  recordVisitedConsoleCase,
  subscribeConsoleReferenceView,
  addConsoleFavourite,
  removeConsoleFavourite,
  clearConsoleFavourites,
  consoleFavouriteDestinations,
  MAX_CONSOLE_FAVOURITES,
} from '../frontend/src/lib/console-workflow-state.ts';
import { bulkReviewView, createBulkViewState } from '../frontend/src/lib/controllers/bulk-view-state.ts';
import { lockBrowserWorkspace } from '../frontend/src/lib/browser-workspace-unlock.ts';

const lookupState = Object.freeze({
  query: 'example.test', completedTarget: '', completedLookupDepth: null, lookupMode: 'deep', includeExternalIntelligence: false,
  includeMalwareHostIntelligence: false, includeMalwareIocIntelligence: false,
  includeSecurityTxt: false, error: '', result: null,
});

test('Case navigation notices are bounded, target-specific, browser-only and cleared with the session', () => {
  const previousWindow = globalThis.window;
  const hadWindow = 'window' in globalThis;
  setWindow({});
  try {
    setCaseNavigationContext('case-one', '/monitor?view=watchlists&watchlist=Review', 'Monitoring', 'Case saved; watchlist history remains separate.');
    assert.equal(readCaseNavigationContext('case-two'), null);
    assert.equal(readCaseNavigationContext('case-one')?.href, '/monitor?view=watchlists&watchlist=Review');
    assert.match(readCaseNavigationContext('case-one')?.message ?? '', /watchlist history remains separate/);
    assert.throws(() => setCaseNavigationContext('case-one', '/monitor', 'x'.repeat(81)), RangeError);
    assert.throws(() => setCaseNavigationContext('case-one', '/monitor', 'Monitoring', 'x'.repeat(2_001)), RangeError);
    setCaseNavigationContext('case-one', 'https://external.example', 'Monitoring');
    assert.equal(readCaseNavigationContext('case-one')?.href, '/dashboard');
    selectConsoleCase('case-two');
    setCaseNavigationContext('case-one', '/lookup?q=example.test', 'Lookup');
    selectConsoleCase('case-two');
    assert.equal(readCaseNavigationContext('case-one'), null);
    clearConsoleWorkflowState();
    assert.equal(readCaseNavigationContext('case-one'), null);
    removeWindow();
    setCaseNavigationContext('case-one', '/monitor', 'Monitoring');
    assert.equal(readCaseNavigationContext('case-one'), null);
  } finally {
    clearConsoleWorkflowState();
    if (hadWindow) setWindow(previousWindow); else removeWindow();
  }
});
const bulkState = Object.freeze({
  guideContext: '', input: 'example.test', mode: 'fast', pacing: 'balanced', completed: 1, total: 1, results: [],
  view: bulkReviewView(createBulkViewState()), page: 1,
  status: 'Complete', indicatorFormat: 'domains', indicatorWildcards: false, watchlistName: '',
});

function setWindow(value: unknown): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value,
  });
}

function removeWindow(): void {
  Reflect.deleteProperty(globalThis, 'window');
}

test('tab favourites copy exact pointers, derive destinations and clear without retaining evidence', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  setWindow({});
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: () => null, setItem: () => assert.fail('Favourites must not be persisted'), removeItem: () => assert.fail('Favourites must not change storage'),
  } });
  try {
    clearConsoleReferenceView();
    const supplied = { kind: 'case' as const, caseId: 'case-one', section: 'evidence' as const, privateLabel: 'PRIVATE-IGNORED' };
    assert.equal(addConsoleFavourite(supplied), 'added');
    supplied.caseId = 'changed-after-add';
    assert.deepEqual(readConsoleReferenceView().favourites, [{ kind: 'case', caseId: 'case-one', section: 'evidence' }]);
    assert.equal(addConsoleFavourite({ kind: 'case', caseId: 'case-one', section: 'evidence' }), 'already-added');
    assert.equal(addConsoleFavourite({ kind: 'case', caseId: 'case-one', section: 'summary' }), 'added');
    const destinations = consoleFavouriteDestinations();
    assert.ok(destinations.some(item => item.href === '/cli'));
    assert.ok(destinations.some(item => item.href === '/monitor?view=watchlists'));
    assert.equal(new Set(destinations.map(item => item.href)).size, destinations.length);
    for (const href of ['https://external.example', '/lookup?q=private.example', '/cases?case=unreviewed'])
      assert.throws(() => addConsoleFavourite({ kind: 'destination', href }), RangeError);
    assert.throws(() => addConsoleFavourite({ kind: 'case', caseId: '../private', section: 'evidence' }), RangeError);
    for (const invalid of [null, { kind: 'case', caseId: null, section: 'evidence' }, { kind: 'other', href: '/cli' }])
      assert.throws(() => addConsoleFavourite(invalid as unknown as Parameters<typeof addConsoleFavourite>[0]), RangeError);
    assert.throws(() => pinConsoleCaseCheckpoint({ caseId: null, snapshotId: null } as unknown as Parameters<typeof pinConsoleCaseCheckpoint>[0]), RangeError);
    for (const item of destinations.slice(0, MAX_CONSOLE_FAVOURITES - 2)) assert.equal(addConsoleFavourite({ kind: 'destination', href: item.href }), 'added');
    const full = readConsoleReferenceView();
    assert.ok(Object.isFrozen(full.favourites)); assert.ok(full.favourites.every(Object.isFrozen));
    assert.equal(addConsoleFavourite({ kind: 'case', caseId: 'other', section: 'summary' }), 'full');
    assert.equal(readConsoleReferenceView(), full);
    removeConsoleFavourite({ kind: 'case', caseId: 'case-one', section: 'summary' });
    assert.ok(readConsoleReferenceView().favourites.some(item => item.kind === 'case' && item.section === 'evidence'));
    pinConsoleCaseCheckpoint({ caseId: 'case-one', snapshotId: 'checkpoint-one' });
    clearConsoleFavourites();
    assert.equal(readConsoleReferenceView().favourites.length, 0); assert.equal(readConsoleReferenceView().checkpoints.length, 1);
    addConsoleFavourite({ kind: 'destination', href: '/cli' }); lockBrowserWorkspace();
    assert.deepEqual(readConsoleReferenceView().favourites, []);
    assert.doesNotMatch(JSON.stringify(readConsoleReferenceView()), /PRIVATE-IGNORED/u);
    removeWindow(); assert.equal(addConsoleFavourite({ kind: 'destination', href: '/cli' }), 'unavailable');
  } finally {
    clearConsoleReferenceView();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else removeWindow();
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('tab references retain exact bounded identifiers without writing storage or evicting another pin', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  setWindow({});
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: () => null,
    setItem: () => { assert.fail('references must not be persisted'); }, removeItem: () => { assert.fail('references must not change storage'); },
  } });
  const observed: number[] = [];
  const unsubscribe = subscribeConsoleReferenceView(() => observed.push(readConsoleReferenceView().revision));
  try {
    clearConsoleReferenceView();
    const supplied = { caseId: 'case-one', snapshotId: 'snapshot-one', unexpected: 'PRIVATE-IGNORED' };
    assert.equal(pinConsoleCaseCheckpoint(supplied), 'added');
    supplied.snapshotId = 'changed-after-pinning';
    assert.deepEqual(readConsoleReferenceView().checkpoints, [{ caseId: 'case-one', snapshotId: 'snapshot-one' }]);
    const first = readConsoleReferenceView();
    assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.checkpoints)); assert.ok(Object.isFrozen(first.checkpoints[0]));
    assert.equal(pinConsoleCaseCheckpoint({ caseId: 'case-one', snapshotId: 'snapshot-one' }), 'already-pinned');
    assert.equal(readConsoleReferenceView().revision, first.revision);
    for (const id of ['two', 'three', 'four']) assert.equal(pinConsoleCaseCheckpoint({ caseId: 'case-one', snapshotId: id }), 'added');
    const full = readConsoleReferenceView();
    assert.equal(pinConsoleCaseCheckpoint({ caseId: 'case-two', snapshotId: 'fifth' }), 'full');
    assert.equal(readConsoleReferenceView(), full);
    assert.throws(() => pinConsoleCaseCheckpoint({ caseId: '../case', snapshotId: 'valid' }), RangeError);
    assert.throws(() => pinConsoleCaseCheckpoint({ caseId: 'case-one', snapshotId: 'x'.repeat(129) }), RangeError);
    removeConsoleCaseCheckpoint({ caseId: 'case-two', snapshotId: 'snapshot-one' });
    assert.equal(readConsoleReferenceView(), full, 'the same snapshot identifier in another Case is not the same reference');
    removeConsoleCaseCheckpoint({ caseId: 'case-one', snapshotId: 'two' });
    assert.deepEqual(readConsoleReferenceView().checkpoints.map(ref => ref.snapshotId), ['snapshot-one', 'three', 'four']);
    assert.equal(JSON.stringify(readConsoleReferenceView()).includes('PRIVATE-IGNORED'), false);
    recordVisitedConsoleCase('case-one', 'evidence');
    clearConsoleCaseCheckpoints();
    assert.equal(readConsoleReferenceView().checkpoints.length, 0);
    assert.equal(readConsoleReferenceView().visits.length, 1);
    const epoch = readConsoleReferenceView().revision;
    clearConsoleWorkflowState();
    assert.equal(readConsoleReferenceView().checkpoints.length, 0); assert.equal(readConsoleReferenceView().visits.length, 0);
    assert.ok(readConsoleReferenceView().revision > epoch);
    assert.ok(observed.length > 0);
    pinConsoleCaseCheckpoint({ caseId: 'case-one', snapshotId: 'snapshot-one' });
    recordVisitedConsoleCase('case-one', 'evidence');
    lockBrowserWorkspace();
    assert.deepEqual(readConsoleReferenceView().checkpoints, []); assert.deepEqual(readConsoleReferenceView().visits, []);
    removeWindow();
    assert.equal(pinConsoleCaseCheckpoint({ caseId: 'server-case', snapshotId: 'server-snapshot' }), 'unavailable');
    assert.equal(readConsoleReferenceView().workspaceId, null);
  } finally {
    unsubscribe(); clearConsoleReferenceView();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else removeWindow();
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('visited Case context is bounded navigation state, not selection intent or observed relationships', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  setWindow({}); Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null } });
  try {
    clearConsoleReferenceView();
    selectConsoleCase('not-yet-visited'); setCaseNavigationContext('not-yet-visited', '/monitor', 'Return');
    assert.deepEqual(readConsoleReferenceView().visits, []);
    recordVisitedConsoleCase('case-one', 'evidence'); recordVisitedConsoleCase('case-one', 'evidence');
    recordVisitedConsoleCase('case-one', 'response');
    assert.deepEqual(readConsoleReferenceView().visits, [{ caseId: 'case-one', section: 'response' }]);
    assert.throws(() => recordVisitedConsoleCase(' invalid ', 'summary'), RangeError);
    assert.throws(() => recordVisitedConsoleCase('case-one', 'unsupported' as 'summary'), RangeError);
    for (let index = 0; index < 10; index++) recordVisitedConsoleCase(`visited-${index}`, 'summary');
    assert.deepEqual(readConsoleReferenceView().visits.map(visit => visit.caseId), Array.from({ length: 8 }, (_, index) => `visited-${index + 2}`));
    clearConsoleReferenceView(); assert.deepEqual(readConsoleReferenceView().visits, []);
  } finally {
    clearConsoleWorkflowState();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else removeWindow();
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('keeps console workflow state in the browser runtime and clears both tools together', () => {
  const previousWindow = globalThis.window;
  const hadWindow = 'window' in globalThis;
  setWindow({});
  try {
    writeLookupWorkflowState(lookupState);
    writeBulkWorkflowState(bulkState);
    selectConsoleCase('selected-case');
    assert.equal(readLookupWorkflowState(), lookupState);
    assert.equal(readBulkWorkflowState(), bulkState);
    assert.equal(readSelectedConsoleCase(), 'selected-case');

    clearConsoleWorkflowState();
    assert.equal(readLookupWorkflowState(), null);
    assert.equal(readBulkWorkflowState(), null);
    assert.equal(readSelectedConsoleCase(), null);
  } finally {
    clearConsoleWorkflowState();
    if (hadWindow) setWindow(previousWindow);
    else removeWindow();
  }
});

test('does not expose or write workflow state during server rendering', () => {
  const previousWindow = globalThis.window;
  const hadWindow = 'window' in globalThis;
  removeWindow();
  try {
    writeLookupWorkflowState(lookupState);
    writeBulkWorkflowState(bulkState);
    selectConsoleCase('server-case');
    assert.equal(readLookupWorkflowState(), null);
    assert.equal(readBulkWorkflowState(), null);
    assert.equal(readSelectedConsoleCase(), null);
  } finally {
    clearConsoleWorkflowState();
    if (hadWindow) setWindow(previousWindow);
  }
});

test('Case selection notifies local subscribers without persisting data or duplicating identical choices', () => {
  const previousWindow = globalThis.window;
  const hadWindow = 'window' in globalThis;
  setWindow({});
  const observed: Array<string | null> = [];
  const unsubscribe = subscribeSelectedConsoleCase((id) => observed.push(id));
  const removeBroken = subscribeSelectedConsoleCase((id) => { if (id) throw new Error('View unavailable'); });
  try {
    selectConsoleCase('case-one');
    selectConsoleCase('case-one');
    selectConsoleCase('case-two');
    assert.throws(() => selectConsoleCase(' invalid case '), RangeError);
    assert.equal(readSelectedConsoleCase(), 'case-two');
    clearConsoleWorkflowState();
    assert.deepEqual(observed, [null, 'case-one', 'case-two', null]);
    unsubscribe();
    selectConsoleCase('case-three');
    assert.deepEqual(observed, [null, 'case-one', 'case-two', null]);
  } finally {
    unsubscribe(); removeBroken(); clearConsoleWorkflowState();
    if (hadWindow) setWindow(previousWindow); else removeWindow();
  }
});
