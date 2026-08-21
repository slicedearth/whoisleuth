// Stable comparison-ledger identifiers and safe local destinations are runtime-neutral.
const CONTROL_RE = /[\u0000-\u001f\u007f]/gu;
const MAX_ID_PARTS = 32;
const MAX_ID_PART_LENGTH = 500;

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second = (second + code) | 0;
    second = (second + (second << 10)) | 0;
    second ^= second >>> 6;
  }
  second = (second + (second << 3)) | 0;
  second ^= second >>> 11;
  second = (second + (second << 15)) | 0;
  return `${(first >>> 0).toString(36).padStart(7, '0')}${(second >>> 0).toString(36).padStart(7, '0')}`;
}

export function stableComparisonLedgerId(prefix: string, parts: readonly unknown[]): string {
  const encoded = parts.slice(0, MAX_ID_PARTS).map((part) => {
    let value = '';
    try {
      value = part === null || part === undefined || ['string', 'number', 'boolean', 'bigint'].includes(typeof part)
        ? String(part ?? '')
        : Object.prototype.toString.call(part);
    } catch {
      value = '[unreadable]';
    }
    const bounded = value.slice(0, MAX_ID_PART_LENGTH);
    const typed = `${typeof part}:${value.length}:${bounded}`;
    return `${typed.length}:${typed}`;
  }).join('');
  const material = `${parts.length}:${encoded}`;
  return `${prefix.slice(0, 64)}-${stableHash(material)}`;
}

export function safeComparisonLedgerHref(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  const href = String(value).replace(CONTROL_RE, ' ').replace(/\s+/gu, ' ').trim().slice(0, 500).trim();
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return '';
  try {
    const base = new URL('https://comparison-ledger.invalid/');
    return new URL(href, base).origin === base.origin ? href : '';
  } catch {
    return '';
  }
}
