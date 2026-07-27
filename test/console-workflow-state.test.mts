import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearConsoleWorkflowState,
  readBulkWorkflowState,
  readLookupWorkflowState,
  writeBulkWorkflowState,
  writeLookupWorkflowState,
} from '../frontend/src/lib/console-workflow-state.ts';

const lookupState = Object.freeze({
  query: 'example.test', lookupMode: 'deep', includeExternalIntelligence: false,
  includeMalwareHostIntelligence: false, includeMalwareIocIntelligence: false,
  includeSecurityTxt: false, error: '', result: null,
});
const bulkState = Object.freeze({
  guideContext: '', input: 'example.test', mode: 'fast', completed: 1, total: 1, results: [], filter: 'all',
  mutationFilter: '', signalFilters: [], sortKey: 'risk', sortDirection: -1, page: 1,
  status: 'Complete', indicatorFormat: 'domains', watchlistName: '',
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
    assert.equal(readLookupWorkflowState(), lookupState);
    assert.equal(readBulkWorkflowState(), bulkState);

    clearConsoleWorkflowState();
    assert.equal(readLookupWorkflowState(), null);
    assert.equal(readBulkWorkflowState(), null);
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
    assert.equal(readLookupWorkflowState(), null);
    assert.equal(readBulkWorkflowState(), null);
  } finally {
    clearConsoleWorkflowState();
    if (hadWindow) setWindow(previousWindow);
  }
});
