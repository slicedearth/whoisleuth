const { searchCertificateTransparency } = require('../../lib/ct-search');
const { operationBudgetTargetFor } = require('../../lib/operation-budget');
const { guardNetlifyNetworkRequest, withNetlifyOperationBudget } = require('../../lib/netlify-network-guard');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'certificate_transparency');
  if (guard.response) return guard.response;

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('certificate_transparency'), async () => {
    try {
      const result = await searchCertificateTransparency(q);
      return json(200, { keyword: q, ...result });
    } catch (err) {
      return json(500, { error: err.message });
    }
  });
};
