// Read legacy text conventions once at the versioned storage/import boundary.
// Keep the original assertions for references and historical evidence.
import { CASE_TYPES, normalizeCaseIncidentTargetUrl, readCaseWorkflowMetadata, type CaseWorkflowMetadata } from './case-workflow-metadata.mts';
import { normalizeTags } from './case-record-core.mts';
import { normalizeCaseObjective, parseIncidentUrlContext } from './case-incident-context.mts';
import type { CaseAssertionRecord } from './case-response-records.mts';
import { EVIDENCE_FOLLOW_UP_CASE_SCHEMA_VERSION } from '../contracts/case-portability.mts';

const TYPE_PREFIX = 'case-type:';
const TARGET_PREFIX = 'Incident target URL: ';
const CONTEXT_PREFIX = 'Investigate incident URL: ';
const OBJECTIVE_PREFIX = 'Objective: ';
const RETENTION_SEPARATOR = ' | URL retained: ';

export function readCaseWorkflowFields(raw: Record<string, unknown>, domain: string, assertions: readonly CaseAssertionRecord[], sourceVersion?: number | null) {
  const tags = normalizeTags(raw.tags);
  if (raw.workflowMetadata !== undefined) {
    if (sourceVersion != null && sourceVersion < EVIDENCE_FOLLOW_UP_CASE_SCHEMA_VERSION) throw new TypeError('Typed workflow metadata requires the current Case schema.');
    return { tags, workflowMetadata: readCaseWorkflowMetadata(raw.workflowMetadata, domain)! };
  }
  const types = CASE_TYPES.filter(type => tags.some(tag => tag.toLowerCase() === `${TYPE_PREFIX}${type.id}`)).map(type => type.id);
  const workflowMetadata: CaseWorkflowMetadata = { types, incidentTargets: [], investigationContext: null };
  for (const assertion of assertions) {
    if (assertion.statement.startsWith(TARGET_PREFIX)) {
      const url = normalizeCaseIncidentTargetUrl(assertion.statement.slice(TARGET_PREFIX.length));
      if (url) workflowMetadata.incidentTargets.push({ id: assertion.id, url, state: assertion.state, createdAt: assertion.createdAt, updatedAt: assertion.updatedAt });
    }
    if (assertion.kind !== 'next_step' || assertion.state !== 'open' || !assertion.statement.startsWith(CONTEXT_PREFIX)) continue;
    const parsed = parseIncidentUrlContext(assertion.statement.slice(CONTEXT_PREFIX.length));
    const rationale = assertion.rationale ?? '';
    const index = rationale.lastIndexOf(RETENTION_SEPARATOR);
    const objective = rationale.startsWith(OBJECTIVE_PREFIX) && index > OBJECTIVE_PREFIX.length
      ? normalizeCaseObjective(rationale.slice(OBJECTIVE_PREFIX.length, index)) : '';
    const retention = index >= 0 ? rationale.slice(index + RETENTION_SEPARATOR.length) : '';
    if (!parsed || parsed.registrableDomain !== domain || !objective || (retention !== 'exact' && retention !== 'origin_only')) continue;
    workflowMetadata.investigationContext = { id: assertion.id, objective, urlRetention: retention,
      incidentUrl: retention === 'exact' ? parsed.exactUrl : parsed.originUrl, updatedAt: assertion.updatedAt };
  }
  // Preserve historical text byte-for-byte where already normalised. Typed
  // metadata becomes authoritative; subsequent tag edits never change types.
  return { tags, workflowMetadata: readCaseWorkflowMetadata(workflowMetadata, domain)! };
}
