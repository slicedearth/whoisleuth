import { classifyQuery } from '../../lib/classify.mts';
import { checkDomainAvailability } from '../../lib/availability.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handler: NetlifyFunctionHandler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'availability');
  if (guard.response) return guard.response;

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return json(400, { error: err.message });
  }
  if (classified.type !== 'domain') {
    return json(200, { applicable: false, type: classified.type });
  }

  const params = event.queryStringParameters || {};
  const fast = params.fast === '1' || params.fast === 'true';
  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('availability', { fast }), async () => {
    try {
      const result = await checkDomainAvailability(classified.value, { fast, featurePolicy: guard.featurePolicy });
      return json(200, {
        applicable: true,
        domain: classified.value,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        isSubdomain: classified.isSubdomain,
        ...result,
      });
    } catch (err) {
      return json(500, { error: err.message });
    }
  });
};

export { handler };
