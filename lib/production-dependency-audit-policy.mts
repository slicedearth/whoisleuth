export const PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES = 4 * 1024 * 1024;
export const PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_AT = '2026-08-10';
export const PRODUCTION_DEPENDENCY_AUDIT_EXPIRES_AT = '2026-09-10T00:00:00.000Z';

type JsonObject = Record<string, unknown>;

type ReviewedAdvisory = Readonly<{
  id: string;
  url: string;
  source: number;
  packageName: string;
  severity: 'high';
  range: string;
}>;

type ReviewedPackage = Readonly<{
  name: string;
  version: string;
  severity: 'high';
  range: string;
  isDirect: boolean;
  fixAvailable: false | Readonly<{
    name: string;
    version: string;
    isSemVerMajor: boolean;
  }>;
  viaPackages: readonly string[];
  effects: readonly string[];
  node: string;
  dependencies: Readonly<Record<string, string>>;
}>;

export const REVIEWED_PRODUCTION_ADVISORIES: readonly ReviewedAdvisory[] = Object.freeze([
  Object.freeze({
    id: 'GHSA-w3rx-r6r6-pgpr',
    url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
    source: 1138808,
    packageName: 'image-size',
    severity: 'high',
    range: '<=2.0.2',
  }),
  Object.freeze({
    id: 'GHSA-5p2g-fcmc-qvqq',
    url: 'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
    source: 1138809,
    packageName: 'image-size',
    severity: 'high',
    range: '<=2.0.2',
  }),
]);

export const PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX = Object.freeze({
  name: '@netlify/blobs',
  version: '9.1.5',
  isSemVerMajor: true,
});

const REVIEWED_PACKAGES: readonly ReviewedPackage[] = Object.freeze([
  Object.freeze({
    name: '@netlify/blobs',
    version: '10.7.9',
    severity: 'high',
    range: '>=9.1.6',
    isDirect: true,
    fixAvailable: PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX,
    viaPackages: Object.freeze(['@netlify/dev-utils']),
    effects: Object.freeze([]),
    node: 'node_modules/@netlify/blobs',
    dependencies: Object.freeze({ '@netlify/dev-utils': '4.4.6' }),
  }),
  Object.freeze({
    name: '@netlify/dev-utils',
    version: '4.4.6',
    severity: 'high',
    range: '>=3.2.0',
    isDirect: false,
    fixAvailable: PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX,
    viaPackages: Object.freeze(['image-size']),
    effects: Object.freeze(['@netlify/blobs']),
    node: 'node_modules/@netlify/dev-utils',
    dependencies: Object.freeze({ 'image-size': '^2.0.2' }),
  }),
  Object.freeze({
    name: 'image-size',
    version: '2.0.2',
    severity: 'high',
    range: '*',
    isDirect: false,
    fixAvailable: PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX,
    viaPackages: Object.freeze([]),
    effects: Object.freeze(['@netlify/dev-utils']),
    node: 'node_modules/image-size',
    dependencies: Object.freeze({}),
  }),
]);

export type ProductionDependencyAuditFinding = Readonly<{
  code:
    | 'audit_output_invalid'
    | 'audit_report_unsupported'
    | 'audit_metadata_invalid'
    | 'audit_data_unavailable'
    | 'exception_expired'
    | 'unreviewed_vulnerability'
    | 'advisory_changed'
    | 'package_chain_changed'
    | 'lockfile_changed';
  message: string;
}>;

export type ProductionDependencyAuditAssessment = Readonly<{
  status: 'accepted' | 'blocked';
  auditReportVersion: number | null;
  vulnerablePackageEntries: number;
  reviewedAdvisoryIds: readonly string[];
  reviewedAt: string;
  expiresAt: string;
  findings: readonly ProductionDependencyAuditFinding[];
}>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortedStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 1000 || value.some((entry) => typeof entry !== 'string')) return null;
  return [...value].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function fixAvailableMatches(actual: unknown, reviewed: ReviewedPackage['fixAvailable']): boolean {
  if (reviewed === false) return actual === false;
  if (!isObject(actual)) return false;
  const keys = Object.keys(actual);
  return keys.length === 3
    && keys.every((key) => ['name', 'version', 'isSemVerMajor'].includes(key))
    && actual.name === reviewed.name
    && actual.version === reviewed.version
    && actual.isSemVerMajor === reviewed.isSemVerMajor;
}

function advisoryId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  return value.match(/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\/?$/u)?.[1] ?? null;
}

function finding(code: ProductionDependencyAuditFinding['code'], message: string): ProductionDependencyAuditFinding {
  return Object.freeze({ code, message });
}

function blocked(
  findings: readonly ProductionDependencyAuditFinding[],
  details: Readonly<{ reportVersion?: number | null; packageEntries?: number; advisoryIds?: readonly string[] }> = {},
): ProductionDependencyAuditAssessment {
  return Object.freeze({
    status: 'blocked',
    auditReportVersion: details.reportVersion ?? null,
    vulnerablePackageEntries: details.packageEntries ?? 0,
    reviewedAdvisoryIds: Object.freeze([...(details.advisoryIds ?? [])]),
    reviewedAt: PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_AT,
    expiresAt: PRODUCTION_DEPENDENCY_AUDIT_EXPIRES_AT,
    findings: Object.freeze([...findings]),
  });
}

function parseJson(value: string, label: string):
  | Readonly<{ ok: true; value: JsonObject }>
  | Readonly<{ ok: false; assessment: ProductionDependencyAuditAssessment }> {
  if (Buffer.byteLength(value, 'utf8') > PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES) {
    return { ok: false, assessment: blocked([finding('audit_output_invalid', `${label} exceeds the ${PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES}-byte limit.`)]) };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isObject(parsed)) return { ok: false, assessment: blocked([finding('audit_output_invalid', `${label} must be a JSON object.`)]) };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, assessment: blocked([finding('audit_output_invalid', `${label} is not valid JSON.`)]) };
  }
}

function metadataMatches(vulnerabilities: JsonObject, metadata: unknown): boolean {
  if (!isObject(metadata) || !isObject(metadata.vulnerabilities)) return false;
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const value of Object.values(vulnerabilities)) {
    if (!isObject(value) || !Object.hasOwn(counts, String(value.severity))) return false;
    counts[value.severity as keyof typeof counts] += 1;
  }
  const reported = metadata.vulnerabilities;
  for (const [severity, count] of Object.entries(counts)) {
    if (reported[severity] !== count) return false;
  }
  return reported.total === Object.keys(vulnerabilities).length;
}

function lockfilePackage(lockfile: JsonObject, reviewed: ReviewedPackage): JsonObject | null {
  if (!isObject(lockfile.packages)) return null;
  const record = lockfile.packages[reviewed.node];
  return isObject(record) ? record : null;
}

function supportedLockfileShape(lockfile: JsonObject): lockfile is JsonObject & { packages: JsonObject } {
  const packages = lockfile.packages;
  return lockfile.lockfileVersion === 3
    && isObject(packages)
    && isObject(packages['']);
}

function validateLockfile(lockfile: JsonObject, reviewedPackages: readonly ReviewedPackage[]): ProductionDependencyAuditFinding[] {
  const findings: ProductionDependencyAuditFinding[] = [];
  if (!supportedLockfileShape(lockfile)) {
    return [finding('lockfile_changed', 'package-lock.json is not a supported lockfileVersion 3 package map.')];
  }
  const root = lockfile.packages[''];
  if (!isObject(root) || !isObject(root.dependencies) || root.dependencies['@netlify/blobs'] !== '10.7.9') {
    findings.push(finding('lockfile_changed', 'The root package no longer declares reviewed dependency @netlify/blobs@10.7.9.'));
  }
  for (const reviewed of reviewedPackages) {
    const record = lockfilePackage(lockfile, reviewed);
    const dependencies = record && isObject(record.dependencies) ? record.dependencies : {};
    if (!record || record.version !== reviewed.version) {
      findings.push(finding('lockfile_changed', `${reviewed.name} no longer matches reviewed version ${reviewed.version}.`));
      continue;
    }
    for (const [name, range] of Object.entries(reviewed.dependencies)) {
      if (dependencies[name] !== range) {
        findings.push(finding('lockfile_changed', `${reviewed.name} no longer declares reviewed dependency ${name}@${range}.`));
      }
    }
  }
  return findings;
}

function validatePackage(
  name: string,
  record: JsonObject,
  reviewed: ReviewedPackage,
  reviewedAdvisories: ReadonlyMap<string, ReviewedAdvisory>,
): ProductionDependencyAuditFinding[] {
  const findings: ProductionDependencyAuditFinding[] = [];
  const via = Array.isArray(record.via) && record.via.length <= 1000 ? record.via : null;
  const effects = sortedStrings(record.effects);
  const nodes = sortedStrings(record.nodes);
  if (!via || !effects || !nodes) {
    return [finding('package_chain_changed', `${name} has malformed dependency-chain metadata.`)];
  }
  const viaPackages: string[] = [];
  for (const entry of via) {
    if (typeof entry === 'string') viaPackages.push(entry);
  }
  const mismatches: string[] = [];
  if (record.name !== reviewed.name) mismatches.push('name');
  if (record.severity !== reviewed.severity) mismatches.push('severity');
  if (record.range !== reviewed.range) mismatches.push('range');
  if (record.isDirect !== reviewed.isDirect) mismatches.push('direct-dependency state');
  if (!fixAvailableMatches(record.fixAvailable, reviewed.fixAvailable)) mismatches.push('fix availability');
  if (!sameStrings(viaPackages.sort(), [...reviewed.viaPackages].sort())) mismatches.push('dependency chain');
  if (!sameStrings(effects, [...reviewed.effects].sort())) mismatches.push('affected dependants');
  if (!sameStrings(nodes, [reviewed.node])) mismatches.push('installed node');
  if (mismatches.length) {
    findings.push(finding('package_chain_changed', `${name} changed reviewed attribute(s): ${mismatches.join(', ')}.`));
  }

  for (const entry of via) {
    if (!isObject(entry)) continue;
    const id = advisoryId(entry.url);
    const policy = id ? reviewedAdvisories.get(id) : undefined;
    if (!id || !policy) {
      findings.push(finding('unreviewed_vulnerability', `${name} includes an advisory outside the reviewed allowlist.`));
      continue;
    }
    if (
      entry.source !== policy.source
      || entry.url !== policy.url
      || entry.name !== policy.packageName
      || entry.dependency !== policy.packageName
      || entry.severity !== policy.severity
      || entry.range !== policy.range
    ) {
      findings.push(finding('advisory_changed', `${id} no longer matches the reviewed URL, package, source, severity, or affected range.`));
    }
  }
  return findings;
}

export function assessProductionDependencyAudit(options: Readonly<{
  auditJson: string;
  lockfileJson: string;
  now?: () => Date;
}>): ProductionDependencyAuditAssessment {
  const parsedAudit = parseJson(options.auditJson, 'npm audit output');
  if (!parsedAudit.ok) return parsedAudit.assessment;
  const audit = parsedAudit.value;
  const reportVersion = typeof audit.auditReportVersion === 'number' ? audit.auditReportVersion : null;
  if (reportVersion !== 2 || !isObject(audit.vulnerabilities)) {
    return blocked([finding('audit_report_unsupported', 'npm audit output is not auditReportVersion 2 with a vulnerability map.')], {
      reportVersion,
    });
  }
  const vulnerabilities = audit.vulnerabilities;
  const packageEntries = Object.keys(vulnerabilities).length;
  if (packageEntries > 1000 || !metadataMatches(vulnerabilities, audit.metadata)) {
    return blocked([finding('audit_metadata_invalid', 'npm audit vulnerability metadata is malformed or inconsistent.')], {
      reportVersion,
      packageEntries,
    });
  }
  const parsedLockfile = parseJson(options.lockfileJson, 'package-lock.json');
  if (!parsedLockfile.ok) {
    return blocked(parsedLockfile.assessment.findings.map((entry) => finding('lockfile_changed', entry.message)), {
      reportVersion,
      packageEntries,
    });
  }
  if (packageEntries === 0) {
    if (!supportedLockfileShape(parsedLockfile.value)) {
      return blocked([finding('lockfile_changed', 'package-lock.json is not a supported lockfileVersion 3 package map.')], {
        reportVersion,
        packageEntries,
      });
    }
    if (validateLockfile(parsedLockfile.value, REVIEWED_PACKAGES).length === 0) {
      return blocked([finding(
        'audit_data_unavailable',
        'npm audit reported no vulnerabilities while package-lock.json still contains the reviewed vulnerable dependency chain.',
      )], {
        reportVersion,
        packageEntries,
      });
    }
    return Object.freeze({
      status: 'accepted',
      auditReportVersion: reportVersion,
      vulnerablePackageEntries: 0,
      reviewedAdvisoryIds: Object.freeze([]),
      reviewedAt: PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_AT,
      expiresAt: PRODUCTION_DEPENDENCY_AUDIT_EXPIRES_AT,
      findings: Object.freeze([]),
    });
  }

  const now = (options.now ?? (() => new Date()))();
  if (!Number.isFinite(now.getTime()) || now.getTime() >= Date.parse(PRODUCTION_DEPENDENCY_AUDIT_EXPIRES_AT)) {
    return blocked([finding('exception_expired', `The reviewed exception expired at ${PRODUCTION_DEPENDENCY_AUDIT_EXPIRES_AT}.`)], {
      reportVersion,
      packageEntries,
    });
  }

  const presentAdvisoryIds = new Set<string>();
  let advisoryRecordCount = 0;
  for (const value of Object.values(vulnerabilities)) {
    if (!isObject(value) || !Array.isArray(value.via) || value.via.length > 1000) continue;
    for (const entry of value.via) {
      if (!isObject(entry)) continue;
      advisoryRecordCount += 1;
      const id = advisoryId(entry.url);
      if (id) presentAdvisoryIds.add(id);
    }
  }
  const advisoryIds = [...presentAdvisoryIds].sort();
  const expectedAdvisoryIds = REVIEWED_PRODUCTION_ADVISORIES.map((entry) => entry.id).sort();
  const reviewedById = new Map(REVIEWED_PRODUCTION_ADVISORIES.map((entry) => [entry.id, entry]));
  const findings: ProductionDependencyAuditFinding[] = [];
  const reviewedPackageNames = new Set(REVIEWED_PACKAGES.map((entry) => entry.name));
  for (const name of Object.keys(vulnerabilities)) {
    if (!reviewedPackageNames.has(name)) {
      findings.push(finding('unreviewed_vulnerability', `${name} is not part of the reviewed vulnerable package chain.`));
    }
  }
  for (const reviewed of REVIEWED_PACKAGES) {
    const record = vulnerabilities[reviewed.name];
    if (!isObject(record)) {
      findings.push(finding('package_chain_changed', `${reviewed.name} is missing from the reviewed vulnerable package chain.`));
      continue;
    }
    findings.push(...validatePackage(reviewed.name, record, reviewed, reviewedById));
  }
  if (
    advisoryRecordCount !== REVIEWED_PRODUCTION_ADVISORIES.length
    || !sameStrings(advisoryIds, expectedAdvisoryIds)
  ) {
    findings.push(finding(
      'advisory_changed',
      `Expected exactly ${REVIEWED_PRODUCTION_ADVISORIES.length} distinct reviewed advisory records; received ${advisoryRecordCount} record(s) across ${advisoryIds.length} distinct ID(s).`,
    ));
  }
  findings.push(...validateLockfile(parsedLockfile.value, REVIEWED_PACKAGES));

  if (findings.length) return blocked(findings, { reportVersion, packageEntries, advisoryIds });
  return Object.freeze({
    status: 'accepted',
    auditReportVersion: reportVersion,
    vulnerablePackageEntries: packageEntries,
    reviewedAdvisoryIds: Object.freeze(advisoryIds),
    reviewedAt: PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_AT,
    expiresAt: PRODUCTION_DEPENDENCY_AUDIT_EXPIRES_AT,
    findings: Object.freeze([]),
  });
}
