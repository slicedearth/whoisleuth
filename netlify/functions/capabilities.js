const { isAuthenticatedFromCookieHeader } = require('../../lib/auth');
const { capabilityReport } = require('../../lib/capabilities');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  if (!isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie)) {
    return json(401, { error: 'Authentication required' });
  }
  return json(200, capabilityReport('netlify'));
};
