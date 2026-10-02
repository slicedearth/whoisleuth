import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCase, updateCase, normalizeCaseStore, mergeCases, CASE_SCHEMA_VERSION, projectCaseForAudience } from '../packages/cases/case-model.mts';
import { buildCliCasePack, verifyCliCasePack } from '../cli/case-pack.mts';
import { caseIncidentTargets, caseNumber, caseResponseIncidentUrls, caseTypeIds, caseTypeSummary,
  formattedCaseNumber, normalizeCaseIncidentTargetUrl, readCaseWorkflowMetadata,
  MAX_CASE_INCIDENT_TARGETS, MAX_CASE_INCIDENT_TARGET_HISTORY } from '../packages/cases/case-workflow-metadata.mts';

const NOW = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-05T00:00:00.000Z';
const domain = 'example.test';

describe('Case workflow metadata', () => {
  test('keeps controlled types separate from literal tags and assertions', () => {
    const record = createCase({ domain, tags: ['case-type:phishing', 'priority'], caseTypes: ['impersonation'],
      assertion: { kind: 'unknown', statement: 'Incident target URL: https://literal.example/', state: 'open' } }, NOW);
    assert.deepEqual(caseTypeIds(record), ['impersonation']);
    assert.equal(caseTypeSummary(record), 'Impersonation');
    assert.deepEqual(record.tags, ['case-type:phishing', 'priority']);
    assert.deepEqual(caseIncidentTargets(record), []);
    const reread = normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: [record] }).cases[0]!;
    assert.deepEqual(reread.workflowMetadata, record.workflowMetadata);
    const updated = updateCase([record], record.id, { tags: ['case-type:copyright_infringement'], caseTypes: ['phishing'] }, LATER).record;
    assert.deepEqual(caseTypeIds(updated), ['phishing']);
    assert.deepEqual(updated.tags, ['case-type:copyright_infringement']);
    assert.throws(() => updateCase([updated], record.id, { caseTypes: ['other'], expectedCaseTypes: ['impersonation'] }, LATER), /changed after this edit/);
    assert.throws(() => createCase({ domain, caseTypes: ['future_type'] }, NOW), /Unknown Case type/);
    assert.throws(() => createCase({ domain, caseTypes: ['phishing', 'phishing'] }, NOW), /unique/);
    assert.equal(createCase({ domain, tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`), caseTypes: ['phishing'] }, NOW).tags.length, 20);
  });

  test('derives a stable, readable Case number from the complete immutable id', () => {
    const first = caseNumber('018f4e5a-9b2c-7d3e-8f10-112233445566');
    assert.match(first, /^WS-[0-7][0-9A-HJKMNP-TV-Z]{25}$/u);
    assert.notEqual(first, caseNumber('018f4e5a-9b2c-7d3e-8f10-112233445567'));
    assert.equal(formattedCaseNumber('018f4e5a-9b2c-7d3e-8f10-112233445566').replaceAll('-', ''), first.replaceAll('-', ''));
    assert.match(caseNumber('legacy-case-id'), /^WS-L[0-9A-HJKMNP-TV-Z]{2}-[0-9A-HJKMNP-TV-Z]+$/u);
    assert.notEqual(caseNumber('legacy-case-id'), caseNumber('legacy-case-ie'));
  });

  test('normalises exact HTTP URLs and rejects credentials or non-web schemes', () => {
    assert.equal(normalizeCaseIncidentTargetUrl(' HTTPS://Social.Example/path?id=1#post '), 'https://social.example/path?id=1#post');
    for (const value of ['https://user:secret@social.example/path', 'javascript:alert(1)', 'not a url', `https://social.example/${'x'.repeat(2_000)}`]) assert.equal(normalizeCaseIncidentTargetUrl(value), null);
  });

  test('migrates historical text once, preserving referenced assertions and tag bytes', () => {
    const { workflowMetadata: _metadata, ...legacy } = createCase({ domain }, NOW);
    legacy.tags = ['case-type:phishing', 'campaign-a'];
    legacy.assertions = [
      { id: 'target', kind: 'unknown', statement: 'Incident target URL: https://social.example/post/7', rationale: null, evidencePinIds: [], evidenceRelations: [], state: 'open', createdAt: NOW, updatedAt: NOW },
      { id: 'context', kind: 'next_step', statement: 'Investigate incident URL: https://example.test/login?private=value', rationale: 'Objective: Review login | URL retained: exact', evidencePinIds: [], evidenceRelations: [], state: 'open', createdAt: NOW, updatedAt: NOW },
    ];
    for (const version of [16, CASE_SCHEMA_VERSION]) {
      const migrated = normalizeCaseStore({ version, cases: [legacy] }).cases[0]!;
      assert.deepEqual(caseTypeIds(migrated), ['phishing']);
      assert.deepEqual(caseResponseIncidentUrls(migrated), ['https://social.example/post/7', 'https://example.test/login?private=value']);
      assert.deepEqual(migrated.assertions, legacy.assertions);
      assert.deepEqual(migrated.tags, legacy.tags);
      const changed = updateCase([migrated], migrated.id, { caseTypes: [], incidentTargetResolution: 'target' }, LATER).record;
      const loaded = normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: [changed] }).cases[0]!;
      assert.deepEqual(caseTypeIds(loaded), []);
      assert.deepEqual(caseIncidentTargets(loaded), []);
    }
  });

  test('retains link history, rejects duplicate writes and enforces admission without discarding evidence', () => {
    let record = createCase({ domain, incidentTarget: 'https://social.example/post/0' }, NOW);
    assert.throws(() => updateCase([record], record.id, { incidentTarget: 'https://social.example/post/0' }, NOW), /already active/);
    for (let i = 1; i < MAX_CASE_INCIDENT_TARGETS; i++) record = updateCase([record], record.id, { incidentTarget: `https://social.example/post/${i}` }, NOW).record;
    assert.throws(() => updateCase([record], record.id, { incidentTarget: 'https://social.example/extra' }, NOW), /active incident links/);
    const id = record.workflowMetadata!.incidentTargets[0]!.id;
    record = updateCase([record], record.id, { incidentTargetResolution: id }, LATER).record;
    assert.equal(caseIncidentTargets(record).length, MAX_CASE_INCIDENT_TARGETS - 1);
    assert.equal(caseIncidentTargets(record, { includeResolved: true }).length, MAX_CASE_INCIDENT_TARGETS);
    assert.throws(() => updateCase([record], record.id, { incidentTargetResolution: id }, LATER), /already resolved/);
    const full = { ...record, workflowMetadata: { ...record.workflowMetadata!, incidentTargets: Array.from({ length: MAX_CASE_INCIDENT_TARGET_HISTORY }, (_, i) => ({ id: `target-${i}`, url: `https://social.example/${i}`, state: 'resolved' as const, createdAt: NOW, updatedAt: LATER })) } };
    assert.throws(() => updateCase([full], full.id, { incidentTarget: 'https://social.example/new' }, LATER), /no history was removed/);
  });

  test('strictly admits typed fields and refuses unsupported version or private origin-only payloads', () => {
    const record = createCase({ domain, incidentTarget: 'https://social.example/a' }, NOW);
    const metadata = record.workflowMetadata!;
    for (const value of [{ ...metadata, future: true }, { ...metadata, types: ['unknown'] },
      { ...metadata, incidentTargets: [...metadata.incidentTargets, ...metadata.incidentTargets] },
      { ...metadata, incidentTargets: [{ ...metadata.incidentTargets[0], updatedAt: '2020-01-01T00:00:00.000Z' }] },
      { ...metadata, investigationContext: { id: 'context', objective: 'Review', incidentUrl: 'https://example.test/private?token=value', urlRetention: 'origin_only', updatedAt: NOW } },
    ]) assert.throws(() => readCaseWorkflowMetadata(value, domain));
    assert.throws(() => normalizeCaseStore({ version: 16, cases: [record] }), /current Case schema/);
    assert.throws(() => normalizeCaseStore({ version: CASE_SCHEMA_VERSION + 1, cases: [record] }), /newer/);
    let invoked = false;
    const accessor = Object.defineProperty({}, 'types', { enumerable: true, get() { invoked = true; return []; } });
    assert.throws(() => readCaseWorkflowMetadata(accessor, domain));
    assert.equal(invoked, false);
  });

  test('merges newer target state without stale imports replacing local types or context', () => {
    const original = createCase({ domain, caseTypes: ['phishing'], incidentTarget: 'https://social.example/a',
      investigationContext: { objective: 'Original review', incidentUrl: 'https://example.test/', retainExactUrl: false } }, NOW);
    const newer = updateCase([original], original.id, { caseTypes: ['impersonation'], incidentTargetResolution: original.workflowMetadata!.incidentTargets[0]!.id,
      investigationContext: { objective: 'Later review', incidentUrl: 'https://example.test/later', retainExactUrl: true } }, LATER).record;
    const merged = mergeCases([newer], { version: CASE_SCHEMA_VERSION, cases: [original] }).cases[0]!;
    assert.deepEqual(merged.workflowMetadata, newer.workflowMetadata);
    const forward = mergeCases([original], { version: CASE_SCHEMA_VERSION, cases: [newer] }).cases[0]!;
    assert.deepEqual(forward.workflowMetadata, newer.workflowMetadata);
    const missing = mergeCases([newer], { version: CASE_SCHEMA_VERSION, cases: [{ id: original.id, domain, updatedAt: '2026-09-06T00:00:00.000Z' }] }).cases[0]!;
    assert.deepEqual(missing.workflowMetadata, newer.workflowMetadata);
    const conflicting = structuredClone(original);
    conflicting.workflowMetadata!.incidentTargets = [{ ...original.workflowMetadata!.incidentTargets[0]!, url: 'https://social.example/other' }];
    assert.throws(() => mergeCases([newer], { version: CASE_SCHEMA_VERSION, cases: [conflicting] }), /identity conflicts/);
  });

  test('keeps private context out of public exports independently of the projection policy', () => {
    const record = createCase({ domain, caseTypes: ['phishing'], incidentTarget: 'https://social.example/private-target',
      investigationContext: { objective: 'private-objective', incidentUrl: 'https://example.test/private-context?secret=sentinel', retainExactUrl: true } }, NOW);
    for (const audience of ['internal', 'trusted', 'public'] as const) {
      const pack = buildCliCasePack(JSON.stringify({ version: CASE_SCHEMA_VERSION, cases: [record] }), { audience, reviewed: true }, NOW);
      assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
      if (audience === 'public') {
        assert.doesNotMatch(JSON.stringify(pack), /private-target|private-objective|private-context|secret=sentinel/);
        assert.deepEqual(pack.cases[0]!.workflowMetadata, { types: ['phishing'], incidentTargets: [], investigationContext: null });
        assert.deepEqual(caseTypeIds(normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: [projectCaseForAudience(record, audience)] }).cases[0]!), ['phishing']);
      } else assert.match(JSON.stringify(pack), /private-target/);
    }
  });
});
