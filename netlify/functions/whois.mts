import { classifyQuery } from '../../lib/classify.mts';
import { buildWhoisChain, parseWhoisChain } from '../../lib/whois.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

type WhoisHandlerDependencies = Readonly<{
  buildWhoisChain: typeof buildWhoisChain;
  parseWhoisChain: typeof parseWhoisChain;
}>;

async function handleWhois(
  event: Parameters<NetlifyFunctionHandler>[0],
  dependencies: WhoisHandlerDependencies = { buildWhoisChain, parseWhoisChain },
): ReturnType<NetlifyFunctionHandler> {
  const guard = guardNetlifyNetworkRequest(event, 'whois');
  if (guard.response) return guard.response;

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch {
    return json(400, { error: 'Invalid query' });
  }

  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('whois'), async () => {
    const chain = await dependencies.buildWhoisChain(classified.value);
    return json(200, {
      query: q,
      type: classified.type,
      inputHostname: classified.inputHostname,
      registrableDomain: classified.registrableDomain,
      chain,
      parsed: dependencies.parseWhoisChain(chain),
    });
  });
}

function createWhoisHandler(
  dependencies: WhoisHandlerDependencies = { buildWhoisChain, parseWhoisChain },
): NetlifyFunctionHandler {
  return withNetlifyApiErrorBoundary(
    (request) => handleWhois(request, dependencies),
  );
}

const handler = createWhoisHandler();

export { createWhoisHandler, handler };
export type { WhoisHandlerDependencies };
