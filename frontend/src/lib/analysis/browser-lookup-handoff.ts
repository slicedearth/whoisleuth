import { normalizeDomain } from './case-model.ts';

export type BrowserLookupHandoff = Readonly<{
  domain: string;
  path: string;
  discarded: readonly string[];
  limitations: readonly string[];
}>;

export function buildBrowserLookupHandoff(value: unknown): BrowserLookupHandoff {
  const raw = typeof value === 'string' ? value.trim() : '';
  const domain = normalizeDomain(raw);
  if (!domain) throw new Error('Enter a valid domain or HTTP(S) URL.');
  let parsed: URL | null = null;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    parsed = null;
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Enter a valid domain or HTTP(S) URL.');
  }
  const discarded = [
    parsed?.username || parsed?.password ? 'credentials' : '',
    parsed?.port ? 'port' : '',
    parsed?.pathname && parsed.pathname !== '/' ? 'path' : '',
    parsed?.search ? 'query' : '',
    parsed?.hash ? 'fragment' : '',
  ].filter(Boolean);
  return {
    domain,
    path: `/lookup?q=${encodeURIComponent(domain)}&depth=deep#query`,
    discarded,
    limitations: [
      'The handoff contains only the normalized hostname and chosen lookup depth. It does not include URL credentials, port, path, query, or fragment.',
      'Opening the handoff fills Lookup but does not start collection. Review the target and collection plan before submitting.',
    ],
  };
}
