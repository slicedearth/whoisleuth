// Privacy-safe verifier for operator-produced incremental Lookup staging
// evidence. It validates bounded measurements and adapter coverage without
// retaining lookup targets, responses, credentials, or partial events.

export const LOOKUP_PROGRESS_STAGING_EVIDENCE_SCHEMA =
  'whoisleuth.lookup-progress-staging-evidence';
export const LOOKUP_PROGRESS_STAGING_EVIDENCE_VERSION = 1;
export const MAX_LOOKUP_PROGRESS_STAGING_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_LOOKUP_PROGRESS_STAGING_FIRST_EVENT_MS = 5_000;
export const MIN_LOOKUP_PROGRESS_STAGING_EVENT_SPAN_MS = 250;

const ADAPTERS = ['express', 'netlify'] as const;
const CLIENTS = ['desktop', 'mobile'] as const;
const PATHS = ['direct', 'production_proxy'] as const;
const CHECK_KEYS = [
  'progressiveDelivery',
  'proxyBufferingAbsent',
  'slowConsumerCompleted',
  'authenticationExpiryHandled',
  'duplicateEventsRejected',
  'timeoutCancelled',
  'abortReachedCollector',
  'finalEnvelopeEquivalent',
  'ordinaryFallbackPassed',
  'cacheControlsSafe',
] as const;
const DIGEST_RE = /^[a-f0-9]{64}$/u;
const REVISION_RE = /^[a-f0-9]{7,64}$/u;

type Adapter = typeof ADAPTERS[number];
type Client = typeof CLIENTS[number];
type DeliveryPath = typeof PATHS[number];
type UnknownRecord = Record<string, unknown>;
type StagingRun = Readonly<{
  client: Client;
  path: DeliveryPath;
  firstEventAfterMs: number;
  eventSpanMs: number;
  captureDigestSha256: string;
}>;
type StagingEvidence = Readonly<{
  adapter: Adapter;
  buildRevision: string;
  capturedAt: string;
  checks: Readonly<Record<typeof CHECK_KEYS[number], true>>;
  runs: readonly StagingRun[];
}>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new TypeError(`${label} has an invalid field set.`);
  }
}

function fixedText<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as T;
}

function boundedInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new TypeError(`${label} must be a bounded non-negative integer.`);
  }
  return Number(value);
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64) throw new TypeError(`${label} is invalid.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid.`);
  return new Date(parsed).toISOString();
}

export function parseLookupProgressStagingEvidence(raw: unknown): StagingEvidence {
  const root = record(raw, 'Staging evidence');
  exactKeys(root, [
    'schema',
    'version',
    'adapter',
    'environment',
    'buildRevision',
    'capturedAt',
    'checks',
    'runs',
  ], 'Staging evidence');
  if (
    root.schema !== LOOKUP_PROGRESS_STAGING_EVIDENCE_SCHEMA
    || root.version !== LOOKUP_PROGRESS_STAGING_EVIDENCE_VERSION
    || root.environment !== 'authenticated_staging'
  ) throw new TypeError('Staging evidence uses an unsupported contract or environment.');
  const adapter = fixedText(root.adapter, ADAPTERS, 'Staging adapter');
  if (typeof root.buildRevision !== 'string' || !REVISION_RE.test(root.buildRevision)) {
    throw new TypeError('Staging build revision is invalid.');
  }
  const checks = record(root.checks, 'Staging checks');
  exactKeys(checks, CHECK_KEYS, 'Staging checks');
  for (const key of CHECK_KEYS) {
    if (checks[key] !== true) throw new TypeError(`Staging check ${key} did not pass.`);
  }
  if (!Array.isArray(root.runs) || root.runs.length !== CLIENTS.length * PATHS.length) {
    throw new TypeError('Staging evidence requires desktop and mobile runs on direct and production-proxy paths.');
  }
  const combinations = new Set<string>();
  const runs = root.runs.map((rawRun) => {
    const run = record(rawRun, 'Staging run');
    exactKeys(run, [
      'client',
      'path',
      'firstEventAfterMs',
      'eventSpanMs',
      'captureDigestSha256',
    ], 'Staging run');
    const client = fixedText(run.client, CLIENTS, 'Staging client');
    const deliveryPath = fixedText(run.path, PATHS, 'Staging delivery path');
    const combination = `${client}:${deliveryPath}`;
    if (combinations.has(combination)) throw new TypeError('Staging runs contain a duplicate profile.');
    combinations.add(combination);
    const firstEventAfterMs = boundedInteger(
      run.firstEventAfterMs,
      MAX_LOOKUP_PROGRESS_STAGING_FIRST_EVENT_MS,
      'First-event latency',
    );
    const eventSpanMs = boundedInteger(run.eventSpanMs, 120_000, 'Event span');
    if (eventSpanMs < MIN_LOOKUP_PROGRESS_STAGING_EVENT_SPAN_MS) {
      throw new TypeError('Staging event span does not demonstrate progressive delivery.');
    }
    if (typeof run.captureDigestSha256 !== 'string' || !DIGEST_RE.test(run.captureDigestSha256)) {
      throw new TypeError('Staging capture digest is invalid.');
    }
    return Object.freeze({
      client,
      path: deliveryPath,
      firstEventAfterMs,
      eventSpanMs,
      captureDigestSha256: run.captureDigestSha256,
    });
  });
  return Object.freeze({
    adapter,
    buildRevision: root.buildRevision,
    capturedAt: timestamp(root.capturedAt, 'Staging capture time'),
    checks: Object.freeze(Object.fromEntries(CHECK_KEYS.map((key) => [key, true]))) as StagingEvidence['checks'],
    runs: Object.freeze(runs),
  });
}

export function qualifyLookupProgressStagingEvidence(
  rawEvidence: readonly unknown[],
  options: Readonly<{ now?: () => Date }> = {},
) {
  if (rawEvidence.length !== ADAPTERS.length) {
    throw new TypeError('Qualification requires one Express and one Netlify staging evidence record.');
  }
  const evidence = rawEvidence.map(parseLookupProgressStagingEvidence);
  if (new Set(evidence.map((item) => item.adapter)).size !== ADAPTERS.length) {
    throw new TypeError('Qualification requires distinct Express and Netlify evidence.');
  }
  const buildRevision = evidence[0]?.buildRevision;
  if (!buildRevision || evidence.some((item) => item.buildRevision !== buildRevision)) {
    throw new TypeError('Staging evidence must describe the same build revision.');
  }
  const now = (options.now?.() ?? new Date()).getTime();
  if (!Number.isFinite(now)) throw new TypeError('Qualification time is invalid.');
  for (const item of evidence) {
    const age = now - Date.parse(item.capturedAt);
    if (age < 0 || age > MAX_LOOKUP_PROGRESS_STAGING_EVIDENCE_AGE_MS) {
      throw new TypeError(`${item.adapter} staging evidence is future-dated or stale.`);
    }
  }
  return Object.freeze({
    schema: 'whoisleuth.lookup-progress-staging-qualification',
    version: 1,
    stagingEvidenceComplete: true,
    productionRouteEnabled: false,
    buildRevision,
    adapters: Object.freeze(
      [...evidence]
        .sort((left, right) => left.adapter.localeCompare(right.adapter))
        .map((item) => Object.freeze({
          id: item.adapter,
          capturedAt: item.capturedAt,
          runs: item.runs.length,
          qualified: true,
        })),
    ),
    decision: 'Staging evidence satisfies the transport gate. Enabling an adapter remains a separate reviewed deployment change.',
  });
}

export type { StagingEvidence };
