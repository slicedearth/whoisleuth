import {
  exactKeys,
  requireBoundedString,
  requireDomainName,
  requireIsoTimestamp,
  requireRecord,
} from './bounded-contract-normalizers.mts';

export const DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA = 'whoisleuth.domain-control-flight-recorder.input';
export const DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA = 'whoisleuth.domain-control-flight-recorder';
export const DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION = 1;
export const MAX_FLIGHT_RECORDER_OBSERVATIONS = 200;
export const MAX_FLIGHT_RECORDER_WINDOWS = 40;
export const MAX_FLIGHT_RECORDER_FIELDS = 24;
export const MAX_FLIGHT_RECORDER_VALUES = 32;

export const DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS = [
  'registrar',
  'registrar_lock',
  'registry_dnssec',
  'registry_nameservers',
  'whois_nameservers',
  'delegated_nameservers',
  'delegation_ds',
  'mail_exchangers',
  'caa_policy',
  'tls_certificate',
  'tls_public_key',
  'http_origin',
  'page_identity',
] as const;

export type DomainControlFlightRecorderField = typeof DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS[number];
export type DomainControlObservationState = 'observed' | 'partial' | 'unavailable' | 'unsupported';

export type DomainControlFlightRecorderObservation = Readonly<{
  domain: string;
  observedAt: string;
  collectionDepth: 'deep' | 'fast' | 'unknown';
  fields: readonly Readonly<{
    id: DomainControlFlightRecorderField;
    source: string;
    state: DomainControlObservationState;
    values: readonly string[];
  }>[];
}>;

type ApprovedWindow = Readonly<{
  id: string;
  domain: string;
  startsAt: string;
  endsAt: string;
  fields: readonly DomainControlFlightRecorderField[];
  reason: string;
}>;

const ROOT_KEYS = new Set(['schema', 'version', 'observations', 'approvedWindows']);
const OBSERVATION_KEYS = new Set(['domain', 'observedAt', 'collectionDepth', 'fields']);
const FIELD_KEYS = new Set(['id', 'source', 'state', 'values']);
const WINDOW_KEYS = new Set(['id', 'domain', 'startsAt', 'endsAt', 'fields', 'reason']);
const FIELD_IDS = new Set<string>(DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS);
const STATES = new Set<string>(['observed', 'partial', 'unavailable', 'unsupported']);
const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

function text(value: unknown, label: string, maximum = 240): string {
  return requireBoundedString(value, label, maximum)
    .replace(CONTROL_REPLACE_RE, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function values(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_FLIGHT_RECORDER_VALUES * 2) {
    throw new TypeError(`${label} must contain no more than ${MAX_FLIGHT_RECORDER_VALUES * 2} bounded values.`);
  }
  const output = new Set<string>();
  for (const [index, item] of value.entries()) {
    const normalized = text(item, `${label}[${index}]`, 500).toLowerCase();
    if (normalized) output.add(normalized);
    if (output.size >= MAX_FLIGHT_RECORDER_VALUES) break;
  }
  return [...output].sort();
}

function observation(value: unknown, index: number): DomainControlFlightRecorderObservation {
  const item = requireRecord(value, `observations[${index}]`);
  exactKeys(item, OBSERVATION_KEYS, `observations[${index}]`);
  if (!Array.isArray(item.fields) || item.fields.length > MAX_FLIGHT_RECORDER_FIELDS) {
    throw new TypeError(`observations[${index}].fields must contain no more than ${MAX_FLIGHT_RECORDER_FIELDS} fields.`);
  }
  const seen = new Set<string>();
  const fields = item.fields.map((raw, fieldIndex) => {
    const field = requireRecord(raw, `observations[${index}].fields[${fieldIndex}]`);
    exactKeys(field, FIELD_KEYS, `observations[${index}].fields[${fieldIndex}]`);
    if (typeof field.id !== 'string' || !FIELD_IDS.has(field.id) || seen.has(field.id)) {
      throw new TypeError(`observations[${index}] contains an unsupported or duplicate field.`);
    }
    if (typeof field.state !== 'string' || !STATES.has(field.state)) {
      throw new TypeError(`observations[${index}].fields[${fieldIndex}].state is unsupported.`);
    }
    seen.add(field.id);
    return Object.freeze({
      id: field.id as DomainControlFlightRecorderField,
      source: text(field.source, `observations[${index}].fields[${fieldIndex}].source`, 120),
      state: field.state as DomainControlObservationState,
      values: Object.freeze(values(field.values, `observations[${index}].fields[${fieldIndex}].values`)),
    });
  }).sort((left, right) => left.id.localeCompare(right.id));
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
  const item = requireRecord(value, `approvedWindows[${index}]`);
  exactKeys(item, WINDOW_KEYS, `approvedWindows[${index}]`);
  if (!Array.isArray(item.fields) || item.fields.length < 1 || item.fields.length > MAX_FLIGHT_RECORDER_FIELDS) {
    throw new TypeError(`approvedWindows[${index}].fields must contain from 1 to ${MAX_FLIGHT_RECORDER_FIELDS} fields.`);
  }
  const fields = [...new Set(item.fields.map((field) => {
    if (typeof field !== 'string' || !FIELD_IDS.has(field)) {
      throw new TypeError(`approvedWindows[${index}] contains an unsupported field.`);
    }
    return field as DomainControlFlightRecorderField;
  }))].sort();
  const startsAt = requireIsoTimestamp(item.startsAt, `approvedWindows[${index}].startsAt`);
  const endsAt = requireIsoTimestamp(item.endsAt, `approvedWindows[${index}].endsAt`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new TypeError(`approvedWindows[${index}].endsAt must be later than startsAt.`);
  }
  return Object.freeze({
    id: text(item.id, `approvedWindows[${index}].id`, 64),
    domain: requireDomainName(item.domain, `approvedWindows[${index}].domain`),
    startsAt,
    endsAt,
    fields: Object.freeze(fields),
    reason: text(item.reason, `approvedWindows[${index}].reason`, 400),
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
  const input = requireRecord(inputRaw, 'Domain control flight-recorder input');
  if (input.schema !== DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA || input.version !== 1) {
    throw new TypeError(`Domain control flight-recorder input must use ${DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA} version 1.`);
  }
  exactKeys(input, ROOT_KEYS, 'Domain control flight-recorder input');
  if (!Array.isArray(input.observations)
    || input.observations.length < 1
    || input.observations.length > MAX_FLIGHT_RECORDER_OBSERVATIONS) {
    throw new TypeError(`Domain control flight-recorder input must contain from 1 to ${MAX_FLIGHT_RECORDER_OBSERVATIONS} observations.`);
  }
  if (!Array.isArray(input.approvedWindows) || input.approvedWindows.length > MAX_FLIGHT_RECORDER_WINDOWS) {
    throw new TypeError(`approvedWindows must contain no more than ${MAX_FLIGHT_RECORDER_WINDOWS} entries.`);
  }
  const observations = input.observations.map(observation)
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.domain.localeCompare(right.domain));
  const windows = input.approvedWindows.map(approvedWindow);
  if (new Set(windows.map((window) => window.id)).size !== windows.length) {
    throw new TypeError('Approved change-window ids must be unique.');
  }
  const generatedAt = requireIsoTimestamp(generatedAtValue, 'generatedAt');
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
  const domains = [...new Set(observations.map((item) => item.domain))].sort();
  const observedChanges = events.filter((event) => event.kind === 'observed_change');
  const collectionChanges = events.filter((event) => event.kind === 'collection_change');
  return Object.freeze({
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
    limitations: Object.freeze([
      'The flight recorder compares only supplied bounded observations and performs no collection or configuration change.',
      'Source fields remain separate. A collection failure, partial result, unsupported source, or missing field never becomes evidence that a prior value disappeared.',
      'Approved windows label expected timing but do not delete evidence or establish that a change was authorised, successful, safe, or complete.',
      'Observed changes can reflect publication lag or different collection conditions and require analyst review.',
    ]),
  });
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
