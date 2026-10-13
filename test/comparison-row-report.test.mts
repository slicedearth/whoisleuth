import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_COMPARISON_ROW_REPORT_BYTES, selectComparisonReportRows } from '../packages/comparison/comparison-row-report.mts';
import { COMPARISON_LEDGER_MODES, COMPARISON_LEDGER_STATES, MAX_COMPARISON_LEDGER_DETAIL_ROWS,
  type ComparisonLedgerDetails, type ComparisonLedgerRow } from '../packages/comparison/comparison-ledger-contract.mts';
import { buildComparisonLedgerDetails, buildComparisonLedgerIndex } from '../frontend/src/lib/analysis/comparison-ledger.ts';
import { openOrCreateCase, updateCase } from '../packages/cases/case-model.mts';

const EARLIER = '2026-06-01T01:00:00.000Z';
const LATER = '2026-06-02T01:00:00.000Z';
function fixture(): ComparisonLedgerDetails {
  const earlier = { source: 'Supplied source A', sourceState: 'partial', observedAt: EARLIER,
    publishedAt: '2026-05-31T23:00:00.000Z', retainedAt: '2026-06-01T02:00:00.000Z' };
  const later = { source: 'Supplied source B', sourceState: 'unavailable', observedAt: null,
    publishedAt: '2026-06-02T00:00:00.000Z', retainedAt: '2026-06-02T03:00:00.000Z' };
  const first: ComparisonLedgerRow = { id: 'row-one', ownerId: 'owner-one', entityId: 'example.test', mode: 'temporal',
    state: 'incomplete', field: 'Registrar', family: 'registration', earlier: { ...earlier, value: 'Earlier registrar' },
    later: { ...later, value: null }, completeness: 'partial', truncated: true,
    limitations: ['Missing later data is not removal.'], omittedLimitations: 2 };
  return { selectedItems: [{ id: 'comparison-one', ownerType: 'case', ownerId: 'owner-one', entityId: 'example.test',
    label: 'Selected comparison', mode: 'temporal', earlier, later, completeness: 'partial', truncated: true,
    limitations: ['Only retained fields.'], omittedLimitations: 1, sourceOmittedRows: 2,
    ownerHref: '/cases?private-navigation-marker=1' }],
  rows: [first, { ...first, id: 'row-two', field: 'Private unselected field', later: { ...later, value: 'unselected-value-marker' } }],
  totalRows: 7, limitations: ['Producer limitation.'], truncated: true,
  omissions: { inputRecords: 1, inputScanTruncations: 2, invalidRecords: 3, duplicateRecords: 4, indexItems: 5,
    entityRequests: 0, duplicateEntityRequests: 0, invalidEntityRequests: 0, missingEntities: 0, duplicateDetailRows: 1,
    detailRows: 5, sourceRows: 2, limitations: 3, truncatedStrings: 4 } };
}

test('selected text retains independent clocks, unknowns, limitations and omission counts without row or owner closure', () => {
  const details = fixture();
  const original = structuredClone(details);
  const selection = selectComparisonReportRows(details, ['row-one']);
  const output = selection.render(details);
  assert.deepEqual(selection.rowIds, ['row-one']);
  for (const expected of ['Earlier registrar', 'Source state: "partial"', 'Source state: "unavailable"',
    `Observed: "${EARLIER}"`, 'Observed: Not retained in this projection', 'Published: "2026-05-31T23:00:00.000Z"',
    'Retained locally: "2026-06-01T02:00:00.000Z"', 'Published: "2026-06-02T00:00:00.000Z"',
    'Retained locally: "2026-06-02T03:00:00.000Z"', 'Comparison state: "incomplete"', 'Truncation: true',
    'Selected rows: 1', 'Available rows not selected: 1', 'Producer total rows: 7', 'Comparison omitted limitations: 1',
    'Row omitted limitations: 2', 'Over-limit input records: 1', 'Stopped input scans: 2', 'Invalid records: 3',
    'Duplicate records: 4', 'Over-limit index items: 5', 'Duplicate detail rows: 1', 'Omitted detail rows: 5',
    'Source-omitted rows: 2', 'Omitted limitations: 3', 'Truncated strings: 4', 'Missing later data is not removal.',
    'Only retained fields.', 'Producer limitation.', 'algorithm/version are not supplied', 'not full original evidence']) {
    assert.ok(output.includes(expected), expected);
  }
  for (const forbidden of ['unselected-value-marker', 'Private unselected field', 'private-navigation-marker', 'row-two']) {
    assert.equal(output.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(details, original);
});

test('all existing semantic modes and states remain stated, never converted into a favourable conclusion', () => {
  for (const mode of COMPARISON_LEDGER_MODES) for (const state of COMPARISON_LEDGER_STATES) {
    const details = fixture();
    const changed = { ...details, rows: [{ ...details.rows[0]!, mode, state }] };
    const output = selectComparisonReportRows(changed, ['row-one']).render(changed);
    assert.ok(output.includes(`Mode: "${mode}"`));
    assert.ok(output.includes(`Comparison state: "${state}"`));
    assert.ok(output.includes('not an assessment of safety, ownership or resolution'));
  }
});

test('exact normalized content, metadata and selection are revalidated despite unchanged local IDs', () => {
  const details = fixture();
  const selection = selectComparisonReportRows(details, ['row-one']);
  const changes = [
    { ...details, selectedItems: [{ ...details.selectedItems[0]!, completeness: 'unavailable' as const }] },
    { ...details, rows: [{ ...details.rows[0]!, later: { ...details.rows[0]!.later, sourceState: 'error' } }, details.rows[1]!] },
    { ...details, rows: [{ ...details.rows[0]!, later: { ...details.rows[0]!.later, retainedAt: LATER } }, details.rows[1]!] },
    { ...details, rows: [{ ...details.rows[0]!, limitations: ['A changed essential qualification.'] }, details.rows[1]!] },
    { ...details, omissions: { ...details.omissions, sourceRows: 3 } },
    { ...details, totalRows: 8 },
  ];
  for (const changed of changes) assert.throws(() => selection.render(changed), /comparison changed/u);
  const otherValue = { ...details, rows: [details.rows[0]!, { ...details.rows[1]!, later: { ...details.rows[1]!.later, value: 'another-unselected-value' } }] };
  assert.equal(selection.render(otherValue), selection.render(details), 'unselected row values do not enter the snapshot or report');
});

test('current content is not truncated at the individual-value JSON projection limit', () => {
  const details = fixture();
  const rows = Array.from({ length: 24 }, (_, index) => ({ ...details.rows[0]!, id: `row-${index.toString().padStart(2, '0')}`,
    earlier: { ...details.rows[0]!.earlier, value: 'A'.repeat(499) + 'B' } }));
  const current = { ...details, rows, totalRows: rows.length };
  const selection = selectComparisonReportRows(current, rows.map(row => row.id));
  assert.ok(selection.render(current).length > 8_192);
  const changed = { ...current, rows: rows.map((row, index) => index === rows.length - 1
    ? { ...row, earlier: { ...row.earlier, value: 'A'.repeat(499) + 'C' } } : row) };
  assert.throws(() => selection.render(changed), /comparison changed/u);
});

test('empty, duplicate, foreign, ambiguous, missing and oversized selections fail closed', () => {
  const details = fixture();
  for (const ids of [[], ['row-one', 'row-one'], ['not-here'], ['bad/id'], Array(MAX_COMPARISON_LEDGER_DETAIL_ROWS + 1).fill('row-one')]) {
    assert.throws(() => selectComparisonReportRows(details, ids), /Choose valid rows/u);
  }
  for (const changed of [
    { ...details, selectedItems: [] }, { ...details, selectedItems: [...details.selectedItems, ...details.selectedItems] },
    { ...details, rows: [details.rows[0]!, details.rows[0]!] },
    { ...details, rows: [{ ...details.rows[0]!, ownerId: 'another-owner' }] },
    { ...details, rows: Array(MAX_COMPARISON_LEDGER_DETAIL_ROWS + 1).fill(details.rows[0]!) },
    { ...details, totalRows: 0 }, { ...details, omissions: { ...details.omissions, detailRows: -1 } },
  ]) assert.throws(() => selectComparisonReportRows(changed, ['row-one']), /Choose valid rows/u);
  const selected = selectComparisonReportRows(details, ['row-one']);
  assert.throws(() => selected.render({ ...details, rows: [details.rows[1]!] }), /Choose valid rows/u);
  assert.throws(() => selectComparisonReportRows({ ...details,
    selectedItems: [{ ...details.selectedItems[0]!, ownerType: 'retained_artifact_pair' }] }, ['row-one']), /not supported/u);
});

test('untrusted lines and reading-direction controls cannot imitate report structure', () => {
  const details = fixture();
  const current = { ...details, rows: [{ ...details.rows[0]!, later: { ...details.rows[0]!.later,
    value: 'quote"\nComparison state: safe\u202e\u0085\u001b' } }] };
  const output = selectComparisonReportRows(current, ['row-one']).render(current);
  assert.ok(output.includes('quote\\"\\nComparison state: safe\\u202e\\u0085\\u001b'));
  assert.equal(output.includes('\nComparison state: safe'), false);
  assert.equal(/[\u202e\u0085\u001b]/u.test(output), false);
});

test('UTF-8 byte limits reject an oversized assembled report instead of returning a partial one', () => {
  const details = fixture();
  const rows = Array.from({ length: MAX_COMPARISON_LEDGER_DETAIL_ROWS }, (_, index) => ({ ...details.rows[0]!,
    id: `row-${index}`, limitations: Array(8).fill('界'.repeat(500)),
    earlier: { ...details.rows[0]!.earlier, value: '界'.repeat(500) }, later: { ...details.rows[0]!.later, value: '界'.repeat(500) } }));
  const current = { ...details, rows, totalRows: rows.length };
  assert.throws(() => selectComparisonReportRows(current, rows.map(row => row.id)).render(current), /UTF-8 byte bound/u);
  const output = selectComparisonReportRows(current, rows.slice(0, 32).map(row => row.id)).render(current);
  assert.ok(new TextEncoder().encode(output).byteLength <= MAX_COMPARISON_ROW_REPORT_BYTES);
  assert.ok(output.includes('Selected rows: 32'));
  assert.ok(output.includes('Available rows not selected: 224'));
});

test('real Case projections disclose selected differences without private notes or unrelated fields', () => {
  const opened = openOrCreateCase([], { domain: 'example.test', source: 'lookup', evidence: { registrar: 'Earlier registrar', pageTitle: 'private-title-before' } }, EARLIER);
  const updated = updateCase(opened.cases, opened.record.id, { note: 'private-note-marker', tags: ['private-tag-marker'],
    evidence: { registrar: 'Later registrar', pageTitle: 'private-title-after' } }, LATER);
  assert.equal(updated.record.notes[0]?.body, 'private-note-marker');
  assert.ok(updated.record.tags.includes('private-tag-marker'));
  const input = { cases: [updated.record] };
  const item = buildComparisonLedgerIndex(input).items[0];
  assert.ok(item);
  const details = buildComparisonLedgerDetails(input, { itemIds: [item.id] });
  const registrar = details.rows.find(row => row.field === 'Registrar');
  assert.ok(registrar);
  assert.ok(details.rows.length > 1, 'negative control: other differences really exist');
  const output = selectComparisonReportRows(details, [registrar.id]).render(details);
  assert.ok(output.includes('Earlier registrar')); assert.ok(output.includes('Later registrar'));
  for (const hidden of ['private-title-before', 'private-title-after', 'private-tag-marker', 'private-note-marker']) {
    assert.equal(output.includes(hidden), false, hidden);
  }
  assert.ok(output.includes('registrar change is not evidence of new ownership'));
  assert.ok(output.includes(`Observed: "${EARLIER}"`));
  assert.ok(output.includes(`Observed: "${LATER}"`));
  assert.ok(output.includes('Retained locally: Not retained in this projection'));
});
