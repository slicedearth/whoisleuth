export const LOOKUP_GUIDANCE_TASKS = Object.freeze([
  'general',
  'acquisition',
  'brand',
  'incident',
  'owned',
] as const);
export type LookupGuidanceTask = typeof LOOKUP_GUIDANCE_TASKS[number];
export type LookupGuidanceMode = 'fast' | 'deep' | 'review_retained';

export type LookupTaskGuidance = Readonly<{
  task: LookupGuidanceTask;
  label: string;
  recommendation: LookupGuidanceMode;
  reason: string;
  requestExplanation: string;
  limitation: string;
}>;

const GUIDANCE: Readonly<Record<LookupGuidanceTask, LookupTaskGuidance>> = Object.freeze({
  general: Object.freeze({
    task: 'general',
    label: 'General investigation',
    recommendation: 'fast',
    reason: 'Fast starts with authority-aware registration and availability evidence before a broader collection is justified.',
    requestExplanation: 'Fast requests the existing lower-request authority and RDAP registration path and omits WHOIS, DNS, HTTP, TLS, network-context, and optional intelligence branches.',
    limitation: 'A Fast result can still be partial, unavailable, or inconclusive. Use Deep only when the question needs the additional source families.',
  }),
  brand: Object.freeze({
    task: 'brand',
    label: 'Brand review',
    recommendation: 'deep',
    reason: 'Deep provides the existing source-qualified web, DNS, TLS, registration, and relationship context used by brand review.',
    requestExplanation: 'Deep requests the existing registry RDAP, WHOIS, domain evidence, registrar RDAP, DNS, HTTP, TLS, and network-context branches. Optional intelligence sources receive data only when separately selected.',
    limitation: 'Deep is broader, not complete or authoritative for every question. Missing and conflicting sources remain explicit.',
  }),
  acquisition: Object.freeze({
    task: 'acquisition',
    label: 'Acquisition review',
    recommendation: 'deep',
    reason: 'Deep provides the existing bounded registration, web, DNS, TLS, and uncertainty context expected by acquisition review.',
    requestExplanation: 'Deep uses the existing request budget and source branches. It does not appraise a domain, contact a seller, or establish clean title or legal sufficiency.',
    limitation: 'The recommendation organises due diligence; it does not make an acquisition recommendation or guarantee completeness.',
  }),
  incident: Object.freeze({
    task: 'incident',
    label: 'Incident response',
    recommendation: 'deep',
    reason: 'Deep collects the web, DNS, TLS, registration, and network evidence needed to review an incident and choose a response route.',
    requestExplanation: 'Deep requests the existing source branches. It does not submit a report, test a published contact, or establish responsibility for the observed content.',
    limitation: 'Collection supports review; it does not determine maliciousness or authorise a response.',
  }),
  owned: Object.freeze({
    task: 'owned',
    label: 'Owned-domain posture',
    recommendation: 'deep',
    reason: 'Deep collects the current registration, DNS, TLS, mail, and web observations needed for a source-by-source posture review.',
    requestExplanation: 'Deep uses the existing bounded source branches. Retained baselines remain separate and must be compared using their observation times and source states.',
    limitation: 'A changed or missing observation does not by itself establish compromise, remediation, or control.',
  }),
});

export function lookupTaskGuidance(task: unknown): LookupTaskGuidance {
  return typeof task === 'string' && LOOKUP_GUIDANCE_TASKS.includes(task as LookupGuidanceTask)
    ? GUIDANCE[task as LookupGuidanceTask]
    : GUIDANCE.general;
}
