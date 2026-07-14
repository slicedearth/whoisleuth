// Immediate concurrency leases for network-heavy API operations. In-memory is
// the zero-configuration default; an optional shared provider can enforce the
// same limits across runtime instances.
//
// A long-lived Express process shares the zero-configuration instance; a
// serverless runtime only shares it within one warm function instance and loses
// the state on a cold start. The optional distributed provider can add durable
// fixed-window accounting. The provider-neutral runner deliberately treats
// acquisition as one atomic operation rather than exposing a race-prone
// check-then-consume sequence. Providers may acquire and release either
// synchronously or asynchronously without changing endpoint orchestration.

import { createDistributedOperationBudget as createDistributedOperationBudgetImplementation } from './distributed-operation-budget.mts';

const OPERATION_CLASSES = Object.freeze({
  REGISTRY_LIGHT: 'registry_light',
  REGISTRY_DEEP: 'registry_deep',
  CERTIFICATE_SEARCH: 'certificate_search',
  POSTURE_AUDIT: 'posture_audit',
});

// Stable server-derived feature identities for future durable accounting.
// These describe the public operation being admitted, while OPERATION_CLASSES
// continue to describe its immediate concurrency cost. Compact Lookup is the
// established Bulk response contract, so it can be attributed without trusting
// a caller-supplied UI/workflow label. Global limits must still protect against
// clients deliberately selecting a different compatible response shape.
const OPERATION_FEATURE_MODEL_VERSION = 1;
const OPERATION_FEATURES = Object.freeze({
  LOOKUP_FAST: 'lookup_fast',
  LOOKUP_DEEP: 'lookup_deep',
  BULK_FAST: 'bulk_fast',
  BULK_DEEP: 'bulk_deep',
  RDAP: 'rdap',
  WHOIS: 'whois',
  AVAILABILITY_FAST: 'availability_fast',
  AVAILABILITY_DEEP: 'availability_deep',
  CERTIFICATE_TRANSPARENCY: 'certificate_transparency',
  DOMAIN_POSTURE: 'domain_posture',
});

const OPERATION_FEATURE_CLASSES = Object.freeze({
  [OPERATION_FEATURES.LOOKUP_FAST]: OPERATION_CLASSES.REGISTRY_LIGHT,
  [OPERATION_FEATURES.LOOKUP_DEEP]: OPERATION_CLASSES.REGISTRY_DEEP,
  [OPERATION_FEATURES.BULK_FAST]: OPERATION_CLASSES.REGISTRY_LIGHT,
  [OPERATION_FEATURES.BULK_DEEP]: OPERATION_CLASSES.REGISTRY_DEEP,
  [OPERATION_FEATURES.RDAP]: OPERATION_CLASSES.REGISTRY_LIGHT,
  [OPERATION_FEATURES.WHOIS]: OPERATION_CLASSES.REGISTRY_DEEP,
  [OPERATION_FEATURES.AVAILABILITY_FAST]: OPERATION_CLASSES.REGISTRY_LIGHT,
  [OPERATION_FEATURES.AVAILABILITY_DEEP]: OPERATION_CLASSES.REGISTRY_DEEP,
  [OPERATION_FEATURES.CERTIFICATE_TRANSPARENCY]: OPERATION_CLASSES.CERTIFICATE_SEARCH,
  [OPERATION_FEATURES.DOMAIN_POSTURE]: OPERATION_CLASSES.POSTURE_AUDIT,
});

// The browser currently runs at most 12 fast Bulk workers, 4 deep Bulk
// workers, and 3 Brand Profile posture workers. Session ceilings match those
// established callers; runtime ceilings leave bounded headroom for a small
// number of simultaneous authenticated sessions without allowing unbounded
// multiplication across tabs or scripts.
const DEFAULT_OPERATION_LIMITS = Object.freeze({
  [OPERATION_CLASSES.REGISTRY_LIGHT]: Object.freeze({ session: 12, runtime: 36 }),
  [OPERATION_CLASSES.REGISTRY_DEEP]: Object.freeze({ session: 4, runtime: 12 }),
  [OPERATION_CLASSES.CERTIFICATE_SEARCH]: Object.freeze({ session: 2, runtime: 4 }),
  [OPERATION_CLASSES.POSTURE_AUDIT]: Object.freeze({ session: 3, runtime: 8 }),
});

const OPERATION_BUDGET_ERROR_CODE = 'NETWORK_CONCURRENCY_LIMITED';
const OPERATION_BUDGET_UNAVAILABLE_ERROR_CODE = 'NETWORK_BUDGET_UNAVAILABLE';
const OPERATION_USAGE_ERROR_CODE = 'NETWORK_USAGE_LIMITED';
const OPERATION_USAGE_MODEL_VERSION = 1;
const MAX_OPERATION_USAGE_POLICY_BYTES = 8 * 1024;
const MAX_OPERATION_USAGE_LIMIT = 1_000_000_000;
const OPERATION_RETRY_AFTER_SECONDS = 1;
const OPERATION_PROVIDER_RETRY_AFTER_SECONDS = 5;

type OperationModeOptions = { fast?: boolean; compact?: boolean };
type OperationClass = typeof OPERATION_CLASSES[keyof typeof OPERATION_CLASSES];
type OperationFeature = typeof OPERATION_FEATURES[keyof typeof OPERATION_FEATURES];
type OperationLimit = Readonly<{ session: number; runtime: number }>;
type OperationLimits = Readonly<Record<string, OperationLimit>>;
type FeatureUsageLimit = Readonly<{ daily: number; monthly: number }>;
type OperationUsageLimits = Readonly<{
  modelVersion: number;
  daily: number;
  monthly: number;
  features: Readonly<Record<string, FeatureUsageLimit>>;
}>;
type OperationBudgetTarget = {
  operationClass: string;
  operationFeature: OperationFeature | null;
};
type OperationBudgetContext = { operationFeature?: OperationFeature | null };
type OperationDenialScope = 'session' | 'runtime' | 'provider' | 'global_daily' | 'global_30_day' | 'feature_daily' | 'feature_30_day';
type DeniedLease = {
  allowed: false;
  operationClass?: string;
  operationFeature?: string;
  scope: OperationDenialScope;
  retryAfterSeconds: number;
};
type AllowedLease = {
  allowed: true;
  operationClass?: string;
  release: () => unknown | Promise<unknown>;
};
type LeaseDecision = AllowedLease | DeniedLease;
type OperationBudgetStatus = { id: string; sessionLimit: number; runtimeLimit: number; active: number | null };
type OperationBudgetProvider = {
  mode?: string;
  distributed?: boolean;
  limits?: OperationLimits;
  usageLimits?: OperationUsageLimits | null;
  acquire: (operationClass: string, sessionKey: unknown, context?: OperationBudgetContext) => LeaseDecision | Promise<LeaseDecision>;
  status: () => OperationBudgetStatus[] | Promise<OperationBudgetStatus[]>;
};
type OperationBudgetOutcome<T> =
  | { allowed: true; value: T }
  | { allowed: false; denial: DeniedLease };
type EnvironmentInput = Record<string, unknown>;
type DistributedBudgetFactory = (
  config: Record<string, unknown>,
  dependencies?: Record<string, unknown>,
) => OperationBudgetProvider;

function operationFeatureFor(feature: unknown, { fast = false, compact = false }: OperationModeOptions = {}): OperationFeature | null {
  const fastMode = fast === true;
  const compactMode = compact === true;
  if (feature === 'lookup') {
    if (compactMode) return fastMode ? OPERATION_FEATURES.BULK_FAST : OPERATION_FEATURES.BULK_DEEP;
    return fastMode ? OPERATION_FEATURES.LOOKUP_FAST : OPERATION_FEATURES.LOOKUP_DEEP;
  }
  if (feature === 'availability') {
    return fastMode ? OPERATION_FEATURES.AVAILABILITY_FAST : OPERATION_FEATURES.AVAILABILITY_DEEP;
  }
  if (feature === 'rdap') return OPERATION_FEATURES.RDAP;
  if (feature === 'whois') return OPERATION_FEATURES.WHOIS;
  if (feature === 'certificate_transparency') return OPERATION_FEATURES.CERTIFICATE_TRANSPARENCY;
  if (feature === 'domain_posture') return OPERATION_FEATURES.DOMAIN_POSTURE;
  return null;
}

function operationClassFor(feature: unknown, options: OperationModeOptions = {}): OperationClass | null {
  const operationFeature = operationFeatureFor(feature, options);
  return operationFeature ? OPERATION_FEATURE_CLASSES[operationFeature] : null;
}

function operationBudgetTargetFor(feature: unknown, options: OperationModeOptions = {}): Readonly<OperationBudgetTarget> | null {
  const operationFeature = operationFeatureFor(feature, options);
  if (!operationFeature) return null;
  return Object.freeze({
    operationFeature,
    operationClass: OPERATION_FEATURE_CLASSES[operationFeature],
  });
}

function normalizeOperationBudgetTarget(target: unknown): OperationBudgetTarget {
  if (typeof target === 'string' && /^[a-z0-9_]{1,50}$/.test(target)) {
    return { operationClass: target, operationFeature: null };
  }
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new TypeError('A valid operation budget target is required');
  }
  const record = target as Record<string, unknown>;
  const operationClass = record.operationClass;
  const operationFeature = record.operationFeature;
  if (!Object.prototype.hasOwnProperty.call(OPERATION_FEATURE_CLASSES, operationFeature)
    || OPERATION_FEATURE_CLASSES[operationFeature as OperationFeature] !== operationClass) {
    throw new TypeError('Operation feature and concurrency class do not match');
  }
  return { operationClass: operationClass as string, operationFeature: operationFeature as OperationFeature };
}

function normalizeOperationLimits(limits: unknown = DEFAULT_OPERATION_LIMITS): OperationLimits {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new TypeError('Operation limits must be an object');
  }
  const entries = Object.entries(limits);
  if (!entries.length) throw new TypeError('At least one operation limit is required');
  const normalized: Record<string, OperationLimit> = {};
  for (const [id, configured] of entries) {
    const limit = configured as Record<string, unknown> | null;
    if (!/^[a-z0-9_]{1,50}$/.test(id)
      || !limit
      || !Number.isSafeInteger(limit.session)
      || !Number.isSafeInteger(limit.runtime)
      || (limit.session as number) < 1
      || (limit.runtime as number) < (limit.session as number)
      || (limit.runtime as number) > 1000) {
      throw new TypeError(`Invalid operation limits for ${id}`);
    }
    normalized[id] = Object.freeze({ session: limit.session as number, runtime: limit.runtime as number });
  }
  return Object.freeze(normalized);
}

function normalizeUsageCeiling(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < 1
    || (value as number) > MAX_OPERATION_USAGE_LIMIT) {
    throw new TypeError(`${label} must be a positive bounded integer`);
  }
  return value as number;
}

function normalizeOperationUsageLimits(policy: unknown): OperationUsageLimits {
  let value: unknown = policy;
  if (typeof policy === 'string') {
    if (!policy || Buffer.byteLength(policy, 'utf8') > MAX_OPERATION_USAGE_POLICY_BYTES) {
      throw new TypeError('Operation usage policy must be bounded JSON');
    }
    try {
      value = JSON.parse(policy);
    } catch {
      throw new TypeError('Operation usage policy must be valid JSON');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Operation usage policy must be an object');
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(['daily', 'monthly', 'features']);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new TypeError('Operation usage policy contains unknown fields');
  }
  const daily = normalizeUsageCeiling(record.daily, 'Daily operation limit');
  const monthly = normalizeUsageCeiling(record.monthly, '30-day operation limit');
  if (monthly < daily) throw new TypeError('30-day operation limit must not be lower than the daily limit');

  const rawFeatures = record.features === undefined ? {} : record.features;
  if (!rawFeatures || typeof rawFeatures !== 'object' || Array.isArray(rawFeatures)) {
    throw new TypeError('Feature operation limits must be an object');
  }
  const featureEntries = Object.entries(rawFeatures)
    .sort(([left], [right]) => left.localeCompare(right));
  if (featureEntries.length > Object.keys(OPERATION_FEATURE_CLASSES).length) {
    throw new TypeError('Too many feature operation limits were configured');
  }
  const features: Record<string, FeatureUsageLimit> = {};
  for (const [id, configured] of featureEntries) {
    if (!Object.prototype.hasOwnProperty.call(OPERATION_FEATURE_CLASSES, id)
      || !configured
      || typeof configured !== 'object'
      || Array.isArray(configured)
      || Object.keys(configured).some((key) => !['daily', 'monthly'].includes(key))) {
      throw new TypeError(`Invalid feature operation limits for ${id}`);
    }
    const featureLimit = configured as Record<string, unknown>;
    const featureDaily = normalizeUsageCeiling(featureLimit.daily, `Daily ${id} limit`);
    const featureMonthly = normalizeUsageCeiling(featureLimit.monthly, `30-day ${id} limit`);
    if (featureMonthly < featureDaily
      || featureDaily > daily
      || featureMonthly > monthly) {
      throw new TypeError(`Feature operation limits for ${id} must fit within global limits`);
    }
    features[id] = Object.freeze({ daily: featureDaily, monthly: featureMonthly });
  }
  return Object.freeze({
    modelVersion: OPERATION_USAGE_MODEL_VERSION,
    daily,
    monthly,
    features: Object.freeze(features),
  });
}

function createOperationBudget(limits: unknown = DEFAULT_OPERATION_LIMITS): OperationBudgetProvider {
  const configuredLimits = normalizeOperationLimits(limits);
  const runtimeCounts = new Map<string, number>();
  const sessionCounts = new Map<string, number>();

  function acquire(operationClass: string, sessionKey: unknown): LeaseDecision {
    const configured = configuredLimits[operationClass];
    if (!configured) throw new Error(`Unknown operation class: ${operationClass}`);
    if (typeof sessionKey !== 'string' || !sessionKey) throw new Error('A bounded session key is required');

    const sessionCountKey = `${operationClass}:${sessionKey}`;
    const activeForSession = sessionCounts.get(sessionCountKey) || 0;
    if (activeForSession >= configured.session) {
      return {
        allowed: false,
        operationClass,
        scope: 'session',
        retryAfterSeconds: OPERATION_RETRY_AFTER_SECONDS,
      };
    }

    const activeForRuntime = runtimeCounts.get(operationClass) || 0;
    if (activeForRuntime >= configured.runtime) {
      return {
        allowed: false,
        operationClass,
        scope: 'runtime',
        retryAfterSeconds: OPERATION_RETRY_AFTER_SECONDS,
      };
    }

    sessionCounts.set(sessionCountKey, activeForSession + 1);
    runtimeCounts.set(operationClass, activeForRuntime + 1);
    let released = false;
    return {
      allowed: true,
      operationClass,
      release() {
        if (released) return;
        released = true;
        const nextSession = (sessionCounts.get(sessionCountKey) || 1) - 1;
        const nextRuntime = (runtimeCounts.get(operationClass) || 1) - 1;
        if (nextSession > 0) sessionCounts.set(sessionCountKey, nextSession);
        else sessionCounts.delete(sessionCountKey);
        if (nextRuntime > 0) runtimeCounts.set(operationClass, nextRuntime);
        else runtimeCounts.delete(operationClass);
      },
    };
  }

  function status(): OperationBudgetStatus[] {
    return Object.entries(configuredLimits).map(([id, configured]) => ({
      id,
      sessionLimit: configured.session,
      runtimeLimit: configured.runtime,
      active: runtimeCounts.get(id) || 0,
    }));
  }

  return {
    mode: 'in_memory',
    distributed: false,
    limits: configuredLimits,
    usageLimits: null,
    acquire,
    status,
  };
}

function assertOperationBudgetProvider(provider: unknown): OperationBudgetProvider {
  if (!provider || typeof provider !== 'object'
    || typeof (provider as Partial<OperationBudgetProvider>).acquire !== 'function'
    || typeof (provider as Partial<OperationBudgetProvider>).status !== 'function') {
    throw new TypeError('Operation budget providers must implement acquire() and status()');
  }
  return provider as OperationBudgetProvider;
}

// Runs one bounded operation against any provider implementing the deliberately
// small acquire/status contract. A successful acquire returns a lease whose
// release method is invoked exactly once after downstream work settles. The
// tagged result keeps transport-specific 429 shaping in Express and Netlify,
// rather than coupling a future distributed provider to either framework.
async function runWithOperationBudget<T>(
  provider: unknown,
  target: unknown,
  sessionKey: unknown,
  callback: () => T | Promise<T>,
): Promise<OperationBudgetOutcome<Awaited<T>>> {
  const activeProvider = assertOperationBudgetProvider(provider);
  if (typeof callback !== 'function') throw new TypeError('An operation budget callback is required');

  const { operationClass, operationFeature } = normalizeOperationBudgetTarget(target);

  const lease = await activeProvider.acquire(operationClass, sessionKey, { operationFeature });
  if (!lease || typeof lease.allowed !== 'boolean') {
    throw new TypeError('Operation budget acquire() must return an allowed decision');
  }
  if (!lease.allowed) {
    const denial: DeniedLease = {
      ...lease,
      operationClass,
      ...(operationFeature ? { operationFeature } : {}),
    };
    return {
      allowed: false,
      denial,
    };
  }
  if (typeof lease.release !== 'function') {
    throw new TypeError('An allowed operation budget decision must include release()');
  }

  try {
    return { allowed: true, value: await callback() };
  } finally {
    await lease.release();
  }
}

function operationBudgetError(denial: unknown) {
  const value = denial && typeof denial === 'object' ? denial as Record<string, unknown> : null;
  const scope = value && [
    'session',
    'runtime',
    'provider',
    'global_daily',
    'global_30_day',
    'feature_daily',
    'feature_30_day',
  ].includes(value.scope as string)
    ? value.scope as OperationDenialScope
    : 'runtime';
  const operationFeature = value
    && Object.prototype.hasOwnProperty.call(OPERATION_FEATURE_CLASSES, value.operationFeature)
    ? value.operationFeature as OperationFeature
    : null;
  if (scope === 'provider') {
    return {
      error: 'Distributed network-operation limits are temporarily unavailable. Please retry shortly.',
      errorCode: OPERATION_BUDGET_UNAVAILABLE_ERROR_CODE,
      operationClass: value && value.operationClass ? value.operationClass : null,
      limitScope: scope,
      ...(operationFeature ? {
        operationFeature,
        operationFeatureModelVersion: OPERATION_FEATURE_MODEL_VERSION,
      } : {}),
    };
  }
  if (scope.startsWith('global_') || scope.startsWith('feature_')) {
    const featureScoped = scope.startsWith('feature_');
    const dailyWindow = scope.endsWith('daily');
    return {
      error: `${featureScoped ? 'This operation feature has' : 'This deployment has'} reached its ${dailyWindow ? '24-hour' : '30-day'} network-operation allowance. Please retry after the current accounting window resets.`,
      errorCode: OPERATION_USAGE_ERROR_CODE,
      operationClass: value && value.operationClass ? value.operationClass : null,
      limitScope: scope,
      usageWindow: dailyWindow ? '24_hour' : '30_day',
      usageModelVersion: OPERATION_USAGE_MODEL_VERSION,
      ...(operationFeature ? {
        operationFeature,
        operationFeatureModelVersion: OPERATION_FEATURE_MODEL_VERSION,
      } : {}),
    };
  }
  return {
    error: scope === 'session'
      ? 'This session already has the maximum number of network operations in progress. Please retry shortly.'
      : 'This deployment is already processing the maximum number of network operations for this class. Please retry shortly.',
    errorCode: OPERATION_BUDGET_ERROR_CODE,
    operationClass: value && value.operationClass ? value.operationClass : null,
    limitScope: scope,
    ...(operationFeature ? {
      operationFeature,
      operationFeatureModelVersion: OPERATION_FEATURE_MODEL_VERSION,
    } : {}),
  };
}

function operationBudgetHttpStatus(denial: unknown): number {
  return denial && typeof denial === 'object' && (denial as Record<string, unknown>).scope === 'provider' ? 503 : 429;
}

function operationBudgetReport(runtime = 'unknown', provider: unknown = defaultOperationBudget) {
  const activeProvider = assertOperationBudgetProvider(provider);
  const distributed = activeProvider.distributed === true;
  const providerMode = activeProvider.mode;
  const mode = typeof providerMode === 'string'
    && ['in_memory', 'redis_rest', 'unavailable'].includes(providerMode)
    ? providerMode
    : 'unavailable';
  const scope = distributed
    ? 'deployment'
    : mode === 'unavailable'
      ? 'unavailable'
      : runtime === 'netlify'
        ? 'serverless_instance'
        : runtime === 'express'
          ? 'process'
          : 'runtime_instance';
  const limits = activeProvider.limits || DEFAULT_OPERATION_LIMITS;
  return {
    mode,
    scope,
    distributed,
    classes: Object.entries(limits).map(([id, configured]) => ({
      id,
      sessionLimit: configured.session,
      runtimeLimit: configured.runtime,
    })),
    usage: activeProvider.usageLimits
      ? {
          mode: 'distributed_fixed_windows',
          modelVersion: OPERATION_USAGE_MODEL_VERSION,
          windowModel: 'utc_epoch_fixed',
          dailyLimit: activeProvider.usageLimits.daily,
          thirtyDayLimit: activeProvider.usageLimits.monthly,
          features: Object.entries(activeProvider.usageLimits.features).map(([id, configured]) => ({
            id,
            dailyLimit: configured.daily,
            thirtyDayLimit: configured.monthly,
          })),
        }
      : {
          mode: mode === 'unavailable' ? 'unavailable' : 'disabled',
          modelVersion: OPERATION_USAGE_MODEL_VERSION,
          windowModel: 'utc_epoch_fixed',
          dailyLimit: null,
          thirtyDayLimit: null,
          features: [],
        },
  };
}

function createUnavailableOperationBudget(limits: unknown = DEFAULT_OPERATION_LIMITS): OperationBudgetProvider {
  const configuredLimits = normalizeOperationLimits(limits);
  return {
    mode: 'unavailable',
    distributed: false,
    limits: configuredLimits,
    usageLimits: null,
    async acquire(operationClass: string) {
      if (!configuredLimits[operationClass]) throw new Error(`Unknown operation class: ${operationClass}`);
      return {
        allowed: false,
        operationClass,
        scope: 'provider',
        retryAfterSeconds: OPERATION_PROVIDER_RETRY_AFTER_SECONDS,
      };
    },
    async status() {
      return Object.entries(configuredLimits).map(([id, configured]) => ({
        id,
        sessionLimit: configured.session,
        runtimeLimit: configured.runtime,
        active: null,
      }));
    },
  };
}

function createConfiguredOperationBudget(env: EnvironmentInput | null | undefined = process.env, dependencies: Record<string, unknown> = {}): OperationBudgetProvider {
  const url = env && env.UPSTASH_REDIS_REST_URL;
  const token = env && env.UPSTASH_REDIS_REST_TOKEN;
  const usagePolicy = env && env.WHOISLEUTH_OPERATION_USAGE_LIMITS;
  if (!url && !token && !usagePolicy) return createOperationBudget();
  if (!url || !token) return createUnavailableOperationBudget();
  try {
    const usageLimits = usagePolicy ? normalizeOperationUsageLimits(usagePolicy) : null;
    return (createDistributedOperationBudgetImplementation as DistributedBudgetFactory)({
      url,
      token,
      namespace: env.WHOISLEUTH_BUDGET_NAMESPACE,
      limits: DEFAULT_OPERATION_LIMITS,
      usageLimits,
    }, dependencies);
  } catch {
    return createUnavailableOperationBudget();
  }
}

const defaultOperationBudget = createConfiguredOperationBudget();

export {
  OPERATION_CLASSES,
  OPERATION_FEATURE_MODEL_VERSION,
  OPERATION_FEATURES,
  OPERATION_FEATURE_CLASSES,
  DEFAULT_OPERATION_LIMITS,
  OPERATION_BUDGET_ERROR_CODE,
  OPERATION_BUDGET_UNAVAILABLE_ERROR_CODE,
  OPERATION_USAGE_ERROR_CODE,
  OPERATION_USAGE_MODEL_VERSION,
  MAX_OPERATION_USAGE_POLICY_BYTES,
  MAX_OPERATION_USAGE_LIMIT,
  OPERATION_RETRY_AFTER_SECONDS,
  OPERATION_PROVIDER_RETRY_AFTER_SECONDS,
  operationClassFor,
  operationFeatureFor,
  operationBudgetTargetFor,
  normalizeOperationBudgetTarget,
  normalizeOperationLimits,
  normalizeOperationUsageLimits,
  createOperationBudget,
  createUnavailableOperationBudget,
  createConfiguredOperationBudget,
  assertOperationBudgetProvider,
  runWithOperationBudget,
  operationBudgetError,
  operationBudgetHttpStatus,
  operationBudgetReport,
  defaultOperationBudget,
};
