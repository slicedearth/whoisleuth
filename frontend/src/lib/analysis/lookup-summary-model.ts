import {
  fmtAge,
  fmtExpiresIn,
  formatActivityCell,
  formatPrivacyCell,
} from './scoring.ts';

export type LookupSummarySignal = Readonly<{
  label: string;
  tone: 'danger' | 'good' | 'neutral' | 'warn';
  detail?: string;
}>;

export type LookupSummaryFact = Readonly<{
  label: string;
  value: string;
  detail: string;
  provenance: LookupFactProvenance;
}>;

export type LookupFactProvenance = Readonly<{
  sources: readonly string[];
  observedAt: string;
  fieldFamilies: readonly string[];
  normalization: string;
  completeness: string;
  limitations: readonly string[];
  conflicts: readonly string[];
  decisionImpact: string;
}>;

export type LookupDiagnosticAttempt = Readonly<{
  endpoint: string;
  outcome: string;
  detail: string;
}>;

export type LookupSourceDiagnostic = Readonly<{
  source: string;
  status: string;
  label: string;
  detail: string;
  endpoint: string;
  route: string;
  observedAt: string;
  conformance: readonly string[];
  limitations: readonly string[];
  attempts: readonly LookupDiagnosticAttempt[];
}>;

export type LookupSummaryModel = Readonly<{
  signals: readonly LookupSummarySignal[];
  facts: readonly LookupSummaryFact[];
  diagnostics: readonly LookupSourceDiagnostic[];
}>;

export type LookupSummaryInput = Readonly<{
  availability?: unknown;
  createdDate?: unknown;
  diagnostics?: unknown;
  expiresDate?: unknown;
  idnAnalysis?: unknown;
  profileSignals?: unknown;
  rdapParsed?: unknown;
  registrarRdap?: unknown;
  registryComparison?: unknown;
  registrarPublicationComparison?: unknown;
  resultObservedAt?: unknown;
  updatedDate?: unknown;
  whoisParsed?: unknown;
}>;

type JsonRecord = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_SIGNALS = 12;
const MAX_PROVENANCE_ITEMS = 8;
const MAX_PROVENANCE_TEXT = 320;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function boundedText(value: unknown, maximum = 320): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((item) => boundedText(item, 120)).filter(Boolean).join(', ') || '—';
  }
  if (typeof value === 'object') {
    const item = record(value);
    return display(item.name || item.org || item.handle || item.domain);
  }
  return boundedText(value) || '—';
}

function textOrNull(value: unknown): string | null {
  const valueText = typeof value === 'string' ? boundedText(value) : '';
  return valueText || null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.slice(0, 24).map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function textList(value: unknown, maximum = MAX_PROVENANCE_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = boundedText(item, MAX_PROVENANCE_TEXT);
    if (!text || seen.has(text)) continue;
    output.push(text);
    seen.add(text);
    if (output.length >= maximum) break;
  }
  return output;
}

function formatDate(value: unknown): string {
  if (!value) return '—';
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? boundedText(value) || '—' : parsed.toLocaleString();
}

function statusLabel(value: unknown): string {
  return boundedText(value, 64).replaceAll('_', ' ') || 'unknown';
}

function diagnosticDetail(value: unknown): string {
  const source = record(value);
  const attempts = Array.isArray(source.attempts)
    ? source.attempts.slice(0, 8).map((attempt) => (
      statusLabel(record(attempt).outcome)
    )).join(' → ')
    : '';
  const parts = [
    boundedText(source.endpoint, 2_048),
    source.transportSecurity === 'http' ? 'transport: cleartext HTTP' : '',
    typeof source.httpStatus === 'number' ? `HTTP ${source.httpStatus}` : '',
    attempts ? `attempts: ${attempts}` : '',
    source.resultState ? `result: ${boundedText(source.resultState, 80)}` : '',
    boundedText(source.errorCode, 120),
    source.authoritativeHop ? `authoritative: ${display(source.authoritativeHop)}` : '',
    source.failedHop ? `failed: ${display(source.failedHop)}` : '',
    source.fetchedAt ? `fetched ${formatDate(source.fetchedAt)}` : '',
    source.queriedAt ? `queried ${formatDate(source.queriedAt)}` : '',
  ].filter(Boolean);
  return boundedText(parts.join(' · '), 2_400) || 'No additional source detail';
}

function sourceLabel(value: unknown): string {
  return {
    dns: 'Authoritative DNS delegation',
    rdap: 'Registry RDAP',
    whois: 'WHOIS',
  }[boundedText(value, 32)] || 'No conclusive registration source';
}

function sourceObservation(
  source: unknown,
  diagnostics: JsonRecord,
  fallback: unknown,
): string {
  const sourceId = boundedText(source, 32);
  const diagnostic = sourceId === 'dns'
    ? record(diagnostics.availability)
    : record(diagnostics[sourceId]);
  return formatDate(
    diagnostic.fetchedAt
      || diagnostic.queriedAt
      || diagnostic.observedAt
      || fallback,
  );
}

function sourceCompleteness(source: unknown, diagnostics: JsonRecord): string {
  const sourceId = boundedText(source, 32);
  const diagnostic = sourceId === 'dns'
    ? record(diagnostics.availability)
    : record(diagnostics[sourceId]);
  return statusLabel(diagnostic.status);
}

function registryLimitations(
  availability: JsonRecord,
  rdapParsed: JsonRecord,
  whoisParsed: JsonRecord,
): string[] {
  const output = [
    ...textList(availability.limitations),
    ...textList(whoisParsed.limitations),
  ];
  if (rdapParsed.serverTruncated === true) {
    output.push('The registry declared that the RDAP response omitted some data.');
    output.push(...textList(rdapParsed.serverTruncationReasons));
  }
  return textList(output);
}

function comparisonConflicts(value: unknown, labels: readonly string[]): string[] {
  const accepted = new Set(labels);
  return records(record(value).fields)
    .filter((field) => accepted.has(boundedText(field.label, 120)))
    .filter((field) => boundedText(field.status, 64) === 'conflict')
    .map((field) => boundedText(
      field.assessment
        || `${display(field.rdapDisplay || field.registryDisplay)} differs from ${display(field.whoisDisplay || field.registrarDisplay)}`,
      MAX_PROVENANCE_TEXT,
    ))
    .filter(Boolean)
    .slice(0, MAX_PROVENANCE_ITEMS);
}

function factProvenance(input: Readonly<{
  source: unknown;
  diagnostics: JsonRecord;
  observedAt: unknown;
  fields: readonly string[];
  normalization: string;
  limitations: readonly string[];
  conflicts?: readonly string[];
  decisionImpact: string;
}>): LookupFactProvenance {
  return {
    sources: [sourceLabel(input.source)],
    observedAt: sourceObservation(input.source, input.diagnostics, input.observedAt),
    fieldFamilies: input.fields.map((item) => boundedText(item, 160)).filter(Boolean),
    normalization: boundedText(input.normalization, MAX_PROVENANCE_TEXT),
    completeness: sourceCompleteness(input.source, input.diagnostics),
    limitations: textList(input.limitations),
    conflicts: textList(input.conflicts),
    decisionImpact: boundedText(input.decisionImpact, MAX_PROVENANCE_TEXT),
  };
}

function pushSignal(
  signals: LookupSummarySignal[],
  signal: LookupSummarySignal | null,
): void {
  if (signal && signals.length < MAX_SIGNALS) signals.push(signal);
}

function buildSignals(
  availability: JsonRecord,
  profileSignals: JsonRecord,
  idnAnalysis: JsonRecord,
): LookupSummarySignal[] {
  const signals: LookupSummarySignal[] = [];
  const trusted = boundedText(profileSignals.trusted, 80);
  if (trusted) pushSignal(signals, { label: `Trusted ${trusted}`, tone: 'good' });
  if (profileSignals.faviconMatch === true) {
    pushSignal(signals, { label: 'Favicon match', tone: 'danger' });
  } else if (profileSignals.faviconNearMatch === true) {
    pushSignal(signals, { label: 'Favicon near-match', tone: 'warn' });
  }
  if (profileSignals.reusesOfficialAssets === true) {
    pushSignal(signals, { label: 'Reuses official assets', tone: 'danger' });
  }
  if (availability.hasPasswordField === true) {
    pushSignal(signals, { label: 'Password field', tone: 'warn' });
  }
  const phishingLanguage = textOrNull(availability.phishingLanguageMatch);
  if (phishingLanguage) {
    pushSignal(signals, {
      label: 'Phishing language',
      tone: 'danger',
      detail: phishingLanguage,
    });
  }
  if (idnAnalysis.mixedScript === true) {
    pushSignal(signals, {
      label: 'Mixed-script IDN',
      tone: 'warn',
      detail: 'The Unicode label combines writing scripts.',
    });
  }
  if (Array.isArray(idnAnalysis.referenceMatches) && idnAnalysis.referenceMatches.length > 0) {
    pushSignal(signals, {
      label: 'Official-domain skeleton match',
      tone: 'warn',
      detail: 'A bounded visual skeleton matches an official domain in the active brand profile.',
    });
  }

  const domainAgeDays = typeof availability.domainAgeDays === 'number'
    ? availability.domainAgeDays
    : null;
  const age = fmtAge(domainAgeDays);
  if (age) pushSignal(signals, { label: age, tone: 'neutral' });

  const expiresInDays = typeof availability.expiresInDays === 'number'
    ? availability.expiresInDays
    : null;
  const expiry = fmtExpiresIn(expiresInDays);
  if (expiry && expiresInDays !== null) {
    pushSignal(signals, {
      label: expiry,
      tone: expiresInDays <= 60 ? 'warn' : 'neutral',
    });
  }

  if (typeof availability.privacyProtected === 'boolean') {
    pushSignal(signals, {
      label: formatPrivacyCell(availability.privacyProtected),
      tone: 'neutral',
    });
  }

  const activityStatus = textOrNull(availability.activityStatus);
  if (activityStatus) {
    const detail = textOrNull(availability.websiteProbeDetail);
    pushSignal(signals, {
      label: formatActivityCell(
        activityStatus,
        availability.hasMx === true,
        availability.hasSpf === true,
        availability.hasDmarc === true,
      ),
      tone: 'neutral',
      ...(detail ? { detail } : {}),
    });
  }
  return signals;
}

function diagnosticAttempts(value: unknown): LookupDiagnosticAttempt[] {
  return records(value).slice(0, 8).map((attempt) => ({
    endpoint: boundedText(attempt.endpoint, 2_048) || 'Endpoint not recorded',
    outcome: statusLabel(attempt.outcome),
    detail: boundedText(
      typeof attempt.status === 'number'
        ? `HTTP ${attempt.status}${attempt.detail ? ` · ${boundedText(attempt.detail, 240)}` : ''}`
        : attempt.detail,
      MAX_PROVENANCE_TEXT,
    ) || 'No additional attempt detail',
  }));
}

function buildDiagnostics(
  diagnostics: JsonRecord,
  rdapParsed: JsonRecord,
  whoisParsed: JsonRecord,
  registrarRdap: JsonRecord,
): LookupSourceDiagnostic[] {
  const sources: LookupSourceDiagnostic[] = ['rdap', 'whois', 'availability'].map((source) => {
    const item = record(diagnostics[source]);
    const status = boundedText(item.status, 64);
    const isRdap = source === 'rdap';
    const isWhois = source === 'whois';
    return {
      source,
      status,
      label: statusLabel(status),
      detail: diagnosticDetail(item),
      endpoint: boundedText(item.endpoint, 2_048),
      route: isRdap
        ? 'The endpoint was selected through IANA RDAP bootstrap discovery and bounded endpoint failover.'
        : isWhois
          ? 'The response follows the bounded WHOIS registry and referral chain shown below.'
          : 'This derived state applies the authority-aware availability rules to the collected registration evidence.',
      observedAt: formatDate(item.fetchedAt || item.queriedAt || item.observedAt),
      conformance: isRdap ? textList(rdapParsed.conformance) : [],
      limitations: isRdap
        ? registryLimitations({}, rdapParsed, {})
        : isWhois
          ? textList(whoisParsed.limitations)
          : [],
      attempts: diagnosticAttempts(item.attempts),
    };
  });
  if (registrarRdap.status) {
    const registrarDiagnostic = record(record(diagnostics.rdap).registrar);
    const status = boundedText(registrarRdap.status || registrarDiagnostic.status, 64);
    sources.push({
      source: 'registrar RDAP',
      status,
      label: statusLabel(status),
      detail: diagnosticDetail(registrarDiagnostic),
      endpoint: boundedText(registrarRdap.endpoint || registrarDiagnostic.endpoint, 2_048),
      route: 'This is a separately attributed registrar publication discovered from the registry RDAP response.',
      observedAt: formatDate(registrarRdap.fetchedAt || registrarDiagnostic.fetchedAt),
      conformance: textList(record(registrarRdap.parsed).conformance),
      limitations: textList(registrarRdap.limitations),
      attempts: diagnosticAttempts(
        registrarRdap.attempt ? [registrarRdap.attempt] : registrarDiagnostic.attempts,
      ),
    });
  }
  const reverseDns = record(diagnostics.reverseDns);
  if (reverseDns.status) {
    const status = boundedText(reverseDns.status, 64);
    sources.push({
      source: 'reverse DNS',
      status,
      label: statusLabel(status),
      detail: diagnosticDetail(reverseDns),
      endpoint: '',
      route: 'PTR evidence is non-authoritative context published by the address operator.',
      observedAt: formatDate(reverseDns.observedAt),
      conformance: [],
      limitations: [],
      attempts: [],
    });
  }
  return sources;
}

export function buildLookupSummaryModel(input: LookupSummaryInput): LookupSummaryModel {
  const availability = record(input.availability);
  const rdapParsed = record(input.rdapParsed);
  const whoisParsed = record(input.whoisParsed);
  const diagnostics = record(input.diagnostics);
  const source = availability.source;
  const limitations = registryLimitations(availability, rdapParsed, whoisParsed);
  const registryComparison = input.registryComparison;
  const registrarPublicationComparison = input.registrarPublicationComparison;
  return {
    signals: buildSignals(
      availability,
      record(input.profileSignals),
      record(input.idnAnalysis),
    ),
    facts: [
      {
        label: 'Registration',
        value: display(availability.state || whoisParsed.registrationStatus),
        detail: `${display(availability.confidence)} confidence`,
        provenance: factProvenance({
          source,
          diagnostics,
          observedAt: input.resultObservedAt,
          fields: ['RDAP object state', 'WHOIS registration status', 'authoritative DNS delegation'],
          normalization: 'Authority-aware registration evidence is normalised into a stable availability state while inconclusive sources remain unknown.',
          limitations,
          conflicts: comparisonConflicts(registryComparison, ['Registration status']),
          decisionImpact: 'This is the authority-aware input to the availability result. This inspector does not recalculate or override that decision.',
        }),
      },
      {
        label: 'Registrar',
        value: display(availability.registrar || rdapParsed.registrar || whoisParsed.registrar),
        detail: display(whoisParsed.registrarUrl),
        provenance: factProvenance({
          source,
          diagnostics,
          observedAt: input.resultObservedAt,
          fields: ['RDAP registrar entity', 'WHOIS Registrar', 'registrar RDAP registrar entity'],
          normalization: 'Structured registrar identities are reduced to a bounded display name while each registry, registrar, and WHOIS publication remains separate.',
          limitations,
          conflicts: [
            ...comparisonConflicts(registryComparison, ['Registrar', 'Registrar IANA ID']),
            ...comparisonConflicts(registrarPublicationComparison, ['Registrar', 'Registrar IANA ID']),
          ],
          decisionImpact: 'Registrar identity is investigative and contact context. It does not decide whether the domain exists or establish ownership.',
        }),
      },
      {
        label: 'Created',
        value: formatDate(input.createdDate),
        detail: fmtAge(
          typeof availability.domainAgeDays === 'number' ? availability.domainAgeDays : null,
        ) || 'Registry lifecycle date',
        provenance: factProvenance({
          source,
          diagnostics,
          observedAt: input.resultObservedAt,
          fields: ['RDAP registration event or lifecycle', 'WHOIS creation-date family'],
          normalization: 'Recognised lifecycle dates are parsed into an ISO-compatible instant when possible; the original source publication remains authoritative.',
          limitations,
          conflicts: comparisonConflicts(registryComparison, ['Created']),
          decisionImpact: 'Domain age may contribute to an explainable score factor. It does not prove intent, ownership, or continuous operation.',
        }),
      },
      {
        label: 'Expires',
        value: formatDate(input.expiresDate),
        detail: fmtExpiresIn(
          typeof availability.expiresInDays === 'number' ? availability.expiresInDays : null,
        ) || 'Registry lifecycle date',
        provenance: factProvenance({
          source,
          diagnostics,
          observedAt: input.resultObservedAt,
          fields: ['RDAP expiration event or lifecycle', 'WHOIS expiry-date family'],
          normalization: 'Recognised expiry dates are parsed into an ISO-compatible instant when possible without predicting deletion or release.',
          limitations,
          conflicts: comparisonConflicts(registryComparison, ['Expires']),
          decisionImpact: 'Expiry proximity may contribute to an explainable opportunity factor. It does not predict renewal, deletion, release, price, or eligibility.',
        }),
      },
      {
        label: 'Updated',
        value: formatDate(input.updatedDate),
        detail: 'Most recent registry change',
        provenance: factProvenance({
          source,
          diagnostics,
          observedAt: input.resultObservedAt,
          fields: ['RDAP last-changed event or lifecycle', 'WHOIS updated-date family'],
          normalization: 'Recognised update dates are parsed into an ISO-compatible instant when possible and remain a source-reported lifecycle observation.',
          limitations,
          conflicts: comparisonConflicts(registryComparison, ['Updated']),
          decisionImpact: 'The update date is contextual evidence only and does not establish what changed or whether a website is active.',
        }),
      },
      {
        label: 'Website',
        value: display(availability.activityStatus),
        detail: display(availability.websiteProbeDetail),
        provenance: {
          sources: ['Bounded homepage and favicon observation'],
          observedAt: formatDate(input.resultObservedAt),
          fieldFamilies: ['HTTP response', 'redirect chain', 'bounded homepage body', 'favicon response'],
          normalization: 'Observed responses are classified into active, parked, inactive, or unknown context without executing page scripts.',
          completeness: availability.deepScanComplete === false ? 'partial' : 'complete',
          limitations: textList(record(availability.http).limitations),
          conflicts: [],
          decisionImpact: 'Website activity can inform explainable analysis. A failed or missing response never implies inactivity, safety, or domain availability.',
        },
      },
    ],
    diagnostics: buildDiagnostics(
      diagnostics,
      rdapParsed,
      whoisParsed,
      record(input.registrarRdap),
    ),
  };
}
