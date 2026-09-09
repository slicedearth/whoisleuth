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
} from '../frontend/src/lib/console-workflow-state.ts';

const lookupState = Object.freeze({
  query: 'example.test', completedTarget: '', completedLookupDepth: null, lookupMode: 'deep', includeExternalIntelligence: false,
  includeMalwareHostIntelligence: false, includeMalwareIocIntelligence: false,
  includeSecurityTxt: false, error: '', result: null,
});
const bulkState = Object.freeze({
  guideContext: '', input: 'example.test', mode: 'fast', pacing: 'balanced', completed: 1, total: 1, results: [], filter: 'all',
  mutationFilter: '', signalFilters: [], sortKey: 'risk', sortDirection: -1, page: 1,
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
