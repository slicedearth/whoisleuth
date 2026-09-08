// Bounded RDAP HTTP transport. Bootstrap selection, response validation,
// normalization, and registrar enrichment remain separate concerns in
// lib/rdap.mts.

import { readTextCapped, safeFetch, safeFetchDetailed } from './safe-fetch.mts';
import { abortable } from './abort.mts';

type RdapFetchResult = {
  status: number;
  ok: boolean;
  text: string;
  finalUrl?: string;
};

type RdapFetch = (
  url: string,
  options: RequestInit,
  timeoutMs: number,
) => Promise<RdapFetchResult>;

type RdapTransportDependencies = Readonly<{
  fetch?: typeof safeFetch;
  fetchDetailed?: typeof safeFetchDetailed;
  readText?: typeof readTextCapped;
}>;

const MAX_RDAP_BYTES = 2000000;

async function fetchRdapTransport(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  fetchResponse: (url: string, options: RequestInit) => Promise<{ response: Response; finalUrl?: string }>,
  readText: typeof readTextCapped,
): Promise<RdapFetchResult> {
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response | undefined;
  const cancelBody = () => { void response?.body?.cancel().catch(() => {}); };
  try {
    const result = await abortable(async () => {
      const result = await fetchResponse(url, { ...options, signal });
      response = result.response;
      if (signal.aborted) { cancelBody(); signal.throwIfAborted(); }
      return result;
    }, signal);
    const { text, truncated } = await abortable(
      () => readText(result.response, MAX_RDAP_BYTES, { fatalUtf8: true }), signal,
    );
    if (truncated) throw new Error(`Response from ${url} exceeded ${MAX_RDAP_BYTES} bytes`);
    return {
      status: result.response.status, ok: result.response.ok, text,
      ...(result.finalUrl === undefined ? {} : { finalUrl: result.finalUrl }),
    };
  } finally {
    clearTimeout(timeout);
    if (signal.aborted) cancelBody();
  }
}

async function fetchRdapWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  dependencies: RdapTransportDependencies = {},
): Promise<RdapFetchResult> {
  return fetchRdapTransport(url, options, timeoutMs,
    async (target, request) => ({ response: await (dependencies.fetch ?? safeFetch)(target, request) }),
    dependencies.readText ?? readTextCapped);
}

async function fetchRdapDetailedWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  dependencies: RdapTransportDependencies = {},
): Promise<RdapFetchResult> {
  return fetchRdapTransport(url, options, timeoutMs,
    dependencies.fetchDetailed ?? safeFetchDetailed, dependencies.readText ?? readTextCapped);
}

export {
  fetchRdapDetailedWithTimeout,
  fetchRdapWithTimeout,
  type RdapFetch,
  type RdapFetchResult,
};
