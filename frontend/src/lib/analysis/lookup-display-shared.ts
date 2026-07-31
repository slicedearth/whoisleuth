import type { JsonObject } from './lookup-response.ts';

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

export const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const rec = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

export const records = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

export const show = (value: unknown): string =>
  value == null || value === ''
    ? '—'
    : Array.isArray(value)
      ? value.join(', ') || '—'
      : typeof value === 'object'
        ? show(rec(value).name || rec(value).org || rec(value).handle || rec(value).domain)
        : String(value);

export const statusLabel = (value: string): string => value.replaceAll('_', ' ');

export const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)) : [];

export const boundedTechnologyText = (value: unknown, maxLength = 240): string =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);

export function formatDate(value: unknown): string {
  if (!value) return '—';
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

export function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function firstText(...values: unknown[]): string | null {
  return values.map(textOrNull).find((value): value is string => value !== null) ?? null;
}

export function dateTimeAttribute(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(String(value));
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

export function boundedPostureCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 20) : 0;
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
