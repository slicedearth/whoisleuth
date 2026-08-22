export const LOOKUP_GUIDANCE_TASKS = Object.freeze([
  'registration_authority',
  'brand_impersonation',
  'acquisition',
  'retained_comparison',
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
  registration_authority: Object.freeze({
    task: 'registration_authority',
    label: 'Registration or authority question',
    recommendation: 'fast',
    reason: 'Fast is usually sufficient when the question is limited to authoritative registration and availability evidence.',
    requestExplanation: 'Fast requests the existing lower-request authority and RDAP registration path and omits WHOIS, DNS, HTTP, TLS, network-context, and optional intelligence branches.',
    limitation: 'A Fast result can still be partial, unavailable, or inconclusive and is not a universal ownership decision.',
  }),
  brand_impersonation: Object.freeze({
    task: 'brand_impersonation',
    label: 'Brand or impersonation review',
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
  retained_comparison: Object.freeze({
    task: 'retained_comparison',
    label: 'Retained comparison question',
    recommendation: 'review_retained',
    reason: 'Review the retained comparison first so the existing observation times, completeness, and source states remain visible before deciding whether recollection is necessary.',
    requestExplanation: 'Opening retained change review makes zero target requests. A later Fast or Deep collection occurs only after a separate deliberate Lookup submission.',
    limitation: 'Retained evidence can be stale, partial, or unavailable and does not establish the current state without a reviewed recollection decision.',
  }),
});

export function lookupTaskGuidance(task: unknown): LookupTaskGuidance {
  return typeof task === 'string' && LOOKUP_GUIDANCE_TASKS.includes(task as LookupGuidanceTask)
    ? GUIDANCE[task as LookupGuidanceTask]
    : GUIDANCE.registration_authority;
}
