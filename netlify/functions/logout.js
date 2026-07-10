const { buildClearCookie } = require('../../lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': buildClearCookie({ secure: true }),
    },
    body: JSON.stringify({ ok: true }),
  };
};
