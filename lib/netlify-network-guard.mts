// Shared function-level authentication, rate limiting, and concurrency
// leasing for every network-heavy Netlify endpoint. Keeping these checks
// inside the functions means direct `/.netlify/functions/*` requests receive
// the same application safeguards as canonical `/api/*` redirects, even
// though only the canonical paths can benefit from Netlify edge rate rules.

import {
  isAuthenticatedFromCookieHeader,
  sessionFingerprintFromCookieHeader,
} from './auth.mts';
import { checkRateLimit, getClientIp, API_RATE_LIMIT } from './rate-limit.mts';
import {
  featureDisabledError,
  networkFeaturePolicy,
} from './feature-policy.mts';
import {
  defaultOperationBudget,
  operationBudgetError,
  operationBudgetHttpStatus,
  runWithOperationBudget,
} from './operation-budget.mts';
import { json } from './http.mts';
import type { NetworkFeatureId, NetworkFeaturePolicy } from './feature-policy.mts';
import type { NetlifyJsonResponse } from './http.mts';
import type { NetlifyFunctionEvent } from './netlify-function-types.mts';

type NetlifyGuardResult = {
  response: NetlifyJsonResponse;
  sessionKey?: never;
  featurePolicy?: never;
} | {
  response: null;
  sessionKey: string | null;
  featurePolicy: NetworkFeaturePolicy;
};

function guardNetlifyNetworkRequest(
  event: NetlifyFunctionEvent | null | undefined,
  feature?: NetworkFeatureId,
): NetlifyGuardResult {
  const headers = event && event.headers ? event.headers : {};
  const ip = getClientIp(headers);
  const { allowed, retryAfterSeconds } = checkRateLimit(`api:${ip}`, API_RATE_LIMIT);
  if (!allowed) {
    return {
      response: json(429, {
        error: 'Too many requests. Please try again later.',
        errorCode: 'RATE_LIMITED',
      }, { 'Retry-After': String(retryAfterSeconds) }),
    };
  }

  const cookieHeader = headers.cookie || headers.Cookie;
  if (!isAuthenticatedFromCookieHeader(cookieHeader)) {
    return {
      response: json(401, { error: 'Authentication required', errorCode: 'AUTH_REQUIRED' }),
    };
  }

  const featurePolicy = networkFeaturePolicy();
  if (feature) {
    const disabled = featureDisabledError(feature, featurePolicy);
    if (disabled) return { response: json(503, disabled) };
  }

  return {
    response: null,
    sessionKey: sessionFingerprintFromCookieHeader(cookieHeader),
    featurePolicy,
  };
}

async function withNetlifyOperationBudget<T extends NetlifyJsonResponse>(
  sessionKey: string | null,
  operationTarget: unknown,
  callback: () => Promise<T> | T,
): Promise<T | NetlifyJsonResponse> {
  const outcome = await runWithOperationBudget(defaultOperationBudget, operationTarget, sessionKey, callback);
  if (!outcome.allowed) {
    return json(operationBudgetHttpStatus(outcome.denial), operationBudgetError(outcome.denial), {
      'Retry-After': String(outcome.denial.retryAfterSeconds),
    });
  }
  return outcome.value;
}

export { guardNetlifyNetworkRequest, withNetlifyOperationBudget };
