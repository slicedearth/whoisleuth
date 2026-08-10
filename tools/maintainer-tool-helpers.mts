import { createHash } from 'node:crypto';
import path from 'node:path';

export type MaintainerJsonRecord = Record<string, unknown>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

export function optionalJsonRecord(value: unknown): MaintainerJsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as MaintainerJsonRecord
    : null;
}

export function jsonRecordOrEmpty(value: unknown): MaintainerJsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as MaintainerJsonRecord
    : {};
}

export function requireJsonRecord(value: unknown, label: string): MaintainerJsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value as MaintainerJsonRecord;
}

export function exactObjectKeys(value: MaintainerJsonRecord, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${label} contains unsupported fields: ${unknown.sort().join(', ')}.`);
}

export function boundedControlFreeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || CONTROL_RE.test(value)) {
    throw new TypeError(`${label} must be control-free text no longer than ${maximum} characters.`);
  }
  return value.trim();
}

export function canonicalControlFreeTimestamp(value: unknown, label: string): string {
  const parsed = Date.parse(boundedControlFreeText(value, label, 64));
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

export function sanitizedMaintainerText(value: unknown, fallback: string, maximum: number): string {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
  return (text || fallback).slice(0, maximum);
}

export function boundedNonNegativeInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`${label} must be an integer from 0 to ${maximum}.`);
  }
  return value as number;
}

export function boundedPositiveInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new TypeError(`${label} must be between 1 and ${maximum}.`);
  }
  return Number(value);
}

export function boundedPositiveTimeout(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function boundedSafeRelativePath(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || value.includes('\\')
    || CONTROL_RE.test(value)
    || path.posix.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`${label} must be a bounded safe relative path.`);
  }
  return value;
}

export function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function medianOneDecimal(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number((((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2).toFixed(1))
    : sorted[middle] as number;
}

export function requiredOptionValue(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new TypeError(`${name} requires a value.`);
  if (args.indexOf(name, index + 1) >= 0) throw new TypeError(`${name} may be supplied only once.`);
  return args[index + 1] as string;
}

export function fixedRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
