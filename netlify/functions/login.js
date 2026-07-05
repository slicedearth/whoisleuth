const { checkPassword, createSessionToken, buildSessionCookie } = require('../../lib/auth');

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  if (!checkPassword(body.password)) {
    return json(401, { error: 'Incorrect password' });
  }

  return json(200, { ok: true }, { 'Set-Cookie': buildSessionCookie(createSessionToken(), { secure: true }) });
};
