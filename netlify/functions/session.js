const { isAuthenticatedFromCookieHeader } = require('../../lib/auth');

exports.handler = async (event) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ authenticated: isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie) }),
});
