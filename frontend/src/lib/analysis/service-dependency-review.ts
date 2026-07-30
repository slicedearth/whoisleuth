export const SERVICE_DEPENDENCY_REVIEW_VERSION = 2;

export type ServiceDependencyReviewState = 'observed' | 'review' | 'not_observed' | 'unavailable';
export type ServiceDependencyScope = 'authorized' | 'outside' | 'unspecified';

export type ServiceDependencySignature = Readonly<{
  id: string;
  label: string;
  targetSuffixes: readonly string[];
}>;

export type ServiceDependency = Readonly<{
  id: string;
  recordType: 'CNAME' | 'HTTPS';
  target: string;
  relation: 'external' | 'in_domain';
  scope: ServiceDependencyScope;
  signatureId?: string;
  serviceFamily?: string;
  state: 'observed' | 'review';
  detail: string;
  provenance: string;
}>;

export type ServiceDependencyReview = Readonly<{
  version: 2;
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
): ServiceDependency {
  const targetRelation = relation(target, domain);
  const scope = dependencyScope(target, authorizedScope);
  const signature = serviceSignature(target, signatures);
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
    state: targetRelation === 'external' ? 'review' : 'observed',
    detail: targetRelation === 'external'
      ? `${recordType === 'HTTPS' ? 'An HTTPS alias-mode service binding' : 'The domain'} points to an external target. Confirm that the target resolves and remains deliberately assigned before relying on this name.`
      : `${recordType === 'HTTPS' ? 'An HTTPS alias-mode service binding' : 'The domain'} points within the same domain namespace. Confirm the internal target during DNS or hosting transitions.`,
    provenance: recordType === 'HTTPS'
      ? 'Point-in-time HTTPS service-binding publication'
      : 'Point-in-time DNS CNAME observation',
  };
}

function cnameDependencies(
  raw: unknown,
  domain: string,
  authorizedScope: readonly string[],
  signatures: readonly ServiceDependencySignature[],
): ServiceDependency[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  const dependencies: ServiceDependency[] = [];
  for (const value of raw.slice(0, MAX_DEPENDENCIES * 2)) {
    const target = normalizedHostname(value);
    if (!target || unique.has(target)) continue;
    unique.add(target);
    dependencies.push(dependency('CNAME', target, domain, authorizedScope, signatures));
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
    dependencies.push(dependency('HTTPS', target, domain, authorizedScope, signatures));
    if (dependencies.length >= remaining) break;
  }
  return dependencies;
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
  authorizedScope?: unknown;
  signatures?: readonly ServiceDependencySignature[];
}>): ServiceDependencyReview | null {
  const domain = normalizedHostname(input.domain);
  if (!domain) return null;
  const dnsEvidence = record(input.dnsEvidence);
  const dnsRecords = record(input.dnsRecords);
  const diagnostics = record(dnsEvidence.diagnostics);
  const authorizedScope = parseAuthorizedServiceScope(input.authorizedScope);
  const signatures = normalizedSignatures(input.signatures ?? SERVICE_DEPENDENCY_SIGNATURES);
  const cname = cnameDependencies(dnsRecords.cname, domain, authorizedScope, signatures);
  const https = httpsDependencies(
    dnsRecords.https,
    domain,
    MAX_DEPENDENCIES - cname.length,
    authorizedScope,
    signatures,
  );
  const dependencies = [...cname, ...https];
  const externalCount = dependencies.filter((item) => item.relation === 'external').length;
  const cnameStatus = diagnosticStatus(diagnostics, 'cname');
  const httpsStatus = diagnosticStatus(diagnostics, 'https');
  const complete = dnsEvidence.source === 'dns'
    && dnsEvidence.complete === true
    && ['success', 'not_found'].includes(cnameStatus)
    && ['success', 'not_found'].includes(httpsStatus);

  let state: ServiceDependencyReviewState;
  let label: string;
  if (externalCount) {
    state = 'review';
    label = `${externalCount} external alias dependenc${externalCount === 1 ? 'y requires' : 'ies require'} review`;
  } else if (dependencies.length) {
    state = 'observed';
    label = `${dependencies.length} in-domain alias dependenc${dependencies.length === 1 ? 'y' : 'ies'} observed`;
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
        ]
      : [
          complete
            ? 'Recheck after future DNS or hosting changes; this capture observed no CNAME or HTTPS alias dependency.'
            : 'Refresh complete DNS evidence before concluding whether alias dependencies exist.',
        ],
    limitations: [
      'WHOISleuth does not follow alias targets, query provider accounts, test claimability, or attempt service registration.',
      'Service-family signatures and analyst-entered scope are local comparison aids only; neither establishes provider configuration, account ownership, authorization, abandonment, or claimability.',
      'An observed external alias is a dependency to review, not evidence that it is dangling, vulnerable, malicious, or controlled by another party.',
      'No observed alias in complete point-in-time evidence is not a general security finding and does not cover other delegation or application dependencies.',
      ...(dnsEvidence.truncated === true ? ['The DNS observation was capped, so additional dependencies may not be represented.'] : []),
    ],
  };
}
