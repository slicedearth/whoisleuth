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

test('keeps console workflow state in the browser runtime and clears both tools together', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
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
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('does not expose or write workflow state during server rendering', () => {
  const previousWindow = globalThis.window;
  delete globalThis.window;
  try {
    writeLookupWorkflowState(lookupState);
    writeBulkWorkflowState(bulkState);
    assert.equal(readLookupWorkflowState(), null);
    assert.equal(readBulkWorkflowState(), null);
  } finally {
    clearConsoleWorkflowState();
    if (previousWindow !== undefined) globalThis.window = previousWindow;
  }
});
