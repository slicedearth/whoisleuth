const { classifyQuery } = require('../../lib/classify');
const { buildWhoisChain, parseWhoisChain } = require('../../lib/whois');
const { operationClassFor } = require('../../lib/operation-budget');
const { guardNetlifyNetworkRequest, withNetlifyOperationBudget } = require('../../lib/netlify-network-guard');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
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

  return withNetlifyOperationBudget(guard.sessionKey, operationClassFor('whois'), async () => {
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
