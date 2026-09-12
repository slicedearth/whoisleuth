import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CASE_SCHEMA_VERSION, buildCaseExport, createCase, createCaseIncident, mergeCases, normalizeCaseStore,
  openOrCreateCase, selectedCasesByDomain, updateCase,
} from '../packages/cases/case-model.mts';
import { projectCaseForAudience } from '../packages/cases/case-record-projection.mts';
import { buildCampaignReviewSummary } from '../frontend/src/lib/analysis/campaign-review-summary.ts';
import { buildCampaignTemporalReview } from '../packages/investigation/campaign-temporal-review.mts';

const BEFORE = '2026-08-20T00:00:00.000Z';
const AFTER = '2026-08-22T00:00:00.000Z';
function incidents() {
  const first = createCase({ domain: 'example.test', title: 'Credential page review', note: 'First incident only',
    evidence: { capturedAt: BEFORE, firstCapturedAt: BEFORE, scanDepth: 'fast', availability: 'registered', inputHostname: 'login.example.test' } }, BEFORE);
  const opened = createCaseIncident([first], { domain: 'example.test', title: 'Separate impersonation report',
    reuse: { caseId: first.id, snapshotId: first.evidenceHistory[0]!.id } }, AFTER);
  return { first, second: opened.record, records: opened.cases };
}

test('distinct same-domain incidents retain identity and share only the selected immutable observation', () => {
  const { first, second, records } = incidents();
  assert.notEqual(first.id, second.id);
  assert.equal(first.title, 'Credential page review');
  assert.equal(second.title, 'Separate impersonation report');
  assert.deepEqual(second.evidenceHistory, first.evidenceHistory);
  assert.equal(second.evidenceHistory[0]?.capturedAt, BEFORE);
  assert.deepEqual(second.notes, []);
  assert.deepEqual(second.decisions, []);
  assert.equal(normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: records }).cases.length, 2);
  const edited = updateCase(records, second.id, { note: 'Second incident only', title: 'Revised incident title' }, AFTER);
  assert.equal(edited.cases.find(record => record.id === first.id)?.notes[0]?.body, 'First incident only');
  assert.equal(edited.cases.find(record => record.id === first.id)?.title, first.title);
  assert.equal(edited.record.notes[0]?.body, 'Second incident only');
});

test('domain-only writes cannot choose an incident and explicit selection cannot cross domains', () => {
  const { first, second, records } = incidents();
  assert.throws(() => openOrCreateCase(records, { domain: first.domain }, AFTER), /Select the intended incident/u);
  assert.equal(openOrCreateCase(records, { domain: first.domain }, AFTER, { caseId: first.id }).record.id, first.id);
  assert.throws(() => openOrCreateCase(records, { domain: 'other.example' }, AFTER, { caseId: second.id }), /no longer available/u);
  assert.throws(() => openOrCreateCase(records, { domain: first.domain }, AFTER, { caseId: first.id, newIncident: true }), /not both/u);
  assert.equal(selectedCasesByDomain(records).size, 0);
  assert.equal(selectedCasesByDomain(records, new Map([[first.domain, second.id]])).get(first.domain)?.id, second.id);
  assert.equal(selectedCasesByDomain([first]).get(first.domain)?.id, first.id);
});

test('title edits reject a stale baseline without overwriting another incident or newer title', () => {
  const { first, second, records } = incidents();
  const newer = updateCase(records, first.id, { title: 'Another reviewed title', expectedTitle: first.title! }, AFTER);
  const unchanged = structuredClone(newer.cases);
  assert.throws(() => updateCase(newer.cases, first.id, { title: 'Older draft', expectedTitle: first.title! }, AFTER), /title changed after this draft/u);
  assert.deepEqual(newer.cases, unchanged);
  const reviewed = updateCase(newer.cases, first.id, { title: 'Older draft', expectedTitle: 'Another reviewed title' }, AFTER);
  assert.equal(reviewed.record.title, 'Older draft');
  assert.equal(reviewed.cases.find(record => record.id === second.id)?.title, second.title);
  assert.equal(Object.hasOwn(reviewed.record, 'expectedTitle'), false);
});

test('current export and repeated import preserve both identities without merging unrelated decisions', () => {
  const { first, second, records } = incidents();
  const exported = buildCaseExport(records, AFTER);
  const restored = mergeCases([], exported);
  assert.equal(restored.added, 2);
  assert.deepEqual(restored.cases.map(record => record.id).sort(), [first.id, second.id].sort());
  assert.equal(mergeCases(restored.cases, exported).added, 0);
  const separate = createCase({ domain: first.domain, title: 'Third incident' }, AFTER);
  const imported = mergeCases(records, buildCaseExport([separate], AFTER));
  assert.equal(imported.added, 1);
  assert.equal(imported.cases.length, 3);
  assert.equal(imported.cases.find(record => record.id === first.id)?.notes.length, 1);
  assert.equal(imported.cases.find(record => record.id === separate.id)?.notes.length, 0);
});

test('legacy exports merge only into an unambiguous domain or matching stable identity', () => {
  const { first, second, records } = incidents();
  const legacy = { version: 15, cases: [{ ...first, id: 'legacy-other-id' }] };
  assert.equal(normalizeCaseStore(legacy).cases[0]?.title, '', 'An undeclared legacy title is not current evidence.');
  assert.equal(mergeCases([first], legacy).updated, 1);
  const before = structuredClone(records);
  assert.throws(() => mergeCases(records, legacy), /several incidents exist/u);
  assert.deepEqual(records, before);
  assert.throws(() => mergeCases(records, { version: CASE_SCHEMA_VERSION, cases: [{ domain: first.domain }] }), /several incidents exist/u);
  assert.equal(mergeCases(records, { version: 15, cases: [second] }).updated, 1);
  assert.throws(() => mergeCases(records, { version: CASE_SCHEMA_VERSION, cases: [{ ...first, domain: 'other.example' }] }), /different domain/u);
  const legacyCollision = mergeCases([first], { version: 15, cases: [{ ...first, domain: 'other.example', evidenceHistory: [] }] });
  assert.equal(legacyCollision.added, 1);
  assert.equal(new Set(legacyCollision.cases.map(record => record.id)).size, 2);
});

test('titles are retained locally and excluded independently from public and trusted outputs', () => {
  const { first } = incidents();
  assert.equal(projectCaseForAudience(first, 'internal').title, 'Credential page review');
  for (const audience of ['public', 'trusted'] as const) {
    const projected = projectCaseForAudience(first, audience);
    assert.equal(projected.title, '');
    assert.ok(!JSON.stringify(projected).includes('Credential page review'));
  }
  assert.throws(() => createCaseIncident([first], { domain: first.domain, title: 'x'.repeat(321) }), /limited to 320/u);
  assert.throws(() => createCaseIncident([first], { domain: first.domain, title: 'New incident', reuse: { caseId: first.id, snapshotId: 'missing' } }), /no longer available/u);
});

test('campaign counts distinguish incident records from missing domain members', () => {
  const { records } = incidents();
  const domains = ['example.test', 'missing.test'];
  const summary = buildCampaignReviewSummary(domains, records);
  assert.equal(summary.memberCount, 2);
  assert.equal(summary.linkedCaseCount, 2);
  assert.equal(summary.unavailableCaseCount, 1);
  const temporalRecords = records.map(record => updateCase([record], record.id, {
    evidencePin: { category: 'dns', field: 'dns.ns', label: 'Observed nameserver', value: 'ns1.example.test', source: 'Fixture DNS', observedAt: BEFORE, completeness: 'complete' },
  }, AFTER).record);
  const temporal = buildCampaignTemporalReview(domains, temporalRecords);
  assert.equal(temporal.linkedCaseCount, 2);
  assert.equal(temporal.unavailableCaseCount, 1);
  assert.equal(temporal.events.length, 1);
  assert.deepEqual(temporal.transitions.map(item => item.domain), ['example.test']);
});
