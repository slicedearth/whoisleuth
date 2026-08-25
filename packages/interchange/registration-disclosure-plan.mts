import {
  REGISTRATION_DISCLOSURE_PLAN_SCHEMA,
  REGISTRATION_DISCLOSURE_PLAN_VERSION,
} from '../contracts/analyst-interchange.mts';

export {
  REGISTRATION_DISCLOSURE_PLAN_SCHEMA,
  REGISTRATION_DISCLOSURE_PLAN_VERSION,
} from '../contracts/analyst-interchange.mts';
export const MAX_DISCLOSURE_JUSTIFICATION_LENGTH = 4000;
export const MAX_DISCLOSURE_REFERENCE_LENGTH = 160;
export const MAX_DISCLOSURE_REDACTIONS = 40;

export const DISCLOSURE_PURPOSES = [
  'cybersecurity-investigation',
  'brand-protection',
  'legal-claim',
  'consumer-protection',
  'other',
] as const;
export type DisclosurePurpose = typeof DISCLOSURE_PURPOSES[number];

export const DISCLOSURE_FIELD_IDS = [
  'registrant-name',
  'registrant-organization',
  'registrant-email',
  'registrant-phone',
  'administrative-contact',
  'technical-contact',
] as const;
export type DisclosureFieldId = typeof DISCLOSURE_FIELD_IDS[number];

export type RegistrationDisclosureInput = Readonly<{
  purpose?: unknown;
  justification?: unknown;
  requestedFields?: unknown;
  publicDataReviewed?: unknown;
  dataMinimised?: unknown;
  rightsImpactConsidered?: unknown;
  currentProcessReviewed?: unknown;
  gtldScopeReviewed?: unknown;
  registrarParticipationReviewed?: unknown;
  requesterMaterialsReady?: unknown;
  caseReference?: unknown;
}>;

export type RegistrationDisclosureObservedInput = Readonly<{
  domain?: unknown;
  observedAt?: unknown;
  registryRdapEndpoint?: unknown;
  registrarName?: unknown;
  registrarRdapEndpoint?: unknown;
  redactions?: unknown;
  redactionsTruncated?: unknown;
}>;

export type RegistrationDisclosureCheck = Readonly<{
  id: string;
  label: string;
  state: 'block' | 'caution' | 'pass';
  detail: string;
}>;

export type RegistrationDisclosurePlan = Readonly<{
  schema: typeof REGISTRATION_DISCLOSURE_PLAN_SCHEMA;
  schemaVersion: 2;
  generatedAt: string;
  localPreparationOnly: true;
  submissionPerformed: false;
  entitlementDetermined: false;
  readiness: 'needs_input' | 'ready_for_manual_review' | 'review_cautions';
  counts: Readonly<{ block: number; caution: number; pass: number }>;
  observedEvidence: Readonly<{
    domain: string;
    observedAt: string | null;
    registryRdapEndpoint: string | null;
    registrarName: string | null;
    registrarRdapEndpoint: string | null;
    redactions: readonly Readonly<{
      name: string;
      method: string | null;
      reason: string | null;
    }>[];
    redactionsTruncated: boolean;
  }>;
  analystRequest: Readonly<{
    purpose: DisclosurePurpose | null;
    justification: string;
    requestedFields: readonly DisclosureFieldId[];
    publicDataReviewed: boolean;
    dataMinimised: boolean;
    rightsImpactConsidered: boolean;
    currentProcessReviewed: boolean;
    gtldScopeReviewed: boolean;
    registrarParticipationReviewed: boolean;
    requesterMaterialsReady: boolean;
    caseReference: string | null;
  }>;
  checks: readonly RegistrationDisclosureCheck[];
  unknowns: readonly string[];
  limitations: readonly string[];
  nextManualSteps: readonly string[];
  serviceHandoff: Readonly<{
    id: 'icann-rdrs';
    label: 'ICANN Registration Data Request Service';
    informationUrl: 'https://www.icann.org/rdrs-en/';
    portalUrl: 'https://rdrs.icann.org/';
    accountRequired: true;
    submissionPerformed: false;
  }>;
}>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function nullableUrl(value: unknown): string | null {
  const candidate = boundedText(value, 2048);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function nullableIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizePurpose(value: unknown): DisclosurePurpose | null {
  return typeof value === 'string' && DISCLOSURE_PURPOSES.includes(value as DisclosurePurpose)
    ? value as DisclosurePurpose
    : null;
}

function normalizeFields(value: unknown): DisclosureFieldId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is DisclosureFieldId => (
    typeof item === 'string' && DISCLOSURE_FIELD_IDS.includes(item as DisclosureFieldId)
  )))].slice(0, DISCLOSURE_FIELD_IDS.length);
}

function normalizeRedactions(value: unknown): Array<{ name: string; method: string | null; reason: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_DISCLOSURE_REDACTIONS).flatMap((item) => {
    const source = record(item);
    const name = boundedText(source.name, 160) || boundedText(source.prePath, 240) || boundedText(source.postPath, 240);
    if (!name) return [];
    return [{
      name,
      method: boundedText(source.method, 80) || null,
      reason: boundedText(source.reason, 240) || null,
    }];
  });
}

function check(id: string, label: string, state: RegistrationDisclosureCheck['state'], detail: string): RegistrationDisclosureCheck {
  return { id, label, state, detail };
}

export function buildRegistrationDisclosurePlan(
  observed: RegistrationDisclosureObservedInput,
  input: RegistrationDisclosureInput,
  generatedAt = new Date().toISOString(),
): RegistrationDisclosurePlan {
  const redactions = normalizeRedactions(observed.redactions);
  const purpose = normalizePurpose(input.purpose);
  const justification = boundedText(input.justification, MAX_DISCLOSURE_JUSTIFICATION_LENGTH);
  const requestedFields = normalizeFields(input.requestedFields);
  const publicDataReviewed = input.publicDataReviewed === true;
  const dataMinimised = input.dataMinimised === true;
  const rightsImpactConsidered = input.rightsImpactConsidered === true;
  const currentProcessReviewed = input.currentProcessReviewed === true;
  const gtldScopeReviewed = input.gtldScopeReviewed === true;
  const registrarParticipationReviewed = input.registrarParticipationReviewed === true;
  const requesterMaterialsReady = input.requesterMaterialsReady === true;
  const caseReference = boundedText(input.caseReference, MAX_DISCLOSURE_REFERENCE_LENGTH) || null;

  const checks: RegistrationDisclosureCheck[] = [
    redactions.length
      ? check('public-gap', 'Public data gap', 'pass', `${redactions.length} bounded RDAP redaction declaration${redactions.length === 1 ? '' : 's'} observed.`)
      : check('public-gap', 'Public data gap', 'caution', 'No structured RDAP redaction declaration was observed. Confirm that nonpublic data is actually needed.'),
    publicDataReviewed
      ? check('public-review', 'Public sources reviewed', 'pass', 'The analyst confirmed that available public registration evidence was reviewed first.')
      : check('public-review', 'Public sources reviewed', 'block', 'Review available public RDAP and registration evidence before preparing a disclosure request.'),
    purpose
      ? check('purpose', 'Purpose recorded', 'pass', 'A request purpose is recorded separately from observed evidence.')
      : check('purpose', 'Purpose recorded', 'block', 'Select a request purpose.'),
    justification.length >= 40
      ? check('justification', 'Justification recorded', 'pass', 'A bounded analyst-authored justification is present.')
      : check('justification', 'Justification recorded', 'block', 'Add a specific justification of at least 40 characters.'),
    requestedFields.length
      ? check('field-scope', 'Requested fields scoped', 'pass', `${requestedFields.length} field categor${requestedFields.length === 1 ? 'y is' : 'ies are'} requested.`)
      : check('field-scope', 'Requested fields scoped', 'block', 'Select only the registration field categories required for the review.'),
    dataMinimised
      ? check('minimisation', 'Data minimisation confirmed', 'pass', 'The analyst confirmed that the requested fields are limited to the stated purpose.')
      : check('minimisation', 'Data minimisation confirmed', 'block', 'Confirm that each requested field is necessary for the stated purpose.'),
    rightsImpactConsidered
      ? check('rights-impact', 'Rights impact considered', 'pass', 'The analyst confirmed that affected-party privacy and rights were considered.')
      : check('rights-impact', 'Rights impact considered', 'block', 'Consider and record the privacy and rights impact before export.'),
    currentProcessReviewed
      ? check('current-process', 'Current request path reviewed', 'pass', 'The analyst confirmed that current service instructions, terms, and submission process were checked manually.')
      : check('current-process', 'Current request path reviewed', 'block', 'Check the current disclosure service instructions, terms, and request process.'),
    gtldScopeReviewed
      ? check('gtld-scope', 'gTLD service scope reviewed', 'pass', 'The analyst confirmed that the domain and request fit the current service scope.')
      : check('gtld-scope', 'gTLD service scope reviewed', 'block', 'Confirm that the target is within the current nonpublic gTLD registration-data service scope.'),
    registrarParticipationReviewed
      ? check('registrar-participation', 'Registrar participation reviewed', 'pass', 'Current registrar participation was reviewed manually.')
      : check('registrar-participation', 'Registrar participation reviewed', 'block', 'Check whether the registrar currently participates; WHOISleuth does not infer participation.'),
    requesterMaterialsReady
      ? check('requester-materials', 'Requester materials reviewed', 'pass', 'The analyst confirmed that identity, authority, and supporting materials are ready for manual review.')
      : check('requester-materials', 'Requester materials reviewed', 'block', 'Review the requester identity, authority, supporting documents, and account requirements before handoff.'),
    caseReference
      ? check('case-reference', 'Case reference', 'pass', 'A bounded local or external case reference is included.')
      : check('case-reference', 'Case reference', 'caution', 'Add a case reference when one exists so the request can be traced.'),
  ];
  const counts = {
    block: checks.filter((item) => item.state === 'block').length,
    caution: checks.filter((item) => item.state === 'caution').length,
    pass: checks.filter((item) => item.state === 'pass').length,
  };

  return {
    schema: REGISTRATION_DISCLOSURE_PLAN_SCHEMA,
    schemaVersion: REGISTRATION_DISCLOSURE_PLAN_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    localPreparationOnly: true,
    submissionPerformed: false,
    entitlementDetermined: false,
    readiness: counts.block ? 'needs_input' : counts.caution ? 'review_cautions' : 'ready_for_manual_review',
    counts,
    observedEvidence: {
      domain: boundedText(observed.domain, 253).toLowerCase(),
      observedAt: nullableIso(observed.observedAt),
      registryRdapEndpoint: nullableUrl(observed.registryRdapEndpoint),
      registrarName: boundedText(observed.registrarName, 240) || null,
      registrarRdapEndpoint: nullableUrl(observed.registrarRdapEndpoint),
      redactions,
      redactionsTruncated: observed.redactionsTruncated === true || (Array.isArray(observed.redactions) && observed.redactions.length > redactions.length),
    },
    analystRequest: {
      purpose,
      justification,
      requestedFields,
      publicDataReviewed,
      dataMinimised,
      rightsImpactConsidered,
      currentProcessReviewed,
      gtldScopeReviewed,
      registrarParticipationReviewed,
      requesterMaterialsReady,
      caseReference,
    },
    checks,
    unknowns: [
      'Whether this domain and registrar are eligible for the current disclosure service.',
      'Whether the requester is entitled to receive any nonpublic registration data.',
      'Whether the recipient will accept the request or disclose every requested field.',
    ],
    limitations: [
      'This packet is local preparation material, not legal advice, an entitlement decision, or a submitted request.',
      'Only bounded redaction metadata is included; raw RDAP, WHOIS, and personal registration data are excluded.',
      'Service scope, registrar participation, requirements, and response handling can change and must be checked at submission time.',
    ],
    nextManualSteps: [
      'Review the current disclosure-service and registrar instructions.',
      'Verify requester identity, authority, jurisdiction, and any required supporting documents.',
      'Review the exported packet for necessity, accuracy, contradictions, and personal data before manual submission.',
      'Record the external reference and outcome in the case action trail after submission.',
    ],
    serviceHandoff: {
      id: 'icann-rdrs',
      label: 'ICANN Registration Data Request Service',
      informationUrl: 'https://www.icann.org/rdrs-en/',
      portalUrl: 'https://rdrs.icann.org/',
      accountRequired: true,
      submissionPerformed: false,
    },
  };
}

export function registrationDisclosureFilename(plan: RegistrationDisclosurePlan): string {
  const domain = plan.observedEvidence.domain.replace(/[^a-z0-9.-]+/g, '-').replace(/^-|-$/g, '') || 'domain';
  return `whoisleuth-${domain}-registration-disclosure-plan.json`;
}
