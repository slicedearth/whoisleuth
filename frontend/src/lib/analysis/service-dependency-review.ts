export const SERVICE_DEPENDENCY_REVIEW_VERSION = 3;

export type ServiceDependencyReviewState = 'candidate' | 'review' | 'observed' | 'not_observed' | 'unavailable';
export type ServiceDependencyScope = 'authorized' | 'outside' | 'unspecified';
export type ServiceDependencyState = 'candidate' | 'unresolved' | 'active' | 'unsupported' | 'false_positive';

export type ServiceDependencySignature = Readonly<{
  id: string;
  label: string;
  targetSuffixes: readonly string[];
}>;

export type ServiceDependency = Readonly<{
  id: string;
  recordType: 'CNAME' | 'HTTPS' | 'NS' | 'MX' | 'HTTP';
  target: string;
  relation: 'external' | 'in_domain';
  scope: ServiceDependencyScope;
  signatureId?: string;
  serviceFamily?: string;
  state: ServiceDependencyState;
  detail: string;
  provenance: string;
}>;

export type ServiceDependencyReview = Readonly<{
  version: 3;
  state: ServiceDependencyReviewState;
  label: string;
  dependencies: readonly ServiceDependency[];
  authorizedScope: readonly string[];
  nextSteps: readonly string[];
  limitations: readonly string[];
}>;

type UnknownRecord = Record<string, unknown>;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAX_DEPENDENCIES = 20;
const MAX_SCOPE_NAMES = 20;
const MAX_SIGNATURES = 32;
const MAX_SIGNATURE_SUFFIXES = 12;

export const SERVICE_DEPENDENCY_SIGNATURES: readonly ServiceDependencySignature[] = Object.freeze([
  Object.freeze({
    id: 'static-site-service',
    label: 'Hosted static-site service',
    targetSuffixes: Object.freeze(['github.io', 'netlify.app', 'pages.dev', 'readthedocs.io', 'vercel.app']),
  }),
  Object.freeze({
    id: 'application-platform',
    label: 'Hosted application platform',
    targetSuffixes: Object.freeze(['azurewebsites.net', 'herokudns.com', 'herokussl.com', 'onrender.com']),
  }),
  Object.freeze({
    id: 'commerce-platform',
    label: 'Hosted commerce platform',
    targetSuffixes: Object.freeze(['bigcommerce.com', 'myshopify.com']),
  }),
  Object.freeze({
    id: 'content-platform',
    label: 'Hosted content platform',
    targetSuffixes: Object.freeze(['pantheonsite.io', 'webflow.io']),
  }),
  Object.freeze({
    id: 'delivery-platform',
    label: 'Content delivery service',
    targetSuffixes: Object.freeze(['cloudfront.net', 'fastly.net']),
  }),
  Object.freeze({
    id: 'object-storage',
    label: 'Hosted object storage',
    targetSuffixes: Object.freeze(['storage.googleapis.com']),
  }),
]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function normalizedHostname(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase().replace(/\.$/u, '');
  return HOSTNAME.test(normalized) ? normalized : '';
}

export function parseAuthorizedServiceScope(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/u)
      : [];
  const normalized = new Set<string>();
  for (const candidate of candidates.slice(0, MAX_SCOPE_NAMES * 2)) {
    const hostname = normalizedHostname(candidate);
    if (!hostname || !hostname.includes('.')) continue;
    normalized.add(hostname);
    if (normalized.size >= MAX_SCOPE_NAMES) break;
  }
  return [...normalized];
}

function diagnosticStatus(diagnostics: UnknownRecord, name: string): string {
  const diagnostic = record(diagnostics[name]);
  return typeof diagnostic.status === 'string' ? diagnostic.status.toLowerCase() : '';
}

function relation(target: string, domain: string): ServiceDependency['relation'] {
  return target === domain || target.endsWith(`.${domain}`) ? 'in_domain' : 'external';
}

function targetMatchesSuffix(target: string, suffix: string): boolean {
  return target === suffix || target.endsWith(`.${suffix}`);
}

function dependencyScope(target: string, authorizedScope: readonly string[]): ServiceDependencyScope {
  if (!authorizedScope.length) return 'unspecified';
  return authorizedScope.some((suffix) => targetMatchesSuffix(target, suffix))
    ? 'authorized'
    : 'outside';
}

function normalizedSignatures(value: readonly ServiceDependencySignature[]): ServiceDependencySignature[] {
  const signatures: ServiceDependencySignature[] = [];
  for (const candidate of value.slice(0, MAX_SIGNATURES)) {
    const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 80) : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim().slice(0, 120) : '';
    const targetSuffixes = parseAuthorizedServiceScope(candidate.targetSuffixes)
      .slice(0, MAX_SIGNATURE_SUFFIXES);
    if (!id || !label || !targetSuffixes.length) continue;
    signatures.push({ id, label, targetSuffixes });
  }
  return signatures;
}

function serviceSignature(
  target: string,
  signatures: readonly ServiceDependencySignature[],
): ServiceDependencySignature | null {
  return signatures.find((candidate) => candidate.targetSuffixes.some(
    (suffix) => targetMatchesSuffix(target, suffix),
  )) ?? null;
}

function dependency(
  recordType: ServiceDependency['recordType'],
  target: string,
  domain: string,
  authorizedScope: readonly string[],
  signatures: readonly ServiceDependencySignature[],
  activeTargets: ReadonlySet<string>,
  falsePositiveTargets: ReadonlySet<string>,
): ServiceDependency {
  const targetRelation = relation(target, domain);
  const scope = dependencyScope(target, authorizedScope);
  const signature = serviceSignature(target, signatures);
  const state: ServiceDependencyState = falsePositiveTargets.has(target)
    ? 'false_positive'
    : targetRelation === 'in_domain' || !signature
      ? 'unsupported'
      : scope === 'authorized' && activeTargets.has(target)
        ? 'active'
        : scope === 'authorized'
          ? 'candidate'
          : 'unresolved';
  return {
    id: `${recordType.toLowerCase()}:${target}`,
    recordType,
    target,
    relation: targetRelation,
    scope,
    ...(signature ? {
      signatureId: signature.id,
      serviceFamily: signature.label,
    } : {}),
    state,
    detail: state === 'false_positive'
      ? 'The analyst excluded this exact observed target from the current review view. The underlying observation remains unchanged.'
      : state === 'active'
        ? 'The target is within the reviewed scope and also appears in the already-observed final HTTP navigation chain. Confirm the provider assignment independently.'
        : state === 'candidate'
          ? 'The target matches a reviewed service-family signature and is within the analyst-declared authorized scope. Confirm resolution and provider assignment manually.'
          : state === 'unresolved'
            ? 'The external target matches a reviewed service-family signature, but its authorized scope or active assignment has not been established.'
            : targetRelation === 'in_domain'
              ? 'The target remains inside the domain namespace. The external-service catalogue does not classify it.'
              : 'The external target does not match the bounded reviewed service-family catalogue. Manual classification is required.',
    provenance: recordType === 'HTTP'
      ? 'Point-in-time final HTTP navigation origin'
      : recordType === 'HTTPS'
        ? 'Point-in-time HTTPS service-binding publication'
        : `Point-in-time DNS ${recordType} observation`,
  };
}

function cnameDependencies(
  raw: unknown,
  domain: string,
  authorizedScope: readonly string[],
  signatures: readonly ServiceDependencySignature[],
  activeTargets: ReadonlySet<string>,
  falsePositiveTargets: ReadonlySet<string>,
): ServiceDependency[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  const dependencies: ServiceDependency[] = [];
  for (const value of raw.slice(0, MAX_DEPENDENCIES * 2)) {
    const target = normalizedHostname(value);
    if (!target || unique.has(target)) continue;
    unique.add(target);
    dependencies.push(dependency('CNAME', target, domain, authorizedScope, signatures, activeTargets, falsePositiveTargets));
    if (dependencies.length >= MAX_DEPENDENCIES) break;
  }
  return dependencies;
}

function httpsDependencies(
  raw: unknown,
  domain: string,
  remaining: number,
  authorizedScope: readonly string[],
  signatures: readonly ServiceDependencySignature[],
  activeTargets: ReadonlySet<string>,
  falsePositiveTargets: ReadonlySet<string>,
): ServiceDependency[] {
  if (!Array.isArray(raw) || remaining <= 0) return [];
  const unique = new Set<string>();
  const dependencies: ServiceDependency[] = [];
  for (const value of raw.slice(0, remaining * 2)) {
    const item = record(value);
    if (item.mode !== 'alias' || item.serviceUnavailable === true) continue;
    const target = normalizedHostname(item.target);
    if (!target || unique.has(target)) continue;
    unique.add(target);
    dependencies.push(dependency('HTTPS', target, domain, authorizedScope, signatures, activeTargets, falsePositiveTargets));
    if (dependencies.length >= remaining) break;
  }
  return dependencies;
}

function hostnameDependencies(
  raw: unknown,
  recordType: 'NS' | 'MX',
  domain: string,
  remaining: number,
  authorizedScope: readonly string[],
  signatures: readonly ServiceDependencySignature[],
  activeTargets: ReadonlySet<string>,
  falsePositiveTargets: ReadonlySet<string>,
): ServiceDependency[] {
  if (!Array.isArray(raw) || remaining <= 0) return [];
  const unique = new Set<string>();
  const dependencies: ServiceDependency[] = [];
  for (const value of raw.slice(0, remaining * 2)) {
    const target = normalizedHostname(recordType === 'MX' ? record(value).exchange : value);
    if (!target || unique.has(target)) continue;
    unique.add(target);
    dependencies.push(dependency(recordType, target, domain, authorizedScope, signatures, activeTargets, falsePositiveTargets));
    if (dependencies.length >= remaining) break;
  }
  return dependencies;
}

function urlHostname(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? normalizedHostname(url.hostname)
      : '';
  } catch {
    return '';
  }
}

function httpDependency(
  httpEvidence: UnknownRecord,
  domain: string,
  remaining: number,
  authorizedScope: readonly string[],
  signatures: readonly ServiceDependencySignature[],
  activeTargets: ReadonlySet<string>,
  falsePositiveTargets: ReadonlySet<string>,
): ServiceDependency[] {
  if (remaining <= 0 || httpEvidence.source !== 'http') return [];
  const target = urlHostname(httpEvidence.finalUrl);
  if (!target || target === domain) return [];
  return [dependency('HTTP', target, domain, authorizedScope, signatures, activeTargets, falsePositiveTargets)];
}

/**
 * Surfaces already-observed alias dependencies for a manual dangling-service
 * check. Targets are never followed and the model never labels a dependency
 * dangling, vulnerable, claimable, safe, or controlled.
 */
export function buildServiceDependencyReview(input: Readonly<{
  domain?: unknown;
  dnsEvidence?: unknown;
  dnsRecords?: unknown;
  httpEvidence?: unknown;
  authorizedScope?: unknown;
  falsePositiveTargets?: unknown;
  signatures?: readonly ServiceDependencySignature[];
}>): ServiceDependencyReview | null {
  const domain = normalizedHostname(input.domain);
  if (!domain) return null;
  const dnsEvidence = record(input.dnsEvidence);
  const dnsRecords = record(input.dnsRecords);
  const diagnostics = record(dnsEvidence.diagnostics);
  const authorizedScope = parseAuthorizedServiceScope(input.authorizedScope);
  const falsePositiveTargets = new Set(parseAuthorizedServiceScope(input.falsePositiveTargets));
  const signatures = normalizedSignatures(input.signatures ?? SERVICE_DEPENDENCY_SIGNATURES);
  const httpEvidence = record(input.httpEvidence);
  const activeTargets = new Set<string>();
  const finalHttpTarget = urlHostname(httpEvidence.finalUrl);
  if (finalHttpTarget) activeTargets.add(finalHttpTarget);
  const cname = cnameDependencies(dnsRecords.cname, domain, authorizedScope, signatures, activeTargets, falsePositiveTargets);
  const https = httpsDependencies(
    dnsRecords.https,
    domain,
    MAX_DEPENDENCIES - cname.length,
    authorizedScope,
    signatures,
    activeTargets,
    falsePositiveTargets,
  );
  const ns = hostnameDependencies(
    dnsRecords.ns,
    'NS',
    domain,
    MAX_DEPENDENCIES - cname.length - https.length,
    authorizedScope,
    signatures,
    activeTargets,
    falsePositiveTargets,
  );
  const mx = hostnameDependencies(
    dnsRecords.mx,
    'MX',
    domain,
    MAX_DEPENDENCIES - cname.length - https.length - ns.length,
    authorizedScope,
    signatures,
    activeTargets,
    falsePositiveTargets,
  );
  const http = httpDependency(
    httpEvidence,
    domain,
    MAX_DEPENDENCIES - cname.length - https.length - ns.length - mx.length,
    authorizedScope,
    signatures,
    activeTargets,
    falsePositiveTargets,
  );
  const dependencies = [...cname, ...https, ...ns, ...mx, ...http];
  const actionable = dependencies.filter((item) => item.state === 'candidate').length;
  const unresolved = dependencies.filter((item) => item.state === 'unresolved').length;
  const active = dependencies.filter((item) => item.state === 'active').length;
  const cnameStatus = diagnosticStatus(diagnostics, 'cname');
  const httpsStatus = diagnosticStatus(diagnostics, 'https');
  const nsStatus = diagnosticStatus(diagnostics, 'ns');
  const mxStatus = diagnosticStatus(diagnostics, 'mx');
  const complete = dnsEvidence.source === 'dns'
    && dnsEvidence.complete === true
    && ['success', 'not_found'].includes(cnameStatus)
    && ['success', 'not_found'].includes(httpsStatus)
    && ['success', 'not_found'].includes(nsStatus)
    && ['success', 'not_found'].includes(mxStatus);

  let state: ServiceDependencyReviewState;
  let label: string;
  if (actionable) {
    state = 'candidate';
    label = `${actionable} scoped service candidate${actionable === 1 ? '' : 's'} require review`;
  } else if (unresolved || active) {
    state = 'review';
    label = `${unresolved + active} service dependenc${unresolved + active === 1 ? 'y requires' : 'ies require'} review`;
  } else if (dependencies.length) {
    state = 'observed';
    label = `${dependencies.length} dependency observation${dependencies.length === 1 ? '' : 's'} retained`;
  } else if (complete) {
    state = 'not_observed';
    label = 'No alias dependency observed in this capture';
  } else {
    state = 'unavailable';
    label = 'Alias dependency review incomplete';
  }

  return {
    version: SERVICE_DEPENDENCY_REVIEW_VERSION,
    state,
    label,
    dependencies,
    authorizedScope,
    nextSteps: dependencies.length
      ? [
          'Resolve each observed alias target independently immediately before changing DNS or hosting.',
          'Confirm the target is assigned in the expected provider account or service control plane.',
          'Remove or replace stale aliases only after preserving evidence and validating the intended service owner.',
          'Repeat the check after DNS changes because resolver evidence is point in time and may be cached.',
          'Treat analyst-reviewed false positives as view controls only; the source observation remains part of the lookup.',
        ]
      : [
          complete
            ? 'Recheck after future DNS or hosting changes; this capture observed no CNAME or HTTPS alias dependency.'
            : 'Refresh complete DNS evidence before concluding whether alias dependencies exist.',
        ],
    limitations: [
      'WHOISleuth does not follow dependency targets, query provider accounts, test claimability, or attempt service registration.',
      'Service-family signatures and analyst-entered scope are local comparison aids only; neither establishes provider configuration, account ownership, authorization, abandonment, or claimability.',
      'Candidate, unresolved, active, unsupported, and false-positive labels organise manual review only. None establishes dangling status, vulnerability, claimability, ownership, control, safety, or maliciousness.',
      'No observed dependency in complete point-in-time evidence is not a general security finding and does not cover uncollected provider account state.',
      ...(dnsEvidence.truncated === true ? ['The DNS observation was capped, so additional dependencies may not be represented.'] : []),
    ],
  };
}
