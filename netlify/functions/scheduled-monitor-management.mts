// Authenticated browser-management boundary for optional hosted monitoring.
// GET returns only the bounded public projection. POST requires a same-origin
// browser request and accepts one strict management command. Blob construction
// remains fail-closed behind the complete opt-in configuration.

import { getStore } from '@netlify/blobs';
import { isTrustedOrigin } from '../../lib/auth.mts';
import { json } from '../../lib/http.mts';
import { guardNetlifyNetworkRequest } from '../../lib/netlify-network-guard.mts';
import {
  checkRateLimit,
  SCHEDULED_MONITOR_MANAGEMENT_RATE_LIMIT,
} from '../../lib/rate-limit.mts';
import {
  createScheduledMonitorManager,
  MANAGEMENT_ERROR_CODES,
  ScheduledMonitorManagementError,
} from '../../lib/scheduled-monitor-management.mts';
import {
  SCHEDULED_MONITOR_STORE_NAME,
  scheduledMonitorRuntimeConfiguration,
} from '../../lib/scheduled-monitor-configuration.mts';
import {
  createScheduledMonitorRepository,
  SCHEDULED_MONITOR_UNAVAILABLE_CODE,
  ScheduledMonitorUnavailableError,
} from '../../lib/scheduled-monitor-runtime.mts';
import type { NetlifyFunctionEvent } from '../../lib/netlify-function-types.mts';
import type { NetlifyBlobStore } from '../../lib/scheduled-monitor-netlify-store.mts';
import type { EnvironmentInput } from '../../lib/scheduled-monitor-configuration.mts';

type BlobStoreFactory = (name: string) => NetlifyBlobStore;
type ManagementFunctionOptions = {
  env?: EnvironmentInput | null;
  blobStoreFactory?: BlobStoreFactory;
  now?: () => number;
  randomUUID?: () => string;
};

const MAX_SCHEDULED_MONITOR_MANAGEMENT_BODY_BYTES = 1024 * 1024;
const NO_STORE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
const MANAGEMENT_STATUS = Object.freeze({
  [MANAGEMENT_ERROR_CODES.INVALID_REQUEST]: 400,
  [MANAGEMENT_ERROR_CODES.NOT_FOUND]: 404,
  [MANAGEMENT_ERROR_CODES.NAME_CONFLICT]: 409,
  [MANAGEMENT_ERROR_CODES.LIMIT_REACHED]: 409,
  [MANAGEMENT_ERROR_CODES.CAPACITY_EXCEEDED]: 409,
});

function configuredManager(options: ManagementFunctionOptions) {
  const env = options.env === undefined ? process.env : options.env;
  const configuration = scheduledMonitorRuntimeConfiguration(env);
  if (configuration.status !== 'ready') {
    throw new ScheduledMonitorUnavailableError(
      configuration.reason || 'Scheduled monitoring is unavailable.',
    );
  }
  const storeFactory = options.blobStoreFactory || ((name) => getStore(name));
  const blobStore = storeFactory(SCHEDULED_MONITOR_STORE_NAME);
  const repository = createScheduledMonitorRepository({ env, blobStore });
  return createScheduledMonitorManager({
    repository,
    ...(options.now ? { now: options.now } : {}),
    ...(options.randomUUID ? { randomUUID: options.randomUUID } : {}),
  });
}

function noStoreResponse(response: ReturnType<typeof json>) {
  return {
    ...response,
    headers: { ...response.headers, ...NO_STORE_HEADERS },
  };
}

function managementErrorResponse(error: unknown) {
  if (error instanceof ScheduledMonitorManagementError) {
    return json(MANAGEMENT_STATUS[error.code] || 400, {
      error: error.message,
      errorCode: error.code,
    }, NO_STORE_HEADERS);
  }
  if (error instanceof ScheduledMonitorUnavailableError) {
    return json(503, {
      error: error.message,
      errorCode: SCHEDULED_MONITOR_UNAVAILABLE_CODE,
    }, NO_STORE_HEADERS);
  }
  return json(503, {
    error: 'Scheduled monitoring storage is temporarily unavailable.',
    errorCode: SCHEDULED_MONITOR_UNAVAILABLE_CODE,
  }, NO_STORE_HEADERS);
}

async function runScheduledMonitorManagementFunction(
  event: NetlifyFunctionEvent,
  options: ManagementFunctionOptions = {},
) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, {
      error: 'Method not allowed',
      errorCode: 'METHOD_NOT_ALLOWED',
    }, { ...NO_STORE_HEADERS, Allow: 'GET, POST' });
  }
  const guard = guardNetlifyNetworkRequest(event);
  if (guard.response) return noStoreResponse(guard.response);
  if (event.httpMethod === 'POST' && !isTrustedOrigin(event.headers)) {
    return json(403, {
      error: 'Cross-site request blocked',
      errorCode: 'CROSS_SITE_REQUEST_BLOCKED',
    }, NO_STORE_HEADERS);
  }
  const rate = checkRateLimit(
    `scheduled-monitor-management:${guard.sessionKey}`,
    SCHEDULED_MONITOR_MANAGEMENT_RATE_LIMIT,
  );
  if (!rate.allowed) {
    return json(429, {
      error: 'Too many hosted monitoring requests. Please try again later.',
      errorCode: 'RATE_LIMITED',
    }, {
      ...NO_STORE_HEADERS,
      'Retry-After': String(rate.retryAfterSeconds),
    });
  }

  try {
    let command: unknown;
    if (event.httpMethod === 'POST') {
      const body = event.body || '';
      if (Buffer.byteLength(body, 'utf8') > MAX_SCHEDULED_MONITOR_MANAGEMENT_BODY_BYTES) {
        return json(413, {
          error: 'Scheduled monitoring requests are limited to 1 MiB.',
          errorCode: 'REQUEST_TOO_LARGE',
        }, NO_STORE_HEADERS);
      }
      try {
        command = JSON.parse(body);
      } catch {
        return json(400, {
          error: 'Invalid request body',
          errorCode: MANAGEMENT_ERROR_CODES.INVALID_REQUEST,
        }, NO_STORE_HEADERS);
      }
    }
    const manager = configuredManager(options);
    return event.httpMethod === 'GET'
      ? json(200, await manager.read(), NO_STORE_HEADERS)
      : json(200, await manager.execute(command), NO_STORE_HEADERS);
  } catch (error) {
    return managementErrorResponse(error);
  }
}

const handler = (event: NetlifyFunctionEvent) => runScheduledMonitorManagementFunction(event);

export { handler };
export {
  MAX_SCHEDULED_MONITOR_MANAGEMENT_BODY_BYTES,
  runScheduledMonitorManagementFunction,
};
export type { BlobStoreFactory, ManagementFunctionOptions };
