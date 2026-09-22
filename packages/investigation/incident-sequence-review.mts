import type { CaseEvidencePin } from '../cases/case-response-records.mts';
import { CASE_PIN_COMPLETENESS } from '../cases/case-response-records.mts';
import { MAX_RESPONSE_VALUE_LENGTH, MAX_RESPONSE_LABEL_LENGTH, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH } from '../contracts/case-portability.mts';
import { CONTEXT_REVIEW_SCHEMA, CONTEXT_REVIEW_VERSION, MAX_CONTEXT_RECORDS, type ContextReview } from '../contracts/context-review.mts';
import { array, domain, enumeration, exact, HEX_DIGEST_RE, iso, text } from '../evidence/artifact-structure.mts';

export { INCIDENT_SEQUENCE_INPUT_SCHEMA, INCIDENT_SEQUENCE_INPUT_VERSION } from '../contracts/context-review.mts';
export const INCIDENT_STAGE_KINDS = ['message', 'navigation', 'identity_prompt', 'credential_entry', 'consent', 'browser_instruction', 'clipboard', 'local_execution', 'payment', 'recovery', 'other'] as const;
export const INCIDENT_STAGE_BASES = ['retained_observation', 'imported_record', 'reported_action'] as const;
export type IncidentStage = Readonly<{
  id: string;
  kind: typeof INCIDENT_STAGE_KINDS[number];
  basis: typeof INCIDENT_STAGE_BASES[number];
  description: string;
  occurredAt: string | null;
  hostname: string | null;
  source: string;
  reference: string;
  referenceSha256: string | null;
  completeness: typeof CASE_PIN_COMPLETENESS[number];
  limitations: readonly string[];
}>;

export function readIncidentStages(raw: unknown): IncidentStage[] {
  const stages = array(raw, 'Incident stages', MAX_CONTEXT_RECORDS).map(value => {
    const row = exact(value, ['id', 'kind', 'basis', 'description', 'occurredAt', 'hostname', 'source', 'reference', 'referenceSha256', 'completeness', 'limitations'], 'Incident stage');
    const id = text(row.id, 'Stage ID', 64);
    if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new TypeError('Stage ID must be a bounded identifier.');
    iso(row.occurredAt, 'Stage occurrence time', true);
    if (row.hostname !== null) domain(row.hostname, 'Stage hostname');
    if (row.referenceSha256 !== null && (typeof row.referenceSha256 !== 'string' || !HEX_DIGEST_RE.test(row.referenceSha256))) throw new TypeError('Stage reference digest must be hexadecimal SHA-256 or null.');
    return { id, kind: enumeration(row.kind, INCIDENT_STAGE_KINDS, 'Stage kind'), basis: enumeration(row.basis, INCIDENT_STAGE_BASES, 'Stage basis'),
      description: text(row.description, 'Stage description', MAX_RESPONSE_VALUE_LENGTH), occurredAt: row.occurredAt as string | null, hostname: row.hostname as string | null,
      source: text(row.source, 'Stage source', MAX_RESPONSE_LABEL_LENGTH), reference: text(row.reference, 'Stage reference', 500), referenceSha256: row.referenceSha256 as string | null,
      completeness: enumeration(row.completeness, CASE_PIN_COMPLETENESS, 'Stage completeness'),
      limitations: array(row.limitations, 'Stage limitations', MAX_RESPONSE_LIMITATIONS).map(item => text(item, 'Stage limitation', MAX_RESPONSE_LIMITATION_LENGTH)),
    };
  });
  if (new Set(stages.map(row => row.id)).size !== stages.length) throw new TypeError('Incident stage IDs must be unique.');
  return stages;
}

/** Copy the selected pin's provenance without giving it stronger assurance. */
export function incidentStageFromPin(pin: CaseEvidencePin, kind: IncidentStage['kind'], id: string): IncidentStage {
  return readIncidentStages([{ id, kind, basis: 'retained_observation', description: pin.value, occurredAt: pin.observedAt,
    hostname: pin.observationHostname ?? null, source: pin.source, reference: pin.id, referenceSha256: pin.importContentSha256 ?? null,
    completeness: pin.truncated === true && pin.completeness === 'complete' ? 'partial' : pin.completeness, limitations: [...pin.limitations],
  }])[0]!;
}

export function reviewIncidentSequence(raw: unknown, reviewedAt: string): ContextReview {
  iso(reviewedAt, 'Review time');
  const stages = readIncidentStages(raw);
  const counts = Object.fromEntries(INCIDENT_STAGE_BASES.map(basis => [basis, stages.filter(row => row.basis === basis).length]));
  let priorTime: number | null = null, reversedTimes = 0;
  for (const row of stages) {
    if (row.occurredAt === null) continue;
    const time = Date.parse(row.occurredAt);
    if (priorTime !== null && time < priorTime) reversedTimes++;
    priorTime = time;
  }
  return { schema: CONTEXT_REVIEW_SCHEMA, version: CONTEXT_REVIEW_VERSION, kind: 'incident_sequence', reviewedAt, title: 'Incident sequence',
    state: !stages.length || stages.some(row => row.occurredAt === null || row.completeness !== 'complete') || reversedTimes ? 'partial' : 'reviewed',
    summary: `${stages.length} analyst-ordered stages: ${counts.retained_observation} retained observations, ${counts.imported_record} imported records and ${counts.reported_action} reported actions.${reversedTimes ? ` ${reversedTimes} timestamp reversals need review; the selected order was preserved.` : ''}`,
    observations: stages.map((row, index) => ({ label: `${index + 1}. ${row.kind.replaceAll('_', ' ')} · ${row.basis.replaceAll('_', ' ')}`,
      state: row.completeness === 'complete' ? 'reported' : 'partial', detail: `${row.description} · Source completeness: ${row.completeness}.${row.limitations.length ? ` ${row.limitations.join(' ')}` : ''}`,
      source: `${row.source} · reference ${row.reference}${row.referenceSha256 ? ` · reference SHA-256 ${row.referenceSha256}` : ''}`, observedAt: row.occurredAt, hostname: row.hostname })),
    nextSteps: ['Compare stages with the selected message and capture records; retain gaps and conflicting source times.', 'Use reported credential entry, consent or local execution to select the relevant account or device recovery review, separately from domain reporting.'],
    limitations: ['Order is analyst-selected, not proof of causation or a verified attack chain. An instruction, prompt or clipboard attempt does not establish that a person followed it.', 'Sources, occurrence times and reference digests retain their supplied meaning; importing this input does not authenticate them. Unknown times are not replaced by review or save time.'],
  };
}
