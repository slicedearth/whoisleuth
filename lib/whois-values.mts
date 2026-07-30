// Shared bounded scalar and section helpers for WHOIS parsers. Registry
// branches may interpret different labels, but they all use the same control
// character, size, indentation, and section traversal rules.

export const MAX_WHOIS_FIELD_LENGTH = 1000;

export function boundedWhoisValue(
  value: unknown,
  maxLength = MAX_WHOIS_FIELD_LENGTH,
) {
  if (
    typeof value !== 'string'
    || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)
  ) {
    return { value: null, truncated: false };
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return { value: null, truncated: false };
  return {
    value: normalized.slice(0, maxLength).trim() || null,
    truncated: normalized.length > maxLength,
  };
}

export function parseIndentedWhoisValue(
  text: string,
  headerRe: RegExp,
  maxLength: number,
) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return null;
  const lines = text
    .slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n')
    .slice(0, 8);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!/^[ \t]/.test(line)) return null;
    return boundedWhoisValue(line, maxLength);
  }
  return null;
}

export function parseIndentedWhoisSubfield(
  text: string,
  headerRe: RegExp,
  subfieldRe: RegExp,
  maxLength: number,
) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return null;
  const lines = text
    .slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n')
    .slice(0, 8);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!/^[ \t]/.test(line)) return null;
    const match = line.match(subfieldRe);
    if (match) return boundedWhoisValue(match[1], maxLength);
  }
  return null;
}

export function parseBoundedWhoisSection(
  text: string,
  headerRe: RegExp,
  maxLines = 20,
) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return '';
  const lines = text
    .slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n', maxLines + 2);
  const section: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (section.length) break;
      continue;
    }
    if (/^[ \t]*\[[^\]]+\][ \t]*$/.test(line)) break;
    if (section.length >= maxLines) break;
    section.push(line);
  }
  return section.join('\n');
}

export function whoisFieldLimit(key: string): number {
  if (/Email$/i.test(key)) return 320;
  if (/Phone$/i.test(key)) return 100;
  if (/Date$/i.test(key)) return 100;
  if (/Url$/i.test(key)) return 2048;
  if (/domainName/i.test(key)) return 253;
  if (/Address/i.test(key)) return 1000;
  if (/Street/i.test(key)) return 1000;
  return 300;
}
