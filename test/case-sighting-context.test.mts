import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createCase, updateCase, normalizeCaseStore, serializeCaseStore, buildCaseExport, mergeCases } from '../packages/cases/case-model.mts';
import { CASE_SCHEMA_VERSION, COLLECTION_RECEIPT_CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { readCaseSightingContext } from '../packages/cases/case-sighting-context.mts';
import { projectCaseForAudience } from '../packages/cases/case-record-projection.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { buildCliCasePack, verifyCliCasePack } from '../cli/case-pack.mts';
import { buildWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { removeCaseAttachment } from '../packages/cases/case-attachment-model.mts';

const NOW = '2026-10-01T00:00:00.000Z';
const context = { version: 1 as const, channel: 'search_result' as const, deviceClass: 'mobile' as const,
  declaredCountryCode: 'AU', reviewedPathSupplied: 'yes' as const, captureAttachmentId: null };
const sighting = { state: 'analyst_confirmed' as const, category: 'website' as const, source: 'Selected capture', observedAt: NOW,
  completeness: 'partial' as const, limitations: ['One supplied capture.'], context };

test('typed per-sighting declarations survive real private writers, imports, packs and workspace archives', async () => {
  const original = createCase({ domain: 'review.example', sighting }, NOW), before = structuredClone(original);
  const stored = normalizeCaseStore(JSON.parse(serializeCaseStore([original]))).cases[0]!;
  const exported = buildCaseExport([stored], NOW);
  const pack = buildCliCasePack(JSON.stringify(exported), { audience: 'internal', reviewed: true }, NOW);
  assert.equal(verifyCliCasePack(pack).caseCount, 1);
  for (const document of [exported, pack]) {
    const restored = mergeCases([], document).cases[0]!;
    assert.deepEqual(restored.sightings[0]!.context, context);
    assert.equal(restored.sightings[0]!.sourceClass, 'analyst');
    assert.equal(restored.sightings[0]!.completeness, 'partial');
  }
  const archive = await buildWorkspaceArchive({ cases: [original] }, { generatedAt: NOW });
  const read = await readWorkspaceArchive(archive);
  assert.equal(read.sections.find(section => section.id === 'cases')?.status, 'ready');
  const restoredSection = read.sections.find(section => section.id === 'cases')!;
  assert.deepEqual(mergeCases([], restoredSection.data).cases[0]!.sightings[0]!.context, context);
  assert.deepEqual(original, before);
});

test('shared projections and ordinary reports omit private context without removing the sighting', () => {
  const original = createCase({ domain: 'review.example', sighting }, NOW);
  for (const audience of ['trusted', 'public'] as const) {
    const shared = projectCaseForAudience(original, audience);
    assert.equal(shared.sightings.length, 1);
    assert.equal(shared.sightings[0]!.context, undefined);
    const pack = buildCliCasePack(JSON.stringify(buildCaseExport([original], NOW)), { audience, reviewed: true }, NOW);
    assert.equal(verifyCliCasePack(pack).caseCount, 1);
    assert.equal(JSON.stringify(pack).includes('declaredCountryCode'), false);
  }
  assert.equal(buildCaseReport(original, { generatedAt: NOW }).json.analystResponse.sightings[0]!.context, undefined);
  assert.deepEqual(original.sightings[0]!.context, context);
});

test('historical context stays unknown, declared old formats cannot carry new fields, and future inputs fail closed', () => {
  const historical = JSON.parse(readFileSync(new URL('./fixtures/case-lifecycle/browser-case-v20.json', import.meta.url), 'utf8'));
  const restored = normalizeCaseStore(historical);
  assert.equal(restored.version, CASE_SCHEMA_VERSION);
  assert.ok(restored.cases.every(record => record.sightings.every(item => item.context === undefined)));
  const record = createCase({ domain: 'review.example', sighting }, NOW);
  assert.throws(() => mergeCases([], { version: COLLECTION_RECEIPT_CASE_SCHEMA_VERSION, cases: [record] }), TypeError);
  assert.throws(() => mergeCases([], { version: CASE_SCHEMA_VERSION + 1, cases: [record] }));
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/case-lifecycle/case-export-v21-context.json', import.meta.url), 'utf8'));
  assert.deepEqual(mergeCases([], fixture).cases[0]!.sightings.at(-1)!.context, context);
});

test('context is bounded, excludes private material, and capture references must identify this Case', () => {
  for (const patch of [{ version: 2 }, { channel: 'invented' }, { deviceClass: 'invented' }, { declaredCountryCode: 'precise location' },
    { reviewedPathSupplied: true }, { captureAttachmentId: 'https://private.example/path?token=secret' }, { exactUrl: 'https://private.example/' }]) {
    assert.throws(() => readCaseSightingContext({ ...context, ...patch }), TypeError);
  }
  const original = createCase({ domain: 'review.example' }, NOW);
  assert.throws(() => updateCase([original], original.id, { sighting: { ...sighting, context: { ...context, captureAttachmentId: 'missing-file' } } }, NOW), TypeError);
  const attachment = { id: 'retained-capture', fileName: 'capture.png', mediaType: 'image/png' as const, source: 'Selected file', observedAt: NOW,
    retainedAt: NOW, digestSha256: `sha256:${'a'.repeat(64)}`, byteLength: 1 };
  original.attachments = [attachment];
  const updated = updateCase([original], original.id, { sighting: { ...sighting, context: { ...context, captureAttachmentId: attachment.id } } }, NOW).record!;
  assert.equal(updated.sightings[0]!.context!.captureAttachmentId, attachment.id);
  assert.equal(updated.sightings[0]!.evidencePinId, null);
  const removed = removeCaseAttachment(updated, attachment.id, attachment, NOW);
  const retained = normalizeCaseStore(JSON.parse(serializeCaseStore([removed]))).cases[0]!;
  assert.equal(retained.attachments!.length, 0);
  assert.equal(retained.sightings[0]!.context!.captureAttachmentId, attachment.id);
});
