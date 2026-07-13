// Immediate, in-memory concurrency leases for network-heavy API operations.
//
// This is deliberately a small local safety boundary, not distributed usage
// accounting. A long-lived Express process shares one instance; a serverless
// runtime only shares it within one warm function instance and loses the state
// on a cold start. The provider-neutral runner below deliberately treats
// acquisition as one atomic operation rather than exposing a race-prone
// check-then-consume sequence. Providers may acquire and release either
// synchronously or asynchronously, so a shared backend can be added without
// changing endpoint orchestration.

const OPERATION_CLASSES = Object.freeze({
  REGISTRY_LIGHT: 'registry_light',
  REGISTRY_DEEP: 'registry_deep',
  CERTIFICATE_SEARCH: 'certificate_search',
  POSTURE_AUDIT: 'posture_audit',
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
const OPERATION_RETRY_AFTER_SECONDS = 1;

function operationClassFor(feature, { fast = false } = {}) {
  if (feature === 'lookup' || feature === 'availability') {
    return fast ? OPERATION_CLASSES.REGISTRY_LIGHT : OPERATION_CLASSES.REGISTRY_DEEP;
  }
  if (feature === 'rdap') return OPERATION_CLASSES.REGISTRY_LIGHT;
  if (feature === 'whois') return OPERATION_CLASSES.REGISTRY_DEEP;
  if (feature === 'certificate_transparency') return OPERATION_CLASSES.CERTIFICATE_SEARCH;
  if (feature === 'domain_posture') return OPERATION_CLASSES.POSTURE_AUDIT;
  return null;
}

function createOperationBudget(limits = DEFAULT_OPERATION_LIMITS) {
  const runtimeCounts = new Map();
  const sessionCounts = new Map();

  function acquire(operationClass, sessionKey) {
    const configured = limits[operationClass];
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

  function status() {
    return Object.entries(limits).map(([id, configured]) => ({
      id,
      sessionLimit: configured.session,
      runtimeLimit: configured.runtime,
      active: runtimeCounts.get(id) || 0,
    }));
  }

  return { acquire, status };
}

function assertOperationBudgetProvider(provider) {
  if (!provider || typeof provider.acquire !== 'function' || typeof provider.status !== 'function') {
    throw new TypeError('Operation budget providers must implement acquire() and status()');
  }
  return provider;
}

// Runs one bounded operation against any provider implementing the deliberately
// small acquire/status contract. A successful acquire returns a lease whose
// release method is invoked exactly once after downstream work settles. The
// tagged result keeps transport-specific 429 shaping in Express and Netlify,
// rather than coupling a future distributed provider to either framework.
async function runWithOperationBudget(provider, operationClass, sessionKey, callback) {
  assertOperationBudgetProvider(provider);
  if (typeof callback !== 'function') throw new TypeError('An operation budget callback is required');

  const lease = await provider.acquire(operationClass, sessionKey);
  if (!lease || typeof lease.allowed !== 'boolean') {
    throw new TypeError('Operation budget acquire() must return an allowed decision');
  }
  if (!lease.allowed) return { allowed: false, denial: lease };
  if (typeof lease.release !== 'function') {
    throw new TypeError('An allowed operation budget decision must include release()');
  }

  try {
    return { allowed: true, value: await callback() };
  } finally {
    await lease.release();
  }
}

function operationBudgetError(denial) {
  const scope = denial && denial.scope === 'session' ? 'session' : 'runtime';
  return {
    error: scope === 'session'
      ? 'This session already has the maximum number of network operations in progress. Please retry shortly.'
      : 'This deployment is already processing the maximum number of network operations for this class. Please retry shortly.',
    errorCode: OPERATION_BUDGET_ERROR_CODE,
    operationClass: denial && denial.operationClass ? denial.operationClass : null,
    limitScope: scope,
  };
}

function operationBudgetReport(runtime = 'unknown') {
  const scope = runtime === 'netlify' ? 'serverless_instance' : runtime === 'express' ? 'process' : 'runtime_instance';
  return {
    mode: 'in_memory',
    scope,
    distributed: false,
    classes: Object.entries(DEFAULT_OPERATION_LIMITS).map(([id, configured]) => ({
      id,
      sessionLimit: configured.session,
      runtimeLimit: configured.runtime,
    })),
  };
}

const defaultOperationBudget = createOperationBudget();

module.exports = {
  OPERATION_CLASSES,
  DEFAULT_OPERATION_LIMITS,
  OPERATION_BUDGET_ERROR_CODE,
  OPERATION_RETRY_AFTER_SECONDS,
  operationClassFor,
  createOperationBudget,
  assertOperationBudgetProvider,
  runWithOperationBudget,
  operationBudgetError,
  operationBudgetReport,
  defaultOperationBudget,
};
