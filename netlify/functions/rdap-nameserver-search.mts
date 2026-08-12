import {
  RdapNameserverSearchInputError,
  searchRdapNameserver,
} from '../../lib/rdap-nameserver-search.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import {
  guardNetlifyNetworkRequest,
  withNetlifyOperationBudget,
} from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

type RdapNameserverSearchHandlerDependencies = Readonly<{
  searchRdapNameserver: typeof searchRdapNameserver;
}>;

async function handleRdapNameserverSearch(
  event: Parameters<NetlifyFunctionHandler>[0],
  dependencies: RdapNameserverSearchHandlerDependencies = { searchRdapNameserver },
): ReturnType<NetlifyFunctionHandler> {
  const guard = guardNetlifyNetworkRequest(event, 'rdap_nameserver_search');
  if (guard.response) return guard.response;

  return withNetlifyOperationBudget(
    guard.sessionKey,
    operationBudgetTargetFor('rdap_nameserver_search'),
    async () => {
      try {
        const result = await dependencies.searchRdapNameserver(
          event.queryStringParameters?.nameserver,
          event.queryStringParameters?.scope,
        );
        return json(200, result);
      } catch (error) {
        if (error instanceof RdapNameserverSearchInputError) {
          return json(400, { error: error.message, errorCode: error.code });
        }
        throw error;
      }
    },
  );
}

function createRdapNameserverSearchHandler(
  dependencies: RdapNameserverSearchHandlerDependencies = { searchRdapNameserver },
): NetlifyFunctionHandler {
  return withNetlifyApiErrorBoundary(
    (request) => handleRdapNameserverSearch(request, dependencies),
  );
}

const handler = createRdapNameserverSearchHandler();

export { createRdapNameserverSearchHandler, handler };
export type { RdapNameserverSearchHandlerDependencies };
