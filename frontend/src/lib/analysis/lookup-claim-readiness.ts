import type { EvidenceCoverageLedger, EvidenceCoverageState } from './evidence-coverage-ledger.ts';
import type { LookupDecisionSupport } from './lookup-decision-support.ts';
import type { LookupTaskView } from './lookup-presentation.ts';

export type LookupClaimReadinessState = 'ready' | 'limited' | 'not_ready';

export type LookupClaimReadinessEntry = Readonly<{
  id: string;
  label: string;
  state: LookupClaimReadinessState;
  conclusion: string;
  requiredEvidence: readonly string[];
  missingEvidence: readonly string[];
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
  version: 1;
  entries: readonly LookupClaimReadinessEntry[];
  disagreements: readonly RegistrationDisagreementDiagnostic[];
  counts: Readonly<Record<LookupClaimReadinessState, number>>;
  limitation: string;
}>;

type JsonRecord = Record<string, unknown>;
type Requirement = Readonly<{ id: string; label: string }>;

const MAX_TEXT = 320;
const MAX_DIAGNOSTICS = 12;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const LIMITED_STATES = new Set<EvidenceCoverageState>(['partial', 'unavailable', 'unknown']);
const ABSENT_STATES = new Set<EvidenceCoverageState>(['skipped', 'unsupported']);

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
  requirements: readonly Requirement[],
  coverage: ReadonlyMap<string, EvidenceCoverageLedger['entries'][number]>,
): Pick<LookupClaimReadinessEntry, 'state' | 'requiredEvidence' | 'missingEvidence' | 'limitations'> {
  const entries = requirements.map((requirement) => ({ requirement, evidence: coverage.get(requirement.id) }));
  const missingEvidence = entries
    .filter(({ evidence }) => !evidence || evidence.state !== 'complete')
    .map(({ requirement }) => requirement.label);
  const limitations = entries.flatMap(({ evidence, requirement }) => {
    if (!evidence || evidence.state === 'complete') return [];
    const detail = evidence.limitations[0] || evidence.statusLabel;
    return [`${requirement.label}: ${detail}`];
  }).slice(0, 8);
  if (!missingEvidence.length) {
    return {
      state: 'ready',
      requiredEvidence: requirements.map((item) => item.label),
      missingEvidence: [],
      limitations,
    };
  }
  const observedCount = entries.filter(({ evidence }) => evidence && !ABSENT_STATES.has(evidence.state)).length;
  const hasLimited = entries.some(({ evidence }) => evidence && LIMITED_STATES.has(evidence.state));
  return {
    state: observedCount > 0 && hasLimited ? 'limited' : 'not_ready',
    requiredEvidence: requirements.map((item) => item.label),
    missingEvidence,
    limitations,
  };
}

function readinessEntry(
  input: Readonly<{
    id: string;
    label: string;
    conclusion: string;
    requirements: readonly Requirement[];
    coverage: ReadonlyMap<string, EvidenceCoverageLedger['entries'][number]>;
    href: `#${string}`;
    additionalReady?: boolean;
    additionalMissing?: string;
  }>,
): LookupClaimReadinessEntry {
  const evaluated = evaluateRequirements(input.requirements, input.coverage);
  if (input.additionalReady === false) {
    return {
      id: input.id,
      label: input.label,
      state: evaluated.state === 'not_ready' ? 'not_ready' : 'limited',
      conclusion: input.conclusion,
      requiredEvidence: evaluated.requiredEvidence,
      missingEvidence: [...evaluated.missingEvidence, input.additionalMissing || 'Required analyst context'],
      limitations: evaluated.limitations,
      href: input.href,
    };
  }
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
      detail = `A transfer, reseller relationship, source normalization, or publication delay could explain the difference. None is proven by this comparison alone.`;
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
  hasActiveProfile?: boolean;
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
  const registrationRequirements = [{ id: 'rdap', label: 'Authoritative registry evidence' }] as const;
  const webRequirements = [{ id: 'http', label: 'HTTP observation' }, { id: 'tls', label: 'TLS observation' }] as const;
  const entries: LookupClaimReadinessEntry[] = [];

  if (targetType === 'domain') {
    entries.push(readinessEntry({
      id: 'registration-state',
      label: 'Registration-state statement',
      conclusion: 'Whether an authority-aware registered, available, or inconclusive statement can be made.',
      requirements: registrationRequirements,
      coverage,
      href: '#registry',
      additionalReady: !['', 'unknown', 'inconclusive', 'error'].includes(text(input.availabilityState, 40)),
      additionalMissing: 'Settled authority-aware availability state',
    }));
    entries.push(readinessEntry({
      id: 'current-web-observation',
      label: 'Current website statement',
      conclusion: 'Whether the current HTTP and TLS observation is complete enough to describe what responded.',
      requirements: webRequirements,
      coverage,
      href: '#web-evidence',
    }));
    if (input.task === 'brand' || input.hasActiveProfile) {
      entries.push(readinessEntry({
        id: 'brand-resemblance',
        label: 'Brand-resemblance assessment',
        conclusion: 'Whether reviewed brand context and page identity evidence support a bounded resemblance assessment.',
        requirements: [{ id: 'page-identity', label: 'Page identity observation' }],
        coverage,
        href: '#evidence-page-identity',
        additionalReady: input.hasActiveProfile === true,
        additionalMissing: 'Reviewed Brand Profile',
      }));
    }
    if (input.task === 'owned' || input.task === 'acquisition') {
      entries.push(readinessEntry({
        id: 'controlled-change',
        label: 'Controlled-change planning',
        conclusion: 'Whether registration and DNS evidence are complete enough to prepare a reviewed change plan.',
        requirements: [...registrationRequirements, { id: 'dns', label: 'DNS observation' }],
        coverage,
        href: '#evidence-dns',
      }));
    }
    if (input.task === 'incident') {
      entries.push(readinessEntry({
        id: 'incident-response',
        label: 'Incident response handoff',
        conclusion: 'Whether current web evidence and a reviewed recipient route are present for a response packet.',
        requirements: [{ id: 'http', label: 'HTTP observation' }, { id: 'page-identity', label: 'Page identity observation' }],
        coverage,
        href: '#case-response',
        additionalReady: input.hasCaseSection === true && (input.responseRecipientCount ?? 0) > 0,
        additionalMissing: 'Reviewed case and recipient route',
      }));
    }
  } else if (targetType === 'ip' || targetType === 'asn') {
    entries.push(readinessEntry({
      id: 'network-context',
      label: 'Network registration statement',
      conclusion: 'Whether the observed network registration context is complete enough to describe the resource.',
      requirements: [{ id: 'rdap', label: 'Authoritative RDAP evidence' }],
      coverage,
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
    version: 1,
    entries,
    disagreements,
    counts,
    limitation: input.decisionSupport.counts.conflicts
      ? 'Readiness describes evidence sufficiency, not truth. Registration-source explanations are bounded hypotheses and require review of the original observations.'
      : 'Readiness describes evidence sufficiency, not truth, ownership, intent, safety, or eligibility.',
  };
}
