import { classifyQuery } from '../../lib/classify.mts';
import { buildWhoisChain, parseWhoisChain } from '../../lib/whois.js';
import { operationBudgetTargetFor } from '../../lib/operation-budget.js';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handler: NetlifyFunctionHandler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'whois');
  if (guard.response) return guard.response;

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return json(400, { error: err.message });
  }

  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('whois'), async () => {
    try {
      const chain = await buildWhoisChain(classified.value);
      return json(200, {
        query: q,
        type: classified.type,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        chain,
        parsed: parseWhoisChain(chain),
      });
    } catch (err) {
      return json(500, { error: err.message });
    }
  });
};

export { handler };
