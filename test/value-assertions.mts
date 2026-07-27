import assert from 'node:assert/strict';

function recordValue(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function requiredValue<T>(value: T | null | undefined): T {
  assert.notEqual(value, null);
  assert.notEqual(value, undefined);
  return value as T;
}

export { arrayValue, recordValue, requiredValue };
