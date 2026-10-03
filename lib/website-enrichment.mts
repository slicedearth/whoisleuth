// Bounded website and network enrichment, independent of registration authority.
import { capturedWebCollectionQuality } from '../packages/evidence/collection-quality.mts';
import { recordOrEmpty as errorRecord } from './json-record.mts';
import type { RegistrationAssessment } from './domain-registration.mts';
import { safeFetchDetailed, readTextCapped } from './safe-fetch.mts';
import { whoisleuthRequestHeaders } from './outbound-identity.mts';
import { collectDnsIntelligence, skippedDnsIntelligence } from './dns-intelligence.mts';
import type { DnsResolver } from './dns-intelligence.mts';
import { fetchFaviconHash } from './favicon.mts';
import { extractHtmlSignals } from './html-signals.mts';
import { analyzeStaticHtml } from './static-html-analysis.mts';
import { featureDecision, networkFeaturePolicy } from './feature-policy.mts';
import { withoutHttpDeliveryMetadata, buildHttpObservation, failedHttpObservation, skippedHttpObservation } from './http-intelligence.mts';
import { collectTlsIntelligence, skippedTlsObservation } from './tls-intelligence.mts';
import { analyzeWebsiteSecurityPosture } from './website-security-posture.mts';
import {
  analyzeWebsiteTechnology,
  captureTechnologyResponseHeaders,
} from './website-technology.mts';
import {
  analyzeResponsePolicyHeaders,
  qualifyResponsePolicyWithCspMeta,
} from './response-policy.mts';
import type { ResponsePolicyAnalysis } from './response-policy.mts';
import { nonEmptyErrorMessage } from './error-detail.mts';
import { prepareSelectedLookupUrl } from '../packages/evidence/lookup-target.mts';
import {
  HOMEPAGE_FETCH_TIMEOUT_MS,
  MAX_HOMEPAGE_BYTES,
} from './outbound-request-bounds.mts';

type UnknownRecord = Record<string, unknown>;
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
  analysisBaseUrl?: string;
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
type HomepageFetchOptions = { fetcher?: HomepageFetcher; timeoutMs?: number; selectedUrl?: string; signal?: AbortSignal };
export type WebsiteEnrichmentOptions = {
  signal?: AbortSignal;
  observationHostname?: string;
  selectedUrl?: string;
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
  fetchHomepage?: (domain: string, options?: HomepageFetchOptions) => Promise<HomepageResult>;
  fetchFaviconHash?: typeof fetchFaviconHash;
  featurePolicy?: ReturnType<typeof networkFeaturePolicy>;
};
type WebsiteActivity = 'parked' | 'active' | 'unreachable';
type HtmlSignals = Omit<Awaited<ReturnType<typeof extractHtmlSignals>>, 'cspMetaPolicy'> & Readonly<{
  cspMetaPolicy: Awaited<ReturnType<typeof extractHtmlSignals>>['cspMetaPolicy'] | null;
}>;


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
// Fetches enough of the homepage for the lightweight HTML signals below and
// preserves why the probe failed. A failed request is not evidence that a
// domain has "no site": transient DNS/TLS/network failures, a slow origin, or
// an HTTP error can all produce the same null body. Keeping that distinction
// avoids turning an inconclusive probe into a false inactivity claim.
async function fetchHomepage(
  domain: string,
  { fetcher = safeFetchDetailed as HomepageFetcher, timeoutMs = HOMEPAGE_FETCH_TIMEOUT_MS, selectedUrl, signal }: HomepageFetchOptions = {},
): Promise<HomepageResult> {
  const selected = selectedUrl === undefined ? null : prepareSelectedLookupUrl(selectedUrl, domain);
  const requestTimeoutMs = Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= HOMEPAGE_FETCH_TIMEOUT_MS
    ? timeoutMs
    : HOMEPAGE_FETCH_TIMEOUT_MS;
  const headers = whoisleuthRequestHeaders();
  const failures: HomepageFailure[] = [];
  const probeStartedAt = Date.now();
  for (const requestUrl of selected ? [selected] : [`https://${domain}`, `http://${domain}`]) {
    signal?.throwIfAborted();
    const scheme = new URL(requestUrl).protocol.slice(0, -1);
    const attemptStartedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const fetched = await fetcher(requestUrl, { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, headers });
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
      const analysisBase = new URL(detail.finalUrl);
      analysisBase.search = '';
      analysisBase.hash = '';
      // Retain an explicitly partial prefix when the body exceeds its bound;
      // downstream analyses must not treat it as a complete page. The
      // timeout stays armed through this read (cleared in `finally` below,
      // not here) - a malicious site could otherwise send headers
      // immediately and then trickle or stall the body forever, hanging
      // this worker with no deadline once the timer above is disarmed.
      if (res.ok) {
        const body = await readTextCapped(res, MAX_HOMEPAGE_BYTES, { includeSha256: true });
        return {
          text: body.text,
          status: 'fetched',
          detail: `${selected ? 'Selected URL' : 'Homepage'} responded over ${scheme.toUpperCase()} (HTTP ${res.status}).`,
          responsePolicy: analyzeResponsePolicyHeaders(res.headers),
          technologyHeaders: captureTechnologyResponseHeaders(res.headers),
          ...(selected ? { analysisBaseUrl: analysisBase.toString() } : {}),
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
        detail: `Web server responded over ${scheme.toUpperCase()} (HTTP ${res.status}); ${selected ? 'selected page' : 'homepage'} content was not available for inspection.`,
        responsePolicy: analyzeResponsePolicyHeaders(res.headers),
        technologyHeaders: captureTechnologyResponseHeaders(res.headers),
        http: buildHttpObservation({ ...detail, durationMs: Date.now() - attemptStartedAt }, {
          previousAttempts: failures,
          capturedBodyBytes: 0,
          bodyInspected: false,
        }),
      };
    } catch (err) {
      signal?.throwIfAborted();
      const error = errorRecord(err);
      const reason = error.name === 'AbortError'
        ? `timed out after ${requestTimeoutMs} milliseconds`
        : selected ? 'request failed; the selected URL was not retried at another path or scheme'
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
      ? `Could not confirm ${selected ? 'selected URL' : 'homepage'} activity: ${failures.map((attempt) => attempt.error).join('; ')}.`
      : 'Could not confirm homepage activity.',
    http: failedHttpObservation(failures, { durationMs: Date.now() - probeStartedAt }),
  };
}

function deriveWebsiteActivity(homepageStatus: string, hasFavicon: boolean, alreadyParked = false): WebsiteActivity {
  if (alreadyParked) return 'parked';
  if (homepageStatus === 'fetched' || homepageStatus === 'responded' || hasFavicon) return 'active';
  return 'unreachable';
}

type WebsiteContext = RegistrationAssessment & { domain: string; observationHostname: string; selectedUrl: string | undefined };
async function enrichWebsite(context: WebsiteContext, options: WebsiteEnrichmentOptions, featurePolicy: ReturnType<typeof networkFeaturePolicy>) {
  const { domain, observationHostname, selectedUrl, registration, registryDnsEvidence, nameservers, dnssec } = context;
  const websiteProbeEnabled = featureDecision('website_probe', featurePolicy).enabled;
  const collectDns = options.collectDnsIntelligence || collectDnsIntelligence;
  const collectTls = options.collectTlsIntelligence || collectTlsIntelligence;
  const fetchHomepageForDomain = options.fetchHomepage || fetchHomepage;
  const fetchFaviconForDomain = options.fetchFaviconHash || fetchFaviconHash;
  const dnsIntelligenceEnabled = featureDecision('dns_intelligence', featurePolicy).enabled;
  const tlsIntelligenceEnabled = featureDecision('tls_intelligence', featurePolicy).enabled;
  const deepScanComplete = (['rdap', 'whois', 'dns_intelligence', 'website_probe', 'tls_intelligence'] as const)
    .every((feature) => featureDecision(feature, featurePolicy).enabled);

  // Registered - look for for-sale/parked/website signals (homepage fetch,
  // deep mode only), and check for a configured mail exchanger as a
  // phishing-risk signal (a lookalike domain that can receive/send mail is
  // capable of running credential-harvesting or BEC campaigns).
  const nsSignal = registration.state === 'registered' ? nameservers.find((ns) => PARKING_NS_PATTERNS.some((re) => re.test(ns))) : undefined;
  let forSaleSignal = nsSignal ? `parking nameserver (${nsSignal})` : null;
  let activityStatus = nsSignal && observationHostname === domain ? 'parked' : 'unknown';

  // Homepage + bounded DNS evidence resolve in parallel; the favicon fetch is sequenced after
  // the homepage so it can use any <link rel="icon"> the page declares (many
  // sites serve no /favicon.ico and only point to a CDN PNG this way). One
  // extra round-trip on the already-slow deep path, in exchange for finding
  // favicons the bare /favicon.ico probe would miss.
  const [homepage, dnsIntelligence, tlsIntelligence] = await Promise.all([
    websiteProbeEnabled ? fetchHomepageForDomain(observationHostname, {
      ...(selectedUrl ? { selectedUrl } : {}), ...(options.signal ? { signal: options.signal } : {}),
    }).catch((err): HomepageResult => ({
      text: null,
      status: 'inconclusive',
      detail: selectedUrl ? 'Could not confirm selected URL activity.'
        : `Could not confirm homepage activity: ${String(err && err.message ? err.message : 'request failed').slice(0, 180)}.`,
      http: failedHttpObservation([
        { url: selectedUrl ?? `https://${observationHostname}`, error: selectedUrl ? 'request failed' : String(err && err.message ? err.message : 'request failed') },
      ]),
    })) : Promise.resolve<HomepageResult>({
      text: null,
      status: 'skipped',
      detail: 'Website probing is disabled by deployment policy.',
      http: skippedHttpObservation(),
    }),
    dnsIntelligenceEnabled
      ? collectDns(observationHostname, {
          ...(options.dnsResolvers ? { resolvers: options.dnsResolvers } : {}),
          includeExtendedContext: options.includeExtendedDnsContext === true,
          includeInheritedCaa: options.includeInheritedCaa === true,
          registryEvidence: registryDnsEvidence,
          ...(observationHostname !== domain ? { registrationDomain: domain } : {}),
        })
      : Promise.resolve(skippedDnsIntelligence(
          'DNS intelligence is disabled by deployment policy.',
          {
            includeExtendedContext: options.includeExtendedDnsContext === true,
            includeInheritedCaa: options.includeInheritedCaa === true,
          },
        )),
    tlsIntelligenceEnabled
      ? collectTls(observationHostname)
      : Promise.resolve(skippedTlsObservation()),
  ]);
  options.signal?.throwIfAborted();
  const page = homepage.text;
  const pageBaseUrl = homepage.analysisBaseUrl ?? (typeof homepage.http?.finalUrl === 'string' ? homepage.http.finalUrl : `https://${observationHostname}/`);
  let pageAnalysis = page ? analyzeStaticHtml(page, { baseUrl: pageBaseUrl, includeVisibleText: true }) : undefined;

  let htmlSignals: HtmlSignals = {
    domainSaleSignal: null,
    pageTitle: null,
    hasPasswordField: false,
    hasExternalPasswordForm: null,
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
      const responseContentType = homepage.http?.response?.contentType;
      const pageIdentityEligible = typeof responseContentType !== 'string'
        || responseContentType.trim() === ''
        || /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(responseContentType.trim());
      htmlSignals = await extractHtmlSignals(page, observationHostname, {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(pageAnalysis ? { htmlAnalysis: pageAnalysis } : {}),
        baseUrl: pageBaseUrl,
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
      if (pageIdentityEligible && htmlSignals.domainSaleSignal) {
        if (!selectedUrl && observationHostname === domain) forSaleSignal = forSaleSignal || htmlSignals.domainSaleSignal;
        activityStatus = 'parked';
      }
    }
  }

  if (options.includeTechnologyProfile !== false && htmlSignals.technologyProfile === null
    && ['fetched', 'responded'].includes(homepage.status)) {
    htmlSignals.technologyProfile = await analyzeWebsiteTechnology({
      ...(options.signal ? { signal: options.signal } : {}),
      htmlAvailable: false,
      httpServer: homepage.http?.response?.server,
      responseHeaders: homepage.technologyHeaders,
      observedAt: homepage.http?.observedAt,
    });
  }

  // Complete document consumers before an optional network wait. Only the
  // small icon projection, not every parsed element/token, crosses that wait.
  const faviconEvidence = pageAnalysis ? {
    iconLinks: pageAnalysis.iconLinks, effectiveBaseUrl: pageAnalysis.effectiveBaseUrl,
  } : undefined;
  const pageCollectionComplete = homepage.status === 'fetched' && homepage.http?.complete === true
    && homepage.http.response?.bodyTruncated !== true && Boolean(pageAnalysis)
    && !pageAnalysis?.inputLimitReached && !pageAnalysis?.tagLimitReached
    && !pageAnalysis?.visibleTextLimitReached && !pageAnalysis?.forms.truncated;
  pageAnalysis = undefined;
  const favicon = websiteProbeEnabled
    ? await fetchFaviconForDomain(observationHostname, {
        baseUrl: pageBaseUrl, ...(faviconEvidence ? { htmlAnalysis: faviconEvidence } : {}),
      }).catch(() => null)
    : null;
  const faviconHash = favicon ? favicon.hash : null;
  const faviconPHash = favicon ? favicon.phash : null;

  const responsePolicy = qualifyResponsePolicyWithCspMeta(homepage.responsePolicy, htmlSignals.cspMetaPolicy);
  const retainedHttp = options.includeDeliveryMetadata === false
    ? withoutHttpDeliveryMetadata(homepage.http)
    : homepage.http;
  const { cspMetaPolicy: _cspMetaPolicy, domainSaleSignal: _domainSaleSignal, ...retainedHtmlSignals } = htmlSignals;
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
  if (!selectedUrl && observationHostname === domain && !forSaleSignal && redirectSaleSignal) {
    forSaleSignal = redirectSaleSignal;
    activityStatus = 'parked';
  }

  const faviconProvedActive = !selectedUrl && homepage.status === 'inconclusive' && Boolean(favicon);
  const websiteProbeStatus = faviconProvedActive ? 'responded' : homepage.status;
  const websiteProbeDetail = faviconProvedActive
    ? `${homepage.detail} A favicon responded successfully, confirming an active web service.`
    : homepage.detail;
  if (websiteProbeEnabled) {
    activityStatus = deriveWebsiteActivity(homepage.status, !selectedUrl && Boolean(favicon), activityStatus === 'parked');
  }

  const registrationResult = registration.state !== 'registered' ? registration
    : !forSaleSignal ? {
      ...registration,
      detail: 'source' in registration && registration.source === 'dns'
        ? 'Authoritative DNS delegation confirms the domain is registered, but RDAP/WHOIS registration details were unavailable.'
        : selectedUrl ? 'The domain is registered. Website observations concern the explicitly selected URL.'
        : observationHostname === domain ? 'Domain is registered and shows no for-sale signals.'
          : 'The domain is registered. Website observations concern the separately identified hostname.',
    } : {
    ...registration,
    state: 'for_sale',
    confidence: 'medium',
    detail: `Detected a for-sale listing (${forSaleSignal}).`,
  };
  return {
    ...registrationResult,
    activityStatus,
    websiteProbeStatus,
    websiteProbeDetail,
    http: retainedHttp,
    ...(options.observationHostname !== undefined || selectedUrl ? { observationHostname } : {}),
    ...(selectedUrl ? { webObservationMode: 'selected_url' as const } : {}),
    deepScanComplete,
    webCollectionQuality: capturedWebCollectionQuality(
      !websiteProbeEnabled ? 'not_collected' : pageCollectionComplete ? 'complete'
        : homepage.status === 'fetched' ? 'partial' : 'unavailable',
      // The bounded favicon collector returns no result for both failed and
      // non-image candidates. A miss therefore cannot prove an icon was removed.
      !websiteProbeEnabled ? 'not_collected' : favicon ? 'complete' : 'unknown',
    ),
    faviconHash,
    faviconPHash,
    ...retainedHtmlSignals,
    securityPosture,
    nameservers: nameservers.length || observationHostname !== domain ? nameservers : dnsIntelligence.records.ns,
    dns: dnsIntelligence,
    tls: tlsIntelligence,
    hasMx: dnsIntelligence.hasMx,
    hasNullMx: dnsIntelligence.hasNullMx,
    mxHosts: dnsIntelligence.mxHosts,
    hasSpf: dnsIntelligence.hasSpf,
    hasDmarc: dnsIntelligence.hasDmarc,
  };
}

export { enrichWebsite, fetchHomepage, deriveWebsiteActivity, forSaleRedirectSignal };
