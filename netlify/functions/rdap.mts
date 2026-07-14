import { classifyQuery } from '../../lib/classify.mts';
import { fetchRdapRecord } from '../../lib/rdap.js';
import { operationBudgetTargetFor } from '../../lib/operation-budget.js';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handler: NetlifyFunctionHandler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'rdap');
  if (guard.response) return guard.response;

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return json(400, { error: err.message });
  }

  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('rdap'), async () => {
    try {
      const record = await fetchRdapRecord(classified.type, classified.value);
      if (!record) {
        return json(404, { error: `No RDAP registry found for "${q}" via IANA bootstrap` });
      }

      return json(200, {
        query: q,
        type: classified.type,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        ...record,
      });
    } catch (err) {
      return json(500, { error: err.message });
    }
  });
};

export { handler };
