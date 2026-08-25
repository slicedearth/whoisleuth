import { Buffer } from 'node:buffer';

import {
  requireBoundedString,
  requireDomainName,
  requireIsoTimestamp,
} from './bounded-contract-normalizers.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_APPROVED_WINDOW_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_EVENT_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_ROOT_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SUMMARY_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
  DOMAIN_CONTROL_FLIGHT_RECORDER_WINDOW_KEYS,
  MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES,
  MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES,
  MAX_FLIGHT_RECORDER_FIELDS,
  MAX_FLIGHT_RECORDER_EVENTS,
  MAX_FLIGHT_RECORDER_INPUT_VALUES,
  MAX_FLIGHT_RECORDER_JSON_DEPTH,
  MAX_FLIGHT_RECORDER_JSON_VALUES,
  MAX_FLIGHT_RECORDER_OBSERVATIONS,
  MAX_FLIGHT_RECORDER_SOURCE_LENGTH,
  MAX_FLIGHT_RECORDER_VALUE_LENGTH,
  MAX_FLIGHT_RECORDER_VALUES,
  MAX_FLIGHT_RECORDER_WINDOWS,
  MAX_FLIGHT_RECORDER_WINDOW_ID_LENGTH,
  MAX_FLIGHT_RECORDER_WINDOW_REASON_LENGTH,
  MIN_FLIGHT_RECORDER_OBSERVATIONS,
  type DomainControlFlightRecorderField,
  type DomainControlFlightRecorderObservation,
  type DomainControlObservationState,
} from '../packages/contracts/domain-control-flight-recorder.mts';

export {
  DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
  MAX_FLIGHT_RECORDER_FIELDS,
  MAX_FLIGHT_RECORDER_OBSERVATIONS,
  MAX_FLIGHT_RECORDER_VALUES,
  MAX_FLIGHT_RECORDER_WINDOWS,
};
export type {
  DomainControlFlightRecorderField,
  DomainControlFlightRecorderObservation,
  DomainControlObservationState,
} from '../packages/contracts/domain-control-flight-recorder.mts';

type ApprovedWindow = Readonly<{
  id: string;
  domain: string;
  startsAt: string;
  endsAt: string;
  fields: readonly DomainControlFlightRecorderField[];
  reason: string;
}>;

const ROOT_KEYS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_KEYS);
const OBSERVATION_KEYS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS);
const FIELD_KEYS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS);
const WINDOW_KEYS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_WINDOW_KEYS);
const DOCUMENT_ROOT_KEYS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_ROOT_KEYS);
const EVENT_KEYS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_EVENT_KEYS);
const EVENT_APPROVED_WINDOW_KEYS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_APPROVED_WINDOW_KEYS);
const SUMMARY_KEYS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_SUMMARY_KEYS);
const FIELD_IDS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS);
const STATES = new Set<string>(['observed', 'partial', 'unavailable', 'unsupported']);
const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRecord(
  value: unknown,
  keys: ReadonlySet<string>,
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must be an ordinary object.`);
    }
    const ownKeys = Reflect.ownKeys(value);
    const unknownKey = ownKeys.find((key) => typeof key !== 'string' || !keys.has(key));
    if (unknownKey !== undefined) {
      throw new TypeError(`${label} contains an unknown field: ${String(unknownKey)}`);
    }
    if (ownKeys.length !== keys.size) {
      throw new TypeError(`${label} must use its exact registered fields.`);
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${label}.${key} must be an enumerable data field.`);
      }
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith(label)) throw cause;
    throw new TypeError(`${label} must be an ordinary object.`);
  }
}

function boundedDataArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${label} must be an ordinary array.`);
    }
    if (Object.getOwnPropertyDescriptor(value, Symbol.iterator)
      || Object.getOwnPropertyDescriptor(value, 'toJSON')) {
      throw new TypeError(`${label} must not override array behaviour.`);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor && !lengthDescriptor.enumerable && 'value' in lengthDescriptor
      ? lengthDescriptor.value
      : null;
    if (!Number.isSafeInteger(length) || Number(length) < minimum || Number(length) > maximum) {
      throw new TypeError(`${label} must contain from ${minimum} to ${maximum} entries.`);
    }
    const boundedLength = Number(length);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== boundedLength + 1 || !ownKeys.includes('length')) {
      throw new TypeError(`${label} must be a dense array without additional fields.`);
    }
    const result: unknown[] = [];
    for (let index = 0; index < boundedLength; index += 1) {
      const key = String(index);
      if (!ownKeys.includes(key)) throw new TypeError(`${label} must be dense.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${label}[${index}] must be an enumerable data field.`);
      }
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith(label)) throw cause;
    throw new TypeError(`${label} must be an ordinary bounded array.`);
  }
}

class FlightRecorderJsonBudgetError extends Error {}
class FlightRecorderJsonStructureError extends Error {}

function addJsonBytes(current: number, addition: number, maximum: number): number {
  const total = current + addition;
  if (!Number.isSafeInteger(total) || total > maximum) throw new FlightRecorderJsonBudgetError();
  return total;
}

function jsonStringBytes(value: string, maximum: number): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let addition = 0;
    if (code === 0x22 || code === 0x5c) addition = 2;
    else if (code <= 0x1f) {
      addition = code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addition = 4;
        index += 1;
      } else addition = 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) addition = 6;
    else if (code <= 0x7f) addition = 1;
    else if (code <= 0x7ff) addition = 2;
    else addition = 3;
    bytes = addJsonBytes(bytes, addition, maximum);
  }
  return bytes;
}

function boundedPrettyJsonBytes(value: unknown, maximum: number): number {
  const active = new Set<object>();
  let valuesSeen = 0;

  const measure = (input: unknown, depth: number, arrayElement: boolean): number | null => {
    valuesSeen += 1;
    if (valuesSeen > MAX_FLIGHT_RECORDER_JSON_VALUES || depth > MAX_FLIGHT_RECORDER_JSON_DEPTH) {
      throw new FlightRecorderJsonStructureError();
    }
    if (input === null) return 4;
    if (typeof input === 'string') return jsonStringBytes(input, maximum);
    if (typeof input === 'boolean') return input ? 4 : 5;
    if (typeof input === 'number') return Number.isFinite(input) ? String(input).length : 4;
    if (typeof input === 'undefined' || typeof input === 'function' || typeof input === 'symbol') {
      return arrayElement ? 4 : null;
    }
    if (typeof input === 'bigint' || typeof input !== 'object' || active.has(input)) {
      throw new FlightRecorderJsonStructureError();
    }
    active.add(input);
    try {
      const childIndent = (depth + 1) * 2;
      const closingIndent = depth * 2;
      if (Array.isArray(input)) {
        const items = boundedDataArray(input, 'Domain control flight-recorder JSON array', 0, MAX_FLIGHT_RECORDER_JSON_VALUES);
        if (!items.length) return 2;
        let bytes = 1;
        for (let index = 0; index < items.length; index += 1) {
          if (index > 0) bytes = addJsonBytes(bytes, 1, maximum);
          bytes = addJsonBytes(bytes, 1 + childIndent, maximum);
          bytes = addJsonBytes(bytes, measure(items[index], depth + 1, true) ?? 4, maximum);
        }
        return addJsonBytes(bytes, 1 + closingIndent + 1, maximum);
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) throw new FlightRecorderJsonStructureError();
      if (Object.getOwnPropertyDescriptor(input, 'toJSON')) throw new FlightRecorderJsonStructureError();
      const keys = Reflect.ownKeys(input);
      let bytes = 1;
      let properties = 0;
      for (const key of keys) {
        if (typeof key !== 'string') throw new FlightRecorderJsonStructureError();
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new FlightRecorderJsonStructureError();
        }
        const measured = measure(descriptor.value, depth + 1, false);
        if (measured === null) continue;
        if (properties > 0) bytes = addJsonBytes(bytes, 1, maximum);
        bytes = addJsonBytes(bytes, 1 + childIndent, maximum);
        bytes = addJsonBytes(bytes, jsonStringBytes(key, maximum), maximum);
        bytes = addJsonBytes(bytes, 2, maximum);
        bytes = addJsonBytes(bytes, measured, maximum);
        properties += 1;
      }
      return properties ? addJsonBytes(bytes, 1 + closingIndent + 1, maximum) : 2;
    } finally {
      active.delete(input);
    }
  };

  const bytes = measure(value, 0, false);
  if (bytes === null) throw new FlightRecorderJsonStructureError();
  return addJsonBytes(bytes, 1, maximum);
}

function assertPrettyJsonByteBudget(value: unknown, maximum: number, label: string): void {
  try {
    boundedPrettyJsonBytes(value, maximum);
  } catch (cause) {
    if (cause instanceof FlightRecorderJsonBudgetError) {
      throw new TypeError(`${label} exceeds ${maximum} serialised bytes.`);
    }
    throw new TypeError(`${label} must be serialisable as bounded JSON.`);
  }
}

function snapshotFlightRecorderInput(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const observations = boundedDataArray(
    input.observations,
    'Domain control flight-recorder input observations',
    MIN_FLIGHT_RECORDER_OBSERVATIONS,
    MAX_FLIGHT_RECORDER_OBSERVATIONS,
  ).map((raw, index) => {
    const item = exactRecord(raw, OBSERVATION_KEYS, `observations[${index}]`);
    const fields = boundedDataArray(item.fields, `observations[${index}].fields`, 0, MAX_FLIGHT_RECORDER_FIELDS)
      .map((fieldRaw, fieldIndex) => {
        const field = exactRecord(fieldRaw, FIELD_KEYS, `observations[${index}].fields[${fieldIndex}]`);
        return Object.freeze({
          id: field.id,
          source: field.source,
          state: field.state,
          values: boundedDataArray(
            field.values,
            `observations[${index}].fields[${fieldIndex}].values`,
            0,
            MAX_FLIGHT_RECORDER_INPUT_VALUES,
          ),
        });
      });
    return Object.freeze({
      domain: item.domain,
      observedAt: item.observedAt,
      collectionDepth: item.collectionDepth,
      fields: Object.freeze(fields),
    });
  });
  const approvedWindows = boundedDataArray(input.approvedWindows, 'approvedWindows', 0, MAX_FLIGHT_RECORDER_WINDOWS)
    .map((raw, index) => {
      const item = exactRecord(raw, WINDOW_KEYS, `approvedWindows[${index}]`);
      return Object.freeze({
        id: item.id,
        domain: item.domain,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        fields: boundedDataArray(item.fields, `approvedWindows[${index}].fields`, 1, MAX_FLIGHT_RECORDER_FIELDS),
        reason: item.reason,
      });
    });
  return Object.freeze({
    schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
    version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
    observations: Object.freeze(observations),
    approvedWindows: Object.freeze(approvedWindows),
  });
}

function text(value: unknown, label: string, maximum = 240): string {
  return requireBoundedString(value, label, maximum)
    .replace(CONTROL_REPLACE_RE, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function values(value: unknown, label: string): string[] {
  const input = boundedDataArray(value, label, 0, MAX_FLIGHT_RECORDER_INPUT_VALUES);
  const output = new Set<string>();
  for (let index = 0; index < input.length; index += 1) {
    const normalized = text(input[index], `${label}[${index}]`, MAX_FLIGHT_RECORDER_VALUE_LENGTH).toLowerCase();
    if (normalized && output.size < MAX_FLIGHT_RECORDER_VALUES) output.add(normalized);
  }
  return [...output].sort(ordinalCompare);
}

function observation(value: unknown, index: number): DomainControlFlightRecorderObservation {
  const item = exactRecord(value, OBSERVATION_KEYS, `observations[${index}]`);
  const inputFields = boundedDataArray(item.fields, `observations[${index}].fields`, 0, MAX_FLIGHT_RECORDER_FIELDS);
  const seen = new Set<string>();
  const fields = inputFields.map((raw, fieldIndex) => {
    const field = exactRecord(raw, FIELD_KEYS, `observations[${index}].fields[${fieldIndex}]`);
    if (typeof field.id !== 'string' || !FIELD_IDS.has(field.id) || seen.has(field.id)) {
      throw new TypeError(`observations[${index}] contains an unsupported or duplicate field.`);
    }
    if (typeof field.state !== 'string' || !STATES.has(field.state)) {
      throw new TypeError(`observations[${index}].fields[${fieldIndex}].state is unsupported.`);
    }
    seen.add(field.id);
    return Object.freeze({
      id: field.id as DomainControlFlightRecorderField,
      source: text(field.source, `observations[${index}].fields[${fieldIndex}].source`, MAX_FLIGHT_RECORDER_SOURCE_LENGTH),
      state: field.state as DomainControlObservationState,
      values: Object.freeze(values(field.values, `observations[${index}].fields[${fieldIndex}].values`)),
    });
  }).sort((left, right) => ordinalCompare(left.id, right.id));
  const collectionDepth = item.collectionDepth === 'deep' || item.collectionDepth === 'fast'
    ? item.collectionDepth
    : item.collectionDepth === 'unknown'
      ? 'unknown'
      : null;
  if (!collectionDepth) throw new TypeError(`observations[${index}].collectionDepth is unsupported.`);
  return Object.freeze({
    domain: requireDomainName(item.domain, `observations[${index}].domain`),
    observedAt: requireIsoTimestamp(item.observedAt, `observations[${index}].observedAt`),
    collectionDepth,
    fields: Object.freeze(fields),
  });
}

function approvedWindow(value: unknown, index: number): ApprovedWindow {
  const item = exactRecord(value, WINDOW_KEYS, `approvedWindows[${index}]`);
  const inputFields = boundedDataArray(item.fields, `approvedWindows[${index}].fields`, 1, MAX_FLIGHT_RECORDER_FIELDS);
  const fields = [...new Set(inputFields.map((field) => {
    if (typeof field !== 'string' || !FIELD_IDS.has(field)) {
      throw new TypeError(`approvedWindows[${index}] contains an unsupported field.`);
    }
    return field as DomainControlFlightRecorderField;
  }))].sort(ordinalCompare);
  const startsAt = requireIsoTimestamp(item.startsAt, `approvedWindows[${index}].startsAt`);
  const endsAt = requireIsoTimestamp(item.endsAt, `approvedWindows[${index}].endsAt`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new TypeError(`approvedWindows[${index}].endsAt must be later than startsAt.`);
  }
  return Object.freeze({
    id: text(item.id, `approvedWindows[${index}].id`, MAX_FLIGHT_RECORDER_WINDOW_ID_LENGTH),
    domain: requireDomainName(item.domain, `approvedWindows[${index}].domain`),
    startsAt,
    endsAt,
    fields: Object.freeze(fields),
    reason: text(item.reason, `approvedWindows[${index}].reason`, MAX_FLIGHT_RECORDER_WINDOW_REASON_LENGTH),
  });
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchingWindow(
  windows: readonly ApprovedWindow[],
  domain: string,
  field: DomainControlFlightRecorderField,
  observedAt: string,
): ApprovedWindow | null {
  const time = Date.parse(observedAt);
  return windows.find((window) => (
    window.domain === domain
    && window.fields.includes(field)
    && Date.parse(window.startsAt) <= time
    && time <= Date.parse(window.endsAt)
  )) ?? null;
}

export function buildDomainControlFlightRecorder(inputRaw: unknown, generatedAtValue = new Date().toISOString()) {
  const inputRoot = exactRecord(inputRaw, ROOT_KEYS, 'Domain control flight-recorder input');
  if (inputRoot.schema !== DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
    || inputRoot.version !== DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION) {
    throw new TypeError(`Domain control flight-recorder input must use ${DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA} version ${DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION}.`);
  }
  const input = snapshotFlightRecorderInput(inputRoot);
  assertPrettyJsonByteBudget(
    input,
    MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES,
    'Domain control flight-recorder input',
  );
  const inputObservations = input.observations as readonly unknown[];
  const inputWindows = input.approvedWindows as readonly unknown[];
  const observations = inputObservations.map(observation)
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt)
      || ordinalCompare(left.domain, right.domain));
  const windows = inputWindows.map(approvedWindow);
  if (new Set(windows.map((window) => window.id)).size !== windows.length) {
    throw new TypeError('Approved change-window ids must be unique.');
  }
  const generatedAt = requireIsoTimestamp(generatedAtValue, 'generatedAt');
  if (observations.some((item) => Date.parse(item.observedAt) > Date.parse(generatedAt))) {
    throw new TypeError('Domain control flight-recorder observations cannot be later than generatedAt.');
  }
  const latest = new Map<string, DomainControlFlightRecorderObservation['fields'][number]>();
  const events: Array<Readonly<{
    id: string;
    domain: string;
    field: DomainControlFlightRecorderField;
    observedAt: string;
    kind: 'first_observation' | 'observed_change' | 'collection_change' | 'recovered';
    state: 'observed' | 'partial';
    before: readonly string[];
    after: readonly string[];
    source: string;
    approvedWindow: Readonly<{ id: string; reason: string }> | null;
    explanation: string;
  }>> = [];
  for (const item of observations) {
    for (const field of item.fields) {
      const key = `${item.domain}\u0000${field.id}`;
      const previous = latest.get(key);
      latest.set(key, field);
      if (!previous) {
        if (field.state !== 'observed') continue;
        events.push(Object.freeze({
          id: `${item.domain}:${field.id}:${item.observedAt}`,
          domain: item.domain,
          field: field.id,
          observedAt: item.observedAt,
          kind: 'first_observation',
          state: 'observed',
          before: Object.freeze([]),
          after: field.values,
          source: field.source,
          approvedWindow: null,
          explanation: 'The first complete value for this source-attributed field was retained.',
        }));
        continue;
      }
      const window = matchingWindow(windows, item.domain, field.id, item.observedAt);
      if (previous.state === 'observed' && field.state === 'observed') {
        if (sameValues(previous.values, field.values)) continue;
        events.push(Object.freeze({
          id: `${item.domain}:${field.id}:${item.observedAt}`,
          domain: item.domain,
          field: field.id,
          observedAt: item.observedAt,
          kind: 'observed_change',
          state: 'observed',
          before: previous.values,
          after: field.values,
          source: field.source,
          approvedWindow: window ? Object.freeze({ id: window.id, reason: window.reason }) : null,
          explanation: window
            ? 'A complete observed value changed during an analyst-approved change window. The evidence is retained and labelled expected rather than removed.'
            : 'Two complete source-attributed observations contain different values.',
        }));
      } else if (previous.state !== 'observed' && field.state === 'observed') {
        events.push(Object.freeze({
          id: `${item.domain}:${field.id}:${item.observedAt}`,
          domain: item.domain,
          field: field.id,
          observedAt: item.observedAt,
          kind: 'recovered',
          state: 'observed',
          before: Object.freeze([]),
          after: field.values,
          source: field.source,
          approvedWindow: null,
          explanation: 'Collection returned a complete value after an earlier incomplete source state.',
        }));
      } else if (previous.state === 'observed' && field.state !== 'observed') {
        events.push(Object.freeze({
          id: `${item.domain}:${field.id}:${item.observedAt}`,
          domain: item.domain,
          field: field.id,
          observedAt: item.observedAt,
          kind: 'collection_change',
          state: 'partial',
          before: previous.values,
          after: Object.freeze([]),
          source: field.source,
          approvedWindow: null,
          explanation: `The source became ${field.state}; this is a collection-quality change, not evidence that the prior value disappeared.`,
        }));
      }
    }
  }
  const domains = [...new Set(observations.map((item) => item.domain))].sort(ordinalCompare);
  const observedChanges = events.filter((event) => event.kind === 'observed_change');
  const collectionChanges = events.filter((event) => event.kind === 'collection_change');
  const document = Object.freeze({
    schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
    version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
    generatedAt,
    domains: Object.freeze(domains),
    observationCount: observations.length,
    events: Object.freeze(events),
    summary: Object.freeze({
      firstObservations: events.filter((event) => event.kind === 'first_observation').length,
      observedChanges: observedChanges.length,
      approvedChanges: observedChanges.filter((event) => event.approvedWindow !== null).length,
      unexpectedChanges: observedChanges.filter((event) => event.approvedWindow === null).length,
      collectionChanges: collectionChanges.length,
      recoveredSources: events.filter((event) => event.kind === 'recovered').length,
    }),
    limitations: DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS,
  });
  serializeDomainControlFlightRecorder(document);
  return document;
}

function exactRecorderText(value: unknown, label: string, maximum: number): string {
  const normalized = text(value, label, maximum);
  if (normalized !== value) throw new TypeError(`${label} must use its canonical text form.`);
  return normalized;
}

function exactRecorderInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function exactRecorderValues(value: unknown, label: string): readonly string[] {
  const input = boundedDataArray(value, label, 0, MAX_FLIGHT_RECORDER_VALUES);
  const normalized = input.map((item, index) => exactRecorderText(
    item,
    `${label}[${index}]`,
    MAX_FLIGHT_RECORDER_VALUE_LENGTH,
  ));
  if (new Set(normalized).size !== normalized.length
    || normalized.some((item, index) => index > 0 && normalized[index - 1]! >= item)) {
    throw new TypeError(`${label} must contain unique canonically ordered values.`);
  }
  return Object.freeze(normalized);
}

export function validateDomainControlFlightRecorderDocument(
  value: unknown,
): ReturnType<typeof buildDomainControlFlightRecorder> {
  const root = exactRecord(value, DOCUMENT_ROOT_KEYS, 'Domain control flight-recorder document');
  if (root.schema !== DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA
    || root.version !== DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION) {
    throw new TypeError(`Domain control flight-recorder document must use ${DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA} version ${DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION}.`);
  }
  const generatedAt = requireIsoTimestamp(root.generatedAt, 'Domain control flight-recorder document generatedAt');
  if (generatedAt !== root.generatedAt) {
    throw new TypeError('Domain control flight-recorder document generatedAt must use its canonical timestamp form.');
  }
  const domainInput = boundedDataArray(
    root.domains,
    'Domain control flight-recorder document domains',
    1,
    MAX_FLIGHT_RECORDER_OBSERVATIONS,
  );
  const domains = domainInput.map((item, index) => {
    const normalized = requireDomainName(item, `Domain control flight-recorder document domains[${index}]`);
    if (normalized !== item) {
      throw new TypeError(`Domain control flight-recorder document domains[${index}] must use its canonical form.`);
    }
    return normalized;
  });
  if (new Set(domains).size !== domains.length
    || domains.some((item, index) => index > 0 && domains[index - 1]! >= item)) {
    throw new TypeError('Domain control flight-recorder document domains must be unique and canonically ordered.');
  }
  const observationCount = exactRecorderInteger(
    root.observationCount,
    MIN_FLIGHT_RECORDER_OBSERVATIONS,
    MAX_FLIGHT_RECORDER_OBSERVATIONS,
    'Domain control flight-recorder document observationCount',
  );
  if (observationCount < domains.length) {
    throw new TypeError('Domain control flight-recorder document observationCount is inconsistent with its domains.');
  }
  const eventInput = boundedDataArray(
    root.events,
    'Domain control flight-recorder document events',
    0,
    MAX_FLIGHT_RECORDER_EVENTS,
  );
  const kindCounts = {
    first_observation: 0,
    observed_change: 0,
    collection_change: 0,
    recovered: 0,
    approved_change: 0,
  };
  const events = eventInput.map((eventValue, index) => {
    const label = `Domain control flight-recorder document event ${index + 1}`;
    const event = exactRecord(eventValue, EVENT_KEYS, label);
    const eventDomain = requireDomainName(event.domain, `${label}.domain`);
    if (eventDomain !== event.domain || !domains.includes(eventDomain)) {
      throw new TypeError(`${label}.domain must be present in the document domain list.`);
    }
    if (typeof event.field !== 'string' || !FIELD_IDS.has(event.field)) {
      throw new TypeError(`${label}.field is unsupported.`);
    }
    const observedAt = requireIsoTimestamp(event.observedAt, `${label}.observedAt`);
    if (observedAt !== event.observedAt || Date.parse(observedAt) > Date.parse(generatedAt)) {
      throw new TypeError(`${label}.observedAt must not be later than document generation.`);
    }
    if (event.kind !== 'first_observation'
      && event.kind !== 'observed_change'
      && event.kind !== 'collection_change'
      && event.kind !== 'recovered') {
      throw new TypeError(`${label}.kind is unsupported.`);
    }
    const expectedState = event.kind === 'collection_change' ? 'partial' : 'observed';
    if (event.state !== expectedState) throw new TypeError(`${label}.state is inconsistent.`);
    const before = exactRecorderValues(event.before, `${label}.before`);
    const after = exactRecorderValues(event.after, `${label}.after`);
    if (((event.kind === 'first_observation' || event.kind === 'recovered') && before.length)
      || (event.kind === 'collection_change' && after.length)) {
      throw new TypeError(`${label} before/after values are inconsistent.`);
    }
    let approvedWindow: Readonly<{ id: string; reason: string }> | null = null;
    if (event.approvedWindow !== null) {
      if (event.kind !== 'observed_change') throw new TypeError(`${label}.approvedWindow is inconsistent.`);
      const window = exactRecord(event.approvedWindow, EVENT_APPROVED_WINDOW_KEYS, `${label}.approvedWindow`);
      approvedWindow = Object.freeze({
        id: exactRecorderText(window.id, `${label}.approvedWindow.id`, MAX_FLIGHT_RECORDER_WINDOW_ID_LENGTH),
        reason: exactRecorderText(window.reason, `${label}.approvedWindow.reason`, MAX_FLIGHT_RECORDER_WINDOW_REASON_LENGTH),
      });
      kindCounts.approved_change += 1;
    }
    kindCounts[event.kind] += 1;
    return Object.freeze({
      id: exactRecorderText(event.id, `${label}.id`, 400),
      domain: eventDomain,
      field: event.field as DomainControlFlightRecorderField,
      observedAt,
      kind: event.kind,
      state: expectedState,
      before,
      after,
      source: exactRecorderText(event.source, `${label}.source`, MAX_FLIGHT_RECORDER_SOURCE_LENGTH),
      approvedWindow,
      explanation: exactRecorderText(event.explanation, `${label}.explanation`, MAX_FLIGHT_RECORDER_VALUE_LENGTH),
    });
  });
  const summaryInput = exactRecord(root.summary, SUMMARY_KEYS, 'Domain control flight-recorder document summary');
  const expectedSummary = Object.freeze({
    firstObservations: kindCounts.first_observation,
    observedChanges: kindCounts.observed_change,
    approvedChanges: kindCounts.approved_change,
    unexpectedChanges: kindCounts.observed_change - kindCounts.approved_change,
    collectionChanges: kindCounts.collection_change,
    recoveredSources: kindCounts.recovered,
  });
  for (const key of DOMAIN_CONTROL_FLIGHT_RECORDER_SUMMARY_KEYS) {
    const supplied = exactRecorderInteger(summaryInput[key], 0, MAX_FLIGHT_RECORDER_EVENTS, `Domain control flight-recorder document summary ${key}`);
    if (supplied !== expectedSummary[key]) {
      throw new TypeError('Domain control flight-recorder document summary is inconsistent.');
    }
  }
  const limitationsInput = boundedDataArray(
    root.limitations,
    'Domain control flight-recorder document limitations',
    DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS.length,
    DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS.length,
  );
  if (limitationsInput.some((item, index) => item !== DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS[index])) {
    throw new TypeError('Domain control flight-recorder document limitations are invalid.');
  }
  const document = Object.freeze({
    schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
    version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
    generatedAt,
    domains: Object.freeze(domains),
    observationCount,
    events: Object.freeze(events),
    summary: expectedSummary,
    limitations: DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS,
  });
  assertPrettyJsonByteBudget(
    document,
    MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES,
    'Domain control flight-recorder document',
  );
  return document as ReturnType<typeof buildDomainControlFlightRecorder>;
}

export function serializeDomainControlFlightRecorder(
  document: ReturnType<typeof buildDomainControlFlightRecorder>,
): string {
  assertPrettyJsonByteBudget(
    document,
    MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES,
    'Domain-control flight-recorder output',
  );
  const serialised = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialised, 'utf8') > MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES) {
    throw new TypeError(`Domain-control flight-recorder output exceeds ${MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES} serialised bytes.`);
  }
  return serialised;
}

export function formatDomainControlFlightRecorder(document: ReturnType<typeof buildDomainControlFlightRecorder>): string {
  const lines = [
    'Domain-control flight recorder',
    `Domains             ${document.domains.length}`,
    `Observations        ${document.observationCount}`,
    `Unexpected changes  ${document.summary.unexpectedChanges}`,
    `Approved changes    ${document.summary.approvedChanges}`,
    `Collection changes  ${document.summary.collectionChanges}`,
    '',
  ];
  for (const event of document.events.filter((item) => item.kind !== 'first_observation')) {
    lines.push(`${event.observedAt}  ${event.domain}  ${event.field.replaceAll('_', ' ')}  ${event.kind.replaceAll('_', ' ')}`);
    lines.push(`  ${event.explanation}`);
  }
  if (!document.events.some((item) => item.kind !== 'first_observation')) {
    lines.push('No retained transition was available between the supplied observations.');
  }
  lines.push('', ...document.limitations.map((item) => `Limitation: ${item}`), '');
  return lines.join('\n');
}
