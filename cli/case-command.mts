import { createHash } from 'node:crypto';
import { boundedJsonLimitsForBytes, parseBoundedJsonObject } from '../lib/bounded-json.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { MAX_CASE_CHECKPOINT_FACTS, MAX_CASE_OBJECTIVE_LENGTH, MAX_CASE_STORE_BYTES, MAX_EDITABLE_CASE_INPUT_BYTES, MAX_NOTE_LENGTH, MAX_RESPONSE_RATIONALE_LENGTH, MAX_RESPONSE_VALUE_LENGTH } from '../packages/contracts/case-portability.mts';
import { readEditableCaseExport } from '../packages/cases/case-export-input.mts';
import { createCaseIncident, openOrCreateCase, recordCaseConclusion, recordCaseRecheckOutcome, updateCase, type CaseConclusionInput } from '../packages/cases/case-record-operations.mts';
import { buildCaseExport, serializeCaseStore } from '../packages/cases/case-storage-model.mts';
import { appendCaseEvidencePin, type CaseEvidencePin } from '../packages/cases/case-response-model.mts';
import { readCaseRecheckAnswerContext } from '../packages/cases/case-recheck-model.mts';
import { dispositionLabel, statusLabel } from '../packages/cases/case-record-decisions.mts';
import { normalizeDomain } from '../packages/cases/case-record-core.mts';
import type { CaseRecord } from '../packages/cases/case-record-contracts.mts';
import type { CliArguments } from './arguments.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { safeTerminalValue } from './formatters/terminal.mts';
import { CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';

type CaseArguments = Extract<CliArguments, { action: 'case' }>;
type JsonObject = Record<string, unknown>;

function fields(input: JsonObject, allowed: readonly string[], label: string): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new CliUsageError(`${label} contains an unsupported field.`);
}
function prose(input: unknown, maximum: number, label: string): string {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input)) {
    throw new CliUsageError(`${label} must contain 1–${maximum} characters without unsafe control characters.`);
  }
  return input.trim();
}
function selection(cases: readonly CaseRecord[], args: CaseArguments, required: boolean): CaseRecord[] {
  const domain = args.domain === null ? null : normalizeDomain(args.domain);
  if (args.domain !== null && !domain) throw new CliUsageError('Select a valid Case domain.');
  const selected = cases.filter(record => (!args.caseId || record.id === args.caseId) && (!domain || record.domain === domain));
  if ((args.caseId || domain || required) && selected.length === 0) throw new CliUsageError('The selected Case is not present in this file.');
  if (required && selected.length !== 1) throw new CliUsageError('Select exactly one Case with --case-id; no arbitrary Case was chosen.');
  return selected;
}

function pin(input: unknown, now: string): JsonObject {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CliUsageError('An evidence pin must be a JSON object.');
  const raw = input as JsonObject;
  if (Object.hasOwn(raw, 'id') || Object.hasOwn(raw, 'createdAt')) throw new CliUsageError('New pin identity and creation time are allocated by the Case operation.');
  const normal = appendCaseEvidencePin([], raw, now)[0]!;
  // Validate the supplied subset against the domain result, without duplicating
  // its field inventory or accepting silent truncation/default substitution.
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(normal, key) || canonicalArtifactJsonV2(value) !== canonicalArtifactJsonV2(normal[key as keyof CaseEvidencePin])) {
      throw new CliUsageError(`Pin field ${safeTerminalValue(key)} is not canonical or exceeds its bound. Use explicit ISO timestamps and supported values; no pin was saved.`);
    }
  }
  return raw;
}

function retainExistingEntries(before: CaseRecord, after: CaseRecord): void {
  const pairs = [
    [before.notes, after.notes], [before.evidenceHistory, after.evidenceHistory], [before.evidencePins, after.evidencePins],
    [before.decisions, after.decisions], [before.actions, after.actions], [before.assertions, after.assertions],
    [before.manualTrail, after.manualTrail], [before.sightings, after.sightings],
    [before.observedEffects.reviews, after.observedEffects.reviews], [before.closures.records, after.closures.records],
    [before.branches ?? [], after.branches ?? []], [before.attachments ?? [], after.attachments ?? []],
  ] as const;
  for (const [prior, next] of pairs) {
    const retained = new Set(next.map(value => canonicalArtifactJsonV2(value)));
    if (prior.some(value => !retained.has(canonicalArtifactJsonV2(value)))) {
      throw new CliUsageError('The operation would remove or alter earlier retained evidence. Export a smaller working set or review it in the console; nothing was written.');
    }
  }
}

function mutate(cases: CaseRecord[], args: CaseArguments, input: JsonObject | null, note: string | null, now: string): CaseRecord[] {
  if (args.operation === 'open') {
    const title = args.title === null ? undefined : prose(args.title, MAX_CASE_OBJECTIVE_LENGTH, 'Incident title');
    const result = args.newIncident
      ? createCaseIncident(cases, { domain: args.domain, title }, now)
      : openOrCreateCase(cases, { domain: args.domain, ...(title ? { title } : {}) }, now, args.caseId ? { caseId: args.caseId } : {});
    if (!result.created && title && title !== result.record.title) throw new CliUsageError('The selected Case already exists with another title. Use --new-incident for a separate investigation.');
    return result.cases;
  }
  const current = selection(cases, args, true)[0]!;
  let result: ReturnType<typeof updateCase>;
  if (args.operation === 'note') {
    result = updateCase(cases, current.id, { note: prose(note, MAX_NOTE_LENGTH, 'Case note') }, now);
  } else if (args.operation === 'pin') {
    result = updateCase(cases, current.id, { evidencePin: pin(input, now) }, now);
  } else if (args.operation === 'assess') {
    if (!input) throw new CliUsageError('An assessment requires JSON input.');
    fields(input, ['disposition', 'reviewReasonCode', 'summary', 'rationale', 'evidence'], 'Assessment');
    if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > MAX_CASE_CHECKPOINT_FACTS) {
      throw new CliUsageError(`Select 1–${MAX_CASE_CHECKPOINT_FACTS} evidence facts for the assessment.`);
    }
    const evidence: CaseConclusionInput['evidence'] = input.evidence.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliUsageError('Each assessment fact needs a pin and stance.');
      fields(value, ['pin', 'pinId', 'stance'], 'Assessment evidence');
      if (!['supports', 'contradicts', 'unresolved'].includes(value.stance)) throw new CliUsageError('Use supports, contradicts or unresolved for each evidence stance.');
      if (Object.hasOwn(value, 'pin') === Object.hasOwn(value, 'pinId')) throw new CliUsageError('Select one new pin or one retained pinId for each assessment fact.');
      return Object.hasOwn(value, 'pinId') ? { pinId: value.pinId, stance: value.stance } : { pin: pin(value.pin, now), stance: value.stance };
    });
    const summary = prose(input.summary, MAX_RESPONSE_VALUE_LENGTH, 'Assessment summary');
    const rationale = prose(input.rationale, MAX_RESPONSE_RATIONALE_LENGTH, 'Assessment rationale');
    result = recordCaseConclusion(cases, current.id, { disposition: input.disposition, reviewReasonCode: input.reviewReasonCode, summary, rationale, evidence }, now);
    if (result.record.decisions.at(-1)?.summary !== summary || result.record.decisions.at(-1)?.rationale !== rationale) {
      throw new CliUsageError('Assessment text needs canonical single-line values; no assessment was written.');
    }
  } else if (args.operation === 'recheck') {
    if (!input) throw new CliUsageError('A recheck requires JSON input.');
    fields(input, ['state', 'observedAt', 'completeness', 'comparisonSummary', 'source', 'followUpAt', 'limitations', 'collectionDepth', 'recheck', 'observationHostname'], 'Recheck');
    const recheck = readCaseRecheckAnswerContext(input.recheck);
    if (input.state === 'not_reproduced' && !recheck) {
      throw new CliUsageError('Not reproduced requires a saved recheck question and confirmed comparable conditions. Import the planned Case or record unavailable for a limited observation.');
    }
    const summary = prose(input.comparisonSummary, MAX_RESPONSE_VALUE_LENGTH, 'Comparison summary');
    result = recordCaseRecheckOutcome(cases, current.id, {
      ...input, state: input.state, observedAt: input.observedAt, completeness: input.completeness,
      comparisonSummary: summary, source: input.source, ...(recheck ? { recheck } : {}),
    }, now);
    const review = result.record.observedEffects.reviews.at(-1)!;
    const comparison = result.record.evidencePins.find(value => value.id === review.evidencePinId)!;
    const projected: JsonObject = { state: review.state, observedAt: review.observedAt, completeness: review.completeness,
      comparisonSummary: comparison.value, source: review.source, followUpAt: review.followUpAt,
      limitations: review.limitations, collectionDepth: comparison.collectionDepth,
      ...(review.recheck ? { recheck: review.recheck } : {}),
      ...(comparison.observationHostname ? { observationHostname: comparison.observationHostname } : {}),
    };
    for (const [key, value] of Object.entries(input)) {
      if (canonicalArtifactJsonV2(value) !== canonicalArtifactJsonV2(projected[key])) throw new CliUsageError(`Recheck field ${safeTerminalValue(key)} would be repaired or truncated; nothing was written.`);
    }
  } else throw new CliUsageError('Select a supported Case mutation.');
  retainExistingEntries(current, result.record);
  return result.cases;
}

function formatCases(cases: readonly CaseRecord[], digest: string): string {
  const lines = ['Local Case review', `File digest  ${digest}`, `Cases        ${cases.length}`, ''];
  for (const record of cases) {
    lines.push(`Case ${safeTerminalValue(record.id)} · ${safeTerminalValue(record.title || record.domain)}`,
      `Domain       ${safeTerminalValue(record.domain)}`, `Status       ${statusLabel(record.status)}`,
      `Disposition  ${dispositionLabel(record.disposition)} (analyst assessment)`, `Updated      ${record.updatedAt}`);
    for (const note of record.notes) lines.push(`Note ${note.createdAt}`, safeTerminalValue(note.body, '—', MAX_NOTE_LENGTH));
    for (const pin of record.evidencePins) lines.push(`Pin ${safeTerminalValue(pin.id)} · ${safeTerminalValue(pin.label)}`,
      safeTerminalValue(pin.value, '—', MAX_RESPONSE_VALUE_LENGTH),
      `  Source ${safeTerminalValue(pin.source)} · ${safeTerminalValue(pin.observedAt, 'time unavailable')} · ${pin.completeness}`);
    for (const decision of record.decisions) lines.push(`Assessment ${decision.createdAt}`,
      safeTerminalValue(decision.summary, '—', MAX_RESPONSE_VALUE_LENGTH), safeTerminalValue(decision.rationale, '—', MAX_RESPONSE_RATIONALE_LENGTH));
    for (const review of record.observedEffects.reviews) lines.push(`Recheck ${safeTerminalValue(review.observedAt, 'time unavailable')} · ${review.state} · ${review.completeness} · ${safeTerminalValue(review.source)}`);
    lines.push(`Other retained records: ${record.evidenceHistory.length} snapshots, ${record.actions.length} actions, ${record.assertions.length} assertions, ${record.attachments?.length ?? 0} file references.`, '');
  }
  lines.push('Use --json for the full Case export. Attached file bytes remain separate. This command makes no request.', '');
  return lines.join('\n');
}

export async function runCaseCommand(args: CaseArguments, dependencies: CliDependencies, context: CliCommandContext): Promise<number> {
  context.setFailureLabel('Local Case operation');
  try {
    const raw = args.source ? dependencies.caseFileInput ?? await context.readInput(args.source, MAX_EDITABLE_CASE_INPUT_BYTES, 'Case file') : null;
    const digest = raw === null ? null : `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    if (args.expectedFileDigest && args.expectedFileDigest !== digest) throw new CliUsageError('The Case file differs from the reviewed file digest. Nothing was written.');
    const cases = raw === null ? [] : readEditableCaseExport(raw);
    const now = normalizeExplicitIsoTimestamp(context.now());
    if (!now) throw new CliUsageError('A valid current timestamp is required.');
    if (args.operation === 'show') {
      const selected = selection(cases, args, false);
      context.writeStdout(args.output === 'json' ? `${JSON.stringify(buildCaseExport(selected, now))}\n` : context.terminal(formatCases(selected, digest!), args.color));
      return EXIT_CODES.SUCCESS;
    }
    const input = args.inputSource ? parseBoundedJsonObject(await context.readInput(args.inputSource, MAX_EDITABLE_CASE_INPUT_BYTES, 'Case operation input'), {
      maximumBytes: MAX_EDITABLE_CASE_INPUT_BYTES, limits: boundedJsonLimitsForBytes(MAX_CASE_STORE_BYTES), label: 'Case operation input',
    }) : null;
    const note = args.noteSource ? await context.readInput(args.noteSource, MAX_NOTE_LENGTH * 4 + 4, 'Case note') : args.text;
    const next = mutate(cases, args, input, note, now);
    if (Buffer.byteLength(serializeCaseStore(next)) > MAX_CASE_STORE_BYTES) throw new CliUsageError('The updated Case store exceeds its byte budget. No evidence was pruned and nothing was written.');
    const output = `${JSON.stringify(buildCaseExport(next, now))}\n`;
    // Apply the same strict admission to our output before atomic publication.
    readEditableCaseExport(output);
    dependencies.signal?.throwIfAborted();
    context.writeStdout(output);
    return EXIT_CODES.SUCCESS;
  } catch (cause) {
    dependencies.signal?.throwIfAborted();
    if (cause instanceof CliUsageError) throw cause;
    throw new CliUsageError(cause instanceof Error ? cause.message : 'The Case operation could not be completed.');
  }
}
