export const SERVICE_DEPENDENCY_REVIEW_VERSION = 1;

export type ServiceDependencyReviewState = 'observed' | 'review' | 'not_observed' | 'unavailable';

export type ServiceDependency = Readonly<{
  id: string;
  recordType: 'CNAME' | 'HTTPS';
  target: string;
  relation: 'external' | 'in_domain';
  state: 'observed' | 'review';
  detail: string;
  provenance: string;
}>;

export type ServiceDependencyReview = Readonly<{
  version: 1;
  state: ServiceDependencyReviewState;
  label: string;
  dependencies: readonly ServiceDependency[];
  nextSteps: readonly string[];
  limitations: readonly string[];
}>;

type UnknownRecord = Record<string, unknown>;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAX_DEPENDENCIES = 20;

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

function diagnosticStatus(diagnostics: UnknownRecord, name: string): string {
  const diagnostic = record(diagnostics[name]);
  return typeof diagnostic.status === 'string' ? diagnostic.status.toLowerCase() : '';
}

function relation(target: string, domain: string): ServiceDependency['relation'] {
  return target === domain || target.endsWith(`.${domain}`) ? 'in_domain' : 'external';
}

function cnameDependencies(raw: unknown, domain: string): ServiceDependency[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  const dependencies: ServiceDependency[] = [];
  for (const value of raw.slice(0, MAX_DEPENDENCIES * 2)) {
    const target = normalizedHostname(value);
    if (!target || unique.has(target)) continue;
    unique.add(target);
    const targetRelation = relation(target, domain);
    dependencies.push({
      id: `cname:${target}`,
      recordType: 'CNAME',
      target,
      relation: targetRelation,
      state: targetRelation === 'external' ? 'review' : 'observed',
      detail: targetRelation === 'external'
        ? 'The domain aliases to an external target. Confirm that the target resolves and remains deliberately assigned before relying on this name.'
        : 'The domain aliases to a target within the same domain namespace. Confirm the internal target during DNS or hosting transitions.',
      provenance: 'Point-in-time DNS CNAME observation',
    });
    if (dependencies.length >= MAX_DEPENDENCIES) break;
  }
  return dependencies;
}

function httpsDependencies(raw: unknown, domain: string, remaining: number): ServiceDependency[] {
  if (!Array.isArray(raw) || remaining <= 0) return [];
  const unique = new Set<string>();
  const dependencies: ServiceDependency[] = [];
  for (const value of raw.slice(0, remaining * 2)) {
    const item = record(value);
    if (item.mode !== 'alias' || item.serviceUnavailable === true) continue;
    const target = normalizedHostname(item.target);
    if (!target || unique.has(target)) continue;
    unique.add(target);
    const targetRelation = relation(target, domain);
    dependencies.push({
      id: `https:${target}`,
      recordType: 'HTTPS',
      target,
      relation: targetRelation,
      state: targetRelation === 'external' ? 'review' : 'observed',
      detail: targetRelation === 'external'
        ? 'An HTTPS alias-mode service binding points to an external target. Confirm that the target remains expected and assigned.'
        : 'An HTTPS alias-mode service binding points within the same domain namespace. Confirm it during service transitions.',
      provenance: 'Point-in-time HTTPS service-binding publication',
    });
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
}>): ServiceDependencyReview | null {
  const domain = normalizedHostname(input.domain);
  if (!domain) return null;
  const dnsEvidence = record(input.dnsEvidence);
  const dnsRecords = record(input.dnsRecords);
  const diagnostics = record(dnsEvidence.diagnostics);
  const cname = cnameDependencies(dnsRecords.cname, domain);
  const https = httpsDependencies(dnsRecords.https, domain, MAX_DEPENDENCIES - cname.length);
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
      'An observed external alias is a dependency to review, not evidence that it is dangling, vulnerable, malicious, or controlled by another party.',
      'No observed alias in complete point-in-time evidence is not a general security finding and does not cover other delegation or application dependencies.',
      ...(dnsEvidence.truncated === true ? ['The DNS observation was capped, so additional dependencies may not be represented.'] : []),
    ],
  };
}
