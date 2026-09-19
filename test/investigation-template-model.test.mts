import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVESTIGATION_TEMPLATE_SCHEMA,
  INVESTIGATION_TEMPLATE_VERSION,
  MAX_INVESTIGATION_TEMPLATES,
  buildInvestigationTemplateExport,
  createInvestigationTemplate,
  mergeInvestigationTemplates,
  normalizeInvestigationTemplate,
  normalizeInvestigationTemplateStore,
  serializeInvestigationTemplateStore,
  saveInvestigationTemplate,
} from '../frontend/src/lib/analysis/investigation-template-model.ts';

const CREATED_AT = '2026-07-28T01:00:00.000Z';
const UPDATED_AT = '2026-07-28T02:00:00.000Z';

function candidate(id = 'focused-review') {
  return {
    id,
    label: 'Focused review',
    summary: 'Review bounded evidence with explicit approval.',
    recipeId: 'new_domain_triage',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    stages: [
      {
        id: 'lookup',
        label: 'Collect focused evidence',
        detail: 'Review one bounded target.',
        expectedEvidence: 'Separately attributed evidence.',
        completionCriteria: 'Every source state was reviewed.',
        instructions: ['Run a Deep lookup.', 'Review unavailable sources.'],
        requiresApproval: false,
      },
      { id: 'bulk', enabled: false },
      { id: 'monitor', label: 'Record an analyst decision', requiresApproval: true },
    ],
  };
}

test('normalizes only allowlisted steps and preserves mandatory request gates', () => {
  const normalized = normalizeInvestigationTemplate({
    ...candidate(),
    stages: [
      ...candidate().stages,
      {
        id: 'invented',
        workspace: 'external',
        path: 'https://outside.invalid',
        instructions: ['Run arbitrary code.'],
      },
    ],
    credentials: 'drop',
  });
  assert.ok(normalized);
  assert.deepEqual(normalized.stages.map((stage) => stage.id), ['lookup', 'monitor']);
  assert.equal(normalized.stages[0]?.requiresApproval, true);
  assert.equal(normalized.stages[1]?.requiresApproval, true);
  assert.equal(normalized.stages[0]?.workspace, 'lookup');
  assert.equal(normalized.stages[0]?.path, '/lookup');
  assert.equal('credentials' in normalized, false);
  assert.equal(JSON.stringify(normalized).includes('outside.invalid'), false);
});

test('creates bounded timestamps and rejects templates without an allowlisted step', () => {
  const created = createInvestigationTemplate({
    ...candidate(''),
    id: undefined,
    createdAt: undefined,
  }, { now: CREATED_AT, makeId: () => 'generated-template' });
  assert.equal(created.id, 'generated-template');
  assert.equal(created.createdAt, CREATED_AT);
  assert.equal(created.updatedAt, CREATED_AT);

  assert.throws(() => createInvestigationTemplate({
    ...candidate(),
    stages: [{ id: 'invented' }],
  }, { now: CREATED_AT, makeId: () => 'unused' }), /incomplete or invalid/u);
});

test('caps, sorts, serializes, and refuses future local collections', () => {
  const templates = Array.from({ length: MAX_INVESTIGATION_TEMPLATES + 5 }, (_, index) => ({
    ...candidate(`template-${index}`),
    updatedAt: new Date(Date.parse(UPDATED_AT) + index * 1000).toISOString(),
  }));
  const normalized = normalizeInvestigationTemplateStore(templates);
  assert.equal(normalized.templates.length, MAX_INVESTIGATION_TEMPLATES);
  assert.equal(normalized.templates[0]?.id, `template-${templates.length - 1}`);
  assert.equal(JSON.parse(serializeInvestigationTemplateStore(templates)).templates.length, MAX_INVESTIGATION_TEMPLATES);
  assert.throws(() => normalizeInvestigationTemplateStore({
    schema: INVESTIGATION_TEMPLATE_SCHEMA,
    version: INVESTIGATION_TEMPLATE_VERSION + 1,
    templates: [],
  }), /unsupported.*no data was changed/u);
});

test('exports and non-destructively merges only the strict versioned schema', () => {
  const exported = buildInvestigationTemplateExport([candidate()], UPDATED_AT);
  assert.equal(exported.schema, INVESTIGATION_TEMPLATE_SCHEMA);
  assert.equal(exported.version, INVESTIGATION_TEMPLATE_VERSION);
  assert.match(exported.limitations.join(' '), /cannot run code/u);

  const result = mergeInvestigationTemplates([candidate('local')], exported);
  assert.equal(result.added, 1);
  assert.equal(result.updated, 0);
  assert.deepEqual(result.templates.map((item) => item.id).sort(), ['focused-review', 'local']);

  const updated = mergeInvestigationTemplates(result.templates, {
    ...exported,
    templates: [{ ...candidate(), label: 'Updated review', updatedAt: '2026-07-29T00:00:00Z' }],
  });
  assert.equal(updated.updated, 1);
  assert.equal(updated.templates.find((item) => item.id === 'focused-review')?.label, 'Updated review');
  assert.throws(() => mergeInvestigationTemplates([], { templates: [candidate()] }), /versioned/u);
  assert.throws(() => mergeInvestigationTemplates([], {
    ...exported,
    version: INVESTIGATION_TEMPLATE_VERSION + 1,
  }), /newer schema/u);

  const unsupported = { ...exported, version: 1 };
  const before = structuredClone(unsupported);
  assert.throws(() => mergeInvestigationTemplates([], unsupported), /schema 2/u);
  assert.deepEqual(unsupported, before);
});

test('full template collections refuse a new save or import without deleting existing work', () => {
  const local = Array.from({ length: MAX_INVESTIGATION_TEMPLATES }, (_, index) => candidate(`template-${index}`));
  const before = structuredClone(local);
  assert.throws(() => saveInvestigationTemplate(local, candidate('new-template')), /storage is full.*no templates were changed/u);
  const updated = saveInvestigationTemplate(local, { ...candidate('template-0'), label: 'Edited existing template' });
  assert.equal(updated.length, MAX_INVESTIGATION_TEMPLATES);
  assert.equal(updated.find((item) => item.id === 'template-0')?.label, 'Edited existing template');
  const imported = mergeInvestigationTemplates(local, buildInvestigationTemplateExport([candidate('imported')]));
  assert.deepEqual(imported.templates, normalizeInvestigationTemplateStore(local).templates);
  assert.deepEqual({ added: imported.added, updated: imported.updated, skipped: imported.skipped, pruned: imported.pruned }, { added: 0, updated: 0, skipped: 1, pruned: 0 });
  assert.deepEqual(local, before);
});

test('template imports leave timestamp ties and older guidance unchanged', () => {
  const local = [candidate()];
  for (const updatedAt of [CREATED_AT, UPDATED_AT]) {
    const result = mergeInvestigationTemplates(local, buildInvestigationTemplateExport([{ ...candidate(), updatedAt, label: 'Different guidance' }]));
    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.templates[0]?.label, 'Focused review');
  }
});
