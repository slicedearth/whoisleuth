const { classifyQuery } = require('../../lib/classify');
const { fetchRdapRecord } = require('../../lib/rdap');
const { operationClassFor } = require('../../lib/operation-budget');
const { guardNetlifyNetworkRequest, withNetlifyOperationBudget } = require('../../lib/netlify-network-guard');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
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

  return withNetlifyOperationBudget(guard.sessionKey, operationClassFor('rdap'), async () => {
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
