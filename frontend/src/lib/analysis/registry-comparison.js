// Normalized comparison of the domain fields published by RDAP and WHOIS.
// Registries routinely express the same value with different punctuation,
// casing, ordering, or timestamp precision, so comparisons happen on a
// canonical form while the UI retains the original source values.

const REDACTION_MARKERS = [
  /redacted/i,
  /data protected/i,
  /privacy protect/i,
  /not disclosed/i,
  /not published/i,
  /masked/i,
];

function isRedacted(value) {
  if (typeof value !== 'string') return false;
  return REDACTION_MARKERS.some((re) => re.test(value));
}

function publishedState(value) {
  if (value === null || value === undefined || value === '') return 'absent';
  if (Array.isArray(value) && value.length === 0) return 'absent';
  if (isRedacted(value)) return 'redacted';
  return 'value';
}

function sourceCondition(status) {
  if (status === 'partial') return 'incomplete';
  if (['error', 'unsupported', 'not_found', 'skipped', 'disabled'].includes(status)) return 'unavailable';
  return 'complete';
}

function fieldState(value, condition) {
  const state = publishedState(value);
  return state === 'absent' && condition !== 'complete' ? condition : state;
}

function registrarValue(value) {
  if (!value || typeof value !== 'object') return value || null;
  return value.name || value.org || value.handle || null;
}

function normalizeText(value) {
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

function normalizeDomain(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\.+$/, '') : null;
}

// Registry timestamps may be a date, an ISO timestamp, or a timestamp with
// different precision. Registration lifecycle comparisons only need the UTC
// calendar date; comparing milliseconds would turn equivalent publication
// formats into false conflicts.
function normalizeDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const ymd = trimmed.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return normalizeText(trimmed);
}

function normalizeDnssec(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/unsigned|not signed|insecure/.test(normalized)) return 'unsigned';
  if (/signed|secure/.test(normalized)) return 'signed';
  return normalized;
}

function normalizeStatus(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    : null;
}

function normalizeNameserver(value) {
  return normalizeDomain(value);
}

function normalizeSet(values, normalizeItem) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeItem).filter(Boolean))].sort();
}

function sameNormalizedValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function displayValue(value, state, status) {
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

function findRdapEvent(rdap, action) {
  const event = Array.isArray(rdap?.events) ? rdap.events.find((item) => item.action === action) : null;
  return event?.date || null;
}

function rdapLifecycleDate(rdap, field, fallbackAction) {
  const value = rdap?.lifecycle?.[field];
  return typeof value === 'string' && value ? value : findRdapEvent(rdap, fallbackAction);
}

// Conflict and equivalence require values from both sources. Missing fields
// in a failed, unsupported, skipped, not-found, or partial source are not
// publication differences: preserving that source health prevents a lookup
// failure from being presented as an RDAP/WHOIS disagreement.
function classifyFieldStatus(rdapState, whoisState, rdapValue, whoisValue, normalize) {
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

function compareField(label, rdapValue, whoisValue, normalize, sourceHealth, comparisonValues = {}) {
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

export function compareRegistrySources(rdapParsed, whoisParsed, options = {}) {
  const rdap = rdapParsed || {};
  const whois = whoisParsed || {};
  const sourceHealth = {
    rdapStatus: options.rdapStatus || null,
    whoisStatus: options.whoisStatus || null,
    rdapCondition: sourceCondition(options.rdapStatus),
    whoisCondition: sourceCondition(options.whoisStatus),
  };
  const dateField = (label, field, fallbackAction) => {
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

  const counts = {
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
