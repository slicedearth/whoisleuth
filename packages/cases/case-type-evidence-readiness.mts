// Pure, advisory Case-type evidence guidance. This projection reads only
// browser-local Case records and never treats a completed row as proof of a
// policy breach, legal claim, maliciousness, attribution, or recipient scope.

import type { CaseRecord } from './case-record-contracts.mts';
import { caseIncidentTargets, caseTypeIds, CASE_TYPES, type CaseTypeId } from './case-workflow-metadata.mts';

export const CASE_TYPE_READINESS_CHECK_IDS = [
  'exact_incident_target',
  'timed_observation',
  'observed_behaviour',
  'domain_context',
  'message_delivery',
  'technical_payload',
  'official_or_rights_context',
  'analyst_decision',
  'reviewed_response_route',
] as const;
export type CaseTypeReadinessCheckId = typeof CASE_TYPE_READINESS_CHECK_IDS[number];
export type CaseTypeReadinessState = 'present' | 'missing';

export type CaseTypeReadinessRow = Readonly<{
  id: CaseTypeReadinessCheckId;
  label: string;
  why: string;
  importance: 'required' | 'recommended';
  state: CaseTypeReadinessState;
  appliesTo: readonly string[];
  evidence: string;
}>;

export type CaseTypeReadiness = Readonly<{
  selectedTypes: readonly CaseTypeId[];
  rows: readonly CaseTypeReadinessRow[];
  counts: Readonly<{ present: number; missingRequired: number; missingRecommended: number }>;
  limitation: string;
}>;

type CheckDefinition = Readonly<{
  id: CaseTypeReadinessCheckId;
  label: string;
  why: string;
  test: (record: CaseRecord) => Readonly<{ present: boolean; evidence: string }>;
}>;

const NON_OBSERVATION_SOURCE_STATES = new Set(['blocked', 'disabled', 'error', 'failed', 'inconclusive', 'not_found', 'not_reported', 'rate_limited', 'skipped', 'stale', 'unavailable', 'unsupported']);

function qualifiedPins(record: CaseRecord) {
  return record.evidencePins.filter((pin) => pin.source.trim()
    && !NON_OBSERVATION_SOURCE_STATES.has(String(pin.sourceState ?? '').trim().toLowerCase().replaceAll('-', '_')));
}

function typedObservation(
  record: CaseRecord,
  pinType: RegExp,
  sightingCategories: ReadonlySet<string>,
): boolean {
  return qualifiedPins(record).some((pin) => pinType.test(`${pin.category ?? ''} ${pin.field ?? ''}`.toLowerCase()))
    || record.sightings.some((sighting) => sighting.source.trim()
      && !['expired', 'not_reproduced'].includes(sighting.state)
      && sightingCategories.has(sighting.category));
}

const CHECKS: Readonly<Record<CaseTypeReadinessCheckId, CheckDefinition>> = Object.freeze({
  exact_incident_target: Object.freeze({
    id: 'exact_incident_target', label: 'Exact incident link',
    why: 'Identifies the specific page, account, post, message, file, or transaction being assessed.',
    test: (record: CaseRecord) => {
      const count = caseIncidentTargets(record).length;
      return { present: count > 0, evidence: count ? `${count} active exact link${count === 1 ? '' : 's'}` : 'No active exact incident link' };
    },
  }),
  timed_observation: Object.freeze({
    id: 'timed_observation', label: 'Timed source observation',
    why: 'Lets a recipient distinguish what was observed from when it was observed.',
    test: (record: CaseRecord) => {
      const count = qualifiedPins(record).length + record.sightings.filter((sighting) => sighting.source.trim() && !['expired', 'not_reproduced'].includes(sighting.state)).length;
      return { present: count > 0, evidence: count ? `${count} retained timed observation${count === 1 ? '' : 's'}` : 'No retained evidence pin or sighting' };
    },
  }),
  observed_behaviour: Object.freeze({
    id: 'observed_behaviour', label: 'Observed behaviour or content',
    why: 'Supports the allegation with a recorded behaviour rather than a domain name or resemblance alone.',
    test: (record: CaseRecord) => {
      const present = typedObservation(record, /\b(?:content|form|http|page|redirect|title|website|web|credential|message|profile|post)\b/u, new Set(['website']));
      return { present, evidence: present
        ? 'A retained record describes web, message, account, or content behaviour'
        : 'No retained behaviour or content observation was identified' };
    },
  }),
  domain_context: Object.freeze({
    id: 'domain_context', label: 'Registration, DNS, or infrastructure context',
    why: 'Separates domain-level context from content, identity, and analyst conclusions.',
    test: (record: CaseRecord) => {
      const present = typedObservation(record, /\b(?:rdap|whois|registrar|registry|dns|nameserver|certificate|tls|hosting|network|asn|registration|delegation|infrastructure)\b/u, new Set(['registration', 'delegation', 'certificate', 'infrastructure']));
      return { present, evidence: present
        ? 'A retained record provides domain or infrastructure context'
        : 'No retained registration, DNS, certificate, or infrastructure context was identified' };
    },
  }),
  message_delivery: Object.freeze({
    id: 'message_delivery', label: 'Message or delivery evidence',
    why: 'Connects a reported message to its displayed identity, delivery path, and authentication results.',
    test: (record: CaseRecord) => {
      const present = typedObservation(record, /\b(?:email|message|received|reply-to|return-path|spf|dkim|dmarc|arc|mail)\b/u, new Set(['mail']));
      return { present, evidence: present
        ? 'A retained record refers to message or mail evidence'
        : 'No retained message or delivery evidence was identified' };
    },
  }),
  technical_payload: Object.freeze({
    id: 'technical_payload', label: 'Technical payload indicator',
    why: 'Records the file, hash, delivery mechanism, or other technical observation behind a malware assessment.',
    test: (record: CaseRecord) => {
      const present = typedObservation(record, /\b(?:malware|payload|sha-?256|hash|download|executable|script|file)\b/u, new Set());
      return { present, evidence: present
        ? 'A retained record identifies a payload, file, hash, or delivery mechanism'
        : 'No retained payload, file, hash, or delivery observation was identified' };
    },
  }),
  official_or_rights_context: Object.freeze({
    id: 'official_or_rights_context', label: 'Official identity or rights context',
    why: 'Records the affected identity, official reference, or rights basis without treating it as proof of infringement.',
    test: (record: CaseRecord) => {
      const present = record.brandProfileIds.length > 0
        || typedObservation(record, /\b(?:official|trademark|copyright|rights|registration_number)\b/u, new Set());
      return { present, evidence: present ? 'A Brand Profile association or retained rights/official reference is present' : 'No Brand Profile association or retained rights/official reference was identified' };
    },
  }),
  analyst_decision: Object.freeze({
    id: 'analyst_decision', label: 'Evidence-linked analyst decision',
    why: 'Separates the analyst’s conclusion and confidence from collected source observations.',
    test: (record: CaseRecord) => {
      const linked = record.decisions.filter((decision) => decision.evidencePinIds.length > 0).length;
      return { present: linked > 0, evidence: linked ? `${linked} evidence-linked decision${linked === 1 ? '' : 's'}` : 'No evidence-linked analyst decision' };
    },
  }),
  reviewed_response_route: Object.freeze({
    id: 'reviewed_response_route', label: 'Reviewed response route',
    why: 'Identifies where a reviewed packet may be used without implying that WHOISleuth submitted it.',
    test: (record: CaseRecord) => {
      const count = record.actions.filter((action) => !['internal_review', 'defensive_control'].includes(action.type)).length;
      return { present: count > 0, evidence: count ? `${count} external response action${count === 1 ? '' : 's'}` : 'No external response action' };
    },
  }),
});

const COMMON: readonly CaseTypeReadinessCheckId[] = Object.freeze(['timed_observation', 'analyst_decision']);
function typeChecks(
  required: readonly CaseTypeReadinessCheckId[],
  recommended: readonly CaseTypeReadinessCheckId[],
) {
  return Object.freeze({ required: Object.freeze([...required]), recommended: Object.freeze([...recommended]) });
}
const TYPE_CHECKS: Readonly<Record<CaseTypeId, Readonly<{ required: readonly CaseTypeReadinessCheckId[]; recommended: readonly CaseTypeReadinessCheckId[] }>>> = Object.freeze({
  phishing: typeChecks([...COMMON, 'exact_incident_target', 'observed_behaviour'], ['message_delivery', 'domain_context', 'reviewed_response_route']),
  impersonation: typeChecks([...COMMON, 'exact_incident_target', 'official_or_rights_context'], ['observed_behaviour', 'domain_context', 'reviewed_response_route']),
  lookalike_cybersquatting: typeChecks([...COMMON, 'domain_context', 'official_or_rights_context'], ['exact_incident_target', 'observed_behaviour', 'reviewed_response_route']),
  trademark_infringement: typeChecks([...COMMON, 'exact_incident_target', 'official_or_rights_context'], ['observed_behaviour', 'domain_context', 'reviewed_response_route']),
  copyright_infringement: typeChecks([...COMMON, 'exact_incident_target', 'official_or_rights_context'], ['observed_behaviour', 'reviewed_response_route']),
  counterfeit_goods: typeChecks([...COMMON, 'exact_incident_target', 'official_or_rights_context', 'observed_behaviour'], ['domain_context', 'reviewed_response_route']),
  scam_fraud: typeChecks([...COMMON, 'exact_incident_target', 'observed_behaviour'], ['domain_context', 'message_delivery', 'reviewed_response_route']),
  malware_distribution: typeChecks([...COMMON, 'exact_incident_target', 'technical_payload'], ['observed_behaviour', 'domain_context', 'reviewed_response_route']),
  credential_theft: typeChecks([...COMMON, 'exact_incident_target', 'observed_behaviour'], ['message_delivery', 'domain_context', 'reviewed_response_route']),
  spam_platform_abuse: typeChecks([...COMMON, 'exact_incident_target'], ['message_delivery', 'observed_behaviour', 'reviewed_response_route']),
  privacy_personal_data: typeChecks([...COMMON, 'exact_incident_target', 'observed_behaviour'], ['reviewed_response_route']),
  account_compromise: typeChecks([...COMMON, 'exact_incident_target'], ['message_delivery', 'observed_behaviour', 'reviewed_response_route']),
  other: typeChecks([...COMMON], ['exact_incident_target', 'observed_behaviour', 'domain_context', 'reviewed_response_route']),
});

export function buildCaseTypeEvidenceReadiness(record: CaseRecord): CaseTypeReadiness {
  const selectedTypes = caseTypeIds(record.tags);
  if (!selectedTypes.length) return Object.freeze({
    selectedTypes,
    rows: Object.freeze([]),
    counts: Object.freeze({ present: 0, missingRequired: 0, missingRecommended: 0 }),
    limitation: 'Select at least one Case type to derive type-specific evidence guidance.',
  });
  const importance = new Map<CaseTypeReadinessCheckId, 'required' | 'recommended'>();
  const appliesTo = new Map<CaseTypeReadinessCheckId, string[]>();
  for (const typeId of selectedTypes) {
    const type = CASE_TYPES.find((candidate) => candidate.id === typeId)!;
    for (const id of TYPE_CHECKS[typeId].recommended) {
      if (!importance.has(id)) importance.set(id, 'recommended');
      const labels = appliesTo.get(id) ?? [];
      if (!labels.includes(type.label)) labels.push(type.label);
      appliesTo.set(id, labels);
    }
    for (const id of TYPE_CHECKS[typeId].required) {
      importance.set(id, 'required');
      const labels = appliesTo.get(id) ?? [];
      if (!labels.includes(type.label)) labels.push(type.label);
      appliesTo.set(id, labels);
    }
  }
  const rows = CASE_TYPE_READINESS_CHECK_IDS.flatMap((id): CaseTypeReadinessRow[] => {
    const rowImportance = importance.get(id);
    if (!rowImportance) return [];
    const check = CHECKS[id];
    const result = check.test(record);
    return [Object.freeze({
      id,
      label: check.label,
      why: check.why,
      importance: rowImportance,
      state: result.present ? 'present' : 'missing',
      appliesTo: Object.freeze([...(appliesTo.get(id) ?? [])]),
      evidence: result.evidence,
    })];
  });
  return Object.freeze({
    selectedTypes: Object.freeze([...selectedTypes]),
    rows: Object.freeze(rows),
    counts: Object.freeze({
      present: rows.filter((row) => row.state === 'present').length,
      missingRequired: rows.filter((row) => row.state === 'missing' && row.importance === 'required').length,
      missingRecommended: rows.filter((row) => row.state === 'missing' && row.importance === 'recommended').length,
    }),
    limitation: 'This checklist is derived from retained Case records. It guides evidence review but does not establish maliciousness, attribution, policy breach, legal standing, or legal sufficiency.',
  });
}
