// Shared strict primitives for internal evidence contracts. These helpers do
// not infer missing values and keep every string, object, enum, and counter
// bounded before a provider or connector result reaches its public model.

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
