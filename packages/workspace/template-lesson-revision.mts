import { normalizeInvestigationTemplate, createInvestigationTemplate, type InvestigationTemplate } from './investigation-template-model.mts';
import { normalizeInvestigationGuideTemplateSnapshot } from './investigation-guide.mts';
import { assertWorkspaceInputGraph } from './hostile-input.mts';
import { sha256ArtifactDigestV2, SORTED_JSON_V2 } from '../evidence/artifact-integrity.mts';
import { MAX_NOTE_LENGTH } from '../contracts/case-portability.mts';
import { text } from '../evidence/artifact-structure.mts';

export function templateGuidanceChanges(before: InvestigationTemplate, after: InvestigationTemplate) {
  const rows: { label: string; before: string; after: string }[] = [];
  const add = (label: string, left: string, right: string) => { if (left !== right) rows.push({ label, before: left, after: right }); };
  add('Name', before.label, after.label); add('Summary', before.summary, after.summary);
  const old = new Map(before.stages.map(stage => [stage.id, stage]));
  const next = new Map(after.stages.map(stage => [stage.id, stage]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const left = old.get(id), right = next.get(id);
    if (!left || !right) { add(`Step ${id}`, left ? 'Included' : 'Not included', right ? 'Included' : 'Not included'); continue; }
    for (const [field, label] of [['label', 'Name'], ['detail', 'Purpose'], ['expectedEvidence', 'Expected evidence'], ['completionCriteria', 'Completion criteria']] as const) add(`${right.label} · ${label}`, left[field], right[field]);
    add(`${right.label} · Instructions`, left.instructions.join('\n'), right.instructions.join('\n'));
    add(`${right.label} · Approval`, left.requiresApproval ? 'Required' : 'Not required', right.requiresApproval ? 'Required' : 'Not required');
  }
  return rows;
}

/** A deliberately authored fork; the lesson contributes only its content digest. */
export async function prepareTemplateLessonRevision(baseRaw: unknown, proposedRaw: unknown, lesson: string,
  context: { applicability: string; rationale: string; now?: string }) {
  assertWorkspaceInputGraph(proposedRaw, 'Proposed template revision');
  const base = normalizeInvestigationTemplate(baseRaw);
  const proposed = normalizeInvestigationGuideTemplateSnapshot(proposedRaw);
  if (!base || !proposed || proposed.id === base.id || proposed.recipeId !== base.recipeId) throw new TypeError('A lesson revision needs a distinct identity and the same base guide.');
  if (typeof lesson !== 'string' || !lesson.trim() || lesson.length > MAX_NOTE_LENGTH) throw new TypeError('Select one bounded saved lesson.');
  const applicability = text(context.applicability.trim(), 'Template applicability', 400);
  const rationale = text(context.rationale.trim(), 'Template revision reason', 400);
  // The normal template reader tolerates older guidance. An authored revision
  // must instead show exactly what will be saved, not silently shorten input.
  const raw = proposedRaw as { label: unknown; summary?: unknown; stages?: unknown[] };
  if (raw.label !== proposed.label || (raw.summary !== undefined && raw.summary !== proposed.summary)) throw new TypeError('Use a non-empty name and summary within the displayed limits, without control characters.');
  for (const candidate of raw.stages ?? []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('Each revised step must be an object.');
    const stage = candidate as { id?: string; enabled?: boolean; instructions?: unknown; [key: string]: unknown };
    if (stage.enabled === false) continue;
    const retained = proposed.stages.find(row => row.id === stage.id);
    if (!retained) throw new TypeError('Only the selected guide’s existing steps can be revised.');
    for (const field of ['label', 'detail', 'expectedEvidence', 'completionCriteria', 'instructions'] as const) {
      if (JSON.stringify(stage[field]) !== JSON.stringify(retained[field])) throw new TypeError('Keep each guidance field within its displayed limit; instructions allow six lines of 240 characters.');
    }
  }
  const now = context.now ?? new Date().toISOString();
  const candidate = createInvestigationTemplate({ ...proposed, createdAt: now,
    lessonRevision: { parentTemplateId: base.id, parentContentSha256: (await sha256ArtifactDigestV2(base)).slice('sha256:'.length),
      lessonContentSha256: (await sha256ArtifactDigestV2({ body: lesson })).slice('sha256:'.length), canonicalization: SORTED_JSON_V2, applicability, rationale },
  }, { now });
  const changes = templateGuidanceChanges(base, candidate);
  if (!changes.some(row => !['Name', 'Summary'].includes(row.label))) throw new TypeError('Revise at least one step before preparing a lesson revision.');
  return { candidate, changes };
}
