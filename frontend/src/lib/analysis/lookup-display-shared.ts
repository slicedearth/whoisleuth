import type { JsonObject } from './lookup-response.ts';
import {
  isRecord as isUnknownRecord,
  recordOrEmpty,
} from '../../../../lib/json-record.mts';

export type JsonRecord = JsonObject;

export type SourceStatus = {
  status?: string;
  errorCode?: string | null;
  endpoint?: string | null;
  transportSecurity?: string | null;
  httpStatus?: number | null;
  fetchedAt?: string | null;
  queriedAt?: string | null;
  authoritativeHop?: string | null;
  failedHop?: string | null;
  conflictingHop?: string | null;
  resultState?: string | null;
  upstreamStatus?: number | null;
  detail?: unknown;
  attempts?: Array<{ outcome?: string }>;
};

export type ComparisonField = {
  label: string;
  status: string;
  rdapState?: string;
  whoisState?: string;
  rdapDisplay: string;
  whoisDisplay: string;
};

export type RdapPublicationField = {
  label: string;
  status: string;
  registryState?: string;
  registrarState?: string;
  registryDisplay: string;
  registrarDisplay: string;
};

export type RegistryComparison = {
  fields: ComparisonField[];
};

export type PublicationComparison = {
  fields: RdapPublicationField[];
  counts: {
    equivalent: number;
    conflict: number;
    registry_only: number;
    registrar_only: number;
    registry_redacted: number;
    registrar_redacted: number;
    registry_unavailable: number;
    registrar_unavailable: number;
    registry_incomplete: number;
    registrar_incomplete: number;
  };
};

export const MAX_LOOKUP_DISPLAY_RECORDS = 500;
export const MAX_LOOKUP_DISPLAY_STRING_ITEMS = 500;
export const MAX_LOOKUP_DISPLAY_ARRAY_ITEMS = 64;
export const MAX_LOOKUP_DISPLAY_TEXT_LENGTH = 4_096;
export const MAX_LOOKUP_DISPLAY_VALUE_LENGTH = 1_024;
export const MAX_LOOKUP_DISPLAY_OBJECT_DEPTH = 8;

export const isRecord = isUnknownRecord as (value: unknown) => value is JsonRecord;

export const rec = recordOrEmpty as (value: unknown) => JsonRecord;

export const records = (value: unknown, maximum = MAX_LOOKUP_DISPLAY_RECORDS): JsonRecord[] =>
  Array.isArray(value)
    ? value.slice(0, Math.max(0, Math.min(MAX_LOOKUP_DISPLAY_RECORDS, Math.trunc(maximum)))).filter(isRecord)
    : [];

function boundedDisplayText(value: string, maximum = MAX_LOOKUP_DISPLAY_TEXT_LENGTH): string {
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ');
  if (sanitized.length <= maximum) return sanitized || '—';
  return `${sanitized.slice(0, Math.max(0, maximum - 1))}…`;
}

function displayValue(value: unknown, depth: number): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return boundedDisplayText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return boundedDisplayText(String(value));
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_LOOKUP_DISPLAY_OBJECT_DEPTH) return '…';
    const retained = value
      .slice(0, MAX_LOOKUP_DISPLAY_ARRAY_ITEMS)
      .map((item) => displayValue(item, depth + 1));
    const omitted = value.length - retained.length;
    const marker = omitted > 0 ? `… (+${omitted.toLocaleString('en')} more)` : '';
    return boundedDisplayText([...retained, marker].filter(Boolean).join(', ') || '—');
  }
  if (typeof value === 'object') {
    if (depth >= MAX_LOOKUP_DISPLAY_OBJECT_DEPTH) return '…';
    const source = rec(value);
    const candidate = source.name || source.org || source.handle || source.domain;
    return candidate === undefined ? '—' : displayValue(candidate, depth + 1);
  }
  return '—';
}

export const show = (value: unknown): string => displayValue(value, 0);

export const statusLabel = (value: string): string => value.replaceAll('_', ' ');

export function formatCollectionDuration(value: number | null): string {
  if (value === null) return 'Not separately timed';
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

export const stringList = (
  value: unknown,
  maximum = MAX_LOOKUP_DISPLAY_STRING_ITEMS,
  maximumLength = MAX_LOOKUP_DISPLAY_VALUE_LENGTH,
): string[] => Array.isArray(value)
  ? value
    .slice(0, Math.max(0, Math.min(MAX_LOOKUP_DISPLAY_STRING_ITEMS, Math.trunc(maximum))))
    .filter((item): item is string => typeof item === 'string')
    .map((item) => boundedDisplayText(item, Math.max(1, Math.min(MAX_LOOKUP_DISPLAY_VALUE_LENGTH, Math.trunc(maximumLength)))))
  : [];

export const boundedTechnologyText = (value: unknown, maxLength = 240): string =>
  (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);

export function boundedJsonPreview(
  value: unknown,
  maximumCharacters = 65_536,
): { text: string; truncated: boolean } {
  let remainingValues = 2_000;
  let remainingCharacters = Math.max(1_024, Math.trunc(maximumCharacters / 2));
  let truncated = false;

  const project = (current: unknown, depth: number): unknown => {
    remainingValues -= 1;
    if (remainingValues < 0 || depth > MAX_LOOKUP_DISPLAY_OBJECT_DEPTH) {
      truncated = true;
      return '[preview omitted]';
    }
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number') return Number.isFinite(current) ? current : '[invalid number]';
    if (typeof current === 'string') {
      const retained = current.slice(0, Math.max(0, remainingCharacters));
      remainingCharacters -= retained.length;
      if (retained.length < current.length) truncated = true;
      return retained;
    }
    if (Array.isArray(current)) {
      const output: unknown[] = [];
      const maximumItems = Math.min(50, current.length);
      for (let index = 0; index < maximumItems; index += 1) {
        if (remainingValues <= 0 || remainingCharacters <= 0) break;
        output.push(project(current[index], depth + 1));
      }
      if (output.length < current.length) {
        truncated = true;
        output.push(`[${current.length - output.length} array items omitted]`);
      }
      return output;
    }
    if (typeof current === 'object') {
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      let inspected = 0;
      for (const key in current as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        if (inspected >= 50 || remainingValues <= 0 || remainingCharacters <= 0) {
          truncated = true;
          break;
        }
        inspected += 1;
        const retainedKey = key.slice(0, 160);
        remainingCharacters -= retainedKey.length;
        output[retainedKey] = project((current as Record<string, unknown>)[key], depth + 1);
      }
      return output;
    }
    truncated = true;
    return '[unsupported value]';
  };

  const serialized = JSON.stringify(project(value, 0), null, 2) ?? '';
  if (serialized.length <= maximumCharacters) return { text: serialized, truncated };
  return {
    text: `${serialized.slice(0, Math.max(0, maximumCharacters - 20))}\n[preview omitted]`,
    truncated: true,
  };
}

export function formatDate(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return '—';
  const source = String(value).slice(0, 128);
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? boundedDisplayText(source, 128) : parsed.toLocaleString();
}

export function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function firstText(...values: unknown[]): string | null {
  return values.map(textOrNull).find((value): value is string => value !== null) ?? null;
}

export function dateTimeAttribute(value: unknown): string | undefined {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return undefined;
  const parsed = new Date(String(value).slice(0, 128));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function datedRow(label: string, value: unknown) {
  const datetime = dateTimeAttribute(value);
  return { label, value: formatDate(value), ...(datetime ? { datetime } : {}) };
}

export function boundedCredentialCount(value: unknown, maximum = 500): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), maximum)
    : 0;
}

export function boundedPostureCount(value: unknown, maximum = 32): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(count, maximum) : 0;
}

export function trackingIdentifierLabel(value: unknown): string {
  return (
    {
      'advertising-property': 'Advertising property',
      'analytics-property': 'Analytics property',
      'legacy-analytics-property': 'Legacy analytics property',
      'tag-container': 'Tag container',
    } as Record<string, string>
  )[String(value)] || statusLabel(show(value));
}
