import type { NetlifyFunctionHandler } from '../lib/netlify-function-types.mts';

/** Reuse independent endpoint expectations across native and event-based test fixtures. */
export function eventFixtureForFetch(handler: (request: Request) => Promise<Response>): NetlifyFunctionHandler {
  return async event => {
    const url = new URL('https://console.example/api/lookup');
    for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const method = event.httpMethod ?? 'GET';
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const response = await handler(new Request(url, { method, headers,
      ...(method !== 'GET' && method !== 'HEAD' && event.body !== undefined && event.body !== null
        ? { body: event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body } : {}),
    }));
    return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
  };
}
