// Shared response builder for Netlify Functions - was copy-pasted
// identically into every function file (server.js doesn't need this; Express
// has res.json() built in).
function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Strict-Transport-Security': 'max-age=31536000',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

module.exports = { json };
