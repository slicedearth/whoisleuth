// Deterministic normalization for lifecycle dates published by RDAP and
// WHOIS services. Raw upstream strings remain the provenance source; these
// helpers only produce additive Date/ISO companions for comparison, storage,
// and presentation.

const REGISTRY_MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
});

function utcDateFromParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date | null {
  if (![year, month, day, hour, minute, second, millisecond].every(Number.isInteger)) return null;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1
    || hour < 0 || hour > 23 || minute < 0 || minute > 59
    || second < 0 || second > 59 || millisecond < 0 || millisecond > 999) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second || date.getUTCMilliseconds() !== millisecond) return null;
  return date;
}

// Parse the explicit non-ISO formats observed across supported ccTLD WHOIS
// services before considering ISO-shaped input. Runtime Date parsing treats
// dotted dates ambiguously and timezone-less timestamps in the host's local
// timezone, so every accepted shape is validated and normalized through UTC.
function parseRegistryDate(input: unknown): Date | null {
  if (typeof input !== 'string') return null;
  // The documented .nz WHOIS examples place one space before the RFC3339
  // `T` separator. Canonicalize that registry-specific presentation quirk
  // before applying the existing strict ISO-shaped parser.
  const value = input.trim().replace(
    /^(\d{4}-\d{2}-\d{2})[ ]+[Tt](?=\d{2}:)/,
    '$1T',
  );
  if (!value) return null;

  // DD.MM.YYYY[ HH:MM:SS] - e.g. 14.03.2024 10:46:48
  let match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (match) {
    const [, day, month, year, hour, minute, second] = match;
    return utcDateFromParts(+year, +month, +day, +(hour || 0), +(minute || 0), +(second || 0));
  }

  // YYYY. MM. DD. - e.g. 2006. 09. 18.
  match = value.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/);
  if (match) {
    const [, year, month, day] = match;
    return utcDateFromParts(+year, +month, +day);
  }

  // YYYY.MM.DD HH:MM:SS - used by NASK's .pl WHOIS service.
  match = value.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return utcDateFromParts(+year, +month, +day, +hour, +minute, +second);
  }

  // YYYY/MM/DD - an unambiguous year-first form used by CIRA WHOIS.
  match = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return utcDateFromParts(+year, +month, +day);
  }

  // YYYYMMDD with an optional time or Registro.br contact-reference suffix.
  // The raw value remains available as provenance while the validated date
  // and optional clock time are projected into the additive ISO companion.
  match = value.match(/^(\d{4})(\d{2})(\d{2})(?:\s+(\d{1,2}):(\d{2}):(\d{2})|\s+#[0-9]{1,20})?$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return utcDateFromParts(+year, +month, +day, +(hour || 0), +(minute || 0), +(second || 0));
  }

  // YYYY-Mon-DD. - e.g. 1999-Feb-16.
  match = value.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})\.?$/);
  if (match) {
    const month = REGISTRY_MONTHS[match[2].toLowerCase()];
    return month ? utcDateFromParts(+match[1], month, +match[3]) : null;
  }

  // DD-Mon-YYYY[ HH:MM:SS] - used by several ICANN-style ccTLD services.
  match = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (match) {
    const month = REGISTRY_MONTHS[match[2].toLowerCase()];
    return month
      ? utcDateFromParts(+match[3], month, +match[1], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0))
      : null;
  }

  // DD-MM-YYYY - an unambiguous day-first form published by ISOC-IL's
  // legacy WHOIS service. The four-digit year in the final position keeps
  // this distinct from the ISO year-first form handled below.
  match = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return utcDateFromParts(+year, +month, +day);
  }

  // Ddd Mon DD YYYY[ HH:MM:SS] - the English textual form used by the
  // Belgian registry. Weekday text is presentation-only; the validated
  // calendar components determine the canonical UTC companion.
  match = value.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/i);
  if (match) {
    const month = REGISTRY_MONTHS[match[1].toLowerCase()];
    return month
      ? utcDateFromParts(+match[3], month, +match[2], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0))
      : null;
  }

  // ISO 8601-shaped dates and timestamps. A missing timezone is deliberately
  // interpreted as UTC so Express and function deployments agree.
  match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?)?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zulu, offsetSign, offsetHours, offsetMinutes] = match;
  const millisecond = fraction ? Number(`${fraction}000`.slice(0, 3)) : 0;
  const local = utcDateFromParts(+year, +month, +day, +(hour || 0), +(minute || 0), +(second || 0), millisecond);
  if (!local) return null;
  if (!offsetSign || zulu) return local;
  const offsetHour = +offsetHours;
  const offsetMinute = +offsetMinutes;
  if (offsetHour > 23 || offsetMinute > 59) return null;
  const offsetMs = (offsetHour * 60 + offsetMinute) * 60000;
  return new Date(local.getTime() + (offsetSign === '+' ? -offsetMs : offsetMs));
}

function registryDateIso(value: unknown): string | null {
  const date = parseRegistryDate(value);
  return date ? date.toISOString() : null;
}

export { parseRegistryDate, registryDateIso };
