import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CASE_VIEWS_SCHEMA, MAX_CASE_VIEWS, MAX_CASE_VIEWS_BYTES, type CaseViewFilters } from '../packages/contracts/case-views-contract.mts';
import { emptyCaseViewsStore, mergeCaseViews, normalizeCaseViewFilters, normalizeCaseViewsStore, serializeCaseViewsStore } from '../packages/workspace/case-views.mts';
import { filterCaseList } from '../packages/cases/case-list-view.mts';
import { createCase } from '../packages/cases/case-model.mts';
import { caseNumber } from '../packages/cases/case-workflow-metadata.mts';
import { buildWorkspaceArchive, previewWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { decryptWorkspaceArchive, encryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';
import { CASE_VIEWS_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';

const now = '2026-04-04T00:00:00.000Z';
const later = '2026-04-05T00:00:00.000Z';
const filters: CaseViewFilters = { status: '', disposition: '', search: '', sort: 'updated' };
const fixture = JSON.parse(readFileSync(new URL('./fixtures/extracted-domain-lifecycle/case-views-v1.json', import.meta.url), 'utf8'));
const view = { id: 'first-view', name: 'Review next', filters, createdAt: now, updatedAt: now };
const store = (...views: unknown[]) => ({ ...emptyCaseViewsStore(), views });

test('saved views preserve exact ordinary filters through the real collection split and join', () => {
  const admitted = normalizeCaseViewsStore(fixture);
  assert.deepEqual(admitted, fixture);
  const records = CASE_VIEWS_COLLECTION.split(admitted);
  assert.deepEqual(CASE_VIEWS_COLLECTION.normalize(CASE_VIEWS_COLLECTION.join(records, 1)), fixture);
  assert.equal(serializeCaseViewsStore(fixture), JSON.stringify(fixture));
  assert.deepEqual(normalizeCaseViewsStore(null), { schema: CASE_VIEWS_SCHEMA, version: 1, views: [] });
  const copy = normalizeCaseViewsStore(store(view));
  view.name = 'Changed caller';
  assert.equal(copy.views[0]?.name, 'Review next');
  view.name = 'Review next';
});

test('future, malformed, duplicate and unknown saved-view values fail without sanitising away intent', () => {
  for (const raw of [
    { ...store(view), version: 2 }, { ...store(view), version: '1' }, { ...store(view), extra: true },
    store(view, view), store({ ...view, id: '../other' }), store({ ...view, name: '' }),
    store({ ...view, name: 'x'.repeat(81) }), store({ ...view, filters: { ...filters, search: 'x'.repeat(513) } }),
    store({ ...view, filters: { ...filters, status: 'future' } }), store({ ...view, filters: { ...filters, disposition: 'safe' } }),
    store({ ...view, filters: { ...filters, sort: 'future' } }), store({ ...view, filters: { ...filters, targets: [] } }),
    store({ ...view, updatedAt: '2026-04-04' }), store({ ...view, createdAt: later }),
    store({ ...view, name: 'line\nbreak' }), store({ ...view, extra: 'unreviewed' }),
  ]) {
    const before = structuredClone(raw);
    assert.throws(() => normalizeCaseViewsStore(raw));
    assert.deepEqual(raw, before);
  }
  let getterCalls = 0;
  const hostile = { ...view, get filters() { getterCalls += 1; return filters; } };
  assert.throws(() => normalizeCaseViewsStore(store(hostile)), /accessor/u);
  assert.equal(getterCalls, 0);
  assert.throws(() => normalizeCaseViewFilters(Object.assign(Object.create({ status: '' }), filters)), /prototype/u);
});

test('all 100 maximum-text views fit the declared byte budget without losing any view', () => {
  const input = store(...Array.from({ length: MAX_CASE_VIEWS }, (_, index) => ({ ...view,
    // Lone surrogate code units take six JSON bytes each, exceeding ordinary Unicode text.
    id: `${index}-`.padEnd(128, 'x'), name: '\ud800'.repeat(80), filters: { ...filters, search: '\ud800'.repeat(512) },
  })));
  const retained = normalizeCaseViewsStore(input);
  assert.equal(retained.views.length, 100);
  assert.ok(Buffer.byteLength(serializeCaseViewsStore(retained)) < MAX_CASE_VIEWS_BYTES);
  assert.throws(() => normalizeCaseViewsStore(store(...input.views, { ...view, id: 'excess' })), /100/u);
  assert.equal(input.views.length, 100);
});

test('view merges keep omitted and equal-time conflicting definitions and reject capacity loss', () => {
  const local = store(view, { ...view, id: 'keep', name: 'Only local' });
  const incoming = store({ ...view, name: 'Renamed', updatedAt: later }, { ...view, id: 'new' });
  const merged = mergeCaseViews(local, incoming);
  assert.deepEqual({ added: merged.added, updated: merged.updated, skipped: merged.skipped }, { added: 1, updated: 1, skipped: 0 });
  assert.equal(merged.store.views.find(item => item.id === 'keep')?.name, 'Only local');
  assert.deepEqual(mergeCaseViews(local, emptyCaseViewsStore()).store, local);
  const conflict = mergeCaseViews(local, store({ ...view, name: 'Different at same time' }));
  assert.equal(conflict.skipped, 1); assert.deepEqual(conflict.store, local);
  const recreated = mergeCaseViews(local, store({ ...view, name: 'Different creation', createdAt: later, updatedAt: later }));
  assert.equal(recreated.skipped, 1); assert.deepEqual(recreated.store, local);
  const full = store(...Array.from({ length: 100 }, (_, index) => ({ ...view, id: `view-${index}` })));
  assert.throws(() => mergeCaseViews(full, store(view)), /100/u);
  assert.equal(full.views.length, 100);
});

test('temporary and saved filters retain existing title, domain, ID, type, tag and sort behaviour', () => {
  const first = { ...createCase({ domain: 'zeta.example', source: 'manual', tags: ['case-type:phishing', 'urgent'], title: 'First review' }, now), id: '00000000-0000-4000-8000-000000000001', status: 'monitoring' as const, disposition: 'suspicious' as const };
  const second = { ...createCase({ domain: 'alpha.example', source: 'manual' }, later), status: 'reviewing' as const };
  const input = [first, second];
  for (const search of ['FIRST REVIEW', 'zeta.example', 'URGENT', 'phishing', caseNumber(first.id)]) {
    assert.deepEqual(filterCaseList(input, { ...filters, search }).map(item => item.id), [first.id]);
  }
  assert.deepEqual(filterCaseList(input, { ...filters, status: 'monitoring', disposition: 'suspicious' }).map(item => item.id), [first.id]);
  for (const sort of ['updated', 'domain', 'status'] as const) assert.deepEqual(filterCaseList(input, { ...filters, sort }).map(item => item.id), [second.id, first.id]);
  assert.deepEqual(input, [first, second]);
  assert.deepEqual(filterCaseList(input, { ...filters, disposition: 'confirmed_abuse' }), []);
});

test('archive v9 includes saved views while every frozen public archive gains only an empty view section', async () => {
  const archive = await buildWorkspaceArchive({ caseViews: fixture }, { generatedAt: now });
  assert.equal(archive.version, 9);
  assert.equal(archive.manifest.sectionCount, 14);
  assert.deepEqual(archive.sections.caseViews, fixture);
  const preview = await previewWorkspaceArchive(archive, { caseViews: store(view) }, { selectedSectionIds: ['caseViews'] });
  assert.deepEqual(preview.sections.find(section => section.id === 'caseViews')?.data, fixture);
  assert.equal(preview.sections.find(section => section.id === 'caseViews')?.added, 1);
  for (const version of [5, 6, 7, 8]) {
    const name = version === 5 ? 'workspace-archive-v5-public.json' : `workspace-archive-v${version}-empty-current.json`;
    const raw = JSON.parse(readFileSync(new URL(`./fixtures/case-lifecycle/${name}`, import.meta.url), 'utf8'));
    const before = JSON.stringify(raw);
    const read = await readWorkspaceArchive(raw);
    assert.equal(read.sourceVersion, version);
    assert.deepEqual(read.sections.find(section => section.id === 'caseViews')?.data, emptyCaseViewsStore());
    const merged = await previewWorkspaceArchive(raw, { caseViews: fixture });
    assert.equal(merged.sections.find(section => section.id === 'caseViews')?.updated, 0);
    assert.equal(JSON.stringify(raw), before);
  }
  await assert.rejects(readWorkspaceArchive({ ...archive, version: 8 }), /exact required section/u);
  await assert.rejects(readWorkspaceArchive({ ...archive, version: 10 }), /newer/u);
});

test('encrypted archive v9 restores the view definition without exposing its search in the envelope', async () => {
  const archive = await buildWorkspaceArchive({ caseViews: fixture }, { generatedAt: now });
  const passphrase = 'Reserved recovery fixture only';
  const encrypted = await encryptWorkspaceArchive(archive, passphrase);
  assert.equal(JSON.stringify(encrypted).includes('Monitoring phishing Cases'), false);
  const restored = await readWorkspaceArchive(await decryptWorkspaceArchive(encrypted, passphrase));
  assert.deepEqual(restored.sections.find(section => section.id === 'caseViews')?.data, fixture);
});
