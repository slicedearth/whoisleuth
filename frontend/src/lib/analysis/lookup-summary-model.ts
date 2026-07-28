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
}>;

export type LookupSourceDiagnostic = Readonly<{
  source: string;
  status: string;
  label: string;
  detail: string;
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
  updatedDate?: unknown;
  whoisParsed?: unknown;
}>;

type JsonRecord = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_SIGNALS = 12;

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
      tone: availability.privacyProtected ? 'warn' : 'good',
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
      tone: activityStatus === 'active'
        ? 'good'
        : activityStatus === 'parked'
          ? 'warn'
          : 'neutral',
      ...(detail ? { detail } : {}),
    });
  }
  return signals;
}

function buildDiagnostics(diagnostics: JsonRecord): LookupSourceDiagnostic[] {
  const sources: LookupSourceDiagnostic[] = ['rdap', 'whois', 'availability'].map((source) => {
    const item = record(diagnostics[source]);
    const status = boundedText(item.status, 64);
    return {
      source,
      status,
      label: statusLabel(status),
      detail: diagnosticDetail(item),
    };
  });
  const reverseDns = record(diagnostics.reverseDns);
  if (reverseDns.status) {
    const status = boundedText(reverseDns.status, 64);
    sources.push({
      source: 'reverse DNS',
      status,
      label: statusLabel(status),
      detail: diagnosticDetail(reverseDns),
    });
  }
  return sources;
}

export function buildLookupSummaryModel(input: LookupSummaryInput): LookupSummaryModel {
  const availability = record(input.availability);
  const rdapParsed = record(input.rdapParsed);
  const whoisParsed = record(input.whoisParsed);
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
      },
      {
        label: 'Registrar',
        value: display(availability.registrar || rdapParsed.registrar || whoisParsed.registrar),
        detail: display(whoisParsed.registrarUrl),
      },
      {
        label: 'Created',
        value: formatDate(input.createdDate),
        detail: fmtAge(
          typeof availability.domainAgeDays === 'number' ? availability.domainAgeDays : null,
        ) || 'Registry lifecycle date',
      },
      {
        label: 'Expires',
        value: formatDate(input.expiresDate),
        detail: fmtExpiresIn(
          typeof availability.expiresInDays === 'number' ? availability.expiresInDays : null,
        ) || 'Registry lifecycle date',
      },
      {
        label: 'Updated',
        value: formatDate(input.updatedDate),
        detail: 'Most recent registry change',
      },
      {
        label: 'Website',
        value: display(availability.activityStatus),
        detail: display(availability.websiteProbeDetail),
      },
    ],
    diagnostics: buildDiagnostics(record(input.diagnostics)),
  };
}
