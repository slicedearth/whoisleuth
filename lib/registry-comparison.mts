// Normalized comparison of the domain fields published by RDAP and WHOIS.
// Registries routinely express the same value with different punctuation,
// casing, ordering, or timestamp precision, so comparisons happen on a
// canonical form while consumers retain the original source values.

const REDACTION_MARKERS = [
  /redacted/i,
  /data protected/i,
  /privacy protect/i,
  /not disclosed/i,
  /not published/i,
  /masked/i,
];

type LooseRecord = Record<string, any>;
type PublishedState = 'absent' | 'redacted' | 'value';
type SourceCondition = 'complete' | 'incomplete' | 'unavailable';
type FieldState = PublishedState | Exclude<SourceCondition, 'complete'>;
type FieldStatus =
  | 'equivalent' | 'conflict' | 'rdap_only' | 'whois_only'
  | 'rdap_redacted' | 'whois_redacted'
  | 'rdap_unavailable' | 'whois_unavailable'
  | 'rdap_incomplete' | 'whois_incomplete';
type RegistryComparisonOptions = { rdapStatus?: unknown; whoisStatus?: unknown };
type RdapPublicationComparisonOptions = { registryStatus?: unknown; registrarStatus?: unknown };
type SourceHealth = {
  rdapStatus: unknown;
  whoisStatus: unknown;
  rdapCondition: SourceCondition;
  whoisCondition: SourceCondition;
};

function isRedacted(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return REDACTION_MARKERS.some((re) => re.test(value));
}

function publishedState(value: unknown): PublishedState {
  if (value === null || value === undefined || value === '') return 'absent';
  if (Array.isArray(value) && value.length === 0) return 'absent';
  if (isRedacted(value)) return 'redacted';
  return 'value';
}

function sourceCondition(status: unknown): SourceCondition {
  if (status === 'partial') return 'incomplete';
  if (typeof status === 'string' && ['error', 'unsupported', 'not_found', 'skipped', 'disabled'].includes(status)) return 'unavailable';
  return 'complete';
}

function fieldState(value: unknown, condition: SourceCondition): FieldState {
  const state = publishedState(value);
  return state === 'absent' && condition !== 'complete' ? condition : state;
}

function registrarValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value || null;
  const record = value as LooseRecord;
  return record.name || record.org || record.handle || null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeDomain(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\.+$/, '') : null;
}

// Registry timestamps may be a date, an ISO timestamp, or a timestamp with
// different precision. Registration lifecycle comparisons only need the UTC
// calendar date; comparing milliseconds would turn equivalent publication
// formats into false conflicts.
function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const ymd = trimmed.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return normalizeText(trimmed);
}

function normalizeDnssec(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/unsigned|not signed|insecure/.test(normalized)) return 'unsigned';
  if (/signed|secure/.test(normalized)) return 'signed';
  return normalized;
}

function normalizeStatus(value: unknown): string | null {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    : null;
}

function normalizeNameserver(value: unknown): string | null {
  return normalizeDomain(value);
}

function normalizeSet(values: unknown, normalizeItem: (value: unknown) => string | null): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeItem).filter((value): value is string => Boolean(value)))].sort();
}

function sameNormalizedValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function displayValue(value: unknown, state: FieldState, status: unknown): string {
  if (state === 'absent') return 'Not published';
  if (state === 'redacted') return 'Redacted by source';
  if (state === 'incomplete') return 'Not observed (partial source)';
  if (state === 'unavailable') {
    if (status === 'unsupported') return 'Unsupported by source';
    if (status === 'not_found') return 'No matching registry object';
    if (status === 'skipped') return 'Source skipped';
    if (status === 'disabled') return 'Disabled by deployment policy';
    return 'Source unavailable';
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function findRdapEvent(rdap: LooseRecord, action: string): unknown {
  const event = Array.isArray(rdap?.events) ? rdap.events.find((item) => item.action === action) : null;
  return event?.date || null;
}

function rdapLifecycleDate(rdap: LooseRecord, field: string, fallbackAction: string): unknown {
  const value = rdap?.lifecycle?.[field];
  return typeof value === 'string' && value ? value : findRdapEvent(rdap, fallbackAction);
}

// Conflict and equivalence require values from both sources. Missing fields
// in a failed, unsupported, skipped, not-found, or partial source are not
// publication differences: preserving that source health prevents a lookup
// failure from being presented as an RDAP/WHOIS disagreement.
function classifyFieldStatus(
  rdapState: FieldState,
  whoisState: FieldState,
  rdapValue: unknown,
  whoisValue: unknown,
  normalize: (value: unknown) => unknown,
): FieldStatus {
  if (rdapState === 'value' && whoisState === 'value') {
    return sameNormalizedValue(normalize(rdapValue), normalize(whoisValue)) ? 'equivalent' : 'conflict';
  }
  if (rdapState === 'redacted' && whoisState === 'redacted') return 'equivalent';
  if (rdapState === 'unavailable') return 'rdap_unavailable';
  if (whoisState === 'unavailable') return 'whois_unavailable';
  if (rdapState === 'incomplete') return 'rdap_incomplete';
  if (whoisState === 'incomplete') return 'whois_incomplete';
  if (rdapState === 'value' && whoisState === 'absent') return 'rdap_only';
  if (whoisState === 'value' && rdapState === 'absent') return 'whois_only';
  if (rdapState === 'redacted') return 'rdap_redacted';
  return 'whois_redacted';
}

function compareField(
  label: string,
  rdapValue: unknown,
  whoisValue: unknown,
  normalize: (value: unknown) => unknown,
  sourceHealth: SourceHealth,
  comparisonValues: { rdap?: unknown; whois?: unknown } = {},
) {
  const rdapPublishedState = publishedState(rdapValue);
  const whoisPublishedState = publishedState(whoisValue);
  if (rdapPublishedState === 'absent' && whoisPublishedState === 'absent') return null;

  const rdapState = fieldState(rdapValue, sourceHealth.rdapCondition);
  const whoisState = fieldState(whoisValue, sourceHealth.whoisCondition);

  return {
    label,
    status: classifyFieldStatus(
      rdapState,
      whoisState,
      comparisonValues.rdap ?? rdapValue,
      comparisonValues.whois ?? whoisValue,
      normalize
    ),
    rdapState,
    whoisState,
    rdapDisplay: displayValue(rdapValue, rdapState, sourceHealth.rdapStatus),
    whoisDisplay: displayValue(whoisValue, whoisState, sourceHealth.whoisStatus),
  };
}

export function compareRegistrySources(
  rdapParsed: LooseRecord | null | undefined,
  whoisParsed: LooseRecord | null | undefined,
  options: RegistryComparisonOptions = {},
) {
  const rdap: LooseRecord = rdapParsed || {};
  const whois: LooseRecord = whoisParsed || {};
  const sourceHealth = {
    rdapStatus: options.rdapStatus || null,
    whoisStatus: options.whoisStatus || null,
    rdapCondition: sourceCondition(options.rdapStatus),
    whoisCondition: sourceCondition(options.whoisStatus),
  };
  const dateField = (label: string, field: string, fallbackAction: string) => {
    const rdapValue = rdapLifecycleDate(rdap, field, fallbackAction);
    const whoisValue = whois[field] || whois.lifecycle?.[field] || null;
    return compareField(label, rdapValue, whoisValue, normalizeDate, sourceHealth, {
      rdap: rdap.lifecycle?.[`${field}Iso`] || rdapValue,
      whois: whois[`${field}Iso`] || whois.lifecycle?.[`${field}Iso`] || whoisValue,
    });
  };
  const fields = [
    compareField('Domain', rdap.domain, whois.domainName, normalizeDomain, sourceHealth),
    compareField('Registry object ID', rdap.handle, whois.registryDomainId, normalizeText, sourceHealth),
    compareField('Registrar', registrarValue(rdap.registrar), whois.registrar, normalizeText, sourceHealth),
    compareField('Registrar IANA ID', rdap.registrarIanaId, whois.registrarIanaId, normalizeText, sourceHealth),
    dateField('Created', 'createdDate', 'registration'),
    dateField('Expires', 'expiryDate', 'expiration'),
    dateField('Last updated', 'updatedDate', 'last changed'),
    compareField('DNSSEC', rdap.dnssec, whois.dnssec, normalizeDnssec, sourceHealth),
    compareField('Statuses', rdap.statuses, whois.statuses, (values) => normalizeSet(values, normalizeStatus), sourceHealth),
    compareField('Name servers', rdap.nameservers, whois.nameservers, (values) => normalizeSet(values, normalizeNameserver), sourceHealth),
  ].filter((field) => field !== null);

  const counts: Record<FieldStatus, number> = {
    equivalent: 0, conflict: 0, rdap_only: 0, whois_only: 0,
    rdap_redacted: 0, whois_redacted: 0,
    rdap_unavailable: 0, whois_unavailable: 0,
    rdap_incomplete: 0, whois_incomplete: 0,
  };
  for (const field of fields) counts[field.status] += 1;
  return {
    fields,
    counts,
    sourceHealth: {
      rdap: { status: sourceHealth.rdapStatus, condition: sourceHealth.rdapCondition },
      whois: { status: sourceHealth.whoisStatus, condition: sourceHealth.whoisCondition },
    },
  };
}

const RDAP_PUBLICATION_STATUS = {
  equivalent: 'equivalent',
  conflict: 'conflict',
  rdap_only: 'registry_only',
  whois_only: 'registrar_only',
  rdap_redacted: 'registry_redacted',
  whois_redacted: 'registrar_redacted',
  rdap_unavailable: 'registry_unavailable',
  whois_unavailable: 'registrar_unavailable',
  rdap_incomplete: 'registry_incomplete',
  whois_incomplete: 'registrar_incomplete',
} as const;

type RdapPublicationStatus = typeof RDAP_PUBLICATION_STATUS[keyof typeof RDAP_PUBLICATION_STATUS];

// Registrar RDAP is a separately attributed publication, not a replacement
// for the registry object. Reuse the established pairwise normalization while
// adapting only fields with portable semantics across both RDAP publishers.
// Source-specific object handles and contact inventories stay out of conflict
// classification because different identifiers and disclosure policies are
// expected at each layer.
export function compareRdapPublications(
  registryParsed: LooseRecord | null | undefined,
  registrarParsed: LooseRecord | null | undefined,
  options: RdapPublicationComparisonOptions = {},
) {
  const registry = registryParsed || {};
  const registrar = registrarParsed || {};
  const registrarLifecycle = registrar.lifecycle || {};
  const comparison = compareRegistrySources(
    { ...registry, handle: null },
    {
      domainName: registrar.domain,
      registrar: registrarValue(registrar.registrar),
      registrarIanaId: registrar.registrarIanaId,
      createdDate: registrarLifecycle.createdDate,
      createdDateIso: registrarLifecycle.createdDateIso,
      expiryDate: registrarLifecycle.expiryDate,
      expiryDateIso: registrarLifecycle.expiryDateIso,
      updatedDate: registrarLifecycle.updatedDate,
      updatedDateIso: registrarLifecycle.updatedDateIso,
      dnssec: registrar.dnssec,
      statuses: registrar.statuses,
      nameservers: registrar.nameservers,
    },
    {
      rdapStatus: options.registryStatus,
      whoisStatus: options.registrarStatus,
    },
  );

  const counts: Record<RdapPublicationStatus, number> = {
    equivalent: 0,
    conflict: 0,
    registry_only: 0,
    registrar_only: 0,
    registry_redacted: 0,
    registrar_redacted: 0,
    registry_unavailable: 0,
    registrar_unavailable: 0,
    registry_incomplete: 0,
    registrar_incomplete: 0,
  };
  const fields = comparison.fields.map((field) => {
    const status = RDAP_PUBLICATION_STATUS[field.status];
    counts[status] += 1;
    return {
      label: field.label,
      status,
      registryState: field.rdapState,
      registrarState: field.whoisState,
      registryDisplay: field.rdapDisplay,
      registrarDisplay: field.whoisDisplay,
    };
  });

  return {
    fields,
    counts,
    sourceHealth: {
      registry: comparison.sourceHealth.rdap,
      registrar: comparison.sourceHealth.whois,
    },
  };
}
