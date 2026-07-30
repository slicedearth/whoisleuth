// Registry-specific contact block resolvers. These helpers only interpret
// formats after their exact marker or handle relationship has been proven.

import { boundedWhoisValue } from './whois-values.mts';

export function resolveFredContact(
  text: string,
  handle: string | null | undefined,
) {
  if (!handle) return null;
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerMatch = text.match(
    new RegExp(`^[ \\t]*contact:[ \\t]*${escaped}[ \\t]*$`, 'im'),
  );
  if (!headerMatch) return null;

  const rest = text.slice((headerMatch.index ?? 0) + headerMatch[0].length);
  const endMatch = rest.match(/\n[ \t]*\n|^[ \t]*(?:domain|nsset|contact):/im);
  const block = endMatch ? rest.slice(0, endMatch.index) : rest;
  const get = (pattern: RegExp): string | null => {
    const match = block.match(pattern);
    return match?.[1]?.trim() || null;
  };
  const addresses = [...block.matchAll(/^[ \t]*address:[ \t]*(.+)$/gim)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  return {
    name: get(/^[ \t]*name:[ \t]*(.+)$/im),
    org: get(/^[ \t]*org:[ \t]*(.+)$/im),
    email: get(/^[ \t]*e-?mail:[ \t]*(.+)$/im),
    phone: get(/^[ \t]*phone:[ \t]*(.+)$/im),
    address: addresses.length ? addresses.join(', ') : null,
  };
}

export function resolveIsnicRole(
  text: string,
  handle: string | null | undefined,
) {
  if (!handle) return null;
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerMatch = text.match(new RegExp(
    `^[ \\t]*role:[ \\t]*(.+)\\r?\\n[ \\t]*nic-hdl:[ \\t]*${escaped}[ \\t]*$`,
    'im',
  ));
  if (!headerMatch) return null;

  const lines = text
    .slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n', 22);
  const block: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (block.length) break;
      continue;
    }
    if (/^[ \t]*(?:role|person|domain):/i.test(line)) break;
    if (block.length >= 20) break;
    block.push(line);
  }
  const blockText = block.join('\n');
  const get = (pattern: RegExp, maxLength: number) => {
    const match = blockText.match(pattern);
    return match
      ? boundedWhoisValue(match[1], maxLength)
      : { value: null, truncated: false };
  };
  const rawAddresses = [
    ...blockText.matchAll(/^[ \t]*address:[ \t]*(.+)$/gim),
  ];
  const addresses = rawAddresses
    .slice(0, 4)
    .map((match) => boundedWhoisValue(match[1], 300))
    .filter((entry) => entry.value);
  const address = boundedWhoisValue(
    addresses.map((entry) => entry.value).join(', '),
    1000,
  );
  return {
    org: boundedWhoisValue(headerMatch[1], 300),
    email: get(/^[ \t]*e-?mail:[ \t]*(.+)$/im, 320),
    phone: get(/^[ \t]*phone:[ \t]*(.+)$/im, 100),
    address,
    truncated: block.length >= 20
      || rawAddresses.length > addresses.length
      || addresses.some((entry) => entry.truncated),
  };
}

export function resolveIrnicContact(
  text: string,
  handle: string | null | undefined,
) {
  if (!handle) return null;
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerMatch = text.match(
    new RegExp(`^[ \\t]*nic-hdl:[ \\t]*${escaped}[ \\t]*$`, 'im'),
  );
  if (!headerMatch) return null;
  const lines = text
    .slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n', 22);
  const block: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (block.length) break;
      continue;
    }
    if (/^[ \t]*(?:domain|nic-hdl):/i.test(line)) break;
    if (block.length >= 20) break;
    block.push(line);
  }
  const blockText = block.join('\n');
  if (!/^[ \t]*source[ \t]*:[ \t]*IRNIC(?:\s|$)/im.test(blockText)) {
    return null;
  }
  const get = (pattern: RegExp, maxLength: number) => {
    const match = blockText.match(pattern);
    return match
      ? boundedWhoisValue(match[1], maxLength)
      : { value: null, truncated: false };
  };
  const rawAddresses = [
    ...blockText.matchAll(/^[ \t]*address[ \t]*:[ \t]*(.+)$/gim),
  ];
  const addresses = rawAddresses
    .slice(0, 4)
    .map((match) => boundedWhoisValue(match[1], 300))
    .filter((entry) => entry.value);
  const address = boundedWhoisValue(
    addresses.map((entry) => entry.value).join(', '),
    1000,
  );
  return {
    name: get(/^[ \t]*person[ \t]*:[ \t]*(.+)$/im, 300),
    org: get(/^[ \t]*org[ \t]*:[ \t]*(.+)$/im, 300),
    email: get(/^[ \t]*e-?mail[ \t]*:[ \t]*(.+)$/im, 320),
    phone: get(/^[ \t]*phone[ \t]*:[ \t]*(.+)$/im, 100),
    address,
    truncated: block.length >= 20
      || rawAddresses.length > addresses.length
      || addresses.some((entry) => entry.truncated),
  };
}

export function parseIndentedContactBlock(text: string, headerRe: RegExp) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return null;
  const rest = text.slice((headerMatch.index ?? 0) + headerMatch[0].length);
  const blankLineMatch = rest.match(/\n[ \t]*\n/);
  const blockText = blankLineMatch
    ? rest.slice(0, blankLineMatch.index)
    : rest;
  const allLines = blockText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = allLines.slice(0, 20);
  if (lines.length === 0) return null;

  const remaining = [...lines];
  const emailIndex = remaining.findIndex(
    (line) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line),
  );
  const email = emailIndex !== -1
    ? remaining.splice(emailIndex, 1)[0]
    : null;
  const phoneIndex = remaining.findIndex(
    (line) => /^[+\d][\d.\-() ]{6,}$/.test(line),
  );
  const phone = phoneIndex !== -1
    ? remaining.splice(phoneIndex, 1)[0]
    : null;
  const name = remaining.shift() || null;
  const address = remaining.length ? remaining.join(', ') : null;

  return {
    name,
    address,
    phone,
    email,
    truncated: allLines.length > lines.length,
  };
}
