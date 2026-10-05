import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, updateCase, mergeCases, buildCaseExport, normalizeCaseStore } from '../packages/cases/case-model.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { readCaseEvidenceLinks, mergeCaseEvidenceLinks, caseEvidenceLinkIssues, caseEvidenceSharedContext, caseSelectedEvidenceSourceLimitations, CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION, MAX_CASE_EVIDENCE_LINKS } from '../packages/cases/case-evidence-links.mts';
import { buildCliCasePack, verifyCliCasePack } from '../cli/case-pack.mts';
import { CASE_SCHEMA_VERSION, MAX_CASE_EVIDENCE_PINS, serialiseCasePortableJson } from '../packages/contracts/case-portability.mts';

const NOW = '2026-09-23T01:00:00.000Z';
function scenario() {
  const record = createCase({ domain: 'evidence.example.test', evidencePins: ['Original page', 'Extracted link', 'Screenshot'].map(label => ({
    label, value: label, source: 'Selected document', observedAt: null, completeness: 'partial',
  })) }, NOW);
  const [a, b, c] = record.evidencePins.map(pin => pin.id) as [string, string, string];
  return { record, a, b, c, input: { fromPinId: b, toPinId: a, kind: 'derived_from', basis: 'PRIVATE-RELATION-BASIS' } };
}

test('declarations retain distinct pins and do not change their confidence, completeness or source time', () => {
  const { record, input } = scenario();
  const next = updateCase([record], record.id, { evidenceLink: input }, NOW).record;
  assert.deepEqual(next.evidencePins, record.evidencePins);
  assert.equal(record.evidenceLinks, undefined);
  assert.equal(next.evidenceLinks?.[0]?.basis, input.basis);
  assert.equal(next.evidenceLinks?.[0]?.createdAt, NOW);
  assert.throws(() => updateCase([next], next.id, { evidenceLink: input }, NOW), /already recorded/);
  assert.throws(() => updateCase([next], next.id, { evidenceLink: { ...input, fromPinId: input.toPinId, toPinId: input.fromPinId } }, NOW), /cycle/);
  for (const invalid of [{ ...input, toPinId: input.fromPinId }, { ...input, toPinId: 'missing' }, { ...input, basis: '  ' }, { ...input, hidden: 'secret' }]) {
    assert.throws(() => updateCase([record], record.id, { evidenceLink: invalid }, NOW));
  }
});

test('withdrawal preserves attribution and merge cannot resurrect a withdrawn link or overwrite conflicting provenance', () => {
  const { record, input } = scenario();
  const linked = updateCase([record], record.id, { evidenceLink: input }, NOW).record;
  const link = linked.evidenceLinks![0]!;
  const withdrawn = updateCase([linked], linked.id, { evidenceLinkWithdrawal: { id: link.id, reason: 'The analyst corrected the attribution.' } }, NOW).record;
  assert.equal(withdrawn.evidenceLinks![0]!.basis, link.basis);
  assert.equal(withdrawn.evidenceLinks![0]!.withdrawal?.reason, 'The analyst corrected the attribution.');
  for (const [local, imported] of [[withdrawn, linked], [linked, withdrawn]] as const) {
    assert.deepEqual(mergeCases([local], buildCaseExport([imported], NOW)).cases[0]?.evidenceLinks, withdrawn.evidenceLinks);
  }
  assert.throws(() => updateCase([withdrawn], record.id, { evidenceLinkWithdrawal: { id: link.id, reason: 'again' } }, NOW), /already withdrawn/);
  assert.throws(() => mergeCaseEvidenceLinks(linked.evidenceLinks, [{ ...link, basis: 'Changed claim' }]), /conflicts/);
  assert.throws(() => mergeCaseEvidenceLinks(withdrawn.evidenceLinks, [{ ...link, withdrawal: { at: NOW, reason: 'A different withdrawal' } }]), /conflicts/);
});

test('independent imported links remain explicit when their union forms a cycle or a source pin is missing', () => {
  const { record, input, a, b } = scenario();
  const left = updateCase([record], record.id, { evidenceLink: input }, NOW).record;
  const right = updateCase([record], record.id, { evidenceLink: { ...input, fromPinId: a, toPinId: b } }, NOW).record;
  const merged = mergeCases([left], buildCaseExport([right], NOW)).cases[0]!;
  assert.equal(merged.evidenceLinks?.length, 2);
  assert.ok(caseEvidenceLinkIssues(merged.evidenceLinks!, merged.evidencePins).every(row => row.cyclic));
  assert.match(buildCaseReport(merged, { generatedAt: NOW }).markdown, /Conflicting imported derivation cycle/);
  const missing = { ...left, evidencePins: [] };
  const recovered = normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: [missing] }).cases[0]!;
  assert.equal(recovered.evidenceLinks?.length, 1);
  assert.deepEqual(caseEvidenceLinkIssues(recovered.evidenceLinks!, [])[0]?.missingPinIds, [b, a]);
  assert.match(buildCaseReport(recovered, { generatedAt: NOW }).markdown, /Referenced pins not retained/);
});

test('shared context distinguishes declared source labels, imported content identities and collection checkpoints', () => {
  const { record } = scenario();
  record.evidencePins[0]!.importContentSha256 = 'a'.repeat(64);
  record.evidencePins[1]!.importContentSha256 = 'a'.repeat(64);
  record.evidencePins[0]!.checkpointId = 'one';
  record.evidencePins[2]!.checkpointId = 'one';
  const groups = caseEvidenceSharedContext(record.evidencePins);
  assert.deepEqual(groups.map(group => group.kind).sort(), ['checkpoint', 'import', 'source']);
  assert.equal(groups.find(group => group.kind === 'import')?.label, 'Same imported content');
  assert.equal(groups.find(group => group.kind === 'source')?.pinIds.length, 3);
});

test('reused report qualification survives Case round trips without treating record counts as independent support', () => {
  const { record, input, a, b } = scenario();
  record.evidencePins[0]!.source = 'Original supplied report';
  record.evidencePins[1]!.source = 'Provider result following that report';
  record.evidencePins[0]!.importContentSha256 = 'a'.repeat(64);
  record.evidencePins[1]!.importContentSha256 = 'a'.repeat(64);
  const linked = updateCase([record], record.id, { evidenceLink: { ...input, basis: 'The selected result states that it reused the supplied report.' } }, NOW).record;
  const restored = mergeCases([], buildCaseExport([linked], NOW)).cases[0]!;
  assert.equal(restored.evidencePins.length, 3, 'Separate retained records are not merged into a corroboration count.');
  assert.deepEqual(restored.evidencePins, linked.evidencePins);
  assert.deepEqual(restored.evidenceLinks, linked.evidenceLinks);
  assert.deepEqual(caseSelectedEvidenceSourceLimitations(restored.evidencePins, restored.evidenceLinks, [a, b]), [CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION]);
  assert.match(buildCaseReport(restored, { generatedAt: NOW }).markdown, /not independent corroboration/u);
});

test('narrow output qualifies declared relationships without disclosing the private basis or unselected identity', () => {
  const { record, input, a, b, c } = scenario();
  const linked = updateCase([record], record.id, { evidenceLink: input }, NOW).record;
  const before = structuredClone(linked);
  for (const selection of [[a], [b], [a, b]]) {
    const limits = caseSelectedEvidenceSourceLimitations(linked.evidencePins, linked.evidenceLinks, selection);
    assert.deepEqual(limits, [CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION]);
    for (const privateValue of [input.basis, a, b, linked.evidenceLinks![0]!.id]) assert.equal(JSON.stringify(limits).includes(privateValue), false);
  }
  assert.deepEqual(caseSelectedEvidenceSourceLimitations(linked.evidencePins, linked.evidenceLinks, [c]), []);
  assert.deepEqual(caseSelectedEvidenceSourceLimitations(linked.evidencePins, linked.evidenceLinks, ['not-retained']), []);
  const withdrawn = linked.evidenceLinks!.map(link => ({ ...link, withdrawal: { at: NOW, reason: 'Attribution corrected.' } }));
  assert.deepEqual(caseSelectedEvidenceSourceLimitations(linked.evidencePins, withdrawn, [a]), []);
  assert.deepEqual(linked, before);
});

test('separately documented observations and unknown methods keep their attribution without invented independence', () => {
  const { record } = scenario();
  const pins = record.evidencePins.map((pin, index) => ({ ...pin, source: index < 2 ? 'Same reporting desk' : 'Provider method not documented',
    observedAt: index === 0 ? NOW : '2026-09-24T01:00:00.000Z', checkpointId: `distinct-${index}`, importContentSha256: String(index + 1).repeat(64),
    limitations: [index < 2 ? 'Separately documented observation; reporting independence has not been verified.' : 'The provider did not disclose its collection method.'] }));
  const before = structuredClone(pins);
  assert.deepEqual(caseEvidenceSharedContext(pins).map(group => group.kind), ['source']);
  assert.deepEqual(caseSelectedEvidenceSourceLimitations(pins, undefined, pins.map(pin => pin.id)), [CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION]);
  assert.deepEqual(caseSelectedEvidenceSourceLimitations(pins, undefined, [pins[2]!.id]), [], 'Absence of a known relationship is not an independence finding.');
  assert.deepEqual(pins, before);
});

test('source qualification rejects over-bound selections before grouping retained context', () => {
  const { record } = scenario();
  assert.throws(() => caseSelectedEvidenceSourceLimitations(new Array(MAX_CASE_EVIDENCE_PINS + 1).fill(record.evidencePins[0]), undefined, []));
  assert.throws(() => caseSelectedEvidenceSourceLimitations(record.evidencePins, new Array(MAX_CASE_EVIDENCE_LINKS + 1).fill({}), []));
  assert.throws(() => caseSelectedEvidenceSourceLimitations(record.evidencePins, undefined, new Array(MAX_CASE_EVIDENCE_PINS + 1).fill('pin')));
});

test('Case exports, reports and offline packs retain links while the public audience removes private declarations', () => {
  const { record, input } = scenario();
  const linked = updateCase([record], record.id, { evidenceLink: input }, NOW).record;
  const exported = buildCaseExport([linked], NOW);
  assert.deepEqual(mergeCases([], exported).cases[0]?.evidenceLinks, linked.evidenceLinks);
  assert.deepEqual(buildCaseReport(linked, { generatedAt: NOW }).json.analystResponse.evidenceLinks, linked.evidenceLinks);
  for (const audience of ['internal', 'trusted', 'public'] as const) {
    const pack = buildCliCasePack(serialiseCasePortableJson(exported), { audience, reviewed: true }, NOW);
    assert.equal(verifyCliCasePack(pack).caseCount, 1);
    assert.equal(JSON.stringify(pack).includes('PRIVATE-RELATION-BASIS'), audience !== 'public');
    assert.equal(Boolean(pack.cases[0]?.evidenceLinks), audience !== 'public');
  }
  assert.throws(() => normalizeCaseStore({ version: 16, cases: [linked] }), /current Case schema/);
  assert.throws(() => mergeCases([], { ...exported, version: 12 }), /current Case schema/);
});

test('relationship readers reject malformed, oversized, accessor and future material before accepting it', () => {
  const { record, input } = scenario();
  const link = updateCase([record], record.id, { evidenceLink: input }, NOW).record.evidenceLinks![0]!;
  for (const value of [[{ ...link, createdAt: '2026-02-30T00:00:00.000Z' }], [{ ...link, kind: 'proves' }],
    [link, link], [{ ...link, withdrawal: { at: '2025-01-01T00:00:00.000Z', reason: 'Earlier' } }],
    new Array(MAX_CASE_EVIDENCE_LINKS + 1).fill(link)]) assert.throws(() => readCaseEvidenceLinks(value));
  assert.throws(() => readCaseEvidenceLinks([{ ...link, get hidden() { throw new Error('must not execute'); } }]), error => !String(error).includes('must not execute'));
  assert.equal(readCaseEvidenceLinks(undefined), undefined);
});
