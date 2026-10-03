import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareTemplateLessonRevision } from '../packages/workspace/template-lesson-revision.mts';
import { buildInvestigationTemplateExport, createInvestigationTemplate, mergeInvestigationTemplates, normalizeInvestigationTemplateStore } from '../packages/workspace/investigation-template-model.mts';
import { buildCacaoInvestigationPlaybook, parseCacaoInvestigationPlaybook } from '../packages/interchange/investigation-playbook-interchange.mts';
import { buildWorkspaceArchive, readWorkspaceArchive, previewWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { sha256ArtifactDigestV2 } from '../packages/evidence/artifact-integrity.mts';

const NOW = '2026-09-20T00:00:00.000Z';
const lesson = 'Private Case lesson: retain the rejected observation, reference private-detail-canary.';
function base() {
  return createInvestigationTemplate({ id: 'original-guide', label: 'Review source dates', recipeId: 'new_domain_triage',
    stages: [{ id: 'lookup' }, { id: 'monitor' }],
  }, { now: NOW });
}
function proposal() {
  const original = base();
  return { ...original, id: 'revised-guide', label: 'Review conflicting dates',
    stages: original.stages.map((stage, index) => index ? stage : { ...stage, instructions: ['Compare source dates.'], completionCriteria: 'Record the source date or why it is unavailable.' }) };
}
const context = { applicability: 'Reviews with conflicting observation times.', rationale: 'Keep the observation and collection times separate.', now: NOW };

test('lesson revision is a deliberate fork with exact guidance changes and content-only provenance', async () => {
  const original = base();
  const before = structuredClone(original);
  const { candidate, changes } = await prepareTemplateLessonRevision(original, proposal(), lesson, context);
  assert.notEqual(candidate.id, original.id);
  assert.deepEqual(original, before);
  assert.equal(candidate.stages[0]?.requiresApproval, true);
  assert.deepEqual(candidate.lessonRevision, {
    parentTemplateId: original.id, parentContentSha256: (await sha256ArtifactDigestV2(original)).slice(7),
    lessonContentSha256: (await sha256ArtifactDigestV2({ body: lesson })).slice(7), canonicalization: 'sorted-json-v2',
    applicability: context.applicability, rationale: context.rationale,
  });
  assert.ok(changes.some(row => row.label.endsWith('Completion criteria') && row.after === proposal().stages[0]?.completionCriteria));
  assert.ok(changes.some(row => row.label.endsWith('Instructions') && row.after === 'Compare source dates.'));
  assert.equal(JSON.stringify(candidate).includes('private-detail-canary'), false);
  assert.equal(JSON.stringify(candidate).includes('Private Case lesson'), false);
  assert.deepEqual(Object.keys(candidate.lessonRevision!).sort(), ['applicability', 'canonicalization', 'lessonContentSha256', 'parentContentSha256', 'parentTemplateId', 'rationale']);
});

test('authored revisions reject identity reuse, silent normalisation and cosmetic-only edits', async () => {
  for (const proposed of [base(), { ...base(), id: 'new' }, { ...proposal(), recipeId: 'brand_discovery' },
    { ...proposal(), label: 'x'.repeat(81) },
    { ...proposal(), stages: [{ ...proposal().stages[0], instructions: Array(7).fill('One step') }] },
    { ...proposal(), stages: [{ ...proposal().stages[0], detail: '' }] },
    { ...proposal(), stages: [null] },
  ]) await assert.rejects(prepareTemplateLessonRevision(base(), proposed, lesson, context));
  for (const body of ['', 'x'.repeat(2001)]) await assert.rejects(prepareTemplateLessonRevision(base(), proposal(), body, context));
  for (const applicability of ['', ' ', 'x'.repeat(401)]) await assert.rejects(prepareTemplateLessonRevision(base(), proposal(), lesson, { ...context, applicability }));
});

test('revision origin survives current JSON, CACAO and workspace export without the private lesson', async () => {
  const { candidate } = await prepareTemplateLessonRevision(base(), proposal(), lesson, context);
  const json = buildInvestigationTemplateExport([base(), candidate], NOW);
  assert.equal(json.version, 3);
  assert.deepEqual(mergeInvestigationTemplates([], json).templates.find(row => row.id === candidate.id), candidate);
  const playbook = buildCacaoInvestigationPlaybook(candidate);
  assert.deepEqual(parseCacaoInvestigationPlaybook(playbook), candidate);
  const archive = await buildWorkspaceArchive({ investigationTemplates: [base(), candidate] }, { generatedAt: NOW });
  const read = await readWorkspaceArchive(archive);
  assert.equal(read.sections.find(row => row.id === 'investigationTemplates')?.status, 'ready');
  const preview = await previewWorkspaceArchive(archive, {});
  assert.equal(preview.sections.find(row => row.id === 'investigationTemplates')?.added, 2);
  assert.equal(preview.sections.find(row => row.id === 'investigationTemplates')?.status, 'ready');
  assert.equal(JSON.stringify([json, playbook, archive]).includes('private-detail-canary'), false);
});

test('historical templates remain readable while declarations reject new provenance and future versions', async () => {
  const old = JSON.parse(await readFile(new URL('./fixtures/extracted-domain-lifecycle/investigation-cacao-profile-v2.json', import.meta.url), 'utf8'));
  const read = parseCacaoInvestigationPlaybook(old);
  assert.equal(read.lessonRevision, undefined);
  const legacy = { schema: 'whoisleuth.investigation-templates', version: 2, templates: [base()] };
  assert.equal(normalizeInvestigationTemplateStore(legacy).version, 3);
  assert.equal(normalizeInvestigationTemplateStore(legacy).templates[0]?.lessonRevision, undefined);
  const { candidate } = await prepareTemplateLessonRevision(base(), proposal(), lesson, context);
  assert.throws(() => normalizeInvestigationTemplateStore({ ...legacy, templates: [candidate] }), /requires schema 3/);
  const profile = Object.values(old.playbook_extensions)[0] as Record<string, unknown>;
  profile.lesson_revision = candidate.lessonRevision;
  assert.throws(() => parseCacaoInvestigationPlaybook(old), /requires restricted profile 3/);
  const current = buildInvestigationTemplateExport([candidate], NOW);
  assert.throws(() => mergeInvestigationTemplates([], { ...current, version: 4 }), /newer schema/);
});

test('malformed provenance cannot be silently repaired or carried through imports', async () => {
  const { candidate } = await prepareTemplateLessonRevision(base(), proposal(), lesson, context);
  for (const change of [{ rationale: ' ' }, { applicability: '' }, { parentTemplateId: '../bad' }, { lessonContentSha256: 'missing' }, { canonicalization: 'sorted-json-v1' }, { caseId: 'private-case-canary' }]) {
    assert.throws(() => normalizeInvestigationTemplateStore([{ ...candidate, lessonRevision: { ...candidate.lessonRevision, ...change } }]));
  }
  const original = structuredClone(candidate);
  const edited = createInvestigationTemplate({ ...candidate, label: 'Later explicit edit' }, { now: '2026-09-21T00:00:00.000Z' });
  assert.deepEqual(edited.lessonRevision, original.lessonRevision);
  assert.notEqual(edited.updatedAt, original.updatedAt);
});
