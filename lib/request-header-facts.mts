/** Validated header facts; callers separately decide which proxies to trust. */
export type HeaderInput = Readonly<Record<string, string | readonly string[] | undefined>>;
export type HeaderFact = Readonly<{ state: 'missing' | 'invalid'; value?: never } | { state: 'valid'; value: string }>;

export function headerFact(headers: HeaderInput | null | undefined, name: string): HeaderFact {
  if (!headers) return { state: 'missing' };
  const matches = Object.entries(headers).filter(([key, value]) => key.toLowerCase() === name && value !== undefined);
  if (!matches.length) return { state: 'missing' };
  if (matches.length !== 1) return { state: 'invalid' };
  const value = matches[0]?.[1];
  if (typeof value !== 'string' || !value.length || value.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(value)) return { state: 'invalid' };
  return { state: 'valid', value };
}

export function strictHeader(headers: HeaderInput | null | undefined, name: string): HeaderFact {
  const fact = headerFact(headers, name);
  return fact.state === 'valid' && (fact.value !== fact.value.trim() || fact.value.includes(','))
    ? { state: 'invalid' } : fact;
}

/** The final proxy-appended token; an empty final hop is not an identity. */
export function lastHeaderToken(headers: HeaderInput | null | undefined, name: string): string | null {
  const fact = headerFact(headers, name);
  return fact.state === 'valid' ? fact.value.split(',').at(-1)?.trim() || null : null;
}
