import { classifyQuery } from '../../lib/classify.mts';
import { fetchRdapRecord } from '../../lib/rdap.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

type RdapHandlerDependencies = Readonly<{
  fetchRdapRecord: typeof fetchRdapRecord;
}>;

async function handleRdap(
  event: Parameters<NetlifyFunctionHandler>[0],
  dependencies: RdapHandlerDependencies = { fetchRdapRecord },
): ReturnType<NetlifyFunctionHandler> {
  const guard = guardNetlifyNetworkRequest(event, 'rdap');
  if (guard.response) return guard.response;

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch {
    return json(400, { error: 'Invalid query' });
  }

  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('rdap'), async () => {
    const record = await dependencies.fetchRdapRecord(classified.type, classified.value);
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
  });
}

function createRdapHandler(
  dependencies: RdapHandlerDependencies = { fetchRdapRecord },
): NetlifyFunctionHandler {
  return withNetlifyApiErrorBoundary(
    (request) => handleRdap(request, dependencies),
  );
}

const handler = createRdapHandler();

export { createRdapHandler, handler };
export type { RdapHandlerDependencies };
