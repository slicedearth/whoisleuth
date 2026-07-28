// Bounded RDAP HTTP transport. Bootstrap selection, response validation,
// normalization, and registrar enrichment remain separate concerns in
// lib/rdap.mts.

import { readTextCapped, safeFetch, safeFetchDetailed } from './safe-fetch.mts';

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

const MAX_RDAP_BYTES = 2000000;

async function fetchRdapWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<RdapFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await safeFetch(url, { ...options, signal: controller.signal });
    const { text, truncated } = await readTextCapped(response, MAX_RDAP_BYTES);
    if (truncated) throw new Error(`Response from ${url} exceeded ${MAX_RDAP_BYTES} bytes`);
    return { status: response.status, ok: response.ok, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRdapDetailedWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<RdapFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await safeFetchDetailed(url, { ...options, signal: controller.signal });
    const { text, truncated } = await readTextCapped(result.response, MAX_RDAP_BYTES);
    if (truncated) throw new Error(`Response from ${url} exceeded ${MAX_RDAP_BYTES} bytes`);
    return {
      status: result.response.status,
      ok: result.response.ok,
      text,
      finalUrl: result.finalUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export {
  fetchRdapDetailedWithTimeout,
  fetchRdapWithTimeout,
  type RdapFetch,
  type RdapFetchResult,
};
