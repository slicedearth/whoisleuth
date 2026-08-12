import { classifyQuery } from '../../lib/classify.mts';
import { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors, normalizeMailProtectionProfile } from '../../lib/domain-posture.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

type DomainPostureHandlerDependencies = Readonly<{
  checkDomainPosture: typeof checkDomainPosture;
}>;

async function handleDomainPosture(
  event: Parameters<NetlifyFunctionHandler>[0],
  dependencies: DomainPostureHandlerDependencies = { checkDomainPosture },
): ReturnType<NetlifyFunctionHandler> {
  const guard = guardNetlifyNetworkRequest(event, 'domain_posture');
  if (guard.response) return guard.response;

  const params = event.queryStringParameters || {};
  const q = (params.q || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let type, value;
  try {
    ({ type, value } = classifyQuery(q));
  } catch {
    return json(400, { error: 'Invalid query' });
  }
  if (type !== 'domain') return json(400, { error: 'Domain posture audits only support domain names.' });
  const domain = normalizeAuditDomain(value);
  if (!domain) return json(400, { error: 'Invalid domain name for posture audit.' });

  const selectors = normalizeDkimSelectors(String(params.selectors || '').split(','));
  const retiredSelectors = normalizeDkimSelectors(String(params.retiredSelectors || '').split(','))
    .filter((selector) => !selectors.includes(selector))
    .slice(0, Math.max(0, 10 - selectors.length));
  const mailProtectionProfile = normalizeMailProtectionProfile(params.mailProfile);
  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('domain_posture'), async () => {
    return json(200, await dependencies.checkDomainPosture(domain, {
      dkimSelectors: selectors,
      retiredDkimSelectors: retiredSelectors,
      mailProtectionProfile,
    }));
  });
}

function createDomainPostureHandler(
  dependencies: DomainPostureHandlerDependencies = { checkDomainPosture },
): NetlifyFunctionHandler {
  return withNetlifyApiErrorBoundary(
    (request) => handleDomainPosture(request, dependencies),
  );
}

const handler = createDomainPostureHandler();

export { createDomainPostureHandler, handler };
export type { DomainPostureHandlerDependencies };
