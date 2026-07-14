'use strict';

const MAX_TERMINAL_VALUE_LENGTH = 240;

function safeTerminalValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TERMINAL_VALUE_LENGTH);
  return normalized || fallback;
}

function titleCase(value) {
  const text = safeTerminalValue(value, 'unknown').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatTerminalLookup(document) {
  const lines = [
    `Query          ${safeTerminalValue(document.query)}`,
    `Type           ${safeTerminalValue(document.type)}`,
    `Mode           ${titleCase(document.mode)}`,
  ];
  if (document.inputHostname && document.inputHostname !== document.registrableDomain) {
    lines.push(`Input host     ${safeTerminalValue(document.inputHostname)}`);
    lines.push(`Registry query ${safeTerminalValue(document.registrableDomain)}`);
  }
  if (document.availability?.applicable) {
    lines.push(`Availability   ${titleCase(document.availability.state)}`);
    lines.push(`Confidence     ${titleCase(document.availability.confidence)}`);
  }
  lines.push(`RDAP           ${titleCase(document.diagnostics?.rdap?.status)}`);
  if (document.diagnostics?.rdap?.endpoint) lines.push(`RDAP source    ${safeTerminalValue(document.diagnostics.rdap.endpoint)}`);
  lines.push(`WHOIS          ${titleCase(document.diagnostics?.whois?.status)}`);
  return `${lines.join('\n')}\n`;
}

function formatTerminalBulk(items, metadata) {
  const lines = items.map((item) => {
    if (!item.ok) return `! ${safeTerminalValue(item.query)} — ${safeTerminalValue(item.error, 'Lookup failed')}`;
    const state = titleCase(item.result?.availability?.state);
    const confidence = titleCase(item.result?.availability?.confidence);
    return `✓ ${safeTerminalValue(item.query)} — ${state} (${confidence} confidence)`;
  });
  const succeeded = items.filter((item) => item.ok).length;
  lines.push('');
  lines.push(`${items.length} queries · ${succeeded} succeeded · ${items.length - succeeded} failed · ${metadata.duplicates || 0} duplicates removed`);
  return `${lines.join('\n')}\n`;
}

module.exports = { MAX_TERMINAL_VALUE_LENGTH, formatTerminalBulk, formatTerminalLookup, safeTerminalValue };
