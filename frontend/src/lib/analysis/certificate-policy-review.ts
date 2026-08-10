import type { DesiredPostureBaseline } from './brand-profile-model.ts';

export type CertificatePolicyState =
  | 'aligned'
  | 'apparently_outside_current_policy'
  | 'changed'
  | 'indeterminate'
  | 'not_configured'
  | 'no_target_policy_observed';

export type CertificatePolicyFinding = Readonly<{
  id: 'caa' | 'expected_issuer' | 'expected_san' | 'expected_spki';
  label: string;
  state: CertificatePolicyState;
  observed: readonly string[];
  expected: readonly string[];
  detail: string;
  sources: readonly string[];
  limitations: readonly string[];
}>;

export type CertificatePolicyReview = Readonly<{
  version: 2;
  observedAt: string | null;
  findings: readonly CertificatePolicyFinding[];
  caaAuthorizations: readonly CaaAuthorization[];
  limitations: readonly string[];
}>;

type JsonRecord = Record<string, unknown>;
export type CaaAuthorization = Readonly<{
  tag: 'issue' | 'issuewild' | 'iodef';
  issuer: string;
  critical: number | null;
  accountUris: readonly string[];
  validationMethods: readonly string[];
  unrecognizedParameters: readonly string[];
}>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const KNOWN_ISSUERS: readonly Readonly<{ pattern: RegExp; identifiers: readonly string[] }>[] = Object.freeze([
  { pattern: /let'?s encrypt|isrg/iu, identifiers: ['letsencrypt.org'] },
  { pattern: /digicert|geotrust|thawte|rapidssl/iu, identifiers: ['digicert.com'] },
  { pattern: /sectigo|comodo/iu, identifiers: ['sectigo.com', 'comodoca.com'] },
  { pattern: /google trust|gts ca/iu, identifiers: ['pki.goog'] },
  { pattern: /amazon/iu, identifiers: ['amazon.com'] },
  { pattern: /globalsign/iu, identifiers: ['globalsign.com'] },
  { pattern: /ssl\\.com/iu, identifiers: ['ssl.com'] },
  { pattern: /entrust/iu, identifiers: ['entrust.net'] },
]);

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, maximum = 320): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function caaParameterValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/gu, '').trim().slice(0, 240);
}

export function parseCaaAuthorizations(value: unknown): CaaAuthorization[] {
  if (!Array.isArray(value)) return [];
  const output: CaaAuthorization[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 32)) {
    const candidate = record(item);
    const tag = text(candidate.tag ?? candidate.issue, 32).toLowerCase();
    const rawValue = text(candidate.value ?? candidate.issue, 300);
    if (!['issue', 'issuewild', 'iodef'].includes(tag) || !rawValue) continue;
    const [rawIssuer = '', ...rawParameters] = rawValue.split(';');
    const issuer = caaParameterValue(rawIssuer).toLowerCase();
    if (!issuer) continue;
    const accountUris: string[] = [];
    const validationMethods: string[] = [];
    const unrecognizedParameters: string[] = [];
    for (const rawParameter of rawParameters.slice(0, 12)) {
      const separator = rawParameter.indexOf('=');
      const name = caaParameterValue(separator >= 0 ? rawParameter.slice(0, separator) : rawParameter).toLowerCase();
      const parameterValue = separator >= 0 ? caaParameterValue(rawParameter.slice(separator + 1)) : '';
      if (!name) continue;
      if (name === 'accounturi' && parameterValue) accountUris.push(parameterValue);
      else if (name === 'validationmethods' && parameterValue) {
        validationMethods.push(...parameterValue.split(',').map((method) => caaParameterValue(method).toLowerCase()).filter(Boolean));
      } else {
        unrecognizedParameters.push(parameterValue ? `${name}=${parameterValue}` : name);
      }
    }
    const normalized = {
      tag: tag as CaaAuthorization['tag'],
      issuer,
      critical: Number.isInteger(candidate.critical) ? Number(candidate.critical) : null,
      accountUris: [...new Set(accountUris)].slice(0, 8),
      validationMethods: [...new Set(validationMethods)].slice(0, 8),
      unrecognizedParameters: [...new Set(unrecognizedParameters)].slice(0, 8),
    };
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(Object.freeze(normalized));
  }
  return output;
}

function issuerText(value: unknown): string {
  const issuer = record(value);
  return text(
    issuer.organization
      ?? issuer.O
      ?? issuer.commonName
      ?? issuer.CN
      ?? issuer.name,
    240,
  );
}

function issuerIdentifiers(value: string): string[] {
  const identifiers = KNOWN_ISSUERS
    .filter((item) => item.pattern.test(value))
    .flatMap((item) => item.identifiers);
  return [...new Set(identifiers)].sort();
}

function dnsSettled(value: JsonRecord): boolean {
  const status = text(value.status, 40);
  return value.source === 'dns'
    && value.complete === true
    && value.truncated !== true
    && ['success', 'not_found'].includes(status);
}

function caaFinding(input: Readonly<{
  dnsEvidence: JsonRecord;
  records: CaaAuthorization[];
  issuer: string;
  wildcard: boolean;
  effectivePolicy: boolean;
  effectiveOwner: string;
}>): CertificatePolicyFinding {
  const fixedLimitations = [
    'The comparison uses current point-in-time CAA and certificate evidence and cannot establish which policy applied when the certificate was issued.',
    'WHOISleuth does not cryptographically verify issuance authorisation or infer improper issuance, compromise, or maliciousness.',
  ];
  if (!dnsSettled(input.dnsEvidence)) {
    return {
      id: 'caa',
      label: 'Current CAA and observed issuer',
      state: 'indeterminate',
      observed: input.issuer ? [input.issuer] : [],
      expected: [],
      detail: 'CAA collection was incomplete, unavailable, or truncated, so no current-policy comparison is available.',
      sources: ['DNS', 'TLS certificate'],
      limitations: fixedLimitations,
    };
  }
  const issue = input.records.filter((item) => item.tag === 'issue');
  const issueWild = input.records.filter((item) => item.tag === 'issuewild');
  const applicable = input.wildcard && issueWild.length ? issueWild : issue;
  if (!applicable.length) {
    return {
      id: 'caa',
      label: 'Current CAA and observed issuer',
      state: 'no_target_policy_observed',
      observed: input.issuer ? [input.issuer] : [],
      expected: [],
      detail: input.effectivePolicy
        ? 'No applicable CAA issue authorisation was observed in the completed effective-policy walk.'
        : 'No applicable CAA issue authorisation was observed at the queried domain. Parent-label inheritance was not collected, so this is not a conclusion that no effective CAA policy exists.',
      sources: ['DNS', 'TLS certificate'],
      limitations: input.effectivePolicy
        ? fixedLimitations
        : [
            ...fixedLimitations,
            'Parent-label CAA inheritance is outside the current settled evidence and remains unknown.',
          ],
    };
  }
  const expected = applicable.map((item) => item.issuer);
  const identifiers = issuerIdentifiers(input.issuer);
  if (!input.issuer || !identifiers.length) {
    return {
      id: 'caa',
      label: 'Current CAA and observed issuer',
      state: 'indeterminate',
      observed: input.issuer ? [input.issuer] : [],
      expected,
      detail: 'Current CAA authorisations were observed, but the certificate issuer could not be mapped conservatively to a recognised CAA identifier.',
      sources: ['DNS', 'TLS certificate'],
      limitations: fixedLimitations,
    };
  }
  const aligned = identifiers.some((identifier) => expected.includes(identifier));
  return {
    id: 'caa',
    label: 'Current CAA and observed issuer',
    state: aligned ? 'aligned' : 'apparently_outside_current_policy',
    observed: [input.issuer, ...identifiers],
    expected,
    detail: aligned
      ? `The observed certificate issuer maps to an authorization identifier published in the current CAA evidence${input.effectiveOwner ? ` at ${input.effectiveOwner}` : ''}.`
      : `The observed certificate issuer did not map to an authorization identifier in the current CAA evidence${input.effectiveOwner ? ` at ${input.effectiveOwner}` : ''}.`,
    sources: ['DNS', 'TLS certificate'],
    limitations: fixedLimitations,
  };
}

function exactBaselineFinding(input: Readonly<{
  id: 'expected_issuer' | 'expected_spki';
  label: string;
  observed: string;
  expected: string;
  source: string;
}>): CertificatePolicyFinding {
  if (!input.expected) {
    return {
      id: input.id,
      label: input.label,
      state: 'not_configured',
      observed: input.observed ? [input.observed] : [],
      expected: [],
      detail: 'No reviewed expected value is configured for this official domain.',
      sources: [input.source, 'Brand Profile'],
      limitations: ['An expected value is analyst-authored posture context, not externally verified ownership or control.'],
    };
  }
  if (!input.observed) {
    return {
      id: input.id,
      label: input.label,
      state: 'indeterminate',
      observed: [],
      expected: [input.expected],
      detail: 'An expected value is configured, but current settled evidence did not provide a comparable observation.',
      sources: [input.source, 'Brand Profile'],
      limitations: ['Unavailable current evidence is not treated as a change or mismatch.'],
    };
  }
  const aligned = input.observed.toLowerCase() === input.expected.toLowerCase();
  return {
    id: input.id,
    label: input.label,
    state: aligned ? 'aligned' : 'changed',
    observed: [input.observed],
    expected: [input.expected],
    detail: aligned
      ? 'The current observation matches the reviewed Brand Profile baseline.'
      : 'The current observation differs from the reviewed Brand Profile baseline.',
    sources: [input.source, 'Brand Profile'],
    limitations: ['A difference is a review lead and does not establish compromise, improper issuance, ownership, or maliciousness.'],
  };
}

export function certificateSanPatternMatches(pattern: string, observed: string): boolean {
  if (!pattern.startsWith('*.')) return pattern === observed;
  const suffix = pattern.slice(1);
  return observed.endsWith(suffix)
    && observed.slice(0, -suffix.length).length > 0
    && !observed.slice(0, -suffix.length).includes('.');
}

function sanBaselineFinding(
  observedNames: readonly string[],
  expectedPatterns: readonly string[],
): CertificatePolicyFinding {
  if (!expectedPatterns.length) {
    return {
      id: 'expected_san',
      label: 'Reviewed expected certificate names',
      state: 'not_configured',
      observed: observedNames,
      expected: [],
      detail: 'No reviewed SAN pattern is configured for this official domain.',
      sources: ['TLS certificate', 'Brand Profile'],
      limitations: ['SAN expectations are analyst-authored posture context, not externally verified ownership or control.'],
    };
  }
  if (!observedNames.length) {
    return {
      id: 'expected_san',
      label: 'Reviewed expected certificate names',
      state: 'indeterminate',
      observed: [],
      expected: expectedPatterns,
      detail: 'Expected SAN patterns are configured, but current settled TLS evidence did not provide comparable names.',
      sources: ['TLS certificate', 'Brand Profile'],
      limitations: ['Unavailable current evidence is not treated as a change or mismatch.'],
    };
  }
  const missing = expectedPatterns.filter((pattern) =>
    !observedNames.some((observed) => certificateSanPatternMatches(pattern, observed)));
  return {
    id: 'expected_san',
    label: 'Reviewed expected certificate names',
    state: missing.length ? 'changed' : 'aligned',
    observed: observedNames,
    expected: expectedPatterns,
    detail: missing.length
      ? `Current certificate names do not satisfy ${missing.length} reviewed SAN pattern${missing.length === 1 ? '' : 's'}.`
      : 'Current certificate names satisfy every reviewed SAN pattern.',
    sources: ['TLS certificate', 'Brand Profile'],
    limitations: [
      'Unexpected additional SANs remain visible for review but do not establish compromise, ownership, or maliciousness.',
      'A wildcard pattern matches exactly one label at its wildcard position.',
    ],
  };
}

export function buildCertificatePolicyReview(input: Readonly<{
  observedAt?: unknown;
  dnsEvidence?: unknown;
  dnsRecords?: unknown;
  tlsEvidence?: unknown;
  tlsIssuer?: unknown;
  tlsPublicKey?: unknown;
  tlsAltNames?: unknown;
  baseline?: DesiredPostureBaseline | null;
}>): CertificatePolicyReview {
  const dnsEvidence = record(input.dnsEvidence);
  const dnsRecords = record(input.dnsRecords);
  const tlsEvidence = record(input.tlsEvidence);
  const issuer = issuerText(input.tlsIssuer);
  const spki = text(record(input.tlsPublicKey).fingerprintSha256, 64).toLowerCase();
  const alternativeNames = record(input.tlsAltNames).dnsNames;
  const observedNames = Array.isArray(alternativeNames)
    ? [...new Set(alternativeNames
      .slice(0, 64)
      .map((item) => text(item, 253).toLowerCase().replace(/\.$/u, ''))
      .filter(Boolean))]
    : [];
  const wildcard = observedNames.some((item) => item.startsWith('*.'));
  const caaPolicy = record(dnsEvidence.caaPolicy);
  const effectivePolicy = caaPolicy.policyVersion === 1;
  const records = parseCaaAuthorizations(effectivePolicy ? caaPolicy.records : dnsRecords.caa);
  const policyEvidence = effectivePolicy ? caaPolicy : dnsEvidence;
  const findings: CertificatePolicyFinding[] = [
    caaFinding({
      dnsEvidence: policyEvidence,
      records,
      issuer,
      wildcard,
      effectivePolicy,
      effectiveOwner: text(caaPolicy.effectiveOwner, 253),
    }),
  ];
  if (input.baseline) {
    findings.push(
      exactBaselineFinding({
        id: 'expected_issuer',
        label: 'Reviewed expected certificate issuer',
        observed: issuer,
        expected: input.baseline.tlsIssuer,
        source: 'TLS certificate',
      }),
      sanBaselineFinding(observedNames, input.baseline.tlsSanPatterns),
      exactBaselineFinding({
        id: 'expected_spki',
        label: 'Reviewed expected certificate public key',
        observed: spki,
        expected: input.baseline.tlsSpkiSha256,
        source: 'TLS certificate',
      }),
    );
  }
  return {
    version: 2,
    observedAt: timestamp(tlsEvidence.observedAt ?? dnsEvidence.observedAt ?? input.observedAt),
    findings,
    caaAuthorizations: records,
    limitations: [
      'CAA, TLS, and reviewed baseline observations can have different effective times.',
      'Current CAA cannot prove the policy that applied when an existing certificate was issued.',
      'CAA account URIs and validation methods describe current authorisation constraints; WHOISleuth does not test an account, issuance transaction, or challenge method.',
      'No finding changes Risk automatically.',
    ],
  };
}
