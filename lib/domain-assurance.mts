import { domainToASCII } from 'node:url';

const DOMAIN_ASSURANCE_INPUT_SCHEMA = 'whoisleuth.domain-assurance.input';
const DOMAIN_ASSURANCE_SCHEMA = 'whoisleuth.domain-assurance';
const DOMAIN_ASSURANCE_VERSION = 1;
const MAX_ASSURANCE_INPUT_BYTES = 2 * 1024 * 1024;

type AssuranceKind = 'planned-change' | 'recovery-dependencies' | 'retirement';
type AssuranceState = 'incomplete' | 'needs_review' | 'ready';
type UnknownRecord = Record<string, unknown>;

type PlannedChangeResult = Readonly<{
  kind: 'planned-change';
  domain: string;
  reference: string;
  window: Readonly<{ startsAt: string; endsAt: string }>;
  milestones: readonly Readonly<{
    id: string;
    label: string;
    expectedBy: string;
    evidenceSource: string;
    state: 'missed' | 'not_checked' | 'observed' | 'planned';
    observedAt: string | null;
    evidenceReference: string | null;
  }>[];
  rollbackCriteria: readonly Readonly<{
    id: string;
    condition: string;
    owner: string;
    state: 'met' | 'not_checked' | 'not_met';
  }>[];
  postChangeChecks: readonly Readonly<{
    id: string;
    label: string;
    expectedState: string;
    evidenceSource: string;
    state: 'matched' | 'not_checked' | 'unexpected';
    evidenceReference: string | null;
  }>[];
  review: Readonly<{ state: AssuranceState; reasons: readonly string[] }>;
}>;

type RecoveryDependencyResult = Readonly<{
  kind: 'recovery-dependencies';
  assets: readonly Readonly<{
    domain: string;
    dependencies: Readonly<Record<'certificate' | 'dns' | 'mail' | 'registrar' | 'recovery', string | null>>;
    readiness: Readonly<Record<'dnsRecoveryTested' | 'registrarRecoveryTested' | 'recoveryMfaProtected', boolean | null>>;
  }>[];
  concentrations: readonly Readonly<{
    dependencyType: 'certificate' | 'dns' | 'mail' | 'registrar' | 'recovery';
    provider: string;
    domains: readonly string[];
    share: number;
  }>[];
  unknownDependencies: number;
  review: Readonly<{ state: AssuranceState; reasons: readonly string[] }>;
}>;

type RetirementResult = Readonly<{
  kind: 'retirement';
  domain: string;
  checks: readonly Readonly<{
    id: string;
    label: string;
    state: 'confirmed' | 'not_confirmed' | 'not_checked';
    expected: boolean;
  }>[];
  review: Readonly<{ state: AssuranceState; reasons: readonly string[] }>;
}>;

type DomainAssuranceDocument = Readonly<{
  schema: typeof DOMAIN_ASSURANCE_SCHEMA;
  version: typeof DOMAIN_ASSURANCE_VERSION;
  generatedAt: string;
  result: PlannedChangeResult | RecoveryDependencyResult | RetirementResult;
  limitations: readonly string[];
}>;

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Domain assurance input must be one JSON object.');
  return value as UnknownRecord;
}

function text(value: unknown, field: string, maximum = 160): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${field} must contain from 1 to ${maximum} characters.`);
  return normalized;
}

function optionalText(value: unknown, maximum = 160): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('Optional domain assurance labels must be text.');
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > maximum) throw new Error(`Optional domain assurance labels are limited to ${maximum} characters.`);
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const normalized = text(value, field, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${field} must be an ISO-compatible timestamp.`);
  return new Date(normalized).toISOString();
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return timestamp(value, field);
}

function domain(value: unknown, field = 'domain'): string {
  const normalized = text(value, field, 253).toLowerCase().replace(/\.$/u, '');
  let ascii: string;
  try {
    ascii = domainToASCII(normalized);
  } catch {
    throw new Error(`${field} must be a valid domain name.`);
  }
  if (!ascii || !ascii.includes('.') || ascii.length > 253 || !ascii.split('.').every((labelValue) => (
    labelValue.length >= 1 && labelValue.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(labelValue)
  ))) throw new Error(`${field} must be a valid domain name.`);
  return ascii;
}

function boundedArray(value: unknown, field: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${field} must contain from ${minimum} to ${maximum} items.`);
  }
  return value;
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new Error(`${field} must be true, false, or null.`);
  return value;
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function reviewState(reasons: string[], negative: boolean): AssuranceState {
  if (negative) return 'needs_review';
  return reasons.length ? 'incomplete' : 'ready';
}

function buildPlannedChange(input: UnknownRecord): PlannedChangeResult {
  const target = domain(input.domain);
  const change = record(input.change);
  const startsAt = timestamp(change.startsAt, 'change.startsAt');
  const endsAt = timestamp(change.endsAt, 'change.endsAt');
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('change.endsAt must be later than change.startsAt.');
  const ids = new Set<string>();
  const uniqueId = (value: unknown, field: string) => {
    const id = text(value, field, 64);
    if (ids.has(id)) throw new Error(`Domain assurance item id "${id}" is duplicated.`);
    ids.add(id);
    return id;
  };
  const milestones = boundedArray(change.milestones, 'change.milestones', 1, 24).map((raw, index) => {
    const item = record(raw);
    const state = enumValue(item.state, `change.milestones[${index}].state`, ['missed', 'not_checked', 'observed', 'planned'] as const);
    const observedAt = optionalTimestamp(item.observedAt, `change.milestones[${index}].observedAt`);
    const evidenceReference = optionalText(item.evidenceReference, 300);
    if (state === 'observed' && (!observedAt || !evidenceReference)) {
      throw new Error('Observed change milestones require observedAt and evidenceReference.');
    }
    return {
      id: uniqueId(item.id, `change.milestones[${index}].id`),
      label: text(item.label, `change.milestones[${index}].label`, 180),
      expectedBy: timestamp(item.expectedBy, `change.milestones[${index}].expectedBy`),
      evidenceSource: text(item.evidenceSource, `change.milestones[${index}].evidenceSource`, 120),
      state,
      observedAt,
      evidenceReference,
    };
  });
  const rollbackCriteria = boundedArray(change.rollbackCriteria, 'change.rollbackCriteria', 1, 16).map((raw, index) => {
    const item = record(raw);
    return {
      id: uniqueId(item.id, `change.rollbackCriteria[${index}].id`),
      condition: text(item.condition, `change.rollbackCriteria[${index}].condition`, 240),
      owner: text(item.owner, `change.rollbackCriteria[${index}].owner`, 120),
      state: enumValue(item.state, `change.rollbackCriteria[${index}].state`, ['met', 'not_checked', 'not_met'] as const),
    };
  });
  const postChangeChecks = boundedArray(change.postChangeChecks, 'change.postChangeChecks', 1, 24).map((raw, index) => {
    const item = record(raw);
    const state = enumValue(item.state, `change.postChangeChecks[${index}].state`, ['matched', 'not_checked', 'unexpected'] as const);
    const evidenceReference = optionalText(item.evidenceReference, 300);
    if (state !== 'not_checked' && !evidenceReference) throw new Error('Completed post-change checks require evidenceReference.');
    return {
      id: uniqueId(item.id, `change.postChangeChecks[${index}].id`),
      label: text(item.label, `change.postChangeChecks[${index}].label`, 180),
      expectedState: text(item.expectedState, `change.postChangeChecks[${index}].expectedState`, 240),
      evidenceSource: text(item.evidenceSource, `change.postChangeChecks[${index}].evidenceSource`, 120),
      state,
      evidenceReference,
    };
  });
  const reasons = [
    ...(milestones.some((item) => item.state === 'planned' || item.state === 'not_checked') ? ['One or more planned milestones have not been observed.'] : []),
    ...(rollbackCriteria.some((item) => item.state === 'not_checked') ? ['One or more rollback criteria have not been evaluated.'] : []),
    ...(postChangeChecks.some((item) => item.state === 'not_checked') ? ['One or more post-change checks remain open.'] : []),
  ];
  const negative = milestones.some((item) => item.state === 'missed')
    || rollbackCriteria.some((item) => item.state === 'met')
    || postChangeChecks.some((item) => item.state === 'unexpected');
  return {
    kind: 'planned-change',
    domain: target,
    reference: text(change.reference, 'change.reference', 120),
    window: { startsAt, endsAt },
    milestones,
    rollbackCriteria,
    postChangeChecks,
    review: { state: reviewState(reasons, negative), reasons },
  };
}

function buildRecoveryDependencies(input: UnknownRecord): RecoveryDependencyResult {
  const assets = boundedArray(input.assets, 'assets', 1, 100).map((raw, index) => {
    const item = record(raw);
    const dependencies = record(item.dependencies);
    const readiness = record(item.readiness);
    return {
      domain: domain(item.domain, `assets[${index}].domain`),
      dependencies: {
        registrar: optionalText(dependencies.registrar, 120),
        dns: optionalText(dependencies.dns, 120),
        mail: optionalText(dependencies.mail, 120),
        certificate: optionalText(dependencies.certificate, 120),
        recovery: optionalText(dependencies.recovery, 120),
      },
      readiness: {
        registrarRecoveryTested: nullableBoolean(readiness.registrarRecoveryTested, `assets[${index}].readiness.registrarRecoveryTested`),
        dnsRecoveryTested: nullableBoolean(readiness.dnsRecoveryTested, `assets[${index}].readiness.dnsRecoveryTested`),
        recoveryMfaProtected: nullableBoolean(readiness.recoveryMfaProtected, `assets[${index}].readiness.recoveryMfaProtected`),
      },
    };
  });
  if (new Set(assets.map((asset) => asset.domain)).size !== assets.length) throw new Error('Recovery dependency domains must be unique.');
  const dependencyTypes = ['registrar', 'dns', 'mail', 'certificate', 'recovery'] as const;
  const concentrations = dependencyTypes.flatMap((dependencyType) => {
    const byProvider = new Map<string, string[]>();
    for (const asset of assets) {
      const provider = asset.dependencies[dependencyType];
      if (!provider) continue;
      const domains = byProvider.get(provider.toLowerCase()) || [];
      domains.push(asset.domain);
      byProvider.set(provider.toLowerCase(), domains);
    }
    return [...byProvider.entries()].filter(([, domains]) => domains.length > 1).map(([provider, domains]) => ({
      dependencyType,
      provider,
      domains: domains.sort(),
      share: Number((domains.length / assets.length).toFixed(4)),
    }));
  }).sort((left, right) => right.share - left.share || left.dependencyType.localeCompare(right.dependencyType));
  const unknownDependencies = assets.reduce((total, asset) => (
    total + dependencyTypes.filter((dependencyType) => asset.dependencies[dependencyType] === null).length
  ), 0);
  const reasons = [
    ...(unknownDependencies ? [`${unknownDependencies} dependency fields are not recorded.`] : []),
    ...(assets.some((asset) => Object.values(asset.readiness).some((value) => value === null)) ? ['One or more recovery checks have not been recorded.'] : []),
  ];
  const negative = assets.some((asset) => Object.values(asset.readiness).some((value) => value === false));
  return {
    kind: 'recovery-dependencies',
    assets,
    concentrations,
    unknownDependencies,
    review: { state: reviewState(reasons, negative), reasons },
  };
}

const RETIREMENT_CHECKS = Object.freeze([
  ['autoRenewDisabled', 'Auto-renew is intentionally configured', true],
  ['registrarLockMaintained', 'Registrar lock remains enabled', true],
  ['websiteRetired', 'Web service is retired or intentionally redirected', true],
  ['mailRetired', 'Mail service is retired', true],
  ['nullMxPublished', 'Null MX is published when the domain must not receive mail', true],
  ['spfRestrictive', 'SPF policy is intentionally restrictive', true],
  ['dmarcReject', 'DMARC enforcement is intentionally strict', true],
  ['certificatesReviewed', 'Active and historical certificate exposure was reviewed', true],
  ['delegatedDnsMonitored', 'Delegated DNS remains monitored during retirement', true],
  ['reRegistrationPrevented', 'Registration continuity or defensive renewal is planned', true],
] as const);

function buildRetirement(input: UnknownRecord): RetirementResult {
  const checksInput = record(input.checks);
  const checks = RETIREMENT_CHECKS.map(([id, checkLabel, expected]) => {
    const value = nullableBoolean(checksInput[id], `checks.${id}`);
    return {
      id,
      label: checkLabel,
      state: value === null ? 'not_checked' as const : value === expected ? 'confirmed' as const : 'not_confirmed' as const,
      expected,
    };
  });
  const reasons = checks.filter((check) => check.state === 'not_checked').map((check) => `${check.label} has not been checked.`);
  const negative = checks.some((check) => check.state === 'not_confirmed');
  return {
    kind: 'retirement',
    domain: domain(input.domain),
    checks,
    review: { state: reviewState(reasons, negative), reasons: reasons.slice(0, 20) },
  };
}

function buildDomainAssurance(inputRaw: unknown, generatedAt = new Date().toISOString()): DomainAssuranceDocument {
  const input = record(inputRaw);
  if (input.schema !== DOMAIN_ASSURANCE_INPUT_SCHEMA || input.version !== DOMAIN_ASSURANCE_VERSION) {
    throw new Error(`Domain assurance input must use ${DOMAIN_ASSURANCE_INPUT_SCHEMA} version ${DOMAIN_ASSURANCE_VERSION}.`);
  }
  const kind = enumValue(input.kind, 'kind', ['planned-change', 'recovery-dependencies', 'retirement'] as const satisfies readonly AssuranceKind[]);
  const result = kind === 'planned-change'
    ? buildPlannedChange(input)
    : kind === 'recovery-dependencies'
      ? buildRecoveryDependencies(input)
      : buildRetirement(input);
  return {
    schema: DOMAIN_ASSURANCE_SCHEMA,
    version: DOMAIN_ASSURANCE_VERSION,
    generatedAt: timestamp(generatedAt, 'generatedAt'),
    result,
    limitations: [
      'This review uses only analyst-supplied planning and observation metadata and makes no network request or configuration change.',
      'Provider labels, readiness checks, and evidence references are analyst-authored assertions; they are not independently verified by this report.',
      'A ready result means the supplied checklist is complete under this schema. It is not a guarantee of control, recovery, successful change, or safe retirement.',
      'Do not include passwords, recovery codes, private keys, personal contact details, or other secrets in an assurance input.',
    ],
  };
}

function formatDomainAssurance(document: DomainAssuranceDocument): string {
  const { result } = document;
  const output = [
    'Domain assurance review',
    `Workflow          ${result.kind.replaceAll('-', ' ')}`,
    `State             ${result.review.state.replaceAll('_', ' ')}`,
  ];
  if ('domain' in result) output.push(`Domain            ${result.domain}`);
  if (result.kind === 'recovery-dependencies') {
    output.push(`Assets            ${result.assets.length}`);
    output.push(`Concentrations    ${result.concentrations.length}`);
    output.push(`Unknown fields    ${result.unknownDependencies}`);
    for (const concentration of result.concentrations) {
      output.push(`  ${concentration.dependencyType}: ${concentration.provider} (${concentration.domains.length}/${result.assets.length})`);
    }
  } else if (result.kind === 'planned-change') {
    output.push(`Change reference  ${result.reference}`);
    output.push(`Milestones        ${result.milestones.length}`);
    output.push(`Rollback criteria ${result.rollbackCriteria.length}`);
    output.push(`Post-change checks ${result.postChangeChecks.length}`);
  } else {
    output.push(`Confirmed         ${result.checks.filter((check) => check.state === 'confirmed').length}/${result.checks.length}`);
  }
  if (result.review.reasons.length) {
    output.push('', 'Review reasons:');
    for (const reason of result.review.reasons) output.push(`  - ${reason}`);
  }
  output.push('', 'Limitations:');
  for (const limitation of document.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}

export {
  DOMAIN_ASSURANCE_INPUT_SCHEMA,
  DOMAIN_ASSURANCE_SCHEMA,
  DOMAIN_ASSURANCE_VERSION,
  MAX_ASSURANCE_INPUT_BYTES,
  buildDomainAssurance,
  formatDomainAssurance,
};
export type { AssuranceKind, AssuranceState, DomainAssuranceDocument };
