const { classifyQuery } = require('../../lib/classify');
const { runUnifiedLookup, LOOKUP_ERROR_CODES } = require('../../lib/lookup');
const { operationClassFor } = require('../../lib/operation-budget');
const { guardNetlifyNetworkRequest, withNetlifyOperationBudget } = require('../../lib/netlify-network-guard');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'lookup');
  if (guard.response) return guard.response;

  const params = event.queryStringParameters || {};
  const q = (params.q || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"', errorCode: LOOKUP_ERROR_CODES.MISSING_QUERY });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return json(400, { error: err.message, errorCode: LOOKUP_ERROR_CODES.INVALID_QUERY });
  }

  const fast = params.fast === '1' || params.fast === 'true';
  return withNetlifyOperationBudget(guard.sessionKey, operationClassFor('lookup', { fast }), async () => {
    try {
      const compact = params.compact === '1' || params.compact === 'true';
      const result = await runUnifiedLookup(classified, { fast, compact, featurePolicy: guard.featurePolicy });
      return json(200, {
        query: q,
        type: classified.type,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        isSubdomain: classified.isSubdomain,
        ...result,
      });
    } catch (err) {
      return json(500, { error: err.message, errorCode: LOOKUP_ERROR_CODES.LOOKUP_FAILED });
    }
  });
};
