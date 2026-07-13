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
const { featureDisabledError, networkFeaturePolicy } = require('./feature-policy');
const {
  defaultOperationBudget,
  operationBudgetError,
  operationBudgetHttpStatus,
  runWithOperationBudget,
} = require('./operation-budget');
const { json } = require('./http');

function guardNetlifyNetworkRequest(event, feature) {
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

async function withNetlifyOperationBudget(sessionKey, operationTarget, callback) {
  const outcome = await runWithOperationBudget(defaultOperationBudget, operationTarget, sessionKey, callback);
  if (!outcome.allowed) {
    return json(operationBudgetHttpStatus(outcome.denial), operationBudgetError(outcome.denial), {
      'Retry-After': String(outcome.denial.retryAfterSeconds),
    });
  }
  return outcome.value;
}

module.exports = { guardNetlifyNetworkRequest, withNetlifyOperationBudget };
