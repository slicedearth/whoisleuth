import { normalizeDomain } from './case-record-core.ts';

export const MAX_CANONICAL_DOMAIN_CONTROL_RECORDS = 32;

type RecordKind = 'caa' | 'ds' | 'mx';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum = 500): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || /[\u0000-\u001f\u007f]/u.test(value)) return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum).trim();
}

function integer(value: unknown, maximum: number): number | null {
  const candidate = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= maximum ? candidate : null;
}

function exchange(value: unknown): string {
  const candidate = text(value, 253).toLowerCase();
  if (candidate === '.') return '.';
  return normalizeDomain(candidate) ?? '';
}

export function canonicalMxRecord(value: unknown): string {
  const item = record(value);
  if (Object.keys(item).length) {
    const host = exchange(item.exchange ?? item.host ?? item.value);
    const priority = integer(item.priority ?? item.preference, 65_535);
    return host && priority !== null ? `${priority} ${host}` : '';
  }
  const candidate = text(value, 500).toLowerCase();
  const match = /^(\d{1,5})\s+(.+)$/u.exec(candidate);
  if (match) {
    const priority = integer(match[1], 65_535);
    const host = exchange(match[2]);
    return priority !== null && host ? `${priority} ${host}` : '';
  }
  return exchange(candidate);
}

function caaValue(value: unknown): string {
  return text(value, 500).replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2').trim().toLowerCase();
}

export function canonicalCaaRecord(value: unknown): string {
  const item = record(value);
  if (Object.keys(item).length) {
    const flags = integer(item.critical ?? item.flags ?? 0, 255);
    const tag = text(item.tag, 32).toLowerCase();
    const payload = caaValue(item.value);
    return flags !== null && /^(?:issue|issuewild|iodef)$/u.test(tag) && payload
      ? `${flags} ${tag} ${payload}`
      : '';
  }
  const candidate = text(value, 600);
  const match = /^(\d{1,3})\s+(issue|issuewild|iodef)\s+(.+)$/iu.exec(candidate);
  if (!match) return '';
  const flags = integer(match[1], 255);
  const tag = match[2]?.toLowerCase() ?? '';
  const payload = caaValue(match[3]);
  return flags !== null && payload ? `${flags} ${tag} ${payload}` : '';
}

export function canonicalDsRecord(value: unknown): string {
  const item = record(value);
  if (Object.keys(item).length) {
    const keyTag = integer(item.keyTag ?? item.key_tag, 65_535);
    const algorithm = integer(item.algorithm, 255);
    const digestType = integer(item.digestType ?? item.digest_type, 255);
    const digest = text(item.digest, 1024).replace(/\s+/gu, '').toLowerCase();
    return keyTag !== null && algorithm !== null && digestType !== null && /^[a-f0-9]{2,1024}$/u.test(digest)
      ? `${keyTag} ${algorithm} ${digestType} ${digest}`
      : '';
  }
  const candidate = text(value, 1200);
  const match = /^(\d{1,5})\s+(\d{1,3})\s+(\d{1,3})\s+([a-f0-9\s]+)$/iu.exec(candidate);
  if (!match) return '';
  return canonicalDsRecord({ keyTag: match[1], algorithm: match[2], digestType: match[3], digest: match[4] });
}

export function canonicalDomainControlRecordList(value: unknown, kind: RecordKind): string[] {
  if (!Array.isArray(value)) return [];
  const normalizer = kind === 'mx' ? canonicalMxRecord : kind === 'caa' ? canonicalCaaRecord : canonicalDsRecord;
  return [...new Set(value
    .slice(0, MAX_CANONICAL_DOMAIN_CONTROL_RECORDS * 4)
    .map(normalizer)
    .filter(Boolean))]
    .sort()
    .slice(0, MAX_CANONICAL_DOMAIN_CONTROL_RECORDS);
}
