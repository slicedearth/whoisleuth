/** Sharing declarations are not encryption, redaction or an authority to disclose. */
export const TLP_MARKINGS = ['clear', 'green', 'amber', 'amber-strict', 'red'] as const;
export const RECIPIENT_SCOPES = ['public', 'community', 'organization', 'named-recipients'] as const;
export type TlpMarking = typeof TLP_MARKINGS[number];
export type RecipientScope = typeof RECIPIENT_SCOPES[number];

const RISKY_KEYS = new Set([
  'authorization', 'cookie', 'cookies', 'credential', 'credentials', 'email', 'emails',
  'entities', 'password', 'phone', 'raw', 'rawrdap', 'rawwhois', 'registrant', 'session', 'token',
]);
const MARKING_KEYS = new Set([
  'informationmarking', 'marking', 'markings', 'sharingmarking',
  'tlp', 'tlplabel', 'tlpmarking', 'trafficlightprotocol',
]);

export function markingFromText(value: string): TlpMarking | null {
  const normalized = value.toUpperCase().replace(/\s+/gu, '').replace('TLP:', '').replace('+STRICT', '-STRICT').toLowerCase();
  return TLP_MARKINGS.includes(normalized as TlpMarking) ? normalized as TlpMarking : null;
}

export function expectedScope(marking: TlpMarking): RecipientScope {
  if (marking === 'clear') return 'public';
  if (marking === 'green') return 'community';
  if (marking === 'red') return 'named-recipients';
  return 'organization';
}

export function tlpLabel(marking: TlpMarking): `TLP:${string}` {
  return `TLP:${marking === 'amber-strict' ? 'AMBER+STRICT' : marking.toUpperCase()}`;
}

/** Scan an already admitted, byte/node/depth-bounded JSON tree, not arbitrary objects. */
export function scanSharingMetadata(root: Record<string, unknown>): Readonly<{
  importedMarkings: readonly TlpMarking[];
  riskyKeyCount: number;
}> {
  const stack: Array<{ value: unknown; marking: boolean }> = [{ value: root, marking: false }];
  const markings = new Set<TlpMarking>();
  let riskyKeyCount = 0;
  while (stack.length) {
    const next = stack.pop()!;
    if (typeof next.value === 'string') {
      if (next.marking) {
        const marking = markingFromText(next.value);
        if (marking) markings.add(marking);
      }
    } else if (Array.isArray(next.value)) {
      for (const value of next.value) stack.push({ value, marking: next.marking });
    } else if (next.value && typeof next.value === 'object') {
      for (const [key, value] of Object.entries(next.value)) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
        if (RISKY_KEYS.has(normalized)) riskyKeyCount++;
        stack.push({ value, marking: MARKING_KEYS.has(normalized) });
      }
    }
  }
  return { importedMarkings: [...markings], riskyKeyCount };
}
