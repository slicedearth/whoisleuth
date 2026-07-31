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

const handleRdapNameserverSearch: NetlifyFunctionHandler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'rdap_nameserver_search');
  if (guard.response) return guard.response;

  return withNetlifyOperationBudget(
    guard.sessionKey,
    operationBudgetTargetFor('rdap_nameserver_search'),
    async () => {
      try {
        const result = await searchRdapNameserver(
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
};

const handler = withNetlifyApiErrorBoundary(handleRdapNameserverSearch);

export { handler };
