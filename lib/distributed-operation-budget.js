// Optional distributed concurrency leases and fixed-window operation counters
// backed by an HTTPS Redis-compatible REST endpoint. This module stores only
// operation classes/features, fixed bucket identifiers, integer counts, opaque
// random lease ids, and a one-way hash of the already-opaque session
// fingerprint. It never stores query targets, authentication tokens, evidence,
// or response content.

const crypto = require('crypto');
const { safeFetch, readTextCapped } = require('./safe-fetch');

const DEFAULT_NAMESPACE = 'whoisleuth:operation-budget:v1';
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const PROVIDER_RETRY_AFTER_SECONDS = 5;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAY_WINDOW_MS = 30 * DAY_WINDOW_MS;
const MAX_USAGE_LIMIT = 1_000_000_000;

const ACQUIRE_SCRIPT = `
local current_time = redis.call('TIME')
local now_ms = (tonumber(current_time[1]) * 1000) + math.floor(tonumber(current_time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now_ms)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now_ms)
local runtime_count = redis.call('ZCARD', KEYS[1])
local session_count = redis.call('ZCARD', KEYS[2])
if session_count >= tonumber(ARGV[2]) then
  return {0, 1, runtime_count, session_count}
end
if runtime_count >= tonumber(ARGV[1]) then
  return {0, 2, runtime_count, session_count}
end
local expires_at = now_ms + tonumber(ARGV[3])
redis.call('ZADD', KEYS[1], expires_at, ARGV[4])
redis.call('ZADD', KEYS[2], expires_at, ARGV[4])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) + 60000)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[3]) + 60000)
return {1, 0, runtime_count + 1, session_count + 1}
`.trim();

const ACQUIRE_WITH_USAGE_SCRIPT = `
local current_time = redis.call('TIME')
local now_ms = (tonumber(current_time[1]) * 1000) + math.floor(tonumber(current_time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now_ms)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now_ms)
local runtime_count = redis.call('ZCARD', KEYS[1])
local session_count = redis.call('ZCARD', KEYS[2])
if session_count >= tonumber(ARGV[2]) then
  return {0, 1, runtime_count, session_count, 0, 0, 0, 0, 1}
end
if runtime_count >= tonumber(ARGV[1]) then
  return {0, 2, runtime_count, session_count, 0, 0, 0, 0, 1}
end
local day_ms = ${DAY_WINDOW_MS}
local thirty_day_ms = ${THIRTY_DAY_WINDOW_MS}
local day_bucket = math.floor(now_ms / day_ms)
local thirty_day_bucket = math.floor(now_ms / thirty_day_ms)
local day_reset_ms = (day_bucket + 1) * day_ms
local thirty_day_reset_ms = (thirty_day_bucket + 1) * thirty_day_ms
local global_day_key = KEYS[3] .. ':' .. day_bucket
local global_thirty_day_key = KEYS[4] .. ':' .. thirty_day_bucket
local feature_day_key = KEYS[5] .. ':' .. day_bucket
local feature_thirty_day_key = KEYS[6] .. ':' .. thirty_day_bucket
local function read_counter(key)
  local raw = redis.call('GET', key)
  if not raw then return 0 end
  if not string.match(raw, '^%d+$') then return nil end
  local parsed = tonumber(raw)
  if not parsed or parsed < 0 or parsed > ${MAX_USAGE_LIMIT} then return nil end
  return parsed
end
local global_day_count = read_counter(global_day_key)
local global_thirty_day_count = read_counter(global_thirty_day_key)
local feature_day_count = read_counter(feature_day_key)
local feature_thirty_day_count = read_counter(feature_thirty_day_key)
if not global_day_count or not global_thirty_day_count or not feature_day_count or not feature_thirty_day_count then
  return {-1, 0, runtime_count, session_count, 0, 0, 0, 0, 1}
end
if global_day_count >= tonumber(ARGV[5]) then
  return {0, 3, runtime_count, session_count, global_day_count, global_thirty_day_count, feature_day_count, feature_thirty_day_count, math.max(1, math.ceil((day_reset_ms - now_ms) / 1000))}
end
if global_thirty_day_count >= tonumber(ARGV[6]) then
  return {0, 4, runtime_count, session_count, global_day_count, global_thirty_day_count, feature_day_count, feature_thirty_day_count, math.max(1, math.ceil((thirty_day_reset_ms - now_ms) / 1000))}
end
if tonumber(ARGV[7]) > 0 and feature_day_count >= tonumber(ARGV[7]) then
  return {0, 5, runtime_count, session_count, global_day_count, global_thirty_day_count, feature_day_count, feature_thirty_day_count, math.max(1, math.ceil((day_reset_ms - now_ms) / 1000))}
end
if tonumber(ARGV[8]) > 0 and feature_thirty_day_count >= tonumber(ARGV[8]) then
  return {0, 6, runtime_count, session_count, global_day_count, global_thirty_day_count, feature_day_count, feature_thirty_day_count, math.max(1, math.ceil((thirty_day_reset_ms - now_ms) / 1000))}
end
local expires_at = now_ms + tonumber(ARGV[3])
redis.call('ZADD', KEYS[1], expires_at, ARGV[4])
redis.call('ZADD', KEYS[2], expires_at, ARGV[4])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) + 60000)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[3]) + 60000)
global_day_count = redis.call('INCR', global_day_key)
global_thirty_day_count = redis.call('INCR', global_thirty_day_key)
feature_day_count = redis.call('INCR', feature_day_key)
feature_thirty_day_count = redis.call('INCR', feature_thirty_day_key)
redis.call('PEXPIREAT', global_day_key, day_reset_ms + 60000)
redis.call('PEXPIREAT', feature_day_key, day_reset_ms + 60000)
redis.call('PEXPIREAT', global_thirty_day_key, thirty_day_reset_ms + 60000)
redis.call('PEXPIREAT', feature_thirty_day_key, thirty_day_reset_ms + 60000)
return {1, 0, runtime_count + 1, session_count + 1, global_day_count, global_thirty_day_count, feature_day_count, feature_thirty_day_count, 0}
`.trim();

const RELEASE_SCRIPT = `
local runtime_removed = redis.call('ZREM', KEYS[1], ARGV[1])
local session_removed = redis.call('ZREM', KEYS[2], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
if redis.call('ZCARD', KEYS[2]) == 0 then redis.call('DEL', KEYS[2]) end
return {runtime_removed, session_removed}
`.trim();

const STATUS_SCRIPT = `
local current_time = redis.call('TIME')
local now_ms = (tonumber(current_time[1]) * 1000) + math.floor(tonumber(current_time[2]) / 1000)
local counts = {}
for index, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms)
  counts[index] = redis.call('ZCARD', key)
  if counts[index] == 0 then redis.call('DEL', key) end
end
return counts
`.trim();

function normalizedRestUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new Error('A bounded distributed-budget REST URL is required');
  }
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('The distributed-budget REST URL must be an HTTPS origin without credentials');
  }
  if (parsed.hostname !== 'upstash.io' && !parsed.hostname.endsWith('.upstash.io')) {
    throw new Error('The distributed-budget REST URL must use the configured service endpoint domain');
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('The distributed-budget REST URL must not include a path, query, or fragment');
  }
  return parsed.origin;
}

function normalizedToken(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('A bounded distributed-budget REST token is required');
  }
  return value;
}

function normalizedNamespace(value = DEFAULT_NAMESPACE) {
  if (typeof value !== 'string' || !/^[a-z0-9:_-]{1,64}$/i.test(value)) {
    throw new Error('The distributed-budget namespace must use 1-64 letters, digits, colons, underscores, or hyphens');
  }
  return value;
}

function normalizedLeaseTtl(value = DEFAULT_LEASE_TTL_MS) {
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < 30_000 || ttl > 15 * 60 * 1000) {
    throw new Error('The distributed-budget lease TTL must be between 30 seconds and 15 minutes');
  }
  return ttl;
}

function normalizedLimits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Distributed operation limits are required');
  }
  const entries = Object.entries(value);
  if (!entries.length) throw new Error('At least one distributed operation limit is required');
  const limits = {};
  for (const [id, configured] of entries) {
    if (!/^[a-z0-9_]{1,50}$/.test(id)
      || !configured
      || !Number.isSafeInteger(configured.session)
      || !Number.isSafeInteger(configured.runtime)
      || configured.session < 1
      || configured.runtime < configured.session
      || configured.runtime > 1000) {
      throw new Error(`Invalid distributed operation limits for ${id}`);
    }
    limits[id] = Object.freeze({ session: configured.session, runtime: configured.runtime });
  }
  return Object.freeze(limits);
}

function normalizedUsageLimits(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Distributed usage limits must be an object');
  }
  const daily = value.daily;
  const monthly = value.monthly;
  if (!Number.isSafeInteger(daily)
    || !Number.isSafeInteger(monthly)
    || daily < 1
    || monthly < daily
    || monthly > MAX_USAGE_LIMIT) {
    throw new Error('Invalid distributed global usage limits');
  }
  const rawFeatures = value.features == null ? {} : value.features;
  if (!rawFeatures || typeof rawFeatures !== 'object' || Array.isArray(rawFeatures)) {
    throw new Error('Distributed feature usage limits must be an object');
  }
  const entries = Object.entries(rawFeatures)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > 50) throw new Error('Too many distributed feature usage limits');
  const features = {};
  for (const [id, configured] of entries) {
    const featureDaily = configured && configured.daily;
    const featureMonthly = configured && configured.monthly;
    if (!/^[a-z0-9_]{1,50}$/.test(id)
      || !Number.isSafeInteger(featureDaily)
      || !Number.isSafeInteger(featureMonthly)
      || featureDaily < 1
      || featureMonthly < featureDaily
      || featureDaily > daily
      || featureMonthly > monthly) {
      throw new Error(`Invalid distributed feature usage limits for ${id}`);
    }
    features[id] = Object.freeze({ daily: featureDaily, monthly: featureMonthly });
  }
  return Object.freeze({
    modelVersion: 1,
    daily,
    monthly,
    features: Object.freeze(features),
  });
}

function createRestCommandClient({ url, token }, dependencies = {}) {
  const endpoint = normalizedRestUrl(url);
  const bearerToken = normalizedToken(token);
  const request = dependencies.safeFetch || safeFetch;
  const readResponse = dependencies.readTextCapped || readTextCapped;

  return async function command(body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    let response;
    try {
      response = await request(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }, 0);
      const captured = await readResponse(response, MAX_RESPONSE_BYTES);
      if (captured.truncated) throw new Error('Distributed-budget provider response exceeded its size limit');
      let payload;
      try {
        payload = JSON.parse(captured.text);
      } catch {
        throw new Error('Distributed-budget provider returned malformed JSON');
      }
      if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`Distributed-budget provider rejected the command (HTTP ${response.status})`);
      }
      if (typeof payload.error === 'string' && payload.error) {
        throw new Error('Distributed-budget provider rejected the command');
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
        throw new Error('Distributed-budget provider response omitted its result');
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
      response?.body?.cancel?.().catch(() => {});
    }
  };
}

function classKeys(namespace, operationClass, sessionKey) {
  const sessionHash = crypto.createHash('sha256').update(sessionKey).digest('hex');
  return {
    runtime: `${namespace}:runtime:${operationClass}`,
    session: `${namespace}:session:${operationClass}:${sessionHash}`,
  };
}

function usageKeys(namespace, operationFeature) {
  return {
    globalDay: `${namespace}:usage:global:day`,
    globalThirtyDay: `${namespace}:usage:global:thirty_day`,
    featureDay: `${namespace}:usage:feature:${operationFeature}:day`,
    featureThirtyDay: `${namespace}:usage:feature:${operationFeature}:thirty_day`,
  };
}

function normalizedOperationFeature(context) {
  const value = context && context.operationFeature;
  if (value == null) return 'unattributed';
  if (typeof value !== 'string' || !/^[a-z0-9_]{1,50}$/.test(value)) {
    throw new Error('A bounded operation feature is required for distributed accounting');
  }
  return value;
}

function providerUnavailable(operationClass) {
  return {
    allowed: false,
    operationClass,
    scope: 'provider',
    retryAfterSeconds: PROVIDER_RETRY_AFTER_SECONDS,
  };
}

function validResultArray(value, minimumLength) {
  return Array.isArray(value)
    && value.length >= minimumLength
    && value.slice(0, minimumLength).every((item) => Number.isSafeInteger(Number(item)) && Number(item) >= 0);
}

function createDistributedOperationBudget(config, dependencies = {}) {
  const limits = normalizedLimits(config && config.limits);
  const usageLimits = normalizedUsageLimits(config && config.usageLimits);
  const namespace = normalizedNamespace(config.namespace);
  const leaseTtlMs = normalizedLeaseTtl(config.leaseTtlMs);
  const command = dependencies.command || createRestCommandClient(config, dependencies);
  const createLeaseId = dependencies.createLeaseId || (() => crypto.randomBytes(16).toString('hex'));

  async function acquire(operationClass, sessionKey, context = {}) {
    const configured = limits[operationClass];
    if (!configured) throw new Error(`Unknown operation class: ${operationClass}`);
    if (typeof sessionKey !== 'string' || !sessionKey || sessionKey.length > 256) {
      throw new Error('A bounded session key is required');
    }
    const leaseId = createLeaseId();
    if (typeof leaseId !== 'string' || !/^[a-f0-9]{32}$/i.test(leaseId)) {
      throw new Error('Distributed operation lease ids must be 128-bit hexadecimal values');
    }
    const keys = classKeys(namespace, operationClass, sessionKey);
    const operationFeature = normalizedOperationFeature(context);
    let acquireCommand;
    if (usageLimits) {
      const usage = usageKeys(namespace, operationFeature);
      const featureLimits = usageLimits.features[operationFeature];
      acquireCommand = [
        'EVAL',
        ACQUIRE_WITH_USAGE_SCRIPT,
        6,
        keys.runtime,
        keys.session,
        usage.globalDay,
        usage.globalThirtyDay,
        usage.featureDay,
        usage.featureThirtyDay,
        configured.runtime,
        configured.session,
        leaseTtlMs,
        leaseId,
        usageLimits.daily,
        usageLimits.monthly,
        featureLimits ? featureLimits.daily : 0,
        featureLimits ? featureLimits.monthly : 0,
      ];
    } else {
      acquireCommand = [
        'EVAL',
        ACQUIRE_SCRIPT,
        2,
        keys.runtime,
        keys.session,
        configured.runtime,
        configured.session,
        leaseTtlMs,
        leaseId,
      ];
    }
    let result;
    try {
      result = await command(acquireCommand);
    } catch {
      return providerUnavailable(operationClass);
    }
    const resultLength = usageLimits ? 9 : 4;
    if (!validResultArray(result, resultLength)) return providerUnavailable(operationClass);
    const allowed = Number(result[0]) === 1;
    if (!allowed) {
      const scopeCode = Number(result[1]);
      const scopes = {
        1: 'session',
        2: 'runtime',
        3: 'global_daily',
        4: 'global_30_day',
        5: 'feature_daily',
        6: 'feature_30_day',
      };
      if (!Object.prototype.hasOwnProperty.call(scopes, scopeCode)) return providerUnavailable(operationClass);
      const usageDenial = scopeCode >= 3;
      const retryAfterSeconds = usageDenial ? Number(result[8]) : 1;
      if (!Number.isSafeInteger(retryAfterSeconds)
        || retryAfterSeconds < 1
        || retryAfterSeconds > THIRTY_DAY_WINDOW_MS / 1000) {
        return providerUnavailable(operationClass);
      }
      return {
        allowed: false,
        operationClass,
        ...(operationFeature !== 'unattributed' ? { operationFeature } : {}),
        scope: scopes[scopeCode],
        retryAfterSeconds,
      };
    }

    let released = false;
    return {
      allowed: true,
      operationClass,
      async release() {
        if (released) return true;
        released = true;
        try {
          const releaseResult = await command([
            'EVAL',
            RELEASE_SCRIPT,
            2,
            keys.runtime,
            keys.session,
            leaseId,
          ]);
          return validResultArray(releaseResult, 2);
        } catch {
          // The sorted-set lease expires automatically. A release outage must
          // not replace a completed lookup result or decrement a newer lease.
          return false;
        }
      },
    };
  }

  async function status() {
    const entries = Object.entries(limits);
    const keys = entries.map(([operationClass]) => `${namespace}:runtime:${operationClass}`);
    const result = await command(['EVAL', STATUS_SCRIPT, keys.length, ...keys]);
    if (!validResultArray(result, keys.length)) {
      throw new Error('Distributed-budget provider returned malformed status');
    }
    return entries.map(([id, configured], index) => ({
      id,
      sessionLimit: configured.session,
      runtimeLimit: configured.runtime,
      active: Number(result[index]),
    }));
  }

  return {
    mode: 'redis_rest',
    distributed: true,
    limits,
    usageLimits,
    acquire,
    status,
  };
}

module.exports = {
  DEFAULT_NAMESPACE,
  DEFAULT_LEASE_TTL_MS,
  PROVIDER_RETRY_AFTER_SECONDS,
  DAY_WINDOW_MS,
  THIRTY_DAY_WINDOW_MS,
  ACQUIRE_SCRIPT,
  ACQUIRE_WITH_USAGE_SCRIPT,
  RELEASE_SCRIPT,
  STATUS_SCRIPT,
  normalizedRestUrl,
  normalizedToken,
  normalizedNamespace,
  normalizedLimits,
  normalizedUsageLimits,
  normalizedOperationFeature,
  createRestCommandClient,
  createDistributedOperationBudget,
};
