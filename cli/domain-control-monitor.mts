import { classifyQuery } from '../lib/classify.mts';
import {
  buildDomainControlFlightRecorder,
  type DomainControlFlightRecorderObservation,
} from '../lib/domain-control-flight-recorder.mts';
import { verifyDomainControlManifest } from '../lib/domain-control-manifest.mts';
import type { LookupDependency } from './runner-types.mts';
import { buildCliLookupDocument } from './formatters/json.mts';
import {
  buildCliDomainControlReview,
} from './domain-control-observations.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';

export const CLI_DOMAIN_CONTROL_MONITOR_SCHEMA = 'whoisleuth.cli.domain-control-monitor';
export const CLI_DOMAIN_CONTROL_MONITOR_VERSION = 1;
export const MAX_DOMAIN_CONTROL_MONITOR_DOMAINS = 20;

type PreviousSnapshot = Readonly<{ observations: readonly DomainControlFlightRecorderObservation[] }>;

function previousSnapshot(input: string | null): PreviousSnapshot {
  if (!input) return { observations: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(input.replace(/^\uFEFF/u, '')); } catch { throw new CliUsageError('Previous monitor snapshot must be valid JSON.'); }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (root.schema !== CLI_DOMAIN_CONTROL_MONITOR_SCHEMA || root.version !== CLI_DOMAIN_CONTROL_MONITOR_VERSION || !Array.isArray(root.observations)) {
    throw new CliUsageError(`Previous monitor snapshot must use ${CLI_DOMAIN_CONTROL_MONITOR_SCHEMA} version ${CLI_DOMAIN_CONTROL_MONITOR_VERSION}.`);
  }
  const validated = buildDomainControlFlightRecorder({
    schema: 'whoisleuth.domain-control-flight-recorder.input', version: 1, observations: root.observations, approvedWindows: [],
  });
  void validated;
  return { observations: root.observations as DomainControlFlightRecorderObservation[] };
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
  const generatedAt = options.now();
  let rawManifest: unknown;
  try { rawManifest = JSON.parse(manifestInput.replace(/^\uFEFF/u, '')); } catch { throw new CliUsageError('Domain-control manifest must be valid JSON.'); }
  const manifest = verifyDomainControlManifest(rawManifest);
  const entries = manifest.entries.slice(0, Math.min(options.limit, MAX_DOMAIN_CONTROL_MONITOR_DOMAINS));
  const lookups: unknown[] = new Array(entries.length);
  const failures: Array<{ domain: string; error: string }> = [];
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      if (!entry) break;
      try {
        const classified = classifyQuery(entry.domain);
        const result = await options.executeLookup(classified, { fast: false, compact: false, ...(options.signal ? { signal: options.signal } : {}) });
        lookups[index] = buildCliLookupDocument(entry.domain, classified, result as UnknownRecord, generatedAt, 'deep');
      } catch (cause) {
        failures.push({ domain: entry.domain, error: boundedCliErrorMessage(cause, 'Lookup failed') });
      } finally {
        completed += 1;
        options.onSettled?.(completed, entries.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(entries.length, 1)) }, worker));
  const successful = lookups.filter(Boolean);
  if (!successful.length) throw new Error('No domain-control monitor lookup completed successfully.');
  const review = buildCliDomainControlReview(JSON.stringify({
    schema: 'whoisleuth.cli.domain-control-review-input', version: 1, manifest, lookups: successful,
  }), generatedAt);
  const previous = previousSnapshot(previousInput);
  const observations = review.observations;
  const flightRecorder = buildDomainControlFlightRecorder({
    schema: 'whoisleuth.domain-control-flight-recorder.input', version: 1,
    observations: [...previous.observations, ...observations], approvedWindows: [],
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
    limitations: Object.freeze([
      'This is one bounded run, not a daemon. Scheduling and secure checkpoint retention remain operator-controlled.',
      'The output retains compact normalised observations and errors, not raw RDAP, WHOIS, DNS, HTTP, TLS or page payloads.',
      'A failed source or lookup remains incomplete and does not establish that a previously observed value disappeared.',
    ]),
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
