// Shared strict primitives for internal evidence contracts. These helpers do
// not infer missing values and keep every string, object, enum, and counter
// bounded before a provider or connector result reaches its public model.

import { domainToASCII } from 'node:url';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function strictBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string'
    || value.length > maxLength
    || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized && normalized.length <= maxLength ? normalized : null;
}

export function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function boundedHttpsUrl(value: unknown, maxLength: number): string | null {
  const raw = strictBoundedString(value, maxLength);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const normalized = parsed.toString();
    return normalized.length <= maxLength ? normalized : null;
  } catch {
    return null;
  }
}

export function exactKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${label} contains an unknown field: ${unknown}`);
}

export function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T;
}

export function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

export function requireBoundedString(value: unknown, label: string, maxLength: number): string {
  const normalised = strictBoundedString(value, maxLength);
  if (!normalised) {
    throw new TypeError(`${label} must contain from 1 to ${maxLength} characters without control characters.`);
  }
  return normalised;
}

export function requireIsoTimestamp(value: unknown, label: string): string {
  const normalised = isoTimestamp(value);
  if (!normalised) throw new TypeError(`${label} must be a valid timestamp.`);
  return normalised;
}

export function requireDomainName(value: unknown, label: string, noun = 'domain name'): string {
  const supplied = requireBoundedString(value, label, 253).toLowerCase().replace(/\.$/u, '');
  const ascii = domainToASCII(supplied);
  if (!ascii || !ascii.includes('.') || ascii.length > 253 || ascii.split('.').some((part) => (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part)
  ))) {
    throw new TypeError(`${label} must be a valid ${noun}.`);
  }
  return ascii;
}
