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

function sourceState(value) {
  if (value === null || value === undefined || value === '') return 'absent';
  if (Array.isArray(value) && value.length === 0) return 'absent';
  if (isRedacted(value)) return 'redacted';
  return 'value';
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

function displayValue(value) {
  const state = sourceState(value);
  if (state === 'absent') return 'Not published';
  if (state === 'redacted') return 'Redacted by source';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function findRdapEvent(rdap, action) {
  const event = Array.isArray(rdap?.events) ? rdap.events.find((item) => item.action === action) : null;
  return event?.date || null;
}

// Classifies every reachable (rdapState, whoisState) pair other than
// absent/absent (filtered out by the caller before this runs). Conflict and
// equivalent need both sides to actually hold a comparable value; every
// other combination is classified by which side is redacted or missing,
// since "redacted" and "absent" are different reasons a comparison can't be
// made and the UI (and the field counts below) should be able to tell them
// apart rather than lumping every non-conflicting case into one bucket.
function classifyFieldStatus(rdapState, whoisState, rdapValue, whoisValue, normalize) {
  if (rdapState === 'value' && whoisState === 'value') {
    return sameNormalizedValue(normalize(rdapValue), normalize(whoisValue)) ? 'equivalent' : 'conflict';
  }
  if (rdapState === 'redacted' && whoisState === 'redacted') return 'equivalent';
  if (rdapState === 'value' && whoisState === 'absent') return 'rdap_only';
  if (whoisState === 'value' && rdapState === 'absent') return 'whois_only';
  if (rdapState === 'redacted') return 'rdap_redacted';
  return 'whois_redacted';
}

function compareField(label, rdapValue, whoisValue, normalize) {
  const rdapState = sourceState(rdapValue);
  const whoisState = sourceState(whoisValue);
  if (rdapState === 'absent' && whoisState === 'absent') return null;

  return {
    label,
    status: classifyFieldStatus(rdapState, whoisState, rdapValue, whoisValue, normalize),
    rdapState,
    whoisState,
    rdapDisplay: displayValue(rdapValue),
    whoisDisplay: displayValue(whoisValue),
  };
}

export function compareRegistrySources(rdapParsed, whoisParsed) {
  const rdap = rdapParsed || {};
  const whois = whoisParsed || {};
  const fields = [
    compareField('Domain', rdap.domain, whois.domainName, normalizeDomain),
    compareField('Registrar', registrarValue(rdap.registrar), whois.registrar, normalizeText),
    compareField('Created', findRdapEvent(rdap, 'registration'), whois.createdDate, normalizeDate),
    compareField('Expires', findRdapEvent(rdap, 'expiration'), whois.expiryDate, normalizeDate),
    compareField('Last updated', findRdapEvent(rdap, 'last changed'), whois.updatedDate, normalizeDate),
    compareField('DNSSEC', rdap.dnssec, whois.dnssec, normalizeDnssec),
    compareField('Statuses', rdap.statuses, whois.statuses, (values) => normalizeSet(values, normalizeStatus)),
    compareField('Name servers', rdap.nameservers, whois.nameservers, (values) => normalizeSet(values, normalizeNameserver)),
  ].filter((field) => field !== null);

  const counts = { equivalent: 0, conflict: 0, rdap_only: 0, whois_only: 0, rdap_redacted: 0, whois_redacted: 0 };
  for (const field of fields) counts[field.status] += 1;
  return { fields, counts };
}
