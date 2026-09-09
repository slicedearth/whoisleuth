import { classifyQuery } from '../lib/classify.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import {
  buildDomainControlFlightRecorder,
  validateDomainControlFlightRecorderDocument,
  normalizeDomainControlFlightRecorderObservations,
  type DomainControlFlightRecorderObservation,
} from '../lib/domain-control-flight-recorder.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
  PUBLIC_DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
} from '../packages/contracts/domain-control-flight-recorder.mts';
import {
  DOMAIN_CONTROL_REVIEW_SCHEMA,
  DOMAIN_CONTROL_REVIEW_VERSION,
  PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION,
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_VERSION,
} from '../packages/contracts/domain-control-review.mts';
import {
  CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
  CLI_DOMAIN_CONTROL_MONITOR_VERSION,
  PUBLIC_CLI_DOMAIN_CONTROL_MONITOR_VERSION,
  SUPPORTED_CLI_DOMAIN_CONTROL_MONITOR_VERSIONS,
  DOMAIN_CONTROL_MONITOR_COLLECTION_KEYS,
  DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES,
  DOMAIN_CONTROL_MONITOR_FAILURE_KEYS,
  DOMAIN_CONTROL_MONITOR_LIMITATIONS,
  DOMAIN_CONTROL_MONITOR_MANIFEST_KEYS,
  DOMAIN_CONTROL_MONITOR_ROOT_KEYS,
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS as CONTRACT_MAX_DOMAIN_CONTROL_MONITOR_DOMAINS,
  MAX_DOMAIN_CONTROL_MONITOR_ERROR_LENGTH,
  MAX_DOMAIN_CONTROL_MONITOR_FAILURES,
  MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES,
  MAX_DOMAIN_CONTROL_MONITOR_JSON_CONTAINER_ITEMS,
  MAX_DOMAIN_CONTROL_MONITOR_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_MONITOR_JSON_KEYS,
  MAX_DOMAIN_CONTROL_MONITOR_JSON_VALUES,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS,
} from '../packages/contracts/domain-control-monitor.mts';
import {
  validateDomainControlReviewDocument,
  verifyDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import { requireDomainName, requireIsoTimestamp } from '../lib/bounded-contract-normalizers.mts';
import type { LookupDependency } from './runner-types.mts';
import { buildCliLookupDocument } from './formatters/json.mts';
import {
  buildCliDomainControlReview,
  DOMAIN_CONTROL_REVIEW_SOURCE_FIELDS,
} from './domain-control-observations.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import { CliUsageError } from './errors.mts';

export { CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, CLI_DOMAIN_CONTROL_MONITOR_VERSION };
export const MAX_DOMAIN_CONTROL_MONITOR_DOMAINS = CONTRACT_MAX_DOMAIN_CONTROL_MONITOR_DOMAINS;

type PreviousSnapshot = Readonly<{ observations: readonly DomainControlFlightRecorderObservation[] }>;

function parseMonitorJson(input: string, label: string): unknown {
  const normalized = input.replace(/^\uFEFF/u, '');
  if (Buffer.byteLength(input, 'utf8') > MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES) {
    throw new CliUsageError(`${label} exceeds the ${MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES}-byte limit.`);
  }
  try {
    scanBoundedJson(normalized, {
      maximumDepth: MAX_DOMAIN_CONTROL_MONITOR_JSON_DEPTH,
      maximumKeys: MAX_DOMAIN_CONTROL_MONITOR_JSON_KEYS,
      maximumValues: MAX_DOMAIN_CONTROL_MONITOR_JSON_VALUES,
      maximumContainerItems: MAX_DOMAIN_CONTROL_MONITOR_JSON_CONTAINER_ITEMS,
    });
    return JSON.parse(normalized);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : '';
    if (detail === 'Artefact input is not valid JSON.') {
      throw new CliUsageError(`${label} must be valid JSON.`);
    }
    if (detail.startsWith('Artefact JSON ')) {
      throw new CliUsageError(`${label} ${detail.slice('Artefact JSON '.length)}`);
    }
    throw new CliUsageError(`${label} must satisfy the bounded JSON structure contract.`);
  }
}

function exactMonitorRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliUsageError(`${label} must use its exact object fields.`);
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== keys.length || actualKeys.some((key) => !keys.includes(key))) {
    throw new CliUsageError(`${label} must use its exact object fields.`);
  }
  return record;
}

function monitorInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new CliUsageError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function previousSnapshot(input: string | null, currentGeneratedAt: string): PreviousSnapshot {
  if (input === null) return { observations: [] };
  const parsed = parseMonitorJson(input, 'Previous monitor snapshot');
  const root = exactMonitorRecord(parsed, DOMAIN_CONTROL_MONITOR_ROOT_KEYS, 'Previous monitor snapshot');
  if (root.schema !== CLI_DOMAIN_CONTROL_MONITOR_SCHEMA || !SUPPORTED_CLI_DOMAIN_CONTROL_MONITOR_VERSIONS.some((version) => version === root.version)) {
    throw new CliUsageError(`Previous monitor snapshot must use ${CLI_DOMAIN_CONTROL_MONITOR_SCHEMA} supported version ${SUPPORTED_CLI_DOMAIN_CONTROL_MONITOR_VERSIONS.join(' or ')}.`);
  }
  const legacy = root.version === PUBLIC_CLI_DOMAIN_CONTROL_MONITOR_VERSION;
  const reviewVersion = legacy ? PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION : DOMAIN_CONTROL_REVIEW_VERSION;
  const flightVersion = legacy ? PUBLIC_DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION : DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION;
  let previousGeneratedAt: string;
  try {
    previousGeneratedAt = requireIsoTimestamp(root.generatedAt, 'Previous monitor snapshot generatedAt');
  } catch {
    throw new CliUsageError('Previous monitor snapshot generatedAt must be a valid ISO 8601 timestamp.');
  }
  if (Date.parse(previousGeneratedAt) >= Date.parse(currentGeneratedAt)) {
    throw new CliUsageError('Previous monitor snapshot must precede the current monitor run.');
  }
  const manifest = exactMonitorRecord(root.manifest, DOMAIN_CONTROL_MONITOR_MANIFEST_KEYS, 'Previous monitor snapshot manifest');
  if (typeof manifest.digestSha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(manifest.digestSha256)
    || typeof manifest.expiresAt !== 'string') {
    throw new CliUsageError('Previous monitor snapshot manifest is invalid.');
  }
  try {
    requireIsoTimestamp(manifest.expiresAt, 'Previous monitor snapshot manifest expiresAt');
  } catch {
    throw new CliUsageError('Previous monitor snapshot manifest expiresAt must be a valid ISO 8601 timestamp.');
  }
  if (legacy && Date.parse(manifest.expiresAt) <= Date.parse(previousGeneratedAt)) {
    throw new CliUsageError('Previous monitor snapshot manifest must have been unexpired when the checkpoint was generated.');
  }
  const collection = exactMonitorRecord(root.collection, DOMAIN_CONTROL_MONITOR_COLLECTION_KEYS, 'Previous monitor snapshot collection');
  const requested = monitorInteger(collection.requested, MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, 'Previous monitor snapshot requested count');
  const succeeded = monitorInteger(collection.succeeded, MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, 'Previous monitor snapshot succeeded count');
  const failed = monitorInteger(collection.failed, 0, MAX_DOMAIN_CONTROL_MONITOR_FAILURES, 'Previous monitor snapshot failed count');
  if (requested !== succeeded + failed || !Array.isArray(collection.failures) || collection.failures.length !== failed) {
    throw new CliUsageError('Previous monitor snapshot collection counts are inconsistent.');
  }
  const failureDomains = new Set<string>();
  const failureDomainOrder: string[] = [];
  for (const [index, failureValue] of collection.failures.entries()) {
    const failure = exactMonitorRecord(failureValue, DOMAIN_CONTROL_MONITOR_FAILURE_KEYS, `Previous monitor snapshot failure ${index + 1}`);
    let failureDomain: string;
    try {
      failureDomain = requireDomainName(failure.domain, `Previous monitor snapshot failure ${index + 1} domain`);
    } catch {
      throw new CliUsageError(`Previous monitor snapshot failure ${index + 1} domain is invalid.`);
    }
    if (failureDomain !== failure.domain
      || failureDomains.has(failureDomain)
      || typeof failure.error !== 'string'
      || !DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES.includes(failure.error as typeof DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES[number])
      || failure.error.length > MAX_DOMAIN_CONTROL_MONITOR_ERROR_LENGTH) {
      throw new CliUsageError(`Previous monitor snapshot failure ${index + 1} is invalid.`);
    }
    failureDomains.add(failureDomain);
    failureDomainOrder.push(failureDomain);
  }
  if (!Array.isArray(root.observations)
    || root.observations.length !== succeeded
    || root.observations.length < MIN_DOMAIN_CONTROL_MONITOR_DOMAINS
    || root.observations.length > MAX_DOMAIN_CONTROL_MONITOR_DOMAINS) {
    throw new CliUsageError('Previous monitor snapshot observations are inconsistent with its collection summary.');
  }
  let review: ReturnType<typeof validateDomainControlReviewDocument>;
  let flightRecorder: ReturnType<typeof validateDomainControlFlightRecorderDocument>;
  try {
    review = validateDomainControlReviewDocument(root.review);
    if (review.version !== reviewVersion) throw new TypeError('Mismatched review version.');
  } catch {
    throw new CliUsageError(`Previous monitor snapshot review must use the exact ${DOMAIN_CONTROL_REVIEW_SCHEMA} version ${reviewVersion} contract.`);
  }
  try {
    flightRecorder = validateDomainControlFlightRecorderDocument(root.flightRecorder);
    if (flightRecorder.version !== flightVersion) throw new TypeError('Mismatched flight-recorder version.');
  } catch {
    throw new CliUsageError(`Previous monitor snapshot flight recorder must use the exact ${DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA} version ${flightVersion} contract.`);
  }
  if (!Array.isArray(root.limitations)
    || root.limitations.length !== DOMAIN_CONTROL_MONITOR_LIMITATIONS.length
    || root.limitations.some((value, index) => value !== DOMAIN_CONTROL_MONITOR_LIMITATIONS[index])) {
    throw new CliUsageError('Previous monitor snapshot limitations are invalid.');
  }
  let observations: readonly DomainControlFlightRecorderObservation[];
  try {
    observations = normalizeDomainControlFlightRecorderObservations(root.observations, flightVersion);
    buildDomainControlFlightRecorder({
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
      version: flightVersion,
      observations: root.observations,
      approvedWindows: [],
    }, previousGeneratedAt);
  } catch {
    throw new CliUsageError('Previous monitor snapshot observations must use the exact bounded flight-recorder input contract.');
  }
  const observationDomainOrder = observations.map((observation) => observation.domain);
  const observationDomains = new Set(observationDomainOrder);
  const requestedDomains = review.domains.slice(0, requested).map((item) => item.domain);
  const expectedObservationDomains = requestedDomains.filter((domain) => !failureDomains.has(domain));
  const expectedFailureDomains = requestedDomains.filter((domain) => !observationDomains.has(domain));
  const mismatchedSource = !legacy && review.domains.some((item) => {
    const observation = observations.find((candidate) => candidate.domain === item.domain);
    return item.comparisons.some((comparison) => {
      if (comparison.source === null) return false;
      const field = observation?.fields.find((candidate) => DOMAIN_CONTROL_REVIEW_SOURCE_FIELDS[candidate.id] === comparison.field);
      return !field || field.source !== comparison.source || field.observedAt !== comparison.observedAt;
    });
  });
  if (review.domains.length < requested
    || mismatchedSource
    || observationDomains.size !== observations.length
    || observationDomainOrder.some((domain, index) => domain !== expectedObservationDomains[index])
    || observationDomainOrder.length !== expectedObservationDomains.length
    || failureDomainOrder.some((domain, index) => domain !== expectedFailureDomains[index])
    || failureDomainOrder.length !== expectedFailureDomains.length
    || observations.some((observation) => legacy ? observation.capturedAt !== previousGeneratedAt
      : Date.parse(observation.capturedAt) > Date.parse(previousGeneratedAt))
    || review.domains.some((item) => item.comparisons.some(
      (comparison) => legacy && comparison.observedAt !== null && comparison.observedAt !== previousGeneratedAt,
    ))
    || review.generatedAt !== previousGeneratedAt
    || review.manifest.digestSha256 !== manifest.digestSha256
    || review.manifest.expiresAt !== manifest.expiresAt
    || [...observationDomains].some((domain) => !review.domains.some((item) => item.domain === domain))
    || flightRecorder.generatedAt !== previousGeneratedAt
    || flightRecorder.observationCount < observations.length
    || [...observationDomains].some((domain) => !flightRecorder.domains.includes(domain))) {
    throw new CliUsageError('Previous monitor snapshot embedded documents are inconsistent with its observation projection.');
  }
  // Published checkpoints recorded run time, not independently retained source
  // clocks. Their values remain available without upgrading that timestamp.
  return { observations: legacy ? observations.map((item) => Object.freeze({
    ...item, fields: Object.freeze(item.fields.map((field) => Object.freeze({ ...field, observedAt: null }))),
  })) : observations };
}

function monitorFailureMessage(): typeof DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES[number] {
  return DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES[0];
}

export async function runDomainControlMonitor(
  manifestInput: string,
  previousInput: string | null,
  options: Readonly<{
    executeLookup: LookupDependency;
    now: () => string;
    limit: number;
    concurrency: number;
    signal?: AbortSignal;
    onSettled?: (completed: number, total: number) => void;
  }>,
) {
  if (!Number.isSafeInteger(options.limit)
    || options.limit < MIN_DOMAIN_CONTROL_MONITOR_DOMAINS
    || options.limit > MAX_DOMAIN_CONTROL_MONITOR_DOMAINS) {
    throw new CliUsageError(
      `Domain-control monitor limit must be from ${MIN_DOMAIN_CONTROL_MONITOR_DOMAINS} to ${MAX_DOMAIN_CONTROL_MONITOR_DOMAINS}.`,
    );
  }
  if (!Number.isSafeInteger(options.concurrency)
    || options.concurrency < MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY
    || options.concurrency > MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY) {
    throw new CliUsageError(
      `Domain-control monitor concurrency must be from ${MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY} to ${MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY}.`,
    );
  }
  let startedAt: string;
  try {
    startedAt = requireIsoTimestamp(options.now(), 'Domain-control monitor time');
  } catch {
    throw new CliUsageError('Domain-control monitor time must be a valid ISO 8601 timestamp.');
  }
  const rawManifest = parseMonitorJson(manifestInput, 'Domain-control manifest');
  let manifest: ReturnType<typeof verifyDomainControlManifest>;
  try {
    manifest = verifyDomainControlManifest(rawManifest);
  } catch {
    throw new CliUsageError('Domain-control manifest must satisfy its supported bounded integrity contract.');
  }
  const checkedAt = Date.parse(startedAt);
  if (Date.parse(manifest.expiresAt) <= checkedAt) {
    throw new CliUsageError('Domain-control monitor requires an unexpired manifest.');
  }
  const previous = previousSnapshot(previousInput, startedAt);
  const entries = manifest.entries.slice(0, Math.min(options.limit, MAX_DOMAIN_CONTROL_MONITOR_DOMAINS));
  const lookups: unknown[] = new Array(entries.length);
  const failuresByIndex: Array<Readonly<{ domain: string; error: string }> | undefined> = new Array(entries.length);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      options.signal?.throwIfAborted();
      const index = cursor++;
      const entry = entries[index];
      if (!entry) break;
      try {
        const classified = classifyQuery(entry.domain);
        const result = await options.executeLookup(classified, { fast: false, compact: false, ...(options.signal ? { signal: options.signal } : {}) });
        options.signal?.throwIfAborted();
        const capturedAt = requireIsoTimestamp(options.now(), 'Domain-control capture time');
        if (Date.parse(capturedAt) < checkedAt) throw new CliUsageError('Domain-control capture time must not precede the run.');
        lookups[index] = buildCliLookupDocument(entry.domain, classified, result as UnknownRecord, capturedAt, 'deep');
      } catch {
        if (options.signal?.aborted) {
          throw options.signal.reason || new DOMException('Aborted', 'AbortError');
        }
        failuresByIndex[index] = Object.freeze({ domain: entry.domain, error: monitorFailureMessage() });
      } finally {
        completed += 1;
        options.onSettled?.(completed, entries.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(entries.length, 1)) }, worker));
  options.signal?.throwIfAborted();
  const failures = failuresByIndex.filter((failure): failure is Readonly<{ domain: string; error: string }> => Boolean(failure));
  const successful = lookups.filter(Boolean);
  if (!successful.length) throw new Error('No domain-control monitor lookup completed successfully.');
  const generatedAt = requireIsoTimestamp(options.now(), 'Domain-control completion time');
  if (Date.parse(generatedAt) < checkedAt || successful.some((lookup) =>
    Date.parse(String((lookup as UnknownRecord).generatedAt)) > Date.parse(generatedAt))) {
    throw new CliUsageError('Domain-control completion time must not precede its captures.');
  }
  const review = buildCliDomainControlReview(JSON.stringify({
    schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
    version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
    manifest,
    lookups: successful,
  }), generatedAt);
  const observations = review.observations;
  const flightRecorder = buildDomainControlFlightRecorder({
    schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
    version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
    observations: [...previous.observations, ...observations],
    approvedWindows: [],
  }, generatedAt);
  return Object.freeze({
    schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
    version: CLI_DOMAIN_CONTROL_MONITOR_VERSION,
    generatedAt,
    manifest: Object.freeze({ digestSha256: manifest.integrity.digestSha256, expiresAt: manifest.expiresAt }),
    collection: Object.freeze({ requested: entries.length, succeeded: observations.length, failed: failures.length, failures: Object.freeze(failures) }),
    observations,
    review: review.review,
    flightRecorder,
    limitations: DOMAIN_CONTROL_MONITOR_LIMITATIONS,
  });
}

export function formatDomainControlMonitor(document: Awaited<ReturnType<typeof runDomainControlMonitor>>): string {
  return [
    'One-shot domain control review',
    `Requested    ${document.collection.requested}`,
    `Succeeded    ${document.collection.succeeded}`,
    `Failed       ${document.collection.failed}`,
    `Review       ${document.review.state}`,
    `Unexpected   ${document.flightRecorder.summary.unexpectedChanges}`,
    '',
  ].join('\n');
}
