import { classifyQuery } from '../../lib/classify.mts';
import { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } from '../../lib/domain-posture.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handleDomainPosture: NetlifyFunctionHandler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'domain_posture');
  if (guard.response) return guard.response;

  const params = event.queryStringParameters || {};
  const q = (params.q || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let type, value;
  try {
    ({ type, value } = classifyQuery(q));
  } catch (err) {
    return json(400, { error: err.message });
  }
  if (type !== 'domain') return json(400, { error: 'Domain posture audits only support domain names.' });
  const domain = normalizeAuditDomain(value);
  if (!domain) return json(400, { error: 'Invalid domain name for posture audit.' });

  const selectors = normalizeDkimSelectors(String(params.selectors || '').split(','));
  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('domain_posture'), async () => {
    return json(200, await checkDomainPosture(domain, { dkimSelectors: selectors }));
  });
};

const handler = withNetlifyApiErrorBoundary(handleDomainPosture);

export { handler };
