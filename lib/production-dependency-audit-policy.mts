export const PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES = 4 * 1024 * 1024;
export const PRODUCTION_DEPENDENCY_AUDIT_MAX_PACKAGES = 1_000;

type JsonObject = Record<string, unknown>;
type VulnerabilitySeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

const VULNERABILITY_SEVERITIES = Object.freeze([
  'info',
  'low',
  'moderate',
  'high',
  'critical',
] as const);
const SAFE_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;

export type ProductionDependencyAuditFinding = Readonly<{
  code:
    | 'audit_output_invalid'
    | 'audit_report_unsupported'
    | 'audit_metadata_invalid'
    | 'audit_data_unavailable'
    | 'production_vulnerability';
  message: string;
}>;

export type ProductionDependencyAuditAssessment = Readonly<{
  status: 'accepted' | 'blocked';
  auditReportVersion: number | null;
  vulnerablePackageEntries: number;
  findings: readonly ProductionDependencyAuditFinding[];
}>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finding(
  code: ProductionDependencyAuditFinding['code'],
  message: string,
): ProductionDependencyAuditFinding {
  return Object.freeze({ code, message });
}

function assessment(
  status: ProductionDependencyAuditAssessment['status'],
  findings: readonly ProductionDependencyAuditFinding[],
  reportVersion: number | null = null,
  packageEntries = 0,
): ProductionDependencyAuditAssessment {
  return Object.freeze({
    status,
    auditReportVersion: reportVersion,
    vulnerablePackageEntries: packageEntries,
    findings: Object.freeze([...findings]),
  });
}

function parseAuditJson(value: string):
  | Readonly<{ ok: true; value: JsonObject }>
  | Readonly<{ ok: false; assessment: ProductionDependencyAuditAssessment }> {
  if (Buffer.byteLength(value, 'utf8') > PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES) {
    return {
      ok: false,
      assessment: assessment('blocked', [finding(
        'audit_output_invalid',
        `npm audit output exceeds the ${PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES}-byte limit.`,
      )]),
    };
  }
  if (value.trim() === '') {
    return {
      ok: false,
      assessment: assessment('blocked', [finding(
        'audit_data_unavailable',
        'npm audit returned no JSON report.',
      )]),
    };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isObject(parsed)) {
      return {
        ok: false,
        assessment: assessment('blocked', [finding(
          'audit_output_invalid',
          'npm audit output must be a JSON object.',
        )]),
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      assessment: assessment('blocked', [finding(
        'audit_output_invalid',
        'npm audit output is not valid JSON.',
      )]),
    };
  }
}

function supportedPackageEntry(name: string, value: unknown): value is JsonObject {
  if (
    name.length === 0
    || name.length > 214
    || !SAFE_PACKAGE_NAME.test(name)
    || !isObject(value)
    || value.name !== name
    || typeof value.isDirect !== 'boolean'
    || typeof value.range !== 'string'
    || value.range.length > 2_048
    || !VULNERABILITY_SEVERITIES.includes(value.severity as VulnerabilitySeverity)
  ) return false;
  for (const key of ['via', 'effects', 'nodes'] as const) {
    const entries = value[key];
    if (!Array.isArray(entries) || entries.length > PRODUCTION_DEPENDENCY_AUDIT_MAX_PACKAGES) return false;
  }
  return true;
}

function metadataMatches(vulnerabilities: JsonObject, metadata: unknown): boolean {
  if (
    !isObject(metadata)
    || JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(['dependencies', 'vulnerabilities'])
    || !isObject(metadata.vulnerabilities)
    || !isObject(metadata.dependencies)
  ) return false;
  const reported = metadata.vulnerabilities;
  const expectedKeys = [...VULNERABILITY_SEVERITIES, 'total'].sort();
  if (JSON.stringify(Object.keys(reported).sort()) !== JSON.stringify(expectedKeys)) return false;

  const counts: Record<VulnerabilitySeverity, number> = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };
  for (const [name, value] of Object.entries(vulnerabilities)) {
    if (!supportedPackageEntry(name, value)) return false;
    counts[value.severity as VulnerabilitySeverity] += 1;
  }
  for (const severity of VULNERABILITY_SEVERITIES) {
    if (reported[severity] !== counts[severity]) return false;
  }
  if (reported.total !== Object.keys(vulnerabilities).length) return false;

  const dependencies = metadata.dependencies;
  const dependencyKeys = ['dev', 'optional', 'peer', 'peerOptional', 'prod', 'total'];
  if (JSON.stringify(Object.keys(dependencies).sort()) !== JSON.stringify(dependencyKeys)) return false;
  const dependencyCounts = dependencyKeys.map((key) => dependencies[key]);
  if (!dependencyCounts.every((value) => (
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000
  ))) return false;
  const total = Number(dependencies.total);
  return dependencyKeys
    .filter((key) => key !== 'total')
    .every((key) => Number(dependencies[key]) <= total);
}

export function assessProductionDependencyAudit(options: Readonly<{
  auditJson: string;
}>): ProductionDependencyAuditAssessment {
  const parsed = parseAuditJson(options.auditJson);
  if (!parsed.ok) return parsed.assessment;
  const audit = parsed.value;

  const reportVersion = typeof audit.auditReportVersion === 'number'
    ? audit.auditReportVersion
    : null;
  if (
    reportVersion !== 2
    || JSON.stringify(Object.keys(audit).sort()) !== JSON.stringify(['auditReportVersion', 'metadata', 'vulnerabilities'])
    || !isObject(audit.vulnerabilities)
  ) {
    return assessment('blocked', [finding(
      'audit_report_unsupported',
      'npm audit output is not auditReportVersion 2 with a vulnerability map.',
    )], reportVersion);
  }

  const vulnerabilities = audit.vulnerabilities;
  const packageNames = Object.keys(vulnerabilities).sort();
  if (
    packageNames.length > PRODUCTION_DEPENDENCY_AUDIT_MAX_PACKAGES
    || !metadataMatches(vulnerabilities, audit.metadata)
  ) {
    return assessment('blocked', [finding(
      'audit_metadata_invalid',
      'npm audit vulnerability entries or metadata are malformed or inconsistent.',
    )], reportVersion, packageNames.length);
  }

  if (packageNames.length > 0) {
    return assessment('blocked', packageNames.map((name) => finding(
      'production_vulnerability',
      `Production dependency ${name} has a reported vulnerability.`,
    )), reportVersion, packageNames.length);
  }

  return assessment('accepted', [], reportVersion, 0);
}
