import { classifyQuery } from '../../lib/classify.mts';
import { runUnifiedLookup, LOOKUP_ERROR_CODES } from '../../lib/lookup.mts';
import { createLookupHttpResponse } from '../../lib/lookup-response-contract.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handleLookup: NetlifyFunctionHandler = async (event) => {
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
  const compact = params.compact === '1' || params.compact === 'true';
  const externalIntelligence = params.intelligence === '1' || params.intelligence === 'true';
  const malwareHostIntelligence = params.malware === '1' || params.malware === 'true';
  const malwareIocIntelligence = params.ioc === '1' || params.ioc === 'true';
  const securityTxt = params.security_txt === '1' || params.security_txt === 'true';
  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('lookup', { fast, compact }), async () => {
    const result = await runUnifiedLookup(classified, {
      fast,
      compact,
      externalIntelligence,
      malwareHostIntelligence,
      malwareIocIntelligence,
      securityTxt,
      featurePolicy: guard.featurePolicy,
    });
    return json(200, createLookupHttpResponse(q, classified, result));
  });
};

const handler = withNetlifyApiErrorBoundary(handleLookup, LOOKUP_ERROR_CODES.LOOKUP_FAILED);

export { handler };
