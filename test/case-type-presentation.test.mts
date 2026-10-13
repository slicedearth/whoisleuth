import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caseTypeSummary } from '../packages/cases/case-type-presentation.mts';
import type { CaseTypeId } from '../packages/cases/case-workflow-metadata.mts';

const record = (types: CaseTypeId[]) => ({
  workflowMetadata: { types, incidentTargets: [], investigationContext: null },
});

test('summarises declared Case types without changing their order or contents', () => {
  assert.equal(caseTypeSummary({}), '');
  assert.equal(caseTypeSummary(record([])), '');
  assert.equal(caseTypeSummary(record(['phishing'])), 'Phishing');
  const two = record(['impersonation', 'phishing']);
  const before = structuredClone(two);
  assert.equal(caseTypeSummary(two), 'Phishing and Impersonation');
  assert.deepEqual(two, before);
  assert.equal(caseTypeSummary(record(['trademark_infringement', 'phishing', 'impersonation'])), 'Phishing, Impersonation and 1 more');
  assert.equal(caseTypeSummary(record(['other', 'malware_distribution', 'phishing', 'impersonation'])), 'Phishing, Impersonation and 2 more');
});
