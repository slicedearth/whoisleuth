type UnknownRecord = Record<string, unknown>;

type TechnologyEvidenceRole =
  | 'application_platform'
  | 'embedded_dependency'
  | 'framework_runtime'
  | 'observed_edge';

const TECHNOLOGY_EVIDENCE_ROLE_ORDER: readonly TechnologyEvidenceRole[] = Object.freeze([
  'observed_edge',
  'application_platform',
  'framework_runtime',
  'embedded_dependency',
]);
const TECHNOLOGY_EVIDENCE_ROLE_SET = new Set<TechnologyEvidenceRole>(
  TECHNOLOGY_EVIDENCE_ROLE_ORDER,
);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function technologyEvidenceRoles(value: unknown): TechnologyEvidenceRole[] {
  const finding = record(value);
  const roles = new Set<TechnologyEvidenceRole>();
  let hasExplicitRole = false;
  for (const role of Array.isArray(finding.roles) ? finding.roles.slice(0, 4) : []) {
    if (typeof role === 'string' && TECHNOLOGY_EVIDENCE_ROLE_SET.has(role as TechnologyEvidenceRole)) {
      roles.add(role as TechnologyEvidenceRole);
      hasExplicitRole = true;
    }
  }
  const evidenceValues = Array.isArray(finding.evidence) ? finding.evidence.slice(0, 4) : [];
  for (const evidenceValue of evidenceValues) {
    const evidence = record(evidenceValue);
    if (typeof evidence.role === 'string'
      && TECHNOLOGY_EVIDENCE_ROLE_SET.has(evidence.role as TechnologyEvidenceRole)) {
      roles.add(evidence.role as TechnologyEvidenceRole);
      hasExplicitRole = true;
    }
  }
  if (!hasExplicitRole) {
    if (evidenceValues.some((evidence) => String(record(evidence).source).toLowerCase() === 'resource origin')) {
      roles.add('embedded_dependency');
    }
    const category = String(finding.category).toLowerCase();
    if (category === 'delivery platform') roles.add('observed_edge');
    else if (['application runtime', 'web framework', 'static site generator', 'web server'].includes(category)) {
      roles.add('framework_runtime');
    } else roles.add('application_platform');
  }
  return TECHNOLOGY_EVIDENCE_ROLE_ORDER.filter((role) => roles.has(role));
}

export {
  TECHNOLOGY_EVIDENCE_ROLE_ORDER,
  technologyEvidenceRoles,
};

export type { TechnologyEvidenceRole };
