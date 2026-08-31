// Shared strict primitives for the Lookup response envelope and its owned
// child-profile contracts. These checks validate without normalising or
// copying untrusted values.

import { MAX_OBSERVATION_DIAGNOSTICS } from '../packages/evidence/observation.mts';
import { MAX_HTTP_PROVENANCE_URL } from './http-evidence-bounds.mts';

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue };

const LOOKUP_CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;
const MAX_LOOKUP_CONTRACT_HOST_LENGTH = 253;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validBoundedString(value: unknown, maximum: number, allowEmpty = false): boolean {
  return typeof value === 'string'
    && (allowEmpty || Boolean(value))
    && value.length <= maximum
    && !LOOKUP_CONTROL_CHAR_RE.test(value);
}

function validUint(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function validStringArray(value: unknown, maximumItems: number, maximumLength: number): boolean {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => validBoundedString(item, maximumLength));
}

function validOptionalNullableText(value: unknown, maximumLength: number): boolean {
  return value === undefined || value === null || validBoundedString(value, maximumLength);
}

function validHttpProvenanceUrl(value: unknown): boolean {
  if (typeof value !== 'string'
    || !value
    || value.length > MAX_HTTP_PROVENANCE_URL
    || LOOKUP_CONTROL_CHAR_RE.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.href === value;
  } catch {
    return false;
  }
}

function normalizedDomain(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > MAX_LOOKUP_CONTRACT_HOST_LENGTH
    || LOOKUP_CONTROL_CHAR_RE.test(value)
    || /[\s/?#@\\:]/u.test(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(`https://${value.trim().replace(/\.$/u, '')}/`);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    const labels = hostname.split('.');
    return labels.length >= 2
      && hostname.length <= MAX_LOOKUP_CONTRACT_HOST_LENGTH
      && labels.every((label) => (
        label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
      ))
      ? hostname
      : null;
  } catch {
    return null;
  }
}

function validObservationDiagnosticValue(value: unknown, depth = 0): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    return value.length <= 240 && !LOOKUP_CONTROL_CHAR_RE.test(value);
  }
  if (!isJsonObject(value) || depth >= 2) return false;
  const keys = Object.keys(value);
  return keys.length <= 6
    && keys.every((key) => ['status', 'error', 'detail', 'truncated', 'discarded', 'count'].includes(key))
    && keys.every((key) => validObservationDiagnosticValue(value[key], depth + 1));
}

function validObservationDiagnostics(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isJsonObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_OBSERVATION_DIAGNOSTICS
    && entries.every(([key, item]) => (
      Boolean(key)
      && key.length <= 40
      && /^[a-z0-9_-]+$/iu.test(key)
      && validObservationDiagnosticValue(item)
    ));
}

export {
  LOOKUP_CONTROL_CHAR_RE,
  isJsonObject,
  normalizedDomain,
  validBoundedString,
  validHttpProvenanceUrl,
  validObservationDiagnostics,
  validOptionalNullableText,
  validStringArray,
  validUint,
};

export type { JsonObject, JsonPrimitive, JsonValue };
