import { createHash } from 'node:crypto';

import { canonicalArtifactJsonV2 } from '../../packages/evidence/artifact-integrity.mts';
import {
  CASE_RESPONSE_PACKET_VERSION,
  PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  MAX_ABUSIVE_URLS,
  MAX_RESPONSE_ARTEFACT_REFERENCES,
  MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS,
  MAX_RESPONSE_ACTION_HISTORY,
  MAX_RESPONSE_CONTACTS,
  MAX_RESPONSE_CONTRADICTIONS,
  MAX_RESPONSE_SELECTED_EVIDENCE,
  RESPONSE_AUTHORISATION_CONFIRMATION_IDS,
  RESPONSE_PACKET_PROFILES,
  RESPONSE_CONTACT_KINDS,
  RESPONSE_PACKET_PROFILE_IDS,
  RESPONSE_READINESS_ROW_IDS,
  RESPONSE_READINESS_STATES,
  RESPONSE_ROUTE_STALE_AFTER_DAYS,
} from '../../packages/cases/case-response-packet.mts';
import {
  CASE_ACTION_EVENT_SOURCE_CLASSES,
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  CASE_CLOSURE_REASONS,
  CASE_OBSERVED_EFFECT_SOURCE_CLASSES,
  CASE_OBSERVED_EFFECT_STATES,
  CASE_PROVIDER_OUTCOMES,
  isLegalCaseActionTransition,
  MAX_CASE_ACTION_EVENTS_PER_ACTION,
  MAX_CASE_ACTIONS,
  MAX_CASE_ASSERTIONS,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
  MAX_RESPONSE_LABEL_LENGTH,
  MAX_RESPONSE_LIMITATION_LENGTH,
  MAX_RESPONSE_LIMITATIONS,
  MAX_RESPONSE_RECIPIENT_LENGTH,
} from '../../packages/cases/case-response-model.mts';
import {
  HEX_DIGEST_RE,
  array,
  boolean,
  domain,
  enumeration,
  exact,
  fail,
  integer,
  iso,
  optionalText,
  sameValues,
  strings,
  text,
  type UnknownRecord,
} from './structure-primitives.mts';

const CASE_RESPONSE_PREFLIGHT_IDS = [
  'required_incident_fields',
  'evidence_pins',
  'analyst_decision',
  'recipient_route',
  'profile_recipient',
  'case_disposition',
  'evidence_freshness',
  'contradictory_evidence',
  'action_tracking',
] as const;

const PUBLIC_CASE_ACTION_STATES = ['planned', 'ready_for_review', 'submitted', 'acknowledged', 'resolved', 'closed'] as const;

function validatePublicActionSummary(value: unknown, label: string): void {
  const summary = exact(value, ['total', 'active', 'submitted', 'acknowledged', 'resolved', 'closed', 'overdue', 'followUpDue', 'withOutcome', 'latestOutcomes'], label);
  const total = integer(summary.total, label, 0, MAX_CASE_ACTIONS);
  for (const key of ['active', 'submitted', 'acknowledged', 'resolved', 'closed', 'overdue', 'followUpDue', 'withOutcome'] as const) integer(summary[key], label, 0, total);
  if (Number(summary.resolved) + Number(summary.closed) + Number(summary.active) !== total) fail(label);
  const outcomes = array(summary.latestOutcomes, label, 5);
  for (const candidate of outcomes) {
    const outcome = exact(candidate, ['actionId', 'recipient', 'state', 'outcome', 'updatedAt'], label);
    text(outcome.actionId, label, 64);
    text(outcome.recipient, label, 320);
    enumeration(outcome.state, PUBLIC_CASE_ACTION_STATES, label);
    text(outcome.outcome, label, 2_000);
    iso(outcome.updatedAt, label);
  }
}

function expectedObservationAge(observedAt: string, generatedAt: string): Readonly<{
  ageSeconds: number;
  band: 'future_or_clock_skew' | 'one_to_seven_days' | 'over_seven_days' | 'under_24_hours';
  refreshRecommended: boolean;
}> {
  const ageSeconds = Math.floor((Date.parse(generatedAt) - Date.parse(observedAt)) / 1_000);
  if (ageSeconds < -300) return { ageSeconds, band: 'future_or_clock_skew', refreshRecommended: true };
  if (ageSeconds < 86_400) return { ageSeconds: Math.max(0, ageSeconds), band: 'under_24_hours', refreshRecommended: false };
  if (ageSeconds <= 604_800) return { ageSeconds, band: 'one_to_seven_days', refreshRecommended: false };
  return { ageSeconds, band: 'over_seven_days', refreshRecommended: true };
}

function validateCaseResponsePacketV6(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed', 'profile', 'case', 'incident', 'contacts', 'preflight', 'escalationHistory', 'provenance', 'integrity'], 'Case-response packet');
  if (root.schemaVersion !== PUBLIC_CASE_RESPONSE_PACKET_VERSION) fail('Case-response packet v6');
  iso(root.generatedAt, 'Case-response packet generatedAt');
  if (root.reviewRequired !== true || root.submissionPerformed !== false) fail('Case-response packet review state');
  const profile = exact(root.profile, ['id', 'label', 'audience', 'subject', 'checklist', 'evidenceOrder', 'includedEvidence', 'excludedEvidence', 'redactions', 'attachments', 'followUpFields'], 'Case-response profile');
  const profileId = enumeration(profile.id, RESPONSE_PACKET_PROFILE_IDS, 'Case-response profile id');
  text(profile.label, 'Case-response profile label', 200);
  text(profile.audience, 'Case-response profile audience', 300);
  text(profile.subject, 'Case-response profile subject', 500);
  for (const key of ['checklist', 'evidenceOrder', 'includedEvidence', 'excludedEvidence', 'redactions', 'attachments', 'followUpFields'] as const) strings(profile[key], `Case-response profile ${key}`, 24, 500);
  const caseRecord = exact(root.case, ['id', 'domain', 'status', 'disposition', 'updatedAt'], 'Case-response case');
  text(caseRecord.id, 'Case-response case id', 128);
  domain(caseRecord.domain, 'Case-response case domain');
  text(caseRecord.status, 'Case-response case status', 80);
  text(caseRecord.disposition, 'Case-response case disposition', 80);
  iso(caseRecord.updatedAt, 'Case-response case updatedAt');
  const incident = exact(root.incident, ['category', 'affectedParty', 'abusiveUrls', 'observedHarm', 'observedAt'], 'Case-response incident');
  text(incident.category, 'Case-response category', 80);
  text(incident.affectedParty, 'Case-response affected party', 200);
  const urls = strings(incident.abusiveUrls, 'Case-response abusive URLs', MAX_ABUSIVE_URLS, 2_048);
  if (!urls.length || urls.some((item) => { try { return !['http:', 'https:'].includes(new URL(item).protocol); } catch { return true; } })) fail('Case-response abusive URLs');
  text(incident.observedHarm, 'Case-response observed harm', 2_000);
  iso(incident.observedAt, 'Case-response observedAt');
  const selectedProfile = RESPONSE_PACKET_PROFILES.find((candidate) => candidate.id === profileId);
  if (!selectedProfile
    || profile.label !== selectedProfile.label
    || profile.audience !== selectedProfile.audience
    || profile.subject !== `${selectedProfile.subjectPrefix}: ${caseRecord.domain} (${incident.category})`
    || !sameValues(profile.checklist as unknown[], selectedProfile.checklist)
    || !sameValues(profile.evidenceOrder as unknown[], selectedProfile.evidenceOrder)
    || !sameValues(profile.includedEvidence as unknown[], selectedProfile.includedEvidence)
    || !sameValues(profile.excludedEvidence as unknown[], selectedProfile.excludedEvidence)
    || !sameValues(profile.redactions as unknown[], selectedProfile.redactions)
    || !sameValues(profile.attachments as unknown[], selectedProfile.attachments)
    || !sameValues(profile.followUpFields as unknown[], selectedProfile.followUpFields)) fail('Case-response profile');
  const canonicalUrls = urls.map((item) => {
    try {
      const parsed = new URL(item);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
        ? parsed.toString()
        : null;
    } catch { return null; }
  });
  if (canonicalUrls.some((item, index) => item === null || item !== urls[index])
    || new Set(urls).size !== urls.length) fail('Case-response abusive URLs');
  const contacts = array(root.contacts, 'Case-response contacts', MAX_RESPONSE_CONTACTS);
  const contactKeys = new Set<string>();
  for (const candidate of contacts) {
    const contact = exact(candidate, ['kind', 'contact', 'source', 'limitations'], 'Case-response contact');
    const kind = enumeration(contact.kind, RESPONSE_CONTACT_KINDS, 'Case-response contact kind');
    const contactValue = text(contact.contact, 'Case-response contact value', MAX_RESPONSE_RECIPIENT_LENGTH);
    const contactKey = `${kind}\u0000${contactValue.toLowerCase()}`;
    if (contactKeys.has(contactKey)) fail('Case-response contacts');
    contactKeys.add(contactKey);
    text(contact.source, 'Case-response contact source', MAX_RESPONSE_LABEL_LENGTH);
    strings(contact.limitations, 'Case-response contact limitations', MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH);
  }
  const preflight = exact(root.preflight, ['version', 'status', 'canExport', 'counts', 'checks', 'actionSummary'], 'Case-response preflight');
  if (preflight.version !== 1) fail('Case-response preflight');
  const checks = array(preflight.checks, 'Case-response preflight checks', CASE_RESPONSE_PREFLIGHT_IDS.length, CASE_RESPONSE_PREFLIGHT_IDS.length);
  const actualCounts = { block: 0, caution: 0, pass: 0 };
  for (const [index, candidate] of checks.entries()) {
    const check = exact(candidate, ['id', 'label', 'state', 'detail'], 'Case-response preflight check');
    const id = text(check.id, 'Case-response preflight id', 80);
    if (id !== CASE_RESPONSE_PREFLIGHT_IDS[index]) fail('Case-response preflight check order');
    text(check.label, 'Case-response preflight label', 200);
    const state = enumeration(check.state, ['block', 'caution', 'pass'], 'Case-response preflight state');
    actualCounts[state] += 1;
    text(check.detail, 'Case-response preflight detail', 1_000);
  }
  const counts = exact(preflight.counts, ['block', 'caution', 'pass'], 'Case-response preflight counts');
  for (const state of ['block', 'caution', 'pass'] as const) {
    if (integer(counts[state], 'Case-response preflight count', 0, checks.length) !== actualCounts[state]) fail('Case-response preflight counts');
  }
  const expectedStatus = actualCounts.block ? 'needs_input' : actualCounts.caution ? 'review_cautions' : 'ready_for_review';
  if (preflight.status !== expectedStatus || preflight.canExport !== (actualCounts.block === 0)) fail('Case-response preflight status');
  validatePublicActionSummary(preflight.actionSummary, 'Case-response action summary');
  const history = array(root.escalationHistory, 'Case-response escalation history', MAX_RESPONSE_ACTION_HISTORY);
  for (const candidate of history) {
    const action = exact(candidate, ['type', 'recipient', 'contactSource', 'state', 'reference', 'outcome', 'createdAt', 'updatedAt'], 'Case-response escalation action');
    enumeration(action.type, CASE_ACTION_TYPES, 'Case-response action type');
    text(action.recipient, 'Case-response action recipient', 320, true);
    text(action.contactSource, 'Case-response action source', 120, true);
    enumeration(action.state, PUBLIC_CASE_ACTION_STATES, 'Case-response action state');
    optionalText(action.reference, 'Case-response action reference', 500);
    optionalText(action.outcome, 'Case-response action outcome', 2_000);
    iso(action.createdAt, 'Case-response action createdAt');
    iso(action.updatedAt, 'Case-response action updatedAt');
  }
  const provenance = exact(root.provenance, ['latestEvidenceCapturedAt', 'evidencePinCount', 'decisionCount', 'assertionCount', 'observationAge', 'limitations'], 'Case-response provenance');
  iso(provenance.latestEvidenceCapturedAt, 'Case-response evidence time', true);
  integer(provenance.evidencePinCount, 'Case-response evidence pin count', 0, MAX_CASE_EVIDENCE_PINS);
  integer(provenance.decisionCount, 'Case-response decision count', 0, MAX_CASE_DECISIONS);
  integer(provenance.assertionCount, 'Case-response assertion count', 0, MAX_CASE_ASSERTIONS);
  const age = exact(provenance.observationAge, ['ageSeconds', 'band', 'refreshRecommended'], 'Case-response observation age');
  integer(age.ageSeconds, 'Case-response observation age seconds', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  enumeration(age.band, ['future_or_clock_skew', 'one_to_seven_days', 'over_seven_days', 'under_24_hours'], 'Case-response observation age band');
  boolean(age.refreshRecommended, 'Case-response refresh recommendation');
  const expectedAge = expectedObservationAge(incident.observedAt as string, root.generatedAt as string);
  if (age.ageSeconds !== expectedAge.ageSeconds || age.band !== expectedAge.band
    || age.refreshRecommended !== expectedAge.refreshRecommended) fail('Case-response observation age');
  strings(provenance.limitations, 'Case-response limitations', 8, 600);
  const integrity = exact(root.integrity, ['algorithm', 'canonicalization', 'scope', 'digestSha256'], 'Case-response integrity');
  if (integrity.algorithm !== 'SHA-256'
    || integrity.canonicalization !== 'sorted-json-v2'
    || integrity.scope !== 'packet excluding integrity') fail('Case-response integrity');
  if (typeof integrity.digestSha256 !== 'string' || !HEX_DIGEST_RE.test(integrity.digestSha256)) fail('Case-response integrity');
}

function validateCurrentActionSummary(value: unknown, label: string): number {
  const summary = exact(value, [
    'total', 'active', 'drafting', 'readyForReview', 'reviewed', 'authorised', 'submitted',
    'acknowledged', 'terminal', 'overdue', 'followUpDue', 'withProviderOutcome', 'latestOutcomes',
  ], label);
  const total = integer(summary.total, label, 0, MAX_CASE_ACTIONS);
  const drafting = integer(summary.drafting, label, 0, total);
  const ready = integer(summary.readyForReview, label, 0, total);
  const reviewed = integer(summary.reviewed, label, 0, total);
  const authorised = integer(summary.authorised, label, 0, total);
  const submitted = integer(summary.submitted, label, 0, total);
  const acknowledged = integer(summary.acknowledged, label, 0, total);
  const terminal = integer(summary.terminal, label, 0, total);
  const active = integer(summary.active, label, 0, total);
  if (drafting + ready + reviewed + authorised + submitted + acknowledged + terminal !== total || active + terminal !== total) fail(label);
  for (const key of ['overdue', 'followUpDue', 'withProviderOutcome'] as const) integer(summary[key], label, 0, total);
  const outcomes = array(summary.latestOutcomes, label, 5);
  for (const candidate of outcomes) {
    const outcome = exact(candidate, ['actionId', 'recipient', 'state', 'providerOutcome', 'outcomeDetail', 'occurredAt'], label);
    text(outcome.actionId, label, 64);
    text(outcome.recipient, label, 320);
    enumeration(outcome.state, CASE_ACTION_STATES, label);
    enumeration(outcome.providerOutcome, CASE_PROVIDER_OUTCOMES, label);
    optionalText(outcome.outcomeDetail, label, 2_000);
    iso(outcome.occurredAt, label);
  }
  return total;
}

function validateCaseResponsePacketV7(value: UnknownRecord): void {
  const root = exact(value, [
    'schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed', 'profile', 'case',
    'incident', 'contacts', 'selectedEvidence', 'contradictions', 'readiness', 'artefactReferences',
    'authorisation', 'preflight', 'escalationHistory', 'escalationHistoryOmitted',
    'escalationHistoryLimitations', 'responseLifecycle', 'provenance', 'integrity',
  ], 'Case-response packet v7');
  if (root.schemaVersion !== CASE_RESPONSE_PACKET_VERSION) fail('Case-response packet v7');
  iso(root.generatedAt, 'Case-response packet generatedAt');
  if (root.reviewRequired !== true || root.submissionPerformed !== false) fail('Case-response packet review state');

  const profile = exact(root.profile, ['id', 'label', 'audience', 'subject', 'checklist', 'evidenceOrder', 'includedEvidence', 'excludedEvidence', 'redactions', 'attachments', 'followUpFields'], 'Case-response profile');
  const profileId = enumeration(profile.id, RESPONSE_PACKET_PROFILE_IDS, 'Case-response profile id');
  text(profile.label, 'Case-response profile label', 200);
  text(profile.audience, 'Case-response profile audience', 300);
  text(profile.subject, 'Case-response profile subject', 500);
  for (const key of ['checklist', 'evidenceOrder', 'includedEvidence', 'excludedEvidence', 'redactions', 'attachments', 'followUpFields'] as const) strings(profile[key], `Case-response profile ${key}`, 24, 500);
  const selectedProfile = RESPONSE_PACKET_PROFILES.find((candidate) => candidate.id === profileId);
  if (!selectedProfile
    || profile.label !== selectedProfile.label
    || profile.audience !== selectedProfile.audience
    || !sameValues(profile.checklist as unknown[], selectedProfile.checklist)
    || !sameValues(profile.evidenceOrder as unknown[], selectedProfile.evidenceOrder)
    || !sameValues(profile.includedEvidence as unknown[], selectedProfile.includedEvidence)
    || !sameValues(profile.excludedEvidence as unknown[], selectedProfile.excludedEvidence)
    || !sameValues(profile.redactions as unknown[], selectedProfile.redactions)
    || !sameValues(profile.attachments as unknown[], selectedProfile.attachments)
    || !sameValues(profile.followUpFields as unknown[], selectedProfile.followUpFields)) fail('Case-response profile');

  const caseRecord = exact(root.case, ['id', 'domain', 'status', 'disposition', 'updatedAt'], 'Case-response case');
  text(caseRecord.id, 'Case-response case id', 128);
  domain(caseRecord.domain, 'Case-response case domain');
  text(caseRecord.status, 'Case-response case status', 80);
  text(caseRecord.disposition, 'Case-response case disposition', 80);
  iso(caseRecord.updatedAt, 'Case-response case updatedAt');
  const incident = exact(root.incident, ['category', 'affectedParty', 'abusiveUrls', 'observedHarm', 'observedAt'], 'Case-response incident');
  text(incident.category, 'Case-response category', 80);
  text(incident.affectedParty, 'Case-response affected party', 200);
  const urls = strings(incident.abusiveUrls, 'Case-response abusive URLs', MAX_ABUSIVE_URLS, 2_048);
  if (!urls.length || urls.some((item) => {
    try { const parsed = new URL(item); return !['http:', 'https:'].includes(parsed.protocol) || Boolean(parsed.username || parsed.password) || parsed.toString() !== item; }
    catch { return true; }
  }) || new Set(urls).size !== urls.length) fail('Case-response abusive URLs');
  text(incident.observedHarm, 'Case-response observed harm', 2_000);
  iso(incident.observedAt, 'Case-response observedAt');
  if (profile.subject !== `${selectedProfile?.subjectPrefix}: ${caseRecord.domain} (${incident.category})`) fail('Case-response profile subject');

  const contacts = array(root.contacts, 'Case-response contacts', MAX_RESPONSE_CONTACTS);
  const contactKeys = new Set<string>();
  for (const candidate of contacts) {
    const contact = exact(candidate, ['kind', 'contact', 'source', 'observedAt', 'freshness', 'limitations'], 'Case-response contact');
    const kind = enumeration(contact.kind, RESPONSE_CONTACT_KINDS, 'Case-response contact kind');
    const contactValue = text(contact.contact, 'Case-response contact value', MAX_RESPONSE_RECIPIENT_LENGTH);
    const key = `${kind}\u0000${contactValue.toLowerCase()}`;
    if (contactKeys.has(key)) fail('Case-response contacts');
    contactKeys.add(key);
    text(contact.source, 'Case-response contact source', 120);
    iso(contact.observedAt, 'Case-response contact observedAt', true);
    const freshness = enumeration(contact.freshness, ['current', 'stale', 'unknown'], 'Case-response contact freshness');
    const routeAge = contact.observedAt === null
      ? null
      : Date.parse(root.generatedAt as string) - Date.parse(contact.observedAt as string);
    const expectedFreshness = routeAge === null
      ? 'unknown'
      : routeAge < -300_000 || routeAge > RESPONSE_ROUTE_STALE_AFTER_DAYS * 86_400_000
        ? 'stale'
        : 'current';
    if (freshness !== expectedFreshness) fail('Case-response contact freshness');
    strings(contact.limitations, 'Case-response contact limitations', MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH);
  }

  const evidence = array(root.selectedEvidence, 'Case-response selected evidence', MAX_RESPONSE_SELECTED_EVIDENCE);
  const evidenceIds = new Set<string>();
  for (const candidate of evidence) {
    const item = exact(candidate, ['id', 'label', 'source', 'observedAt', 'completeness', 'limitations'], 'Case-response selected evidence');
    const id = text(item.id, 'Case-response evidence id', 64);
    if (evidenceIds.has(id)) fail('Case-response selected evidence');
    evidenceIds.add(id);
    text(item.label, 'Case-response evidence label', 80);
    text(item.source, 'Case-response evidence source', 120);
    iso(item.observedAt, 'Case-response evidence observedAt');
    enumeration(item.completeness, ['complete', 'partial', 'inconclusive', 'unknown'], 'Case-response evidence completeness');
    strings(item.limitations, 'Case-response evidence limitations', 8, 240);
  }
  const contradictions = array(root.contradictions, 'Case-response contradictions', MAX_RESPONSE_CONTRADICTIONS);
  const contradictionIds = new Set<string>();
  for (const candidate of contradictions) {
    const item = exact(candidate, ['id', 'statement', 'state', 'limitations'], 'Case-response contradiction');
    const id = text(item.id, 'Case-response contradiction id', 64);
    if (contradictionIds.has(id)) fail('Case-response contradictions');
    contradictionIds.add(id);
    text(item.statement, 'Case-response contradiction statement', 2_000);
    enumeration(item.state, ['open', 'resolved'], 'Case-response contradiction state');
    strings(item.limitations, 'Case-response contradiction limitations', 8, 240);
  }

  const readiness = exact(root.readiness, ['profileId', 'rows', 'counts', 'limitations'], 'Case-response readiness');
  if (readiness.profileId !== profileId) fail('Case-response readiness profile');
  const readinessRows = array(readiness.rows, 'Case-response readiness rows', RESPONSE_READINESS_ROW_IDS.length, RESPONSE_READINESS_ROW_IDS.length);
  const actualReadiness = Object.fromEntries(RESPONSE_READINESS_STATES.map((state) => [state, 0])) as Record<string, number>;
  const requiredReadiness = new Set([
    'observed_behaviour', 'exact_url', 'observation_time', 'capture_provenance', 'authority_review',
    'selected_evidence', 'contradictions', 'source_limitations',
    ...(profileId === 'internal_soc' ? [] : ['recipient_route']),
    ...(['registrar', 'registry', 'network_hosting'].includes(profileId) ? ['infrastructure_responsibility'] : []),
  ]);
  const requiredContact = selectedProfile?.requiredContactKind
    ? contacts.find((candidate) => (candidate as UnknownRecord).kind === selectedProfile.requiredContactKind) as UnknownRecord | undefined
    : contacts[0] as UnknownRecord | undefined;
  const expectedReadinessStates: Partial<Record<typeof RESPONSE_READINESS_ROW_IDS[number], string>> = {
    observed_behaviour: 'complete',
    exact_url: 'complete',
    observation_time: expectedObservationAge(incident.observedAt as string, root.generatedAt as string).refreshRecommended ? 'stale' : 'complete',
    capture_provenance: evidence.length ? 'complete' : 'unavailable',
    recipient_route: !requiredContact
      ? 'not_provided'
      : requiredContact.freshness === 'stale'
        ? 'stale'
        : requiredContact.freshness === 'current' && requiredContact.source ? 'complete' : 'partial',
    selected_evidence: !evidence.length
      ? 'not_provided'
      : evidence.every((candidate) => (candidate as UnknownRecord).completeness === 'complete') ? 'complete' : 'partial',
    ...(contradictions.length ? {
      contradictions: contradictions.some((candidate) => (candidate as UnknownRecord).state === 'open') ? 'partial' : 'complete',
    } : {}),
  };
  for (const [index, candidate] of readinessRows.entries()) {
    const row = exact(candidate, ['id', 'label', 'state', 'detail', 'requiredForAuthorisation', 'limitations'], 'Case-response readiness row');
    if (row.id !== RESPONSE_READINESS_ROW_IDS[index]) fail('Case-response readiness row order');
    text(row.label, 'Case-response readiness label', 200);
    const state = enumeration(row.state, RESPONSE_READINESS_STATES, 'Case-response readiness state');
    actualReadiness[state] = (actualReadiness[state] ?? 0) + 1;
    text(row.detail, 'Case-response readiness detail', 500);
    boolean(row.requiredForAuthorisation, 'Case-response readiness requirement');
    if (row.requiredForAuthorisation !== requiredReadiness.has(row.id as string)
      || (expectedReadinessStates[row.id as keyof typeof expectedReadinessStates] !== undefined
        && row.state !== expectedReadinessStates[row.id as keyof typeof expectedReadinessStates])) fail('Case-response readiness projection');
    strings(row.limitations, 'Case-response readiness limitations', 8, 240);
  }
  const readinessCounts = exact(readiness.counts, [...RESPONSE_READINESS_STATES], 'Case-response readiness counts');
  for (const state of RESPONSE_READINESS_STATES) if (integer(readinessCounts[state], 'Case-response readiness count', 0, readinessRows.length) !== actualReadiness[state]) fail('Case-response readiness counts');
  strings(readiness.limitations, 'Case-response readiness limitations', 8, 600);

  const artefacts = array(root.artefactReferences, 'Case-response artefact references', MAX_RESPONSE_ARTEFACT_REFERENCES);
  const artefactIds = new Set<string>();
  for (const candidate of artefacts) {
    const item = exact(candidate, ['id', 'label', 'mediaType', 'capturedAt', 'source', 'digestSha256', 'byteLength', 'limitations'], 'Case-response artefact reference');
    const id = text(item.id, 'Case-response artefact id', 64);
    if (artefactIds.has(id)) fail('Case-response artefact references');
    artefactIds.add(id);
    text(item.label, 'Case-response artefact label', 120);
    text(item.mediaType, 'Case-response artefact media type', 120);
    iso(item.capturedAt, 'Case-response artefact capturedAt');
    text(item.source, 'Case-response artefact source', 120);
    if (typeof item.digestSha256 !== 'string' || !HEX_DIGEST_RE.test(item.digestSha256)) fail('Case-response artefact digest');
    if (item.byteLength !== null) integer(item.byteLength, 'Case-response artefact byte length', 0, 100 * 1024 * 1024);
    strings(item.limitations, 'Case-response artefact limitations', 8, 240);
  }

  const authorisation = exact(root.authorisation, ['status', 'reviewedInputDigestSha256', 'suppliedReviewDigestSha256', 'digestMatches', 'confirmedAt', 'confirmations', 'missingConfirmations', 'limitations'], 'Case-response authorisation');
  const authorisationStatus = enumeration(authorisation.status, ['draft', 'authorised'], 'Case-response authorisation status');
  if (typeof authorisation.reviewedInputDigestSha256 !== 'string' || !HEX_DIGEST_RE.test(authorisation.reviewedInputDigestSha256)) fail('Case-response review digest');
  if (authorisation.suppliedReviewDigestSha256 !== null && (typeof authorisation.suppliedReviewDigestSha256 !== 'string' || !HEX_DIGEST_RE.test(authorisation.suppliedReviewDigestSha256))) fail('Case-response supplied review digest');
  boolean(authorisation.digestMatches, 'Case-response authorisation digest match');
  iso(authorisation.confirmedAt, 'Case-response authorisation confirmedAt', true);
  if (authorisation.confirmedAt !== null
    && Date.parse(authorisation.confirmedAt as string) > Date.parse(root.generatedAt as string) + MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS) {
    fail('Case-response authorisation confirmedAt');
  }
  const confirmations = exact(authorisation.confirmations, [...RESPONSE_AUTHORISATION_CONFIRMATION_IDS], 'Case-response confirmations');
  for (const id of RESPONSE_AUTHORISATION_CONFIRMATION_IDS) boolean(confirmations[id], `Case-response confirmation ${id}`);
  const missing = strings(authorisation.missingConfirmations, 'Case-response missing confirmations', RESPONSE_AUTHORISATION_CONFIRMATION_IDS.length, 80);
  if (missing.some((id) => !RESPONSE_AUTHORISATION_CONFIRMATION_IDS.includes(id as typeof RESPONSE_AUTHORISATION_CONFIRMATION_IDS[number]))) fail('Case-response missing confirmations');
  strings(authorisation.limitations, 'Case-response authorisation limitations', 8, 600);
  const expectedMissing = RESPONSE_AUTHORISATION_CONFIRMATION_IDS.filter((id) => confirmations[id] !== true);
  const expectedDigestMatches = authorisation.suppliedReviewDigestSha256 === authorisation.reviewedInputDigestSha256;
  const missingRequiredReadiness = readinessRows.some((candidate) => {
    const row = candidate as Record<string, unknown>;
    return row.requiredForAuthorisation === true && (row.state === 'not_provided' || row.state === 'unavailable');
  });
  const authorityReady = readinessRows.some((candidate) => {
    const row = candidate as Record<string, unknown>;
    return row.id === 'authority_review' && row.state === 'complete';
  });
  if (authorisation.digestMatches !== expectedDigestMatches
    || !sameValues(missing, expectedMissing)
    || (authorisationStatus === 'authorised' && (authorisation.digestMatches !== true || authorisation.confirmedAt === null || missing.length || missingRequiredReadiness || !authorityReady))
    || (authorisationStatus === 'draft' && authorisation.confirmedAt !== null)) fail('Case-response authorisation');

  const preflight = exact(root.preflight, ['version', 'status', 'canExport', 'counts', 'checks', 'actionSummary'], 'Case-response preflight');
  if (preflight.version !== 2) fail('Case-response preflight');
  const checks = array(preflight.checks, 'Case-response preflight checks', CASE_RESPONSE_PREFLIGHT_IDS.length, CASE_RESPONSE_PREFLIGHT_IDS.length);
  const actualCounts = { block: 0, caution: 0, pass: 0 };
  for (const [index, candidate] of checks.entries()) {
    const check = exact(candidate, ['id', 'label', 'state', 'detail'], 'Case-response preflight check');
    if (check.id !== CASE_RESPONSE_PREFLIGHT_IDS[index]) fail('Case-response preflight check order');
    text(check.label, 'Case-response preflight label', 200);
    const state = enumeration(check.state, ['block', 'caution', 'pass'], 'Case-response preflight state');
    actualCounts[state] += 1;
    text(check.detail, 'Case-response preflight detail', 1_000);
  }
  const counts = exact(preflight.counts, ['block', 'caution', 'pass'], 'Case-response preflight counts');
  for (const state of ['block', 'caution', 'pass'] as const) if (integer(counts[state], 'Case-response preflight count', 0, checks.length) !== actualCounts[state]) fail('Case-response preflight counts');
  const expectedStatus = actualCounts.block ? 'needs_input' : actualCounts.caution ? 'review_cautions' : 'ready_for_review';
  if (preflight.status !== expectedStatus || preflight.canExport !== (actualCounts.block === 0)) fail('Case-response preflight status');
  const actionTotal = validateCurrentActionSummary(preflight.actionSummary, 'Case-response action summary');

  const history = array(root.escalationHistory, 'Case-response escalation history', MAX_RESPONSE_ACTION_HISTORY);
  const escalationHistoryOmitted = integer(root.escalationHistoryOmitted, 'Case-response omitted actions', 0, MAX_CASE_ACTIONS);
  const escalationHistoryLimitations = strings(root.escalationHistoryLimitations, 'Case-response history limitations', 4, 600);
  if (history.length !== Math.min(actionTotal, MAX_RESPONSE_ACTION_HISTORY)
    || escalationHistoryOmitted !== actionTotal - history.length
    || (escalationHistoryOmitted > 0) !== (escalationHistoryLimitations.length > 0)) fail('Case-response action-history bounds');
  const actionIds = new Set<string>();
  const providerEvents: Array<{
    actionId: string;
    eventId: string;
    outcome: typeof CASE_PROVIDER_OUTCOMES[number];
    occurredAt: string;
    reference: string | null;
    applied: boolean;
  }> = [];
  for (const candidate of history) {
    const action = exact(candidate, ['actionId', 'type', 'recipient', 'contactSource', 'state', 'reference', 'providerOutcome', 'outcomeDetail', 'originActionId', 'historyOmitted', 'historyLimitations', 'transitions', 'createdAt', 'updatedAt'], 'Case-response escalation action');
    const actionId = text(action.actionId, 'Case-response action id', 64);
    if (actionIds.has(actionId)) fail('Case-response action identity');
    actionIds.add(actionId);
    enumeration(action.type, CASE_ACTION_TYPES, 'Case-response action type');
    text(action.recipient, 'Case-response action recipient', 320);
    text(action.contactSource, 'Case-response action source', 120);
    enumeration(action.state, CASE_ACTION_STATES, 'Case-response action state');
    optionalText(action.reference, 'Case-response action reference', 500);
    if (action.providerOutcome !== null) enumeration(action.providerOutcome, CASE_PROVIDER_OUTCOMES, 'Case-response provider outcome');
    optionalText(action.outcomeDetail, 'Case-response action outcome detail', 2_000);
    optionalText(action.originActionId, 'Case-response action origin', 64);
    integer(action.historyOmitted, 'Case-response action omitted history', 0, 1_000_000);
    strings(action.historyLimitations, 'Case-response action history limitations', 8, 240);
    const transitions = array(action.transitions, 'Case-response action transitions', MAX_CASE_ACTION_EVENTS_PER_ACTION, 1);
    const eventIds = new Set<string>();
    let projectedState: typeof CASE_ACTION_STATES[number] | null = null;
    let latestReference: string | null = null;
    let latestProviderOutcome: typeof CASE_PROVIDER_OUTCOMES[number] | null = null;
    let latestProviderOutcomeDetail: string | null = null;
    let latestOutcomeDetail: string | null = null;
    let previousTime = Number.NEGATIVE_INFINITY;
    let previousEventId = '';
    for (const eventCandidate of transitions) {
      const event = exact(eventCandidate, ['id', 'previousState', 'nextState', 'occurredAt', 'sourceClass', 'provenance', 'reference', 'evidencePinId', 'limitations', 'providerOutcome', 'outcomeDetail', 'originActionId', 'applied'], 'Case-response action transition');
      const eventId = text(event.id, 'Case-response action event id', 64);
      if (eventIds.has(eventId)) fail('Case-response action event identity');
      eventIds.add(eventId);
      const previousState = event.previousState === null ? null : enumeration(event.previousState, CASE_ACTION_STATES, 'Case-response previous state');
      const nextState = enumeration(event.nextState, CASE_ACTION_STATES, 'Case-response next state');
      iso(event.occurredAt, 'Case-response action event time');
      const eventTime = Date.parse(event.occurredAt as string);
      if (eventTime < previousTime || (eventTime === previousTime && eventId < previousEventId)) fail('Case-response action event order');
      previousTime = eventTime;
      previousEventId = eventId;
      const sourceClass = enumeration(event.sourceClass, CASE_ACTION_EVENT_SOURCE_CLASSES, 'Case-response action event source class');
      text(event.provenance, 'Case-response action event provenance', 80);
      optionalText(event.reference, 'Case-response action event reference', 500);
      optionalText(event.evidencePinId, 'Case-response action event evidence pin', 64);
      strings(event.limitations, 'Case-response action event limitations', 8, 240);
      const providerOutcome = event.providerOutcome === null ? null : enumeration(event.providerOutcome, CASE_PROVIDER_OUTCOMES, 'Case-response action event provider outcome');
      if (providerOutcome !== null && !['submitted', 'acknowledged', 'terminal'].includes(nextState) && sourceClass !== 'migration') fail('Case-response action event provider outcome');
      const migrationSnapshot = sourceClass === 'migration' && previousState === null;
      if (providerOutcome !== null && previousState === 'authorised' && nextState === 'submitted' && !migrationSnapshot) fail('Case-response submission event outcome');
      if (providerOutcome === 'no_response' && sourceClass === 'provider') fail('Case-response no-response event source');
      if (['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState)
        && sourceClass !== 'analyst' && !migrationSnapshot) fail('Case-response explicit analyst transition');
      if (nextState === 'terminal' && previousState !== null
        && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(previousState)
        && (sourceClass !== 'analyst' || providerOutcome !== 'withdrawn')) fail('Case-response early terminal transition');
      if (providerOutcome === 'withdrawn'
        && (nextState !== 'terminal' || (sourceClass !== 'analyst' && !migrationSnapshot))) fail('Case-response withdrawn transition');
      optionalText(event.outcomeDetail, 'Case-response action event outcome detail', 2_000);
      optionalText(event.originActionId, 'Case-response action event origin', 64);
      if (event.originActionId === actionId) fail('Case-response action event origin');
      boolean(event.applied, 'Case-response action event projection');
      const applied = event.applied as boolean;
      if (providerOutcome !== null) {
        providerEvents.push({
          actionId,
          eventId,
          outcome: providerOutcome,
          occurredAt: event.occurredAt as string,
          reference: event.reference as string | null,
          applied,
        });
      }
      if (projectedState === null && Number(action.historyOmitted) > 0 && previousState !== null) projectedState = previousState;
      const expectedApplied = previousState === projectedState
        && isLegalCaseActionTransition(previousState, nextState, sourceClass);
      if (applied !== expectedApplied) fail('Case-response action event projection');
      if (applied) {
        projectedState = nextState;
        if (event.reference !== null) latestReference = event.reference as string;
        if (event.outcomeDetail !== null) latestOutcomeDetail = event.outcomeDetail as string;
        if (providerOutcome !== null) {
          latestProviderOutcome = providerOutcome;
          latestProviderOutcomeDetail = event.outcomeDetail as string | null;
        }
      }
    }
    if ((projectedState ?? 'drafting') !== action.state
      || latestReference !== action.reference
      || latestProviderOutcome !== action.providerOutcome
      || (latestProviderOutcomeDetail ?? latestOutcomeDetail) !== action.outcomeDetail) fail('Case-response action projection');
    if (action.originActionId === actionId) fail('Case-response action origin');
    iso(action.createdAt, 'Case-response action createdAt');
    iso(action.updatedAt, 'Case-response action updatedAt');
  }

  const lifecycle = exact(root.responseLifecycle, ['providerOutcomeState', 'latestProviderOutcome', 'observedChangeState', 'latestObservedEffect', 'latestObservedChangeAt', 'closure', 'limitations'], 'Case-response lifecycle');
  const providerOutcomeState = enumeration(lifecycle.providerOutcomeState, ['available', 'missing', 'ambiguous'], 'Case-response lifecycle provider state');
  let actualLatestProvider: {
    actionId: string;
    eventId: string;
    outcome: typeof CASE_PROVIDER_OUTCOMES[number];
    occurredAt: string;
    reference: string | null;
  } | null = null;
  if (lifecycle.latestProviderOutcome !== null) {
    const outcome = exact(lifecycle.latestProviderOutcome, ['actionId', 'eventId', 'outcome', 'occurredAt', 'reference'], 'Case-response lifecycle provider outcome');
    const actionId = text(outcome.actionId, 'Case-response lifecycle action id', 64);
    const eventId = text(outcome.eventId, 'Case-response lifecycle event id', 64);
    const providerOutcome = enumeration(outcome.outcome, CASE_PROVIDER_OUTCOMES, 'Case-response lifecycle provider outcome');
    iso(outcome.occurredAt, 'Case-response lifecycle provider time');
    const occurredAt = outcome.occurredAt as string;
    optionalText(outcome.reference, 'Case-response lifecycle reference', 500);
    actualLatestProvider = {
      actionId,
      eventId,
      outcome: providerOutcome,
      occurredAt,
      reference: outcome.reference as string | null,
    };
  }
  providerEvents.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    || (right.eventId < left.eventId ? -1 : right.eventId > left.eventId ? 1 : 0));
  const latestProviderTime = providerEvents[0]?.occurredAt ?? null;
  const latestProviderEvents = latestProviderTime === null
    ? []
    : providerEvents.filter((event) => event.occurredAt === latestProviderTime);
  const expectedLatestProvider = escalationHistoryOmitted === 0
    && latestProviderEvents.length === 1 && latestProviderEvents[0]!.applied
    ? latestProviderEvents[0]!
    : null;
  const expectedProviderState = escalationHistoryOmitted > 0
    ? 'ambiguous'
    : providerEvents.length === 0 ? 'missing' : expectedLatestProvider ? 'available' : 'ambiguous';
  if (providerOutcomeState !== expectedProviderState
    || (actualLatestProvider === null) !== (expectedLatestProvider === null)
    || (actualLatestProvider && expectedLatestProvider && (
      actualLatestProvider.actionId !== expectedLatestProvider.actionId
      || actualLatestProvider.eventId !== expectedLatestProvider.eventId
      || actualLatestProvider.outcome !== expectedLatestProvider.outcome
      || actualLatestProvider.occurredAt !== expectedLatestProvider.occurredAt
      || actualLatestProvider.reference !== expectedLatestProvider.reference
    ))) fail('Case-response lifecycle provider state');
  const observedChangeState = enumeration(lifecycle.observedChangeState, ['available', 'missing', 'ambiguous'], 'Case-response lifecycle observed-change state');
  if (lifecycle.latestObservedEffect !== null) {
    const effect = exact(lifecycle.latestObservedEffect, ['reviewId', 'state', 'observedAt', 'sourceClass', 'source'], 'Case-response lifecycle observed effect');
    text(effect.reviewId, 'Case-response effect review id', 64);
    enumeration(effect.state, CASE_OBSERVED_EFFECT_STATES, 'Case-response effect state');
    iso(effect.observedAt, 'Case-response effect observedAt');
    enumeration(effect.sourceClass, CASE_OBSERVED_EFFECT_SOURCE_CLASSES, 'Case-response effect source class');
    text(effect.source, 'Case-response effect source', 80);
  }
  iso(lifecycle.latestObservedChangeAt, 'Case-response observed change time', true);
  if ((observedChangeState === 'available') !== (lifecycle.latestObservedChangeAt !== null)) fail('Case-response lifecycle observed-change state');
  if (lifecycle.closure !== null) {
    const closure = exact(lifecycle.closure, ['id', 'reason', 'createdAt', 'limitations'], 'Case-response closure');
    text(closure.id, 'Case-response closure id', 64);
    enumeration(closure.reason, CASE_CLOSURE_REASONS, 'Case-response closure reason');
    iso(closure.createdAt, 'Case-response closure time');
    strings(closure.limitations, 'Case-response closure limitations', 8, 240);
  }
  strings(lifecycle.limitations, 'Case-response lifecycle limitations', 8, 600);

  const reviewedInputs = {
    contract: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
    version: CASE_RESPONSE_REVIEW_INPUTS_VERSION,
    profile: {
      id: profile.id,
      label: profile.label,
      audience: profile.audience,
      subject: profile.subject,
      checklist: profile.checklist,
      includedEvidence: profile.includedEvidence,
      excludedEvidence: profile.excludedEvidence,
      redactions: profile.redactions,
    },
    case: root.case,
    incident: root.incident,
    contacts: root.contacts,
    selectedEvidence: root.selectedEvidence,
    contradictions: root.contradictions,
    readiness: root.readiness,
    artefactReferences: root.artefactReferences,
    escalationHistory: root.escalationHistory,
    escalationHistoryOmitted: root.escalationHistoryOmitted,
    escalationHistoryLimitations: root.escalationHistoryLimitations,
    responseLifecycle: root.responseLifecycle,
  };
  const expectedReviewDigest = createHash('sha256')
    .update(canonicalArtifactJsonV2(reviewedInputs))
    .digest('hex');
  if (authorisation.reviewedInputDigestSha256 !== expectedReviewDigest) fail('Case-response reviewed-input digest');

  const provenance = exact(root.provenance, ['latestEvidenceCapturedAt', 'evidencePinCount', 'decisionCount', 'assertionCount', 'observationAge', 'limitations'], 'Case-response provenance');
  iso(provenance.latestEvidenceCapturedAt, 'Case-response evidence time', true);
  integer(provenance.evidencePinCount, 'Case-response evidence pin count', 0, MAX_CASE_EVIDENCE_PINS);
  integer(provenance.decisionCount, 'Case-response decision count', 0, MAX_CASE_DECISIONS);
  integer(provenance.assertionCount, 'Case-response assertion count', 0, MAX_CASE_ASSERTIONS);
  const age = exact(provenance.observationAge, ['ageSeconds', 'band', 'refreshRecommended'], 'Case-response observation age');
  integer(age.ageSeconds, 'Case-response observation age seconds', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  enumeration(age.band, ['future_or_clock_skew', 'one_to_seven_days', 'over_seven_days', 'under_24_hours'], 'Case-response observation age band');
  boolean(age.refreshRecommended, 'Case-response refresh recommendation');
  const expectedAge = expectedObservationAge(incident.observedAt as string, root.generatedAt as string);
  if (age.ageSeconds !== expectedAge.ageSeconds || age.band !== expectedAge.band || age.refreshRecommended !== expectedAge.refreshRecommended) fail('Case-response observation age');
  strings(provenance.limitations, 'Case-response limitations', 8, 600);
  const integrity = exact(root.integrity, ['algorithm', 'canonicalization', 'scope', 'digestSha256'], 'Case-response integrity');
  if (integrity.algorithm !== 'SHA-256' || integrity.canonicalization !== 'sorted-json-v2' || integrity.scope !== 'packet excluding integrity') fail('Case-response integrity');
  if (typeof integrity.digestSha256 !== 'string' || !HEX_DIGEST_RE.test(integrity.digestSha256)) fail('Case-response integrity');
}

export function validateCaseResponsePacket(value: UnknownRecord): void {
  if (value.schemaVersion === PUBLIC_CASE_RESPONSE_PACKET_VERSION) return validateCaseResponsePacketV6(value);
  if (Number.isSafeInteger(value.schemaVersion) && (value.schemaVersion as number) < CASE_RESPONSE_PACKET_VERSION) {
    throw new TypeError(`Case-response packet version ${String(value.schemaVersion)} is not part of the public compatibility boundary; no data was changed.`);
  }
  if (Number.isSafeInteger(value.schemaVersion) && (value.schemaVersion as number) > CASE_RESPONSE_PACKET_VERSION) {
    throw new TypeError(`Case-response packet version ${String(value.schemaVersion)} is newer than the supported version ${CASE_RESPONSE_PACKET_VERSION}; no data was changed.`);
  }
  validateCaseResponsePacketV7(value);
}
