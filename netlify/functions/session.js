const { isAuthenticatedFromCookieHeader } = require('../../lib/auth');
const { json } = require('../../lib/http');

exports.handler = async (event) =>
  json(200, { authenticated: isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie) });
