import type { EvidenceCoverageLedger, EvidenceCoverageState } from './evidence-coverage-ledger.ts';
import type { LookupDecisionSupport } from './lookup-decision-support.ts';
import type { LookupTaskView } from './lookup-presentation.ts';

export type LookupClaimReadinessState = 'ready' | 'limited' | 'not_ready';
export const LOOKUP_CLAIM_READINESS_VERSION = 2;

export const LOOKUP_CLAIM_IDS = [
  'registration-state',
  'current-web-observation',
  'brand-resemblance',
  'controlled-change',
  'incident-response',
  'network-context',
] as const;
export type LookupClaimId = typeof LOOKUP_CLAIM_IDS[number];

export const LOOKUP_CLAIM_REQUIREMENT_IDS = [
  'authority-aware-availability',
  'registry-rdap',
  'registry-whois',
  'registry-control-selection',
  'dns-observation',
  'http-observation',
  'tls-observation',
  'page-identity-observation',
  'reviewed-brand-profile',
  'reviewed-case-recipient',
  'authoritative-rdap',
] as const;
export type LookupClaimRequirementId = typeof LOOKUP_CLAIM_REQUIREMENT_IDS[number];
export type LookupClaimRequirementMode = 'network_collection' | 'local_review';

export type LookupClaimRequirement = Readonly<{
  id: LookupClaimRequirementId;
  label: string;
  evidenceId: string | null;
  mode: LookupClaimRequirementMode;
  href: `#${string}`;
  state: EvidenceCoverageState;
  limitations: readonly string[];
}>;

export type LookupClaimReadinessEntry = Readonly<{
  id: LookupClaimId;
  label: string;
  state: LookupClaimReadinessState;
  conclusion: string;
  requiredEvidence: readonly string[];
  missingEvidence: readonly string[];
  requiredEvidenceIds: readonly LookupClaimRequirementId[];
  missingEvidenceIds: readonly LookupClaimRequirementId[];
  requirements: readonly LookupClaimRequirement[];
  limitations: readonly string[];
  href: `#${string}`;
}>;

export type RegistrationDisagreementDiagnostic = Readonly<{
  id: string;
  field: string;
  hypothesis: string;
  detail: string;
  basis: readonly string[];
}>;

export type LookupClaimReadiness = Readonly<{
  version: typeof LOOKUP_CLAIM_READINESS_VERSION;
  entries: readonly LookupClaimReadinessEntry[];
  disagreements: readonly RegistrationDisagreementDiagnostic[];
  counts: Readonly<Record<LookupClaimReadinessState, number>>;
  limitation: string;
}>;

type JsonRecord = Record<string, unknown>;
type RequirementDefinition = Readonly<{
  id: LookupClaimRequirementId;
  label: string;
  evidenceId: string | null;
  mode: LookupClaimRequirementMode;
  href: `#${string}`;
}>;

const MAX_TEXT = 320;
const MAX_DIAGNOSTICS = 12;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const LIMITED_STATES = new Set<EvidenceCoverageState>(['partial', 'unavailable', 'unknown']);
const ABSENT_STATES = new Set<EvidenceCoverageState>(['skipped', 'unsupported']);

export const LOOKUP_CLAIM_REQUIREMENTS: Readonly<Record<LookupClaimRequirementId, RequirementDefinition>> = Object.freeze({
  'authority-aware-availability': Object.freeze({ id: 'authority-aware-availability', label: 'Authority-aware availability decision', evidenceId: 'availability', mode: 'network_collection', href: '#registry' }),
  'registry-rdap': Object.freeze({ id: 'registry-rdap', label: 'Registry RDAP evidence', evidenceId: 'rdap', mode: 'network_collection', href: '#registry' }),
  'registry-whois': Object.freeze({ id: 'registry-whois', label: 'Registry WHOIS evidence', evidenceId: 'whois', mode: 'network_collection', href: '#registry' }),
  'registry-control-selection': Object.freeze({ id: 'registry-control-selection', label: 'Registry control evidence selected by the availability authority', evidenceId: null, mode: 'network_collection', href: '#registry' }),
  'dns-observation': Object.freeze({ id: 'dns-observation', label: 'DNS observation', evidenceId: 'dns', mode: 'network_collection', href: '#evidence-dns' }),
  'http-observation': Object.freeze({ id: 'http-observation', label: 'HTTP observation', evidenceId: 'http', mode: 'network_collection', href: '#evidence-http' }),
  'tls-observation': Object.freeze({ id: 'tls-observation', label: 'TLS observation', evidenceId: 'tls', mode: 'network_collection', href: '#evidence-tls' }),
  'page-identity-observation': Object.freeze({ id: 'page-identity-observation', label: 'Page identity observation', evidenceId: 'page-identity', mode: 'network_collection', href: '#evidence-page' }),
  'reviewed-brand-profile': Object.freeze({ id: 'reviewed-brand-profile', label: 'Reviewed Brand Profile', evidenceId: null, mode: 'local_review', href: '#case-response' }),
  'reviewed-case-recipient': Object.freeze({ id: 'reviewed-case-recipient', label: 'Reviewed case and recipient route', evidenceId: null, mode: 'local_review', href: '#case-response' }),
  'authoritative-rdap': Object.freeze({ id: 'authoritative-rdap', label: 'Authoritative RDAP evidence', evidenceId: 'rdap', mode: 'network_collection', href: '#registry' }),
});

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, maximum = MAX_TEXT): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateRequirements(
  requirements: readonly LookupClaimRequirement[],
): Pick<LookupClaimReadinessEntry, 'state' | 'requiredEvidence' | 'missingEvidence' | 'requiredEvidenceIds' | 'missingEvidenceIds' | 'limitations' | 'requirements'> {
  const missing = requirements.filter((requirement) => requirement.state !== 'complete');
  const limitations = missing.flatMap((requirement) => {
    const detail = requirement.limitations[0] || requirement.state.replaceAll('_', ' ');
    return [`${requirement.label}: ${detail}`];
  }).slice(0, 8);
  if (!missing.length) {
    return {
      state: 'ready',
      requiredEvidence: requirements.map((item) => item.label),
      missingEvidence: [],
      requiredEvidenceIds: requirements.map((item) => item.id),
      missingEvidenceIds: [],
      limitations,
      requirements,
    };
  }
  const observedCount = requirements.filter((requirement) => !ABSENT_STATES.has(requirement.state) && requirement.state !== 'unknown').length;
  const hasLimited = requirements.some((requirement) => LIMITED_STATES.has(requirement.state));
  return {
    state: observedCount > 0 && hasLimited ? 'limited' : 'not_ready',
    requiredEvidence: requirements.map((item) => item.label),
    missingEvidence: missing.map((item) => item.label),
    requiredEvidenceIds: requirements.map((item) => item.id),
    missingEvidenceIds: missing.map((item) => item.id),
    limitations,
    requirements,
  };
}

function requirement(
  id: LookupClaimRequirementId,
  coverage: ReadonlyMap<string, EvidenceCoverageLedger['entries'][number]>,
  override?: Readonly<{ state: EvidenceCoverageState; limitation?: string }>,
): LookupClaimRequirement {
  const definition = LOOKUP_CLAIM_REQUIREMENTS[id];
  const evidence = definition.evidenceId ? coverage.get(definition.evidenceId) : undefined;
  const state = override?.state ?? evidence?.state ?? 'unknown';
  const limitations = override?.limitation
    ? [override.limitation]
    : evidence?.limitations.length
      ? evidence.limitations.slice(0, 8)
      : state === 'complete'
        ? []
        : [evidence?.statusLabel || 'Not supplied'];
  return Object.freeze({ ...definition, state, limitations: Object.freeze(limitations) });
}

function readinessEntry(
  input: Readonly<{
    id: LookupClaimId;
    label: string;
    conclusion: string;
    requirements: readonly LookupClaimRequirement[];
    href: `#${string}`;
  }>,
): LookupClaimReadinessEntry {
  const evaluated = evaluateRequirements(input.requirements);
  return { id: input.id, label: input.label, conclusion: input.conclusion, href: input.href, ...evaluated };
}

function comparisonDiagnostics(
  comparison: unknown,
  sourceLabel: 'WHOIS' | 'Registrar RDAP',
  observedAt: Readonly<{ registry?: unknown; compared?: unknown }>,
): RegistrationDisagreementDiagnostic[] {
  const source = record(comparison);
  const fields = Array.isArray(source.fields) ? source.fields.slice(0, 32) : [];
  const registryTime = timestamp(observedAt.registry);
  const comparedTime = timestamp(observedAt.compared);
  const timeGapHours = registryTime !== null && comparedTime !== null
    ? Math.round(Math.abs(registryTime - comparedTime) / 3_600_000)
    : null;
  const output: RegistrationDisagreementDiagnostic[] = [];
  for (const item of fields) {
    const field = record(item);
    if (text(field.status, 64) !== 'conflict') continue;
    const label = text(field.label, 100) || 'Registration field';
    const normalizedLabel = label.toLowerCase();
    let hypothesis = 'Different source publication scope or update timing';
    let detail = `Registry RDAP and ${sourceLabel} published different normalized values. Review the exact values and source timestamps.`;
    const basis = ['Material normalized-value difference'];
    if (timeGapHours !== null && timeGapHours >= 1) {
      hypothesis = 'Collection-time or publication-lag difference';
      detail = `The sources were observed about ${timeGapHours} hour${timeGapHours === 1 ? '' : 's'} apart. A change or publication delay could explain the difference, but this is not established.`;
      basis.push('Different observation times');
    } else if (/contact|registrant|administrative|technical|abuse/u.test(normalizedLabel)) {
      hypothesis = 'Disclosure or source-role difference';
      detail = `Registration contact publications can differ by source role, disclosure policy, privacy service, or update timing. The available evidence does not identify which explanation applies.`;
      basis.push('Contact-related field');
    } else if (/status|nameserver|name server|dnssec/u.test(normalizedLabel)) {
      hypothesis = 'Registry and delegated-service publication difference';
      detail = `Operational and registry publications can update at different times or represent different layers. Directly review the current authoritative evidence before treating this as a configuration change.`;
      basis.push('Operational registration field');
    } else if (/registrar|sponsor/u.test(normalizedLabel)) {
      hypothesis = 'Sponsorship publication or transfer timing difference';
      detail = `A transfer, reseller relationship, source normalisation, or publication delay could explain the difference. None is proven by this comparison alone.`;
      basis.push('Registrar-related field');
    }
    output.push({
      id: `${sourceLabel === 'WHOIS' ? 'whois' : 'registrar-rdap'}-${normalizedLabel.replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || output.length}`,
      field: label,
      hypothesis,
      detail,
      basis,
    });
  }
  return output;
}

export function buildLookupClaimReadiness(input: Readonly<{
  targetType?: unknown;
  task: LookupTaskView;
  coverage: EvidenceCoverageLedger;
  decisionSupport: LookupDecisionSupport;
  availabilityState?: unknown;
  availabilitySource?: unknown;
  hasActiveProfile?: boolean;
  profileSourceState?: 'loading' | 'ready' | 'unavailable';
  hasCaseSection?: boolean;
  responseRecipientCount?: number;
  registryComparison?: unknown;
  registrarPublicationComparison?: unknown;
  observedAt?: Readonly<{
    registry?: unknown;
    whois?: unknown;
    registrar?: unknown;
  }>;
}>): LookupClaimReadiness {
  const coverage = new Map(input.coverage.entries.map((entry) => [entry.id, entry]));
  const targetType = text(input.targetType, 20);
  const settledAvailability = !['', 'unknown', 'inconclusive', 'error'].includes(text(input.availabilityState, 40));
  const observedAvailability = requirement('authority-aware-availability', coverage);
  const registrationRequirements = [settledAvailability
    ? observedAvailability
    : Object.freeze({
        ...observedAvailability,
        state: observedAvailability.state === 'complete' ? 'partial' as const : observedAvailability.state,
        limitations: Object.freeze([
          ...observedAvailability.limitations,
          'The authority-aware availability state is not settled.',
        ].slice(0, 8)),
      })];
  const availabilitySource = text(input.availabilitySource, 24).toLowerCase();
  const controlledRegistrationRequirements = availabilitySource === 'rdap'
    ? [requirement('registry-rdap', coverage)]
    : availabilitySource === 'whois'
      ? [requirement('registry-whois', coverage)]
      : [requirement('registry-control-selection', coverage, {
          state: 'unknown',
          limitation: 'The availability authority did not select a registry control source.',
        })];
  const webRequirements = [requirement('http-observation', coverage), requirement('tls-observation', coverage)];
  const entries: LookupClaimReadinessEntry[] = [];

  if (targetType === 'domain') {
    entries.push(readinessEntry({
      id: 'registration-state',
      label: 'Registration-state statement',
      conclusion: 'Whether an authority-aware registered, available, or inconclusive statement can be made.',
      requirements: registrationRequirements,
      href: '#registry',
    }));
    entries.push(readinessEntry({
      id: 'current-web-observation',
      label: 'Current website statement',
      conclusion: 'Whether the current HTTP and TLS observation is complete enough to describe what responded.',
      requirements: webRequirements,
      href: '#web-evidence',
    }));
    if (input.task === 'brand' || input.hasActiveProfile) {
      entries.push(readinessEntry({
        id: 'brand-resemblance',
        label: 'Brand-resemblance assessment',
        conclusion: 'Whether reviewed brand context and page identity evidence support a bounded resemblance assessment.',
        requirements: [
          requirement('page-identity-observation', coverage),
          requirement('reviewed-brand-profile', coverage, {
            state: input.profileSourceState === 'unavailable'
              ? 'unavailable'
              : input.hasActiveProfile === true
                ? 'complete'
                : 'unknown',
            ...(input.profileSourceState === 'unavailable'
              ? { limitation: 'The browser-local Brand Profile source is unavailable.' }
              : input.hasActiveProfile === true
                ? {}
                : { limitation: 'No reviewed Brand Profile is active.' }),
          }),
        ],
        href: '#evidence-page',
      }));
    }
    if (input.task === 'owned' || input.task === 'acquisition') {
      entries.push(readinessEntry({
        id: 'controlled-change',
        label: 'Controlled-change planning',
        conclusion: 'Whether registration and DNS evidence are complete enough to prepare a reviewed change plan.',
        requirements: [...registrationRequirements, ...controlledRegistrationRequirements, requirement('dns-observation', coverage)],
        href: '#evidence-dns',
      }));
    }
    if (input.task === 'incident') {
      entries.push(readinessEntry({
        id: 'incident-response',
        label: 'Incident response handoff',
        conclusion: 'Whether current web evidence and a reviewed recipient route are present for a response packet.',
        requirements: [
          requirement('http-observation', coverage),
          requirement('page-identity-observation', coverage),
          requirement('reviewed-case-recipient', coverage, {
            state: input.hasCaseSection === true && (input.responseRecipientCount ?? 0) > 0 ? 'complete' : 'unknown',
            ...(input.hasCaseSection === true && (input.responseRecipientCount ?? 0) > 0
              ? {}
              : { limitation: 'A reviewed case and recipient route are not both available.' }),
          }),
        ],
        href: '#case-response',
      }));
    }
  } else if (targetType === 'ip' || targetType === 'ipv4' || targetType === 'ipv6' || targetType === 'asn') {
    entries.push(readinessEntry({
      id: 'network-context',
      label: 'Network registration statement',
      conclusion: 'Whether the observed network registration context is complete enough to describe the resource.',
      requirements: [requirement('authoritative-rdap', coverage)],
      href: '#registry',
    }));
  }

  const disagreements = [
    ...comparisonDiagnostics(input.registryComparison, 'WHOIS', {
      registry: input.observedAt?.registry,
      compared: input.observedAt?.whois,
    }),
    ...comparisonDiagnostics(input.registrarPublicationComparison, 'Registrar RDAP', {
      registry: input.observedAt?.registry,
      compared: input.observedAt?.registrar,
    }),
  ].slice(0, MAX_DIAGNOSTICS);
  const counts: Record<LookupClaimReadinessState, number> = {
    ready: 0,
    limited: 0,
    not_ready: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;
  return {
    version: LOOKUP_CLAIM_READINESS_VERSION,
    entries,
    disagreements,
    counts,
    limitation: input.decisionSupport.counts.conflicts
      ? 'Readiness describes evidence sufficiency, not truth. Registration-source explanations are bounded hypotheses and require review of the original observations.'
      : 'Readiness describes evidence sufficiency, not truth, ownership, intent, safety, or eligibility.',
  };
}
