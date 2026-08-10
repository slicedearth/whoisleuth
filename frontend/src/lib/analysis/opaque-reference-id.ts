// Opaque browser-local identifiers shared by independently owned record
// models. Validation is intentionally exact: callers must not trim, case-fold,
// repair, resolve, or otherwise reinterpret an identifier.

export const OPAQUE_REFERENCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizeOpaqueReferenceId(value: unknown): string | null {
  return typeof value === 'string' && OPAQUE_REFERENCE_ID_PATTERN.test(value)
    ? value
    : null;
}
