import type {
  EvidenceCoverageLedger,
  EvidenceCoverageState,
} from './evidence-coverage-ledger.ts';
import type { LookupSourceRefreshPlan } from './lookup-source-refresh.ts';
import type { LookupTaskView } from './lookup-presentation.ts';
import type { LookupTiming, LookupTimingSource } from './lookup-response.ts';

export type LookupDecisionState = 'conflict' | 'uncertain';
export type LookupDecisionImportance = 'high' | 'medium' | 'low';

export type LookupTaskGuidance = Readonly<{
  task: LookupTaskView;
  label: string;
  summary: string;
  questions: readonly string[];
  prioritySections: readonly string[];
}>;

export type LookupDecisionEntry = Readonly<{
  id: string;
  state: LookupDecisionState;
  importance: LookupDecisionImportance;
  title: string;
  detail: string;
  sources: readonly string[];
  href: `#${string}`;
}>;

export type LookupNextAction = Readonly<{
  id: string;
  label: string;
  reason: string;
  href: `#${string}`;
  priority: LookupDecisionImportance;
}>;

export type LookupDecisionSupport = Readonly<{
  version: 1;
  guidance: LookupTaskGuidance;
  entries: readonly LookupDecisionEntry[];
  actions: readonly LookupNextAction[];
  counts: Readonly<{
    conflicts: number;
    uncertainties: number;
  }>;
}>;

export type LookupEvidenceQualityEntry = Readonly<{
  id: string;
  label: string;
  category: string;
  endpointClass: string;
  state: EvidenceCoverageState;
  statusLabel: string;
  truncated: boolean;
  observedAt: string | null;
  ageDays: number | null;
  durationMs: number | null;
  timingOutcome: 'fulfilled' | 'rejected' | null;
  refreshAvailable: boolean;
  limitations: readonly string[];
  supports: readonly string[];
}>;

export type LookupEvidenceQualityMatrix = Readonly<{
  version: 1;
  observedAt: string | null;
  totalMs: number | null;
  entries: readonly LookupEvidenceQualityEntry[];
  completeCount: number;
  limitedCount: number;
  stale: boolean;
  ageDays: number | null;
}>;

type JsonRecord = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_TEXT = 320;
const MAX_ENTRIES = 24;
const MAX_ACTIONS = 6;

const TASK_GUIDANCE: Readonly<Record<LookupTaskView, Omit<LookupTaskGuidance, 'task'>>> = Object.freeze({
  general: Object.freeze({
    label: 'General investigation',
    summary: 'Establish what was observed, which sources agree, and what remains unknown before drawing a conclusion.',
    questions: Object.freeze([
      'Which source observations are complete enough to rely on?',
      'Do registration, infrastructure, certificate, and page identity evidence agree?',
      'What manual pivot would reduce the most important uncertainty?',
    ]),
    prioritySections: Object.freeze(['overview', 'web-evidence', 'registry', 'case-response']),
  }),
  acquisition: Object.freeze({
    label: 'Acquisition review',
    summary: 'Prioritize registration lifecycle, authority, transfer dependencies, mail, DNS, and services that would need a controlled transition.',
    questions: Object.freeze([
      'Is the registration conclusion authoritative and internally consistent?',
      'Which DNS, mail, certificate, and website dependencies require transition planning?',
      'Which lifecycle dates are observations rather than guaranteed transfer or deletion dates?',
    ]),
    prioritySections: Object.freeze(['overview', 'registry', 'web-evidence', 'case-response']),
  }),
  brand: Object.freeze({
    label: 'Brand review',
    summary: 'Prioritize declared identity, page similarity, credential surfaces, external destinations, and infrastructure relationships.',
    questions: Object.freeze([
      'Does the page claim or resemble a reviewed identity?',
      'Where do redirects, forms, resources, and trackers cross trust boundaries?',
      'Which similarities are verified facts and which are only review leads?',
    ]),
    prioritySections: Object.freeze(['overview', 'web-evidence', 'external-intelligence', 'case-response']),
  }),
  incident: Object.freeze({
    label: 'Incident response',
    summary: 'Prioritize current reachability, redirects, certificate state, credential surfaces, warning data, and evidence that can support a reviewed response.',
    questions: Object.freeze([
      'What behavior was observed at the recorded time?',
      'Which source limitations could change the response decision?',
      'What evidence and recipient route are ready for a reviewed handoff?',
    ]),
    prioritySections: Object.freeze(['overview', 'external-intelligence', 'web-evidence', 'case-response']),
  }),
  owned: Object.freeze({
    label: 'Owned-domain posture',
    summary: 'Prioritize delegation, mail, certificate, security-policy, lifecycle, and change evidence for a domain under review.',
    questions: Object.freeze([
      'Do registry publication and directly observed delegation agree?',
      'Are mail, certificate, and website controls in the expected state?',
      'Which incomplete or stale source should be reviewed before recording posture?',
    ]),
    prioritySections: Object.freeze(['overview', 'registry', 'web-evidence', 'case-response']),
  }),
});

const TIMING_TO_EVIDENCE: Readonly<Record<LookupTimingSource, readonly string[]>> = Object.freeze({
  rdap: Object.freeze(['rdap']),
  whois: Object.freeze(['whois']),
  domain_evidence: Object.freeze([
    'availability',
    'client-behavior',
    'dns',
    'http',
    'page-identity',
    'page-role',
    'security-posture',
    'sslbl',
    'technology',
    'tls',
  ]),
  reverse_dns: Object.freeze(['reverse-dns']),
  registrar_rdap: Object.freeze(['registrar-rdap']),
  network_context: Object.freeze(['network-context']),
  security_txt: Object.freeze(['security-txt']),
  external_intelligence: Object.freeze(['external-intelligence']),
  malware_host_intelligence: Object.freeze(['malware-host-intelligence']),
  malware_ioc_intelligence: Object.freeze(['malware-ioc-intelligence']),
});

const SUPPORTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  rdap: Object.freeze(['Registration summary', 'Lifecycle', 'Availability']),
  whois: Object.freeze(['Registration comparison', 'Contacts', 'Lifecycle']),
  'registrar-rdap': Object.freeze(['Registration publication comparison']),
  availability: Object.freeze(['Availability decision', 'Lookup assessment']),
  dns: Object.freeze(['Delegation', 'Mail posture', 'Service dependencies']),
  'reverse-dns': Object.freeze(['Observed endpoint context']),
  'network-context': Object.freeze(['Delivery and routing context']),
  http: Object.freeze(['Redirects', 'Page collection', 'Website state']),
  tls: Object.freeze(['Hostname authorization', 'Certificate scope']),
  'page-identity': Object.freeze(['Declared page identity', 'Form and resource review']),
  technology: Object.freeze(['Technology profile']),
  'security-posture': Object.freeze(['Passive security posture']),
  'security-txt': Object.freeze(['Security contact route']),
  sslbl: Object.freeze(['Certificate warning-data comparison']),
  'external-intelligence': Object.freeze(['Optional external context']),
});

const ENDPOINT_CLASS: Readonly<Record<string, string>> = Object.freeze({
  rdap: 'Authoritative registry endpoint',
  whois: 'WHOIS transport',
  'registrar-rdap': 'Registrar publication endpoint',
  availability: 'Authority-aware analysis',
  dns: 'DNS resolver and authorities',
  'reverse-dns': 'Reverse DNS resolver',
  'network-context': 'IP RDAP and routing',
  http: 'Bounded HTTP collection',
  tls: 'TLS endpoint',
  'page-identity': 'Static page analysis',
  technology: 'Derived analysis',
  'security-posture': 'Derived analysis',
  'security-txt': 'Selected well-known resource',
  sslbl: 'Local warning-data snapshot',
  'external-intelligence': 'Optional external provider',
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

function idPart(value: unknown): string {
  return text(value, 80).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

function display(value: unknown): string {
  const normalized = text(value, 180);
  return normalized || 'not published';
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function ageDays(value: string | null, now: unknown): number | null {
  const current = isoDate(now);
  if (!value || !current) return null;
  return Math.max(0, Math.floor((Date.parse(current) - Date.parse(value)) / 86_400_000));
}

function taskGuidance(task: LookupTaskView): LookupTaskGuidance {
  return { task, ...TASK_GUIDANCE[task] };
}

function comparisonEntries(
  comparison: unknown,
  kind: 'registry-whois' | 'registry-registrar',
): LookupDecisionEntry[] {
  const output: LookupDecisionEntry[] = [];
  const source = record(comparison);
  const fields = Array.isArray(source.fields) ? source.fields.slice(0, 24) : [];
  for (const item of fields) {
    const field = record(item);
    const status = text(field.status, 64);
    const label = text(field.label, 120) || 'Registration field';
    const suffix = idPart(label);
    if (status === 'conflict') {
      const left = kind === 'registry-whois' ? field.rdapDisplay : field.registryDisplay;
      const right = kind === 'registry-whois' ? field.whoisDisplay : field.registrarDisplay;
      output.push({
        id: `${kind}-${suffix || output.length}`,
        state: 'conflict',
        importance: ['Domain', 'Registrar', 'Name servers', 'Statuses'].includes(label) ? 'high' : 'medium',
        title: `${label} differs between registration sources`,
        detail: `${display(left)} compared with ${display(right)}.`,
        sources: kind === 'registry-whois'
          ? ['Registry RDAP', 'WHOIS']
          : ['Registry RDAP', 'Registrar RDAP'],
        href: '#registry',
      });
      continue;
    }
    if (status.includes('unavailable') || status.includes('incomplete')) {
      output.push({
        id: `${kind}-${suffix || output.length}-${status}`,
        state: 'uncertain',
        importance: 'low',
        title: `${label} comparison is incomplete`,
        detail: 'At least one registration source did not provide complete evidence, so no disagreement or equivalence conclusion is available.',
        sources: kind === 'registry-whois'
          ? ['Registry RDAP', 'WHOIS']
          : ['Registry RDAP', 'Registrar RDAP'],
        href: '#registry',
      });
    }
  }
  return output;
}

function hostname(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value : text(record(value).url, 2_048);
  if (!candidate) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(candidate) ? candidate : `https://${candidate}`);
    return url.hostname.toLowerCase().replace(/\.$/u, '');
  } catch {
    return null;
  }
}

function sameRegistrableScope(left: string, right: string, registrableDomain: string | null): boolean {
  if (left === right) return true;
  if (!registrableDomain) return false;
  const belongsToDomain = (value: string) => (
    value === registrableDomain || value.endsWith(`.${registrableDomain}`)
  );
  return belongsToDomain(left) && belongsToDomain(right);
}

function identityEntries(input: Readonly<{
  requestedHost?: unknown;
  registrableDomain?: unknown;
  finalUrl?: unknown;
  canonicalUrl?: unknown;
  openGraphUrl?: unknown;
  tlsAuthorization?: unknown;
}>): LookupDecisionEntry[] {
  const output: LookupDecisionEntry[] = [];
  const requestedHost = hostname(input.requestedHost);
  const registrableDomain = hostname(input.registrableDomain);
  const finalHost = hostname(input.finalUrl);
  const canonicalHost = hostname(input.canonicalUrl);
  const openGraphHost = hostname(input.openGraphUrl);
  const tlsAuthorization = record(input.tlsAuthorization);
  if (tlsAuthorization.authorized === false) {
    output.push({
      id: 'tls-hostname-authorization',
      state: 'conflict',
      importance: 'high',
      title: 'The observed certificate did not authorize the requested hostname',
      detail: text(tlsAuthorization.error, 240) || 'TLS hostname authorization failed for the requested host.',
      sources: ['TLS'],
      href: '#evidence-tls',
    });
  }
  if (requestedHost && finalHost && !sameRegistrableScope(requestedHost, finalHost, registrableDomain)) {
    output.push({
      id: 'http-cross-site-final-origin',
      state: 'conflict',
      importance: 'medium',
      title: 'The final website origin is outside the requested domain',
      detail: `${requestedHost} redirected to ${finalHost}. Review the redirect chain before interpreting identity or control.`,
      sources: ['HTTP'],
      href: '#evidence-http',
    });
  }
  if (finalHost && canonicalHost && !sameRegistrableScope(finalHost, canonicalHost, registrableDomain)) {
    output.push({
      id: 'page-canonical-origin',
      state: 'conflict',
      importance: 'medium',
      title: 'The declared canonical origin differs from the observed final origin',
      detail: `${finalHost} served the page while the document declared ${canonicalHost} as canonical.`,
      sources: ['HTTP', 'HTML'],
      href: '#evidence-page-identity',
    });
  }
  if (finalHost && openGraphHost && !sameRegistrableScope(finalHost, openGraphHost, registrableDomain)) {
    output.push({
      id: 'page-open-graph-origin',
      state: 'conflict',
      importance: 'low',
      title: 'The Open Graph URL points outside the observed final origin',
      detail: `${finalHost} served the page while Open Graph metadata declared ${openGraphHost}. Publisher metadata is a claim, not identity proof.`,
      sources: ['HTTP', 'HTML'],
      href: '#evidence-page-identity',
    });
  }
  return output;
}

function certificatePolicyEntries(value: unknown): LookupDecisionEntry[] {
  const review = record(value);
  const findings = Array.isArray(review.findings) ? review.findings.slice(0, 8) : [];
  const output: LookupDecisionEntry[] = [];
  for (const item of findings) {
    const finding = record(item);
    const id = text(finding.id, 80);
    const state = text(finding.state, 80);
    const label = text(finding.label, 120) || 'Certificate policy';
    if (state === 'apparently_outside_current_policy' || state === 'changed') {
      output.push({
        id: `certificate-policy-${id || state}`,
        state: 'conflict',
        importance: id === 'expected_spki' ? 'high' : 'medium',
        title: label,
        detail: text(finding.detail, 300) || 'Observed certificate context differs from the current reviewed policy context.',
        sources: Array.isArray(finding.sources) ? finding.sources.map((source) => text(source, 80)).filter(Boolean) : ['DNS', 'TLS'],
        href: '#evidence-certificate-policy',
      });
      continue;
    }
    if (state === 'indeterminate' || state === 'no_target_policy_observed') {
      output.push({
        id: `certificate-policy-${id || state}`,
        state: 'uncertain',
        importance: 'low',
        title: `${label} is indeterminate`,
        detail: text(finding.detail, 300) || 'Current evidence does not support a policy comparison.',
        sources: Array.isArray(finding.sources) ? finding.sources.map((source) => text(source, 80)).filter(Boolean) : ['DNS', 'TLS'],
        href: '#evidence-certificate-policy',
      });
    }
  }
  return output;
}

function prioritizeEntries(
  entries: readonly LookupDecisionEntry[],
  task: LookupTaskView,
): LookupDecisionEntry[] {
  const taskBoost: Readonly<Record<LookupTaskView, readonly string[]>> = {
    general: [],
    acquisition: ['registry'],
    brand: ['page', 'http', 'tls'],
    incident: ['http', 'tls', 'page'],
    owned: ['registry', 'tls'],
  };
  const importance = { high: 0, medium: 1, low: 2 } as const;
  return [...entries].sort((left, right) => {
    const leftBoost = taskBoost[task].some((prefix) => left.id.startsWith(prefix)) ? -1 : 0;
    const rightBoost = taskBoost[task].some((prefix) => right.id.startsWith(prefix)) ? -1 : 0;
    return leftBoost - rightBoost
      || importance[left.importance] - importance[right.importance]
      || left.title.localeCompare(right.title);
  }).slice(0, 16);
}

export function buildLookupDecisionSupport(input: Readonly<{
  task: LookupTaskView;
  coverage: EvidenceCoverageLedger;
  refreshPlan: LookupSourceRefreshPlan;
  registryComparison?: unknown;
  registrarPublicationComparison?: unknown;
  requestedHost?: unknown;
  registrableDomain?: unknown;
  finalUrl?: unknown;
  canonicalUrl?: unknown;
  openGraphUrl?: unknown;
  tlsAuthorization?: unknown;
  certificatePolicyReview?: unknown;
  hasCaseSection?: boolean;
}>): LookupDecisionSupport {
  const entries = prioritizeEntries([
    ...comparisonEntries(input.registryComparison, 'registry-whois'),
    ...comparisonEntries(input.registrarPublicationComparison, 'registry-registrar'),
    ...identityEntries(input),
    ...certificatePolicyEntries(input.certificatePolicyReview),
  ], input.task);
  const actions: LookupNextAction[] = [];
  const firstConflict = entries.find((entry) => entry.state === 'conflict');
  if (firstConflict) {
    actions.push({
      id: 'review-priority-conflict',
      label: 'Review the highest-priority disagreement',
      reason: firstConflict.title,
      href: firstConflict.href,
      priority: 'high',
    });
  }
  if (input.refreshPlan.items.length) {
    actions.push({
      id: 'review-refresh-options',
      label: 'Review limited or stale sources',
      reason: `${input.refreshPlan.items.length} deliberate source refresh option${input.refreshPlan.items.length === 1 ? ' is' : 's are'} available.`,
      href: '#evidence-quality',
      priority: 'medium',
    });
  }
  const firstLimited = input.coverage.entries.find((entry) => entry.manualReviewSuggested);
  if (firstLimited && !input.refreshPlan.items.some((item) => item.evidenceIds.includes(firstLimited.id))) {
    actions.push({
      id: 'inspect-limited-source',
      label: `Inspect ${firstLimited.label}`,
      reason: `${firstLimited.statusLabel} evidence may limit downstream conclusions.`,
      href: '#evidence-quality',
      priority: 'medium',
    });
  }
  if (input.task === 'brand') {
    actions.push({
      id: 'review-page-identity',
      label: 'Review identity and credential evidence',
      reason: 'Compare declared identity, forms, redirects, and external destinations before making a brand assessment.',
      href: '#web-evidence',
      priority: 'medium',
    });
  } else if (input.task === 'acquisition') {
    actions.push({
      id: 'review-acquisition-dependencies',
      label: 'Review transfer dependencies',
      reason: 'Registration dates alone do not describe the DNS, mail, certificate, and website services that require transition.',
      href: '#web-evidence',
      priority: 'medium',
    });
  } else if (input.task === 'owned') {
    actions.push({
      id: 'review-owned-posture',
      label: 'Review delegation and posture evidence',
      reason: 'Confirm registry publication, authoritative responses, mail, and certificate state together.',
      href: '#web-evidence',
      priority: 'medium',
    });
  }
  if (input.hasCaseSection) {
    actions.push({
      id: 'review-case-handoff',
      label: 'Record or hand off reviewed evidence',
      reason: 'Keep observed facts, hypotheses, unknowns, and analyst decisions separate in the case workflow.',
      href: '#case-response',
      priority: 'low',
    });
  }
  const uniqueActions = [...new Map(actions.map((action) => [action.id, action])).values()].slice(0, MAX_ACTIONS);
  return {
    version: 1,
    guidance: taskGuidance(input.task),
    entries,
    actions: uniqueActions,
    counts: {
      conflicts: entries.filter((entry) => entry.state === 'conflict').length,
      uncertainties: entries.filter((entry) => entry.state === 'uncertain').length,
    },
  };
}

function timingByEvidence(timing: LookupTiming | null): Map<string, LookupTiming['sources'][number]> {
  const output = new Map<string, LookupTiming['sources'][number]>();
  if (!timing) return output;
  for (const source of timing.sources) {
    for (const evidenceId of TIMING_TO_EVIDENCE[source.source]) {
      output.set(evidenceId, source);
    }
  }
  return output;
}

export function buildLookupEvidenceQualityMatrix(input: Readonly<{
  coverage: EvidenceCoverageLedger;
  refreshPlan: LookupSourceRefreshPlan;
  timing: LookupTiming | null;
  observedAt?: unknown;
  observedAtByEvidence?: Readonly<Record<string, unknown>>;
  now?: unknown;
}>): LookupEvidenceQualityMatrix {
  const observedAt = isoDate(input.observedAt);
  const currentAgeDays = ageDays(observedAt, input.now ?? new Date().toISOString());
  const timings = timingByEvidence(input.timing);
  const refreshIds = new Set(input.refreshPlan.items.flatMap((item) => item.evidenceIds));
  const entries = input.coverage.entries.slice(0, MAX_ENTRIES).map((entry) => {
    const timing = timings.get(entry.id);
    const entryObservedAt = isoDate(input.observedAtByEvidence?.[entry.id]) ?? observedAt;
    return {
      id: entry.id,
      label: entry.label,
      category: entry.category,
      endpointClass: ENDPOINT_CLASS[entry.id] ?? 'Source-specific collection',
      state: entry.state,
      statusLabel: entry.statusLabel,
      truncated: entry.truncated,
      observedAt: entryObservedAt,
      ageDays: ageDays(entryObservedAt, input.now ?? new Date().toISOString()),
      durationMs: timing?.durationMs ?? null,
      timingOutcome: timing?.outcome ?? null,
      refreshAvailable: refreshIds.has(entry.id),
      limitations: entry.limitations,
      supports: SUPPORTS[entry.id] ?? Object.freeze([]),
    };
  });
  return {
    version: 1,
    observedAt,
    totalMs: input.timing?.totalMs ?? null,
    entries,
    completeCount: input.coverage.completeCount,
    limitedCount: input.coverage.limitedCount,
    stale: input.refreshPlan.stale,
    ageDays: currentAgeDays,
  };
}
