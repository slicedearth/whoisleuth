// Domain availability check.
//
// Determines registered vs. available vs. expiring via RDAP/WHOIS, and flags
// likely for-sale listings by checking for known parking/marketplace
// nameservers and "for sale" listing language on the domain's own homepage.
// This does not attempt to price the domain - registries don't publish sale
// prices, and that's proprietary marketplace data.
//
// Shared by the Express server and the Netlify Functions.

import { promises as dns } from 'node:dns';

import { fetchRdapRecord } from './rdap.mts';
import { buildWhoisChain, parseWhoisChain } from './whois.mts';
import { safeFetchDetailed, readTextCapped } from './safe-fetch.mts';
import { whoisleuthRequestHeaders } from './outbound-identity.mts';
import { collectDnsIntelligence, skippedDnsIntelligence } from './dns-intelligence.mts';
import type { DnsResolver } from './dns-intelligence.mts';
import { fetchFaviconHash } from './favicon.mts';
import { extractHtmlSignals } from './html-signals.mts';
import { featureDecision, networkFeaturePolicy } from './feature-policy.mts';
import { buildHttpObservation, failedHttpObservation, skippedHttpObservation } from './http-intelligence.mts';
import { collectTlsIntelligence, skippedTlsObservation } from './tls-intelligence.mts';
import { parseRegistryDate, registryDateIso } from './registry-dates.mts';
import { analyzeWebsiteSecurityPosture } from './website-security-posture.mts';
import {
  analyzeResponsePolicyHeaders,
  qualifyResponsePolicyWithCspMeta,
} from './response-policy.mts';
import type { ResponsePolicyAnalysis } from './response-policy.mts';
import { nonEmptyErrorMessage } from './error-detail.mts';
import { registryServiceAdmissionFor } from './registry-capabilities.mts';
import {
  HOMEPAGE_FETCH_TIMEOUT_MS,
  MAX_HOMEPAGE_BYTES,
} from './outbound-request-bounds.mts';

const DNS_DELEGATION_TIMEOUT_MS = 4000;
const MAX_DELEGATION_NAMESERVERS = 50;
const MISSING_DNS_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME', 'NXDOMAIN']);

type UnknownRecord = Record<string, unknown>;
type CompactContact = {
  handle: unknown;
  ianaId?: unknown;
  name: unknown;
  org: unknown;
  email: unknown;
  phone: unknown;
  address?: unknown;
};
type HttpObservation = UnknownRecord & {
  finalUrl?: unknown;
  redirects?: unknown;
  observedAt?: unknown;
  response?: null | {
    contentType?: unknown;
    bodyTruncated?: unknown;
    bodyHash?: unknown;
    server?: unknown;
  };
};
type HomepageResult = {
  text: string | null;
  status: string;
  detail: string;
  http: HttpObservation;
  responsePolicy?: ResponsePolicyAnalysis | null;
  technologyHeaders?: Record<string, string>;
};
type HomepageFailure = { url: string; error: string };
type HomepageFetchDetail = {
  response: Response;
  requestedUrl: string;
  finalUrl: string;
  redirectCount: number;
  redirectLimitReached: boolean;
  hops: Array<{ url: string; status: number; location: string | null; durationMs: number }>;
  durationMs: number;
};
type HomepageFetcher = (url: string, options: RequestInit) => Promise<Response | HomepageFetchDetail>;
type DnsDelegation = {
  delegated: boolean;
  nameservers: string[];
  nameserversTruncated: boolean;
  error: string | null;
};

function errorRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function rdapEventDate(events: UnknownRecord[], action: string): string | null {
  const date = events.find((event) => event.action === action)?.date;
  return typeof date === 'string' ? date : null;
}

type AvailabilityOptions = {
  fast?: boolean;
  includeExtendedDnsContext?: boolean;
  includeInheritedCaa?: boolean;
  includeCredentialSurfaceProfile?: boolean;
  includePublicationMetadata?: boolean;
  includeDeliveryMetadata?: boolean;
  includeStructuredDataIdentity?: boolean;
  includeTechnologyProfile?: boolean;
  includeSecurityPosture?: boolean;
  collectDnsIntelligence?: typeof collectDnsIntelligence;
  dnsResolvers?: Record<string, DnsResolver>;
  collectTlsIntelligence?: typeof collectTlsIntelligence;
  fetchHomepage?: (domain: string) => Promise<HomepageResult>;
  fetchFaviconHash?: typeof fetchFaviconHash;
  featurePolicy?: ReturnType<typeof networkFeaturePolicy>;
  rdapRecord?: unknown;
  whoisChain?: Awaited<ReturnType<typeof buildWhoisChain>> | null;
  rdapRecordPromise?: Promise<unknown>;
  whoisChainPromise?: Promise<Awaited<ReturnType<typeof buildWhoisChain>> | null>;
  dnsDelegation?: DnsDelegation | null;
  resolveNs?: (domain: string) => Promise<string[]>;
};
type WebsiteActivity = 'parked' | 'active' | 'unreachable';
type RegistrationSource = 'rdap' | 'whois' | 'dns' | null;
type RegistrationConfidence = 'high' | 'medium';
type HtmlSignals = ReturnType<typeof extractHtmlSignals>;

function withoutHttpDeliveryMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = { ...(value as Record<string, unknown>) };
  if (output.response && typeof output.response === 'object' && !Array.isArray(output.response)) {
    const response = { ...(output.response as Record<string, unknown>) };
    delete response.deliveryMetadata;
    output.response = response;
  }
  return output;
}

// No marketplace (Afternic/Sedo/Dan.com/GoDaddy Auctions/etc.) offers a
// free, no-auth API to check "is this specific domain listed for sale" -
// what's checkable without credentials is the parking/landing-page
// nameservers and homepage copy these services actually use, which is
// broader coverage of the same signal, not a live cross-marketplace lookup.
const PARKING_NS_PATTERNS = [
  /sedoparking\.com$/i,
  /sedo\.com$/i,
  /above\.com$/i,
  /bodis\.com$/i,
  /parkingcrew\.net$/i,
  /dan\.com$/i,
  /hugedomains\.com$/i,
  /uniregistry/i,
  /squadhelp/i,
  /afternic/i,
  /voodoo\.com$/i,
  /fabulous\.com$/i,
  /namedrive/i,
  /smartname\.com$/i,
  /domainsponsor\.com$/i,
  /undeveloped\.com$/i,
  /trafficz\.com$/i,
  /dsredirection\.com$/i,
];

const FOR_SALE_TEXT_RE =
  /(this domain (?:name )?(?:may be|is) for sale|buy this domain|domain(?: name)? for sale|make (?:an|your) offer|inquire about (?:this|the) domain|purchase this domain|this domain is available for purchase|backorder this domain|bid on this domain|premium domain for sale|own this domain|click here to buy this domain|would you like to buy this domain|this domain is (?:available for lease|listed for sale))/i;
const FOR_SALE_PATH_RE = /\/(?:premium-)?domains?-for-sale(?:\/|$)/i;

function forSaleRedirectSignal(httpObservation: unknown): string | null {
  if (!httpObservation || typeof httpObservation !== 'object') return null;
  const observation = httpObservation as HttpObservation;
  const urls = [
    observation.finalUrl,
    ...(Array.isArray(observation.redirects)
      ? observation.redirects.map((redirect) => redirect && typeof redirect === 'object' ? (redirect as UnknownRecord).to : null)
      : []),
  ];
  for (const value of urls) {
    if (typeof value !== 'string' || value.length > 2048) continue;
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && FOR_SALE_PATH_RE.test(url.pathname)) {
        return `for-sale landing-page redirect (${url.origin}${url.pathname})`;
      }
    } catch {
      // Malformed retained provenance cannot establish a sale signal.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Acquisition/sourcing signals: domain age, privacy-redaction, expiry
// proximity, and site-activity status. These read data already fetched by
// checkDomainAvailability (RDAP/WHOIS dates and registrant info) - none of
// this triggers extra registry queries.
// ---------------------------------------------------------------------------

function computeAgeDays(dateStr: unknown): number | null {
  const d = parseRegistryDate(dateStr);
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
}

function computeDaysUntil(dateStr: unknown): number | null {
  const d = parseRegistryDate(dateStr);
  return d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : null;
}

const PRIVACY_MARKERS = [
  /redacted for privacy/i,
  /data protected/i,
  /privacy\s*protect/i,
  /whoisguard/i,
  /domains by proxy/i,
  /perfect privacy/i,
  /contact privacy/i,
  /private registration/i,
  /identity protect/i,
  /not disclosed/i,
  /withheld for privacy/i,
];

// Explicit privacy/redaction markers establish a positive privacy signal.
// Usable public contact data establishes a negative one. A missing or blank
// contact can instead reflect registry policy, access tier, parser coverage,
// or ordinary omission, so it remains inconclusive rather than being promoted
// to an affirmative privacy claim.
function isPrivacyProtected(registrant: CompactContact | null): boolean | null {
  if (!registrant) return null;
  const blob = [registrant.name, registrant.org, registrant.email].filter(Boolean).join(' ');
  if (!blob) return null;
  return PRIVACY_MARKERS.some((re) => re.test(blob));
}

// RDAP Lookup retains a bounded multi-value contact inventory, but Bulk and
// watchlist availability records deliberately keep the historical compact
// shape. This prevents repeated contact arrays and registry links from
// expanding browser-local stores or flowing into case evidence implicitly.
function compactContact(contact: unknown): CompactContact | null {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return null;
  const value = contact as UnknownRecord;
  const compact = {
    handle: value.handle || null,
    name: value.name || null,
    org: value.org || null,
    email: value.email || null,
    phone: value.phone || null,
    address: value.address || null,
  };
  return Object.values(compact).some(Boolean) ? compact : null;
}

// A number of ccTLD registries publish neither an RDAP bootstrap entry nor a
// generally reachable port-43 WHOIS service. A positive NS answer cannot
// replace registry registration data, but it does prove that the registrable
// domain has an active DNS delegation. Use that as a bounded, positive-only
// fallback: no answer is never interpreted as availability because registered
// domains can legitimately be undelegated.
async function checkDnsDelegation(domain: string, { resolver = dns.resolveNs }: { resolver?: (domain: string) => Promise<string[]> } = {}): Promise<DnsDelegation> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      Promise.resolve().then(() => resolver(domain)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS delegation lookup timed out')), DNS_DELEGATION_TIMEOUT_MS);
      }),
    ]);
    const validNameservers = [...new Set((Array.isArray(records) ? records : [])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim().replace(/\.+$/, '').toLowerCase())
      .filter((value) => value.length > 0 && value.length <= 253)
      .filter((value) => value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))]
      .sort();
    const normalized = validNameservers.slice(0, MAX_DELEGATION_NAMESERVERS);
    return {
      delegated: normalized.length > 0,
      nameservers: normalized,
      nameserversTruncated: validNameservers.length > MAX_DELEGATION_NAMESERVERS,
      error: null,
    };
  } catch (err) {
    const error = errorRecord(err);
    if (typeof error.code === 'string' && MISSING_DNS_CODES.has(error.code)) {
      return { delegated: false, nameservers: [], nameserversTruncated: false, error: null };
    }
    return {
      delegated: false,
      nameservers: [],
      nameserversTruncated: false,
      error: nonEmptyErrorMessage(err, String(err)).slice(0, 180),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Fetches enough of the homepage for the lightweight HTML signals below and
// preserves why the probe failed. A failed request is not evidence that a
// domain has "no site": transient DNS/TLS/network failures, a slow origin, or
// an HTTP error can all produce the same null body. Keeping that distinction
// avoids turning an inconclusive probe into a false inactivity claim.
async function fetchHomepage(
  domain: string,
  { fetcher = safeFetchDetailed as HomepageFetcher, timeoutMs = HOMEPAGE_FETCH_TIMEOUT_MS }: { fetcher?: HomepageFetcher; timeoutMs?: number } = {},
): Promise<HomepageResult> {
  const requestTimeoutMs = Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= HOMEPAGE_FETCH_TIMEOUT_MS
    ? timeoutMs
    : HOMEPAGE_FETCH_TIMEOUT_MS;
  const headers = whoisleuthRequestHeaders();
  const failures: HomepageFailure[] = [];
  const probeStartedAt = Date.now();
  for (const scheme of ['https', 'http']) {
    const requestUrl = `${scheme}://${domain}`;
    const attemptStartedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const fetched = await fetcher(requestUrl, { signal: controller.signal, headers });
      const fetchedResponse = fetched instanceof Response ? fetched : fetched.response;
      const detail: HomepageFetchDetail = fetched && typeof fetched === 'object' && 'response' in fetched
        ? fetched as HomepageFetchDetail
        : {
            response: fetchedResponse,
            requestedUrl: requestUrl,
            finalUrl: requestUrl,
            redirectCount: 0,
            redirectLimitReached: false,
            hops: [{ url: requestUrl, status: fetchedResponse.status, location: null, durationMs: Date.now() - attemptStartedAt }],
            durationMs: Date.now() - attemptStartedAt,
          };
      const res = detail.response;
      // A truncated homepage is still fine here - only used to scan for a
      // for-sale text match, not parsed as well-formed content. The
      // timeout stays armed through this read (cleared in `finally` below,
      // not here) - a malicious site could otherwise send headers
      // immediately and then trickle or stall the body forever, hanging
      // this worker with no deadline once the timer above is disarmed.
      if (res.ok) {
        const body = await readTextCapped(res, MAX_HOMEPAGE_BYTES, { includeSha256: true });
        return {
          text: body.text,
          status: 'fetched',
          detail: `Homepage responded over ${scheme.toUpperCase()} (HTTP ${res.status}).`,
          responsePolicy: analyzeResponsePolicyHeaders(res.headers),
          technologyHeaders: {
            'cf-ray': res.headers.get('cf-ray') || '',
            'x-drupal-cache': res.headers.get('x-drupal-cache') || '',
            'x-served-by': res.headers.get('x-served-by') || '',
            'x-powered-by': res.headers.get('x-powered-by') || '',
            'x-shopify-stage': res.headers.get('x-shopify-stage') || '',
            'x-sorting-hat-podid': res.headers.get('x-sorting-hat-podid') || '',
            'x-vercel-id': res.headers.get('x-vercel-id') || '',
          },
          http: buildHttpObservation({ ...detail, durationMs: Date.now() - attemptStartedAt }, {
            previousAttempts: failures,
            capturedBodyBytes: body.bytesRead,
            bodyInspected: true,
            bodyTruncated: body.truncated,
            bodySha256: body.sha256,
          }),
        };
      }
      // A non-2xx HTTP response still conclusively proves that a web service
      // answered on this domain. It may block this probe (403), require auth
      // (401), have a broken homepage route (404), or be unhealthy (5xx), but
      // none of those are equivalent to "no website". We cannot inspect its
      // HTML signals, so preserve a separate responded status and release the
      // unused body.
      await res.body?.cancel().catch(() => {});
      return {
        text: null,
        status: 'responded',
        detail: `Web server responded over ${scheme.toUpperCase()} (HTTP ${res.status}); homepage content was not available for inspection.`,
        responsePolicy: analyzeResponsePolicyHeaders(res.headers),
        http: buildHttpObservation({ ...detail, durationMs: Date.now() - attemptStartedAt }, {
          previousAttempts: failures,
          capturedBodyBytes: 0,
          bodyInspected: false,
        }),
      };
    } catch (err) {
      const error = errorRecord(err);
      const reason = error.name === 'AbortError'
        ? `timed out after ${requestTimeoutMs} milliseconds`
        : nonEmptyErrorMessage(err, 'request failed')
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .slice(0, 180);
      failures.push({ url: requestUrl, error: `${scheme.toUpperCase()} ${reason}` });
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    text: null,
    status: 'inconclusive',
    detail: failures.length
      ? `Could not confirm homepage activity: ${failures.map((attempt) => attempt.error).join('; ')}.`
      : 'Could not confirm homepage activity.',
    http: failedHttpObservation(failures, { durationMs: Date.now() - probeStartedAt }),
  };
}

function deriveWebsiteActivity(homepageStatus: string, hasFavicon: boolean, alreadyParked = false): WebsiteActivity {
  if (alreadyParked) return 'parked';
  if (homepageStatus === 'fetched' || homepageStatus === 'responded' || hasFavicon) return 'active';
  return 'unreachable';
}

function registryPolicyDetail(domain: string, fast: boolean): string {
  const details: string[] = [];
  const rdapAdmission = registryServiceAdmissionFor(domain, 'rdap');
  if (rdapAdmission && !rdapAdmission.allowed) {
    details.push('RDAP was not queried because the registry capability profile records no IANA-published RDAP service for this suffix.');
  }
  const whoisAdmission = fast ? null : registryServiceAdmissionFor(domain, 'whois');
  if (whoisAdmission && !whoisAdmission.allowed) {
    details.push(whoisAdmission.state === 'permission_required'
      ? 'WHOIS was not queried because registry permission or source authorisation is required.'
      : 'WHOIS was not queried because IANA publishes no domain WHOIS service for this suffix.');
  }
  return details.length ? ` ${details.join(' ')}` : '';
}

// fast: true skips the WHOIS fallback (no TCP:43 chain) and the homepage
// fetch (no for-sale/parking detection) - just RDAP plus the signals
// derivable from it (age, expiry proximity, privacy). Meant for scanning
// large sourcing candidate lists quickly and gently on registry rate
// limits; anything it can't resolve (state "unknown") is meant to get a
// follow-up deep check (fast: false, the default) on the shortlist only.
async function checkDomainAvailability(domain: string, options: AvailabilityOptions = {}) {
  const fast = options.fast === true;
  const collectDns = options.collectDnsIntelligence || collectDnsIntelligence;
  const collectTls = options.collectTlsIntelligence || collectTlsIntelligence;
  const fetchHomepageForDomain = options.fetchHomepage || fetchHomepage;
  const fetchFaviconForDomain = options.fetchFaviconHash || fetchFaviconHash;
  const featurePolicy = options.featurePolicy || networkFeaturePolicy();
  const rdapEnabled = featureDecision('rdap', featurePolicy).enabled;
  const whoisEnabled = featureDecision('whois', featurePolicy).enabled;
  const dnsIntelligenceEnabled = featureDecision('dns_intelligence', featurePolicy).enabled;
  const websiteProbeEnabled = featureDecision('website_probe', featurePolicy).enabled;
  const tlsIntelligenceEnabled = featureDecision('tls_intelligence', featurePolicy).enabled;
  const deepScanComplete = rdapEnabled
    && whoisEnabled
    && dnsIntelligenceEnabled
    && websiteProbeEnabled
    && tlsIntelligenceEnabled;
  const hasPreloadedRdap = Object.prototype.hasOwnProperty.call(options, 'rdapRecord');
  const hasPreloadedWhois = Object.prototype.hasOwnProperty.call(options, 'whoisChain');
  const hasPreloadedRdapPromise = Object.prototype.hasOwnProperty.call(options, 'rdapRecordPromise');
  const hasPreloadedWhoisPromise = Object.prototype.hasOwnProperty.call(options, 'whoisChainPromise');
  const hasPreloadedDnsDelegation = Object.prototype.hasOwnProperty.call(options, 'dnsDelegation');
  let nameservers: string[] = [];
  let statuses: string[] = [];
  let rdapServer: string | null = null;
  let rdapFound = false;
  let registrar: CompactContact | null = null;
  let registrant: CompactContact | null = null;
  let abuse: CompactContact | null = null;
  let createdDate: string | null = null;
  let expiryDate: string | null = null;
  let createdDateIso: string | null = null;
  let expiryDateIso: string | null = null;
  let registrationSource: RegistrationSource = null;
  let registrationConfidence: RegistrationConfidence = 'high';
  let dnssec: string | null = null;
  let registryDnsEvidence: unknown = null;

  if (rdapEnabled) {
    try {
      // Shared with /api/rdap (lib/rdap.mts's fetchRdapRecord) rather than a
      // separate fetch+parse here - same registry data either way, and this
      // also picks up that function's short-TTL cache (lib/lookup-cache.mts)
      // and upstream timeout for free.
      const recordValue = hasPreloadedRdapPromise
        ? await options.rdapRecordPromise
        : hasPreloadedRdap
          ? options.rdapRecord
          : await fetchRdapRecord('domain', domain);
      const record = errorRecord(recordValue);
      const recordRdapServer = typeof record.rdapServer === 'string' ? record.rdapServer : null;
      const upstreamStatus = typeof record.upstreamStatus === 'number' ? record.upstreamStatus : null;
      if (Object.keys(record).length) {
        rdapServer = recordRdapServer;
        if (upstreamStatus === 404) {
          return {
            state: 'available',
            confidence: 'high',
            detail: 'The registry\'s RDAP service has no record for this domain.',
            source: 'rdap',
            rdapServer: recordRdapServer,
          };
        }
        const parsed = errorRecord(record.parsed);
        if (Object.keys(parsed).length) {
          registryDnsEvidence = parsed;
          statuses = Array.isArray(parsed.statuses)
            ? parsed.statuses.filter((status: unknown): status is string => typeof status === 'string').map((status: string) => status.toLowerCase())
            : [];
          nameservers = Array.isArray(parsed.nameservers)
            ? parsed.nameservers.filter((nameserver: unknown): nameserver is string => typeof nameserver === 'string')
            : [];
          registrar = compactContact(parsed.registrar);
          registrant = compactContact(parsed.registrant);
          abuse = compactContact(parsed.abuse);
          const events = Array.isArray(parsed.events)
            ? parsed.events.map(errorRecord)
            : [];
          const lifecycle = errorRecord(parsed.lifecycle);
          createdDate = typeof lifecycle.createdDate === 'string'
            ? lifecycle.createdDate
            : rdapEventDate(events, 'registration');
          expiryDate = typeof lifecycle.expiryDate === 'string'
            ? lifecycle.expiryDate
            : rdapEventDate(events, 'expiration');
          createdDateIso = typeof lifecycle.createdDateIso === 'string'
            ? lifecycle.createdDateIso
            : registryDateIso(createdDate);
          expiryDateIso = typeof lifecycle.expiryDateIso === 'string'
            ? lifecycle.expiryDateIso
            : registryDateIso(expiryDate);
          dnssec = typeof parsed.dnssec === 'string' ? parsed.dnssec : null;
          rdapFound = true;
          registrationSource = 'rdap';
        }
      }
    } catch {
      /* fall through to WHOIS-based detection (deep mode only) */
    }
  }

  const dnsDelegationPromise = !rdapFound && dnsIntelligenceEnabled
    ? hasPreloadedDnsDelegation
      ? Promise.resolve(options.dnsDelegation)
      : checkDnsDelegation(domain, { resolver: options.resolveNs || dns.resolveNs })
    : null;

  let whoisChain: Awaited<ReturnType<typeof buildWhoisChain>> | null = null;
  let whoisParsed: ReturnType<typeof parseWhoisChain> | null = null;
  if (!rdapFound && !fast && whoisEnabled) {
    try {
      whoisChain = (hasPreloadedWhoisPromise
        ? await options.whoisChainPromise
        : hasPreloadedWhois
          ? options.whoisChain
          : await buildWhoisChain(domain)) ?? null;
      if (!Array.isArray(whoisChain)) throw new Error('WHOIS chain unavailable');
      const parsed = parseWhoisChain(whoisChain);
      whoisParsed = parsed;
      if (parsed.notFound) {
        return {
          state: 'available',
          confidence: 'medium',
          detail: `WHOIS reports no matching record for this domain${parsed.notFoundSource ? ` (per ${parsed.notFoundSource})` : ''}.`,
          source: 'whois',
        };
      }
      if (parsed.nameservers.length) nameservers = parsed.nameservers;
      if (parsed.statuses.length) statuses = parsed.statuses.map((status: string) => status.toLowerCase());
      if (parsed.registrar) {
        registrar = {
          handle: null,
          ianaId: parsed.registrarIanaId || null,
          name: parsed.registrar,
          org: null,
          email: parsed.abuseEmail || null,
          phone: parsed.abusePhone || null,
        };
      }
      if (parsed.registrantName || parsed.registrantOrg || parsed.registrantEmail || parsed.registrantPhone) {
        registrant = {
          handle: null,
          name: parsed.registrantName || null,
          org: parsed.registrantOrg || null,
          email: parsed.registrantEmail || null,
          phone: parsed.registrantPhone || null,
        };
      }
      if (parsed.abuseEmail || parsed.abusePhone) {
        abuse = { handle: null, name: null, org: parsed.registrar || null, email: parsed.abuseEmail || null, phone: parsed.abusePhone || null };
      }
      createdDate = parsed.createdDate || null;
      expiryDate = parsed.expiryDate || null;
      createdDateIso = parsed.createdDateIso || parsed.lifecycle?.createdDateIso || registryDateIso(createdDate);
      expiryDateIso = parsed.expiryDateIso || parsed.lifecycle?.expiryDateIso || registryDateIso(expiryDate);
      if (!dnssec) dnssec = parsed.dnssec || null;
      if (parsed.registrationStatus === 'registered'
        || registrar || createdDate || expiryDate || nameservers.length > 0 || statuses.length > 0) {
        registrationSource = 'whois';
      }
    } catch {
      /* if both RDAP and WHOIS fail, we simply can't determine availability */
    }
  }

  // WHOIS ran and was not a confirmed not-found, but produced no positive
  // registration evidence either - e.g. the registry answered inconclusively
  // or every referral hop failed/rate-limited. Report "unknown" rather than
  // fabricating "registered" from an empty record.
  const hasWhoisRegistrationData = whoisParsed?.registrationStatus === 'registered'
    || Boolean(registrar) || Boolean(createdDate) || Boolean(expiryDate)
    || nameservers.length > 0 || statuses.length > 0;
  let dnsDelegated = false;
  if (!rdapFound && !hasWhoisRegistrationData && dnsDelegationPromise) {
    const delegation = await dnsDelegationPromise;
    if (delegation && delegation.delegated === true && Array.isArray(delegation.nameservers) && delegation.nameservers.length) {
      dnsDelegated = true;
      nameservers = delegation.nameservers;
      registrationSource = 'dns';
      registrationConfidence = 'medium';
    }
  }

  if (!rdapFound && !hasWhoisRegistrationData && !dnsDelegated) {
    const disabledSources = [
      !rdapEnabled ? 'RDAP' : null,
      !fast && !whoisEnabled ? 'WHOIS' : null,
      !dnsIntelligenceEnabled ? 'DNS intelligence' : null,
    ].filter(Boolean);
    const disabledDetail = disabledSources.length
      ? ` ${disabledSources.join(', ')} ${disabledSources.length === 1 ? 'is' : 'are'} disabled by deployment policy.`
      : '';
    const policyDetail = registryPolicyDetail(domain, fast);
    return {
      state: 'unknown',
      confidence: 'low',
      detail: fast
        ? `No enabled registration source produced a record or authoritative delegation. A fast scan cannot determine registration status.${disabledDetail}${policyDetail}`
        : whoisParsed && whoisParsed.failedHop
        ? `WHOIS was inconclusive - a referral hop did not answer conclusively (${whoisParsed.failedHop}).${policyDetail}`
        : `No enabled registration source returned conclusive data or an authoritative DNS delegation.${disabledDetail}${policyDetail}`,
      ...(!fast && whoisEnabled ? { source: 'whois' } : {}),
    };
  }

  const domainAgeDays = computeAgeDays(createdDateIso || createdDate);
  const expiresInDays = computeDaysUntil(expiryDateIso || expiryDate);
  // DNS proves delegation only; it says nothing about whether registry
  // contact data is privacy-protected or merely unavailable.
  const privacyProtected = registrationSource === 'dns' ? null : isPrivacyProtected(registrant);

  const baseInfo = {
    nameservers,
    statuses,
    registrar,
    registrant,
    abuse,
    createdDate,
    expiryDate,
    createdDateIso,
    expiryDateIso,
    rdapServer,
    domainAgeDays,
    expiresInDays,
    privacyProtected,
    dnssec,
    source: registrationSource,
  };

  if (statuses.some((s) => s.includes('pendingdelete') || s.includes('redemptionperiod'))) {
    return {
      state: 'expiring',
      confidence: 'medium',
      detail: 'Domain is in redemption/pending-delete status and may become available soon.',
      ...baseInfo,
    };
  }

  if (fast) {
    return {
      state: 'registered',
      confidence: registrationConfidence,
      detail: registrationSource === 'dns'
        ? 'Authoritative DNS delegation confirms the domain is registered, but RDAP/WHOIS registration details were unavailable.'
        : 'Domain is registered. Run a deep check for parking/for-sale detection.',
      ...baseInfo,
    };
  }

  // Registered - look for for-sale/parked/website signals (homepage fetch,
  // deep mode only), and check for a configured mail exchanger as a
  // phishing-risk signal (a lookalike domain that can receive/send mail is
  // capable of running credential-harvesting or BEC campaigns).
  const nsSignal = nameservers.find((ns) => PARKING_NS_PATTERNS.some((re) => re.test(ns)));
  let forSaleSignal = nsSignal ? `parking nameserver (${nsSignal})` : null;
  let activityStatus = nsSignal ? 'parked' : 'unknown';

  // Homepage + bounded DNS evidence resolve in parallel; the favicon fetch is sequenced after
  // the homepage so it can use any <link rel="icon"> the page declares (many
  // sites serve no /favicon.ico and only point to a CDN PNG this way). One
  // extra round-trip on the already-slow deep path, in exchange for finding
  // favicons the bare /favicon.ico probe would miss.
  const [homepage, dnsIntelligence, tlsIntelligence] = await Promise.all([
    websiteProbeEnabled ? fetchHomepageForDomain(domain).catch((err): HomepageResult => ({
      text: null,
      status: 'inconclusive',
      detail: `Could not confirm homepage activity: ${String(err && err.message ? err.message : 'request failed').slice(0, 180)}.`,
      http: failedHttpObservation([
        { url: `https://${domain}`, error: String(err && err.message ? err.message : 'request failed') },
      ]),
    })) : Promise.resolve<HomepageResult>({
      text: null,
      status: 'skipped',
      detail: 'Website probing is disabled by deployment policy.',
      http: skippedHttpObservation(),
    }),
    dnsIntelligenceEnabled
      ? collectDns(domain, {
          ...(options.dnsResolvers ? { resolvers: options.dnsResolvers } : {}),
          includeExtendedContext: options.includeExtendedDnsContext === true,
          includeInheritedCaa: options.includeInheritedCaa === true,
          registryEvidence: registryDnsEvidence,
        })
      : Promise.resolve(skippedDnsIntelligence(
          'DNS intelligence is disabled by deployment policy.',
          {
            includeExtendedContext: options.includeExtendedDnsContext === true,
            includeInheritedCaa: options.includeInheritedCaa === true,
          },
        )),
    tlsIntelligenceEnabled
      ? collectTls(domain)
      : Promise.resolve(skippedTlsObservation()),
  ]);
  const page = homepage.text;
  const favicon = websiteProbeEnabled
    ? await fetchFaviconForDomain(domain, { html: page || '' }).catch(() => null)
    : null;
  const faviconHash = favicon ? favicon.hash : null;
  const faviconPHash = favicon ? favicon.phash : null;

  let htmlSignals: HtmlSignals = {
    pageTitle: null,
    hasPasswordField: false,
    phishingLanguageMatch: null,
    hasExternalFormAction: null,
    externalAssetHosts: [],
    cspMetaPolicy: null,
    pageIdentity: null,
    credentialSurfaceProfile: null,
    structuredDataIdentity: null,
    technologyProfile: null,
    pageRoleProfile: null,
    clientBehaviorProfile: null,
  };

  if (homepage.status === 'fetched') {
    if (page) {
      const saleMatch = page.match(FOR_SALE_TEXT_RE);
      if (saleMatch) {
        forSaleSignal = forSaleSignal || `homepage text ("${saleMatch[0]}")`;
        activityStatus = 'parked';
      }
      const responseContentType = homepage.http?.response?.contentType;
      const pageIdentityEligible = typeof responseContentType !== 'string'
        || responseContentType.trim() === ''
        || /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(responseContentType.trim());
      htmlSignals = extractHtmlSignals(page, domain, {
        ...(typeof homepage.http?.finalUrl === 'string' ? { baseUrl: homepage.http.finalUrl } : {}),
        ...(typeof homepage.http?.observedAt === 'string' ? { observedAt: homepage.http.observedAt } : {}),
        sourceTruncated: homepage.http?.response?.bodyTruncated === true,
        exactBodyHash: homepage.http?.response?.bodyHash,
        httpServer: homepage.http?.response?.server,
        responseHeaders: homepage.technologyHeaders,
        activityStatus,
        includePageIdentity: pageIdentityEligible,
        includePublicationMetadata: options.includePublicationMetadata !== false,
        ...(options.includeCredentialSurfaceProfile !== undefined
          ? { includeCredentialSurfaceProfile: options.includeCredentialSurfaceProfile }
          : {}),
        ...(options.includeStructuredDataIdentity !== undefined
          ? { includeStructuredDataIdentity: options.includeStructuredDataIdentity }
          : {}),
        ...(options.includeTechnologyProfile !== undefined
          ? { includeTechnologyProfile: options.includeTechnologyProfile }
          : {}),
      });
    }
  }

  const responsePolicy = qualifyResponsePolicyWithCspMeta(homepage.responsePolicy, htmlSignals.cspMetaPolicy);
  const retainedHttp = options.includeDeliveryMetadata === false
    ? withoutHttpDeliveryMetadata(homepage.http)
    : homepage.http;
  const { cspMetaPolicy: _cspMetaPolicy, ...retainedHtmlSignals } = htmlSignals;
  const securityPosture = options.includeSecurityPosture === false ? null : analyzeWebsiteSecurityPosture({
    http: homepage.http,
    responsePolicy,
    pageIdentity: htmlSignals.pageIdentity,
    tls: tlsIntelligence,
    dns: dnsIntelligence,
    dnssec,
    observedAt: homepage.http?.observedAt,
  });

  const redirectSaleSignal = forSaleRedirectSignal(homepage.http);
  if (!forSaleSignal && redirectSaleSignal) {
    forSaleSignal = redirectSaleSignal;
    activityStatus = 'parked';
  }

  const faviconProvedActive = homepage.status === 'inconclusive' && Boolean(favicon);
  const websiteProbeStatus = faviconProvedActive ? 'responded' : homepage.status;
  const websiteProbeDetail = faviconProvedActive
    ? `${homepage.detail} A favicon responded successfully, confirming an active web service.`
    : homepage.detail;
  if (websiteProbeEnabled) {
    activityStatus = deriveWebsiteActivity(homepage.status, Boolean(favicon), activityStatus === 'parked');
  }

  if (!forSaleSignal) {
    return {
      state: 'registered',
      confidence: registrationConfidence,
      detail: registrationSource === 'dns'
        ? 'Authoritative DNS delegation confirms the domain is registered, but RDAP/WHOIS registration details were unavailable. No for-sale signals were observed.'
        : 'Domain is registered and shows no for-sale signals.',
      activityStatus,
      websiteProbeStatus,
      websiteProbeDetail,
      http: retainedHttp,
      deepScanComplete,
      faviconHash,
      faviconPHash,
      ...retainedHtmlSignals,
      securityPosture,
      ...baseInfo,
      nameservers: nameservers.length ? nameservers : dnsIntelligence.records.ns,
      dns: dnsIntelligence,
      tls: tlsIntelligence,
      hasMx: dnsIntelligence.hasMx,
      hasNullMx: dnsIntelligence.hasNullMx,
      mxHosts: dnsIntelligence.mxHosts,
      hasSpf: dnsIntelligence.hasSpf,
      hasDmarc: dnsIntelligence.hasDmarc,
    };
  }

  return {
    state: 'for_sale',
    confidence: 'medium',
    detail: `Detected a for-sale listing (${forSaleSignal}).`,
    activityStatus,
    websiteProbeStatus,
    websiteProbeDetail,
    http: retainedHttp,
    deepScanComplete,
    faviconHash,
    faviconPHash,
    ...retainedHtmlSignals,
    securityPosture,
    ...baseInfo,
    nameservers: nameservers.length ? nameservers : dnsIntelligence.records.ns,
    dns: dnsIntelligence,
    tls: tlsIntelligence,
    hasMx: dnsIntelligence.hasMx,
    hasNullMx: dnsIntelligence.hasNullMx,
    mxHosts: dnsIntelligence.mxHosts,
    hasSpf: dnsIntelligence.hasSpf,
    hasDmarc: dnsIntelligence.hasDmarc,
  };
}

export {
  checkDomainAvailability,
  checkDnsDelegation,
  fetchHomepage,
  isPrivacyProtected,
  deriveWebsiteActivity,
  forSaleRedirectSignal,
  parseRegistryDate as parseWhoisDate,
};
