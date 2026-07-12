const { classifyQuery } = require('../../lib/classify');
const { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } = require('../../lib/domain-posture');
const { operationClassFor } = require('../../lib/operation-budget');
const { guardNetlifyNetworkRequest, withNetlifyOperationBudget } = require('../../lib/netlify-network-guard');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event);
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
  return withNetlifyOperationBudget(guard.sessionKey, operationClassFor('domain_posture'), async () => {
    try {
      return json(200, await checkDomainPosture(domain, { dkimSelectors: selectors }));
    } catch (err) {
      return json(500, { error: err.message });
    }
  });
};
