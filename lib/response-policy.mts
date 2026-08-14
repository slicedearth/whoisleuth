// Privacy-minimized interpretation of selected response policies. Header and
// cookie values are read transiently from the already-selected homepage
// response and reduced to fixed signal identifiers plus bounded counts.

type HeaderReader = {
  get(name: string): string | null;
  getSetCookie?: () => string[];
};

type ResponsePolicyComponentState = 'absent' | 'parsed' | 'partial' | 'malformed';
type ResponsePolicySignalId =
  | 'csp_default_source_missing'
  | 'csp_base_uri_missing'
  | 'csp_object_source_unbounded'
  | 'csp_permissive_script_source'
  | 'csp_unsafe_eval'
  | 'csp_unsafe_inline'
  | 'csp_inline_constrained_by_meta'
  | 'hsts_disabled'
  | 'hsts_short_max_age'
  | 'referrer_policy_permissive'
  | 'cookies_missing_secure'
  | 'cookies_missing_http_only'
  | 'cookies_missing_same_site'
  | 'cookies_same_site_none_without_secure';

type ResponsePolicySignal = {
  id: ResponsePolicySignalId;
  count?: number;
};

type ResponsePolicyAnalysis = {
  responsePolicyVersion: typeof RESPONSE_POLICY_VERSION;
  status: 'success' | 'partial';
  complete: boolean;
  components: {
    contentSecurityPolicy: ResponsePolicyComponentState;
    strictTransportSecurity: ResponsePolicyComponentState;
    referrerPolicy: ResponsePolicyComponentState;
    responseCookies: ResponsePolicyComponentState;
  };
  signals: ResponsePolicySignal[];
  diagnostics: {
    signalCount: number;
    cookieCount: number;
    cookiesTruncated: boolean;
    cspMetaPoliciesObserved: number;
    cspMetaPoliciesParsed: number;
    cspMetaPoliciesTruncated: boolean;
  };
  limitations: string[];
};

type HeaderResult = {
  state: 'absent' | 'present' | 'partial' | 'malformed';
  value: string | null;
};

type CspInlineControl = 'restricted' | 'unqualified' | 'uncontrolled' | 'unknown';
type CspAnalysis = {
  state: ResponsePolicyComponentState;
  inlineControl: CspInlineControl;
};
type CspMetaPolicyInput = {
  content: unknown;
  beforeScript: unknown;
};
type CspMetaPolicyAnalysis = {
  cspMetaPolicyVersion: 1;
  policiesObserved: number;
  policiesParsed: number;
  inlineScriptConstrained: boolean;
  truncated: boolean;
};

export const RESPONSE_POLICY_VERSION = 2;
export const MAX_RESPONSE_POLICY_HEADER_BYTES = 8 * 1024;
export const MAX_CSP_META_POLICIES = 4;
export const MAX_RESPONSE_POLICY_DIRECTIVES = 64;
export const MAX_RESPONSE_POLICY_TOKENS = 128;
export const MAX_RESPONSE_COOKIES = 32;
export const MAX_RESPONSE_COOKIE_BYTES = 4 * 1024;
export const MAX_RESPONSE_COOKIE_TOTAL_BYTES = 32 * 1024;
export const MIN_RECOMMENDED_HSTS_SECONDS = 180 * 24 * 60 * 60;

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const DIRECTIVE_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ATTRIBUTE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;
const CSP_NONCE_OR_HASH_RE = /^'(?:nonce-[^']+|sha(?:256|384|512)-[^']+)'$/i;
const REFERRER_POLICIES = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);
const PERMISSIVE_REFERRER_POLICIES = new Set(['no-referrer-when-downgrade', 'unsafe-url']);

function boundedCount(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

function readHeader(headers: HeaderReader | null | undefined, name: string): HeaderResult {
  if (!headers || typeof headers.get !== 'function') return { state: 'absent', value: null };
  let raw: string | null;
  try {
    raw = headers.get(name);
  } catch {
    return { state: 'malformed', value: null };
  }
  if (raw === null || raw.trim() === '') return { state: 'absent', value: null };
  if (CONTROL_RE.test(raw)) return { state: 'malformed', value: null };
  if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_POLICY_HEADER_BYTES) {
    return { state: 'partial', value: null };
  }
  return { state: 'present', value: raw.trim() };
}

function addSignal(signals: ResponsePolicySignal[], id: ResponsePolicySignalId, count?: number): void {
  if (signals.some((signal) => signal.id === id)) return;
  signals.push(count === undefined ? { id } : { id, count: boundedCount(count, MAX_RESPONSE_COOKIES) });
}

function unavailableHeaderState(header: HeaderResult): ResponsePolicyComponentState {
  return header.state === 'present' ? 'malformed' : header.state;
}

function analyzeCsp(header: HeaderResult, signals: ResponsePolicySignal[]): CspAnalysis {
  if (header.state !== 'present' || !header.value) {
    return { state: unavailableHeaderState(header), inlineControl: 'unknown' };
  }

  const directives = new Map<string, string[]>();
  let tokenCount = 0;
  let partial = false;
  for (const rawDirective of header.value.split(';')) {
    const normalized = rawDirective.trim();
    if (!normalized) continue;
    const [rawName = '', ...rawTokens] = normalized.split(/\s+/u);
    const name = rawName.toLowerCase();
    if (!DIRECTIVE_NAME_RE.test(name)) return { state: 'malformed', inlineControl: 'unknown' };
    if (directives.has(name)) continue;
    if (directives.size >= MAX_RESPONSE_POLICY_DIRECTIVES) {
      partial = true;
      break;
    }
    const remaining = Math.max(0, MAX_RESPONSE_POLICY_TOKENS - tokenCount);
    const tokens = rawTokens.slice(0, remaining).map((token) => token.toLowerCase());
    if (tokens.length !== rawTokens.length) partial = true;
    tokenCount += tokens.length;
    directives.set(name, tokens);
  }

  if (!directives.size) return { state: 'malformed', inlineControl: 'unknown' };
  const defaultSources = directives.get('default-src');
  const scriptSources = directives.get('script-src') || defaultSources;
  if (!defaultSources) addSignal(signals, 'csp_default_source_missing');
  if (!directives.has('base-uri')) addSignal(signals, 'csp_base_uri_missing');
  if (!directives.has('object-src') && !defaultSources) addSignal(signals, 'csp_object_source_unbounded');
  let inlineControl: CspInlineControl = scriptSources ? 'restricted' : 'uncontrolled';
  if (scriptSources) {
    if (scriptSources.some((token) => ['*', 'http:', 'https:', 'data:', 'blob:'].includes(token))) {
      addSignal(signals, 'csp_permissive_script_source');
    }
    if (scriptSources.includes("'unsafe-eval'")) addSignal(signals, 'csp_unsafe_eval');
    if (
      scriptSources.includes("'unsafe-inline'")
      && !scriptSources.some((token) => CSP_NONCE_OR_HASH_RE.test(token))
    ) {
      addSignal(signals, 'csp_unsafe_inline');
      inlineControl = 'unqualified';
    }
  }
  return {
    state: partial ? 'partial' : 'parsed',
    inlineControl: partial ? 'unknown' : inlineControl,
  };
}

export function analyzeCspMetaPolicies(
  value: unknown,
  sourceTruncated = false,
): CspMetaPolicyAnalysis {
  const candidates = Array.isArray(value) ? value : [];
  const policies = candidates.slice(0, MAX_CSP_META_POLICIES);
  let policiesParsed = 0;
  let inlineScriptConstrained = false;
  let truncated = sourceTruncated || candidates.length > MAX_CSP_META_POLICIES;

  for (const rawPolicy of policies) {
    const policy = rawPolicy && typeof rawPolicy === 'object' && !Array.isArray(rawPolicy)
      ? rawPolicy as CspMetaPolicyInput
      : null;
    if (!policy || typeof policy.content !== 'string') {
      truncated = true;
      continue;
    }
    const policyContent = policy.content;
    const content = readHeader({ get: () => policyContent }, 'content-security-policy');
    const analysis = analyzeCsp(content, []);
    if (analysis.state !== 'parsed') {
      truncated = true;
      continue;
    }
    policiesParsed += 1;
    if (policy.beforeScript === true && analysis.inlineControl === 'restricted') {
      inlineScriptConstrained = true;
    }
  }

  return {
    cspMetaPolicyVersion: 1,
    policiesObserved: boundedCount(candidates.length, MAX_CSP_META_POLICIES),
    policiesParsed,
    inlineScriptConstrained,
    truncated,
  };
}

export function qualifyResponsePolicyWithCspMeta(
  value: ResponsePolicyAnalysis | null | undefined,
  meta: CspMetaPolicyAnalysis | null | undefined,
): ResponsePolicyAnalysis | null | undefined {
  if (!value || !meta || meta.cspMetaPolicyVersion !== 1) return value;
  const constrained = meta.inlineScriptConstrained
    && value.signals.some((signal) => signal.id === 'csp_unsafe_inline');
  const signals = constrained
    ? [
        ...value.signals.filter((signal) => signal.id !== 'csp_unsafe_inline'),
        { id: 'csp_inline_constrained_by_meta' as const },
      ]
    : [...value.signals];
  const limitations = [...value.limitations];
  if (meta.policiesObserved > 0) {
    limitations.push(constrained
      ? 'A bounded CSP meta policy observed before page scripts further constrained inline script allowed by the response header.'
      : 'CSP meta policy observations did not qualify the selected response-header finding; policies after scripts, malformed policies, and capped policies remain non-authoritative for this comparison.');
  }
  if (meta.truncated) limitations.push('CSP meta policy analysis reached a configured count, position, or byte boundary.');
  return {
    ...value,
    signals: signals.slice(0, 16),
    diagnostics: {
      ...value.diagnostics,
      signalCount: Math.min(signals.length, 16),
      cspMetaPoliciesObserved: boundedCount(meta.policiesObserved, MAX_CSP_META_POLICIES),
      cspMetaPoliciesParsed: boundedCount(meta.policiesParsed, MAX_CSP_META_POLICIES),
      cspMetaPoliciesTruncated: meta.truncated,
    },
    limitations,
  };
}

function analyzeHsts(header: HeaderResult, signals: ResponsePolicySignal[]): ResponsePolicyComponentState {
  if (header.state !== 'present' || !header.value) {
    return unavailableHeaderState(header);
  }
  const directives = header.value.split(';').map((part) => part.trim()).filter(Boolean);
  if (directives.length > MAX_RESPONSE_POLICY_DIRECTIVES) return 'partial';
  const seen = new Set<string>();
  let maxAge: string | null = null;
  for (const directive of directives) {
    const match = /^([a-z][a-z0-9-]{0,63})(?:\s*=\s*(.*))?$/iu.exec(directive);
    if (!match) return 'malformed';
    const name = match[1]?.toLowerCase() ?? '';
    if (seen.has(name)) return 'malformed';
    seen.add(name);
    if (name === 'max-age') {
      const value = match[2];
      if (!value || !/^\d+$/u.test(value)) return 'malformed';
      maxAge = value;
    }
  }
  if (!maxAge || maxAge.length > 12) return 'malformed';
  const seconds = Number(maxAge);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return 'malformed';
  if (seconds === 0) addSignal(signals, 'hsts_disabled');
  else if (seconds < MIN_RECOMMENDED_HSTS_SECONDS) addSignal(signals, 'hsts_short_max_age');
  return 'parsed';
}

function analyzeReferrerPolicy(header: HeaderResult, signals: ResponsePolicySignal[]): ResponsePolicyComponentState {
  if (header.state !== 'present' || !header.value) {
    return unavailableHeaderState(header);
  }
  const candidates = header.value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_RESPONSE_POLICY_TOKENS);
  const effective = candidates.filter((candidate) => REFERRER_POLICIES.has(candidate)).at(-1);
  if (!effective) return 'malformed';
  if (PERMISSIVE_REFERRER_POLICIES.has(effective)) {
    addSignal(signals, 'referrer_policy_permissive');
  }
  return candidates.length >= MAX_RESPONSE_POLICY_TOKENS ? 'partial' : 'parsed';
}

function responseCookies(headers: HeaderReader | null | undefined): {
  state: ResponsePolicyComponentState;
  values: string[];
  truncated: boolean;
} {
  if (!headers) return { state: 'absent', values: [], truncated: false };
  let values: string[] = [];
  try {
    const combined = typeof headers.getSetCookie === 'function' ? null : headers.get('set-cookie');
    values = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : combined
        ? [combined]
        : [];
  } catch {
    return { state: 'malformed', values: [], truncated: false };
  }
  if (!values.length) return { state: 'absent', values: [], truncated: false };

  const retained: string[] = [];
  let totalBytes = 0;
  let truncated = values.length > MAX_RESPONSE_COOKIES;
  for (const value of values.slice(0, MAX_RESPONSE_COOKIES)) {
    if (typeof value !== 'string' || CONTROL_RE.test(value)) return { state: 'malformed', values: [], truncated };
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes > MAX_RESPONSE_COOKIE_BYTES || totalBytes + bytes > MAX_RESPONSE_COOKIE_TOTAL_BYTES) {
      truncated = true;
      continue;
    }
    totalBytes += bytes;
    retained.push(value);
  }
  return { state: truncated ? 'partial' : 'parsed', values: retained, truncated };
}

function analyzeCookies(
  headers: HeaderReader | null | undefined,
  signals: ResponsePolicySignal[],
): { state: ResponsePolicyComponentState; count: number; truncated: boolean } {
  const result = responseCookies(headers);
  if (!result.values.length) return { state: result.state, count: 0, truncated: result.truncated };
  let missingSecure = 0;
  let missingHttpOnly = 0;
  let missingSameSite = 0;
  let sameSiteNoneWithoutSecure = 0;
  let attributesTruncated = false;

  for (const value of result.values) {
    const segments = value.split(';');
    if (!segments[0]?.includes('=')) return { state: 'malformed', count: result.values.length, truncated: result.truncated };
    if (segments.length - 1 > MAX_RESPONSE_POLICY_TOKENS) {
      attributesTruncated = true;
      continue;
    }
    const attributes = new Map<string, string | null>();
    for (const rawAttribute of segments.slice(1, MAX_RESPONSE_POLICY_TOKENS + 1)) {
      const [rawName = '', ...rawValue] = rawAttribute.trim().split('=');
      const name = rawName.toLowerCase();
      if (!name || !ATTRIBUTE_NAME_RE.test(name)) continue;
      attributes.set(name, rawValue.length ? rawValue.join('=').trim().toLowerCase() : null);
    }
    const secure = attributes.has('secure');
    const httpOnly = attributes.has('httponly');
    const sameSite = attributes.get('samesite');
    if (!secure) missingSecure++;
    if (!httpOnly) missingHttpOnly++;
    if (!sameSite) missingSameSite++;
    if (sameSite === 'none' && !secure) sameSiteNoneWithoutSecure++;
  }

  if (missingSecure) addSignal(signals, 'cookies_missing_secure', missingSecure);
  if (missingHttpOnly) addSignal(signals, 'cookies_missing_http_only', missingHttpOnly);
  if (missingSameSite) addSignal(signals, 'cookies_missing_same_site', missingSameSite);
  if (sameSiteNoneWithoutSecure) {
    addSignal(signals, 'cookies_same_site_none_without_secure', sameSiteNoneWithoutSecure);
  }
  return {
    state: result.state === 'partial' || attributesTruncated ? 'partial' : result.state,
    count: result.values.length,
    truncated: result.truncated || attributesTruncated,
  };
}

export function analyzeResponsePolicyHeaders(
  headers: HeaderReader | null | undefined,
): ResponsePolicyAnalysis {
  const signals: ResponsePolicySignal[] = [];
  const contentSecurityPolicy = analyzeCsp(readHeader(headers, 'content-security-policy'), signals).state;
  const strictTransportSecurity = analyzeHsts(readHeader(headers, 'strict-transport-security'), signals);
  const referrerPolicy = analyzeReferrerPolicy(readHeader(headers, 'referrer-policy'), signals);
  const cookies = analyzeCookies(headers, signals);
  const components = {
    contentSecurityPolicy,
    strictTransportSecurity,
    referrerPolicy,
    responseCookies: cookies.state,
  };
  const partial = Object.values(components).some((state) => state === 'partial' || state === 'malformed');
  const limitations = [
    'Policy findings describe only the selected HTTP response and are not a site-wide vulnerability or exploitability assessment.',
    'Header and cookie values, names, paths, domains, nonces, hashes, and reporting endpoints are discarded after analysis.',
  ];
  if (partial) limitations.push('One or more selected policy values could not be interpreted completely.');
  if (cookies.truncated) limitations.push('Response-cookie analysis reached its configured count or byte limit.');
  return {
    responsePolicyVersion: RESPONSE_POLICY_VERSION,
    status: partial ? 'partial' : 'success',
    complete: !partial,
    components,
    signals: signals.slice(0, 16),
    diagnostics: {
      signalCount: Math.min(signals.length, 16),
      cookieCount: boundedCount(cookies.count, MAX_RESPONSE_COOKIES),
      cookiesTruncated: cookies.truncated,
      cspMetaPoliciesObserved: 0,
      cspMetaPoliciesParsed: 0,
      cspMetaPoliciesTruncated: false,
    },
    limitations,
  };
}

export type {
  HeaderReader as ResponsePolicyHeaderReader,
  CspMetaPolicyAnalysis,
  ResponsePolicyAnalysis,
  ResponsePolicyComponentState,
  ResponsePolicySignal,
  ResponsePolicySignalId,
};
