// Shared function-level authentication, rate limiting, and concurrency
// leasing for every network-heavy Netlify endpoint. Keeping these checks
// inside the functions means direct `/.netlify/functions/*` requests receive
// the same application safeguards as canonical `/api/*` redirects, even
// though only the canonical paths can benefit from Netlify edge rate rules.

const {
  isAuthenticatedFromCookieHeader,
  sessionFingerprintFromCookieHeader,
} = require('./auth');
const { checkRateLimit, getClientIp, API_RATE_LIMIT } = require('./rate-limit');
const {
  defaultOperationBudget,
  operationBudgetError,
} = require('./operation-budget');
const { json } = require('./http');

function guardNetlifyNetworkRequest(event) {
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

  return {
    response: null,
    sessionKey: sessionFingerprintFromCookieHeader(cookieHeader),
  };
}

async function withNetlifyOperationBudget(sessionKey, operationClass, callback) {
  const lease = defaultOperationBudget.acquire(operationClass, sessionKey);
  if (!lease.allowed) {
    return json(429, operationBudgetError(lease), {
      'Retry-After': String(lease.retryAfterSeconds),
    });
  }
  try {
    return await callback();
  } finally {
    lease.release?.();
  }
}

module.exports = { guardNetlifyNetworkRequest, withNetlifyOperationBudget };
