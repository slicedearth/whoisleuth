// Shared response builder for Netlify Functions - was copy-pasted
// identically into every function file (server.mts doesn't need this; Express
// has res.json() built in).

type NetlifyResponseHeaders = Readonly<Record<string, string>>;

type NetlifyJsonResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
};

function json(
  statusCode: number,
  body: unknown,
  extraHeaders: NetlifyResponseHeaders = {},
): NetlifyJsonResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Strict-Transport-Security': 'max-age=31536000',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export { json };
export type { NetlifyJsonResponse, NetlifyResponseHeaders };
