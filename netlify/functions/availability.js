const { classifyQuery } = require('../../lib/classify');
const { checkDomainAvailability } = require('../../lib/availability');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  try {
    const { type, value } = classifyQuery(q);
    if (type !== 'domain') {
      return json(200, { applicable: false, type });
    }

    const params = event.queryStringParameters || {};
    const fast = params.fast === '1' || params.fast === 'true';
    const result = await checkDomainAvailability(value, { fast });
    return json(200, { applicable: true, domain: value, ...result });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
