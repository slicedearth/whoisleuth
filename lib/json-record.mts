// Environment-neutral object guards used at untrusted JSON boundaries. These
// helpers deliberately perform no coercion, copying, key filtering, or value
// normalisation; callers retain ownership of their contract-specific bounds.

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function recordOrNull(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

export function recordOrEmpty(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}
