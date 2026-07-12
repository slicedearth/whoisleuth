// Shared response builder for Netlify Functions - was copy-pasted
// identically into every function file (server.js doesn't need this; Express
// has res.json() built in).
function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Strict-Transport-Security': 'max-age=31536000',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

module.exports = { json };
