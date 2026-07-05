const { buildClearCookie } = require('../../lib/auth');

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': buildClearCookie({ secure: true }),
  },
  body: JSON.stringify({ ok: true }),
});
