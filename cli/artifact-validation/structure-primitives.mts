export type UnknownRecord = Record<string, unknown>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
export const HEX_DIGEST_RE = /^[a-f0-9]{64}$/u;
export const SEMANTIC_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export function fail(label: string): never {
  throw new TypeError(`${label} has an unsupported or malformed structure.`);
}

export function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label);
  return value as UnknownRecord;
}

export function exact(value: unknown, keys: readonly string[], label: string): UnknownRecord {
  const source = record(value, label);
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(label);
  return source;
}

export function exactOptional(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): UnknownRecord {
  const source = record(value, label);
  const actual = Object.keys(source);
  if (required.some((key) => !actual.includes(key))
    || actual.some((key) => !required.includes(key) && !optional.includes(key))) fail(label);
  return source;
}

export function text(value: unknown, label: string, maximum = 2_000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || CONTROL_RE.test(value) || (!allowEmpty && !value)) fail(label);
  return value;
}

export function optionalText(value: unknown, label: string, maximum = 2_000): void {
  if (value !== null) text(value, label, maximum);
}

export function iso(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  const candidate = text(value, label, 64);
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== candidate) fail(label);
}

export function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(label);
  return Number(value);
}

export function boolean(value: unknown, label: string): void {
  if (typeof value !== 'boolean') fail(label);
}

export function enumeration<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(label);
  return value as T;
}

export function array(value: unknown, label: string, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(label);
  return value;
}

export function strings(value: unknown, label: string, maximum: number, textMaximum = 2_000): string[] {
  const values = array(value, label, maximum);
  for (const item of values) text(item, label, textMaximum);
  return values as string[];
}

export function digest(value: unknown, label: string): void {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) fail(label);
}

export function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function domain(value: unknown, label: string): void {
  if (typeof value !== 'string' || !DOMAIN_RE.test(value)) fail(label);
}

export function absoluteUrl(value: unknown, label: string, protocols: readonly string[]): URL {
  const candidate = text(value, label, 2_048);
  try {
    const parsed = new URL(candidate);
    if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) fail(label);
    return parsed;
  } catch { return fail(label); }
}

export function nullableRecord(value: unknown, label: string): void {
  if (value !== null) record(value, label);
}

export function validateIntegrity(
  value: unknown,
  label: string,
  version: unknown,
  currentVersion: number,
): void {
  if (version !== currentVersion) fail(label);
  const integrity = exact(value, ['algorithm', 'canonicalization', 'digestSha256'], label);
  if (integrity.algorithm !== 'SHA-256' || integrity.canonicalization !== 'sorted-json-v2') fail(label);
  digest(integrity.digestSha256, label);
}