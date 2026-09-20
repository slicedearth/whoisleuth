// Bounded value normalisation shared by Case response responsibilities.

import {
  MAX_DECISION_PIN_REFERENCES,
  MAX_RESPONSE_LIMITATIONS,
  MAX_RESPONSE_LIMITATION_LENGTH,
} from '../contracts/case-portability.mts';
import {
  normalizeExplicitIsoTimestamp,
  normalizeLegacyIsoTimestamp,
} from '../evidence/observation.mts';
import {
  CASE_PIN_COMPLETENESS,
  type CaseResponseTimestampOptions,
} from './case-response-records.mts';

export const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;

const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

export const COMPLETENESS = new Set<string>(CASE_PIN_COMPLETENESS);

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_REPLACE_RE, ' ').trim().slice(0, maximum);
}

function timestamp(value: unknown, options: CaseResponseTimestampOptions = {}): string | null {
  return normalizeExplicitIsoTimestamp(value)
    ?? (options.legacyTimestamps ? normalizeLegacyIsoTimestamp(value) : null);
}

export function iso(value: unknown, fallback: string, options: CaseResponseTimestampOptions = {}): string {
  return timestamp(value, options) ?? fallback;
}

export function optionalIso(value: unknown, options: CaseResponseTimestampOptions = {}): string | null {
  return timestamp(value, options);
}

function hash(value: string): string {
  let result = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(JSON.stringify(value))}`;
}

export function freshId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeId(value: unknown, prefix: string, raw: unknown): string {
  return typeof value === 'string' && SAFE_ID_RE.test(value)
    ? value
    : deterministicId(prefix, raw);
}

export function limitations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value.slice(0, MAX_RESPONSE_LIMITATIONS * 2)) {
    const normalized = text(item, MAX_RESPONSE_LIMITATION_LENGTH);
    if (normalized) unique.add(normalized);
    if (unique.size >= MAX_RESPONSE_LIMITATIONS) break;
  }
  return [...unique];
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function lifecycleLimitations(value: unknown): string[] {
  return limitations(value).sort(compareCodeUnits);
}

export function uniqueIds(value: unknown, validIds?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value.slice(0, MAX_DECISION_PIN_REFERENCES * 2)) {
    if (typeof item !== 'string' || !SAFE_ID_RE.test(item) || (validIds && !validIds.has(item))) continue;
    unique.add(item);
    if (unique.size >= MAX_DECISION_PIN_REFERENCES) break;
  }
  return [...unique];
}

export function boundedCounter(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 1_000_000)
    : 0;
}
