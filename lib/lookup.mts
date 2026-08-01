// Unified single-query orchestration shared by Express and Netlify.
//
// The browser used to call the RDAP, WHOIS, and availability functions
// separately. On serverless deployments those functions do not share an
// in-memory cache, so availability repeated registry work that RDAP/WHOIS had
// just performed. This module fetches each registration source once and feeds
// those exact results into availability classification.

import { fetchRdapRecord, fetchRegistrarRdapRecord } from './rdap.mts';
import { buildWhoisChain, parseWhoisChain } from './whois.mts';
import { OPERATION_BUDGET_ERROR_CODE } from './operation-budget.mts';
import { checkDomainAvailability } from './availability.mts';
import { abortable } from './abort.mts';
import {
  collectReverseDnsIntelligence,
  failedReverseDnsIntelligence,
  skippedReverseDnsIntelligence,
} from './dns-intelligence.mts';
import { collectObservedNetworkContext } from './observed-network-context.mts';
import { collectSecurityTxt, securityTxtUnavailable } from './security-txt.mts';
import { registryAccessDiagnosticFor } from './registry-capabilities.mts';
import type { ClassifiedQuery } from './classify.mts';
import { FEATURE_DISABLED_ERROR_CODE, featureDecision, networkFeaturePolicy } from './feature-policy.mts';
import { lookupUrlscanDomain } from './urlscan-intelligence.mts';
import { lookupUrlhausDomain } from './urlhaus-intelligence.mts';
import { lookupThreatfoxDomain } from './threatfox-intelligence.mts';
import {
  THREATFOX_PROVIDER,
  URLHAUS_PROVIDER,
  URLSCAN_PROVIDER,
} from './lookup-threat-provider-inventory.mts';
import { createThreatIntelligenceResult } from './threat-intelligence-contract.mts';
import type { ThreatIntelligenceResult } from './threat-intelligence-contract.mts';
import { buildRegistryInsights } from './registry-insights.mts';
import { inspectSslblCertificate } from './sslbl-intelligence.mts';
import {
  normalizeLookupSourceSettlement,
  plannedLookupProgressSources,
  type LookupSourceSettlement,
} from './lookup-source-progress.mts';
import { buildBulkComparisonEvidence } from './bulk-comparison-evidence.mts';

type LookupOptions = {
  fetchRdapRecord?: typeof fetchRdapRecord;
  fetchRegistrarRdapRecord?: typeof fetchRegistrarRdapRecord;
  buildWhoisChain?: typeof buildWhoisChain;
  checkDomainAvailability?: typeof checkDomainAvailability;
  collectReverseDnsIntelligence?: typeof collectReverseDnsIntelligence;
  collectObservedNetworkContext?: typeof collectObservedNetworkContext;
  collectSecurityTxt?: typeof collectSecurityTxt;
  lookupUrlscanDomain?: typeof lookupUrlscanDomain;
  lookupUrlhausDomain?: typeof lookupUrlhausDomain;
  lookupThreatfoxDomain?: typeof lookupThreatfoxDomain;
  inspectSslblCertificate?: typeof inspectSslblCertificate;
  sslblSnapshot?: unknown;
  sslblNow?: string | number | Date;
  fast?: boolean;
  compact?: boolean;
  externalIntelligence?: boolean;
  malwareHostIntelligence?: boolean;
  malwareIocIntelligence?: boolean;
  securityTxt?: boolean;
  featurePolicy?: ReturnType<typeof networkFeaturePolicy>;
  now?: () => number;
  onSourceSettled?: (settlement: LookupSourceSettlement) => void;
  signal?: AbortSignal;
};
type RegistrarRdap = {
  status: string;
  detail?: string | null;
  endpoint?: string | null;
  transportSecurity?: string | null;
  upstreamStatus?: number | null;
  fetchedAt?: string | null;
  attempt?: unknown;
  [key: string]: unknown;
};
type WhoisEnvelope = {
  skipped?: boolean;
  detail?: string;
  error?: string;
  chain?: unknown[];
  parsed?: ReturnType<typeof parseWhoisChain>;
};
type AvailabilityEnvelope = {
  applicable: boolean;
  type?: string;
  state?: string;
  [key: string]: unknown;
};

const LOOKUP_DIAGNOSTICS_VERSION = 8;
const LOOKUP_LEGACY_DIAGNOSTICS_VERSION = 7;
const LOOKUP_TIMING_VERSION = 1;
const MAX_LOOKUP_TIMING_MS = 120_000;
const LOOKUP_TIMING_SOURCE_ORDER = Object.freeze([
  'rdap',
  'whois',
  'domain_evidence',
  'reverse_dns',
  'registrar_rdap',
  'network_context',
  'security_txt',
  'external_intelligence',
  'malware_host_intelligence',
  'malware_ioc_intelligence',
] as const);
type LookupTimingSource = typeof LOOKUP_TIMING_SOURCE_ORDER[number];
type LookupTimingOutcome = 'fulfilled' | 'rejected';
type LookupTimingEntry = {
  source: LookupTimingSource;
  outcome: LookupTimingOutcome;
  durationMs: number;
  completedAfterMs: number;
};
const LOOKUP_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  CONCURRENCY_LIMITED: OPERATION_BUDGET_ERROR_CODE,
  FEATURE_DISABLED: FEATURE_DISABLED_ERROR_CODE,
  MISSING_QUERY: 'MISSING_QUERY',
  INVALID_QUERY: 'INVALID_QUERY',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
  RDAP_UPSTREAM_FAILED: 'RDAP_UPSTREAM_FAILED',
  RDAP_UNSUPPORTED: 'RDAP_UNSUPPORTED',
  WHOIS_UPSTREAM_FAILED: 'WHOIS_UPSTREAM_FAILED',
  AVAILABILITY_CHECK_FAILED: 'AVAILABILITY_CHECK_FAILED',
});

function errorMessage(err: unknown, fallback: string): string {
  const message = err && typeof err === 'object' && 'message' in err
    ? (err as { message?: unknown }).message
    : null;
  return String(message || fallback);
}

function boundedSourceDetail(err: unknown, fallback: string): string {
  return errorMessage(err, fallback)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240) || fallback;
}

function boundedTimingMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_LOOKUP_TIMING_MS, Math.max(0, Math.round(value)));
}

function createLookupTimingTracker(
  enabled: boolean,
  now: () => number,
) {
  const lookupStartedAt = now();
  const entries = new Map<LookupTimingSource, LookupTimingEntry>();

  function measure<T>(source: LookupTimingSource, operation: () => Promise<T> | T): Promise<T> {
    const sourceStartedAt = now();
    return Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          const finishedAt = now();
          entries.set(source, {
            source,
            outcome: 'fulfilled',
            durationMs: boundedTimingMs(finishedAt - sourceStartedAt),
            completedAfterMs: boundedTimingMs(finishedAt - lookupStartedAt),
          });
          return value;
        },
        (error) => {
          const finishedAt = now();
          entries.set(source, {
            source,
            outcome: 'rejected',
            durationMs: boundedTimingMs(finishedAt - sourceStartedAt),
            completedAfterMs: boundedTimingMs(finishedAt - lookupStartedAt),
          });
          throw error;
        },
      );
  }

  return {
    measure<T>(source: LookupTimingSource, operation: () => Promise<T> | T): Promise<T> {
      return enabled ? measure(source, operation) : Promise.resolve().then(operation);
    },
    snapshot() {
      if (!enabled) return null;
      const totalMs = boundedTimingMs(now() - lookupStartedAt);
      return {
        version: LOOKUP_TIMING_VERSION,
        totalMs,
        sources: LOOKUP_TIMING_SOURCE_ORDER
          .map((source) => entries.get(source))
          .filter((entry): entry is LookupTimingEntry => Boolean(entry)),
      };
    },
  };
}

async function runUnifiedLookup(classified: ClassifiedQuery, options: LookupOptions = {}) {
  const fetchRdap = options.fetchRdapRecord || fetchRdapRecord;
  const fetchRegistrarRdap = options.fetchRegistrarRdapRecord || fetchRegistrarRdapRecord;
  const fetchWhois = options.buildWhoisChain || buildWhoisChain;
  const checkAvailability = options.checkDomainAvailability || checkDomainAvailability;
  const collectReverseDns = options.collectReverseDnsIntelligence || collectReverseDnsIntelligence;
  const collectNetworkContext = options.collectObservedNetworkContext || collectObservedNetworkContext;
  const collectDisclosureContacts = options.collectSecurityTxt || collectSecurityTxt;
  const fetchUrlscanIntelligence = options.lookupUrlscanDomain || lookupUrlscanDomain;
  const fetchUrlhausIntelligence = options.lookupUrlhausDomain || lookupUrlhausDomain;
  const fetchThreatfoxIntelligence = options.lookupThreatfoxDomain || lookupThreatfoxDomain;
  const inspectCertificateWarningData = options.inspectSslblCertificate || inspectSslblCertificate;
  const fast = options.fast === true;
  const compact = options.compact === true;
  const externalIntelligence = options.externalIntelligence === true;
  const malwareHostIntelligence = options.malwareHostIntelligence === true;
  const malwareIocIntelligence = options.malwareIocIntelligence === true;
  const securityTxtRequested = options.securityTxt === true;
  const featurePolicy = options.featurePolicy || networkFeaturePolicy();
  const timing = createLookupTimingTracker(!fast && !compact, options.now || Date.now);
  const measure = <T,>(source: LookupTimingSource, operation: () => Promise<T> | T) => (
    timing.measure(source, () => abortable(operation, options.signal))
  );
  const rdapEnabled = featureDecision('rdap', featurePolicy).enabled;
  const whoisEnabled = featureDecision('whois', featurePolicy).enabled;
  const availabilityEnabled = featureDecision('availability', featurePolicy).enabled;
  const websiteProbeEnabled = featureDecision('website_probe', featurePolicy).enabled;
  const dnsIntelligenceEnabled = featureDecision('dns_intelligence', featurePolicy).enabled;
  const skipWhois = fast || !whoisEnabled;

  const rdapPromise = rdapEnabled
    ? measure('rdap', () => fetchRdap(classified.type, classified.value))
    : Promise.resolve(null);
  const whoisPromise = skipWhois
    ? Promise.resolve(null)
    : measure('whois', () => fetchWhois(classified.value));
  // Registrar RDAP is a separately attributed deep-lookup enrichment. It may
  // overlap the WHOIS chain, but it never joins the promises used to decide
  // availability and can add up to its own bounded timeout to a deep lookup.
  const registrarRdapPromise: Promise<RegistrarRdap | null> | null = classified.type === 'domain' && rdapEnabled && !fast && !compact
    ? rdapPromise.then((record) => record && record.upstreamStatus === 200 && record.parsed
        ? measure('registrar_rdap', () => fetchRegistrarRdap(classified.value, record))
        : null)
    : null;
  const availabilityPromise = classified.type === 'domain' && availabilityEnabled
    ? measure('domain_evidence', () => checkAvailability(classified.value, {
        fast,
        includeExtendedDnsContext: !compact,
        includeInheritedCaa: !fast && !compact,
        includeCredentialSurfaceProfile: !fast && !compact,
        includeStructuredDataIdentity: !fast && !compact,
        includeTechnologyProfile: !fast,
        includeSecurityPosture: !compact,
        featurePolicy,
        rdapRecordPromise: rdapPromise,
        whoisChainPromise: whoisPromise,
      }))
    : null;
  // Reverse DNS is separately attributed operator context for deep public-IP
  // lookups. It is never used by RDAP, WHOIS, availability, Risk, fast,
  // compact, Bulk, or monitoring contracts.
  const reverseDnsEligible = (classified.type === 'ipv4' || classified.type === 'ipv6')
    && !fast
    && !compact;
  const reverseDnsPromise = reverseDnsEligible && dnsIntelligenceEnabled
    ? measure('reverse_dns', () => collectReverseDns(classified.value))
    : null;
  // Network registration is an additive deep-only source. It starts only
  // after availability has produced the existing TLS/DNS observations and
  // never joins the evidence used to decide domain availability. The shared
  // RDAP helper supplies its existing three-minute cache and safe transport.
  const networkContextPromise = classified.type === 'domain'
    && rdapEnabled
    && availabilityEnabled
    && !fast
    && !compact
    && availabilityPromise
    ? availabilityPromise.then(
        (availability) => measure(
          'network_context',
          () => collectNetworkContext(availability, { fetchRdapRecord: fetchRdap }),
        ),
        () => measure(
          'network_context',
          () => collectNetworkContext({}, { fetchRdapRecord: fetchRdap }),
        ),
      )
    : null;
  // security.txt is an explicit, additive deep-lookup action. It uses the
  // exact queried hostname because RFC 9116 scopes a file to that hostname;
  // the result never joins registration, availability, or Risk inputs.
  const securityTxtPromise = securityTxtRequested
    && classified.type === 'domain'
    && websiteProbeEnabled
    && !fast
    && !compact
    ? measure('security_txt', () => collectDisclosureContacts(classified.inputHostname))
    : null;
  const urlscanIntelligencePromise: Promise<ThreatIntelligenceResult | null> | null = externalIntelligence
    && classified.type === 'domain'
    && !fast
    && !compact
    ? measure(
        'external_intelligence',
        () => fetchUrlscanIntelligence(classified.registrableDomain || classified.value),
      )
    : null;
  const urlhausIntelligencePromise: Promise<ThreatIntelligenceResult | null> | null = malwareHostIntelligence
    && classified.type === 'domain'
    && !fast
    && !compact
    ? measure(
        'malware_host_intelligence',
        () => fetchUrlhausIntelligence(classified.registrableDomain || classified.value),
      )
    : null;
  const threatfoxIntelligencePromise: Promise<ThreatIntelligenceResult | null> | null = malwareIocIntelligence
    && classified.type === 'domain'
    && !fast
    && !compact
    ? measure(
        'malware_ioc_intelligence',
        () => fetchThreatfoxIntelligence(classified.registrableDomain || classified.value),
      )
    : null;

  // Optional incremental presentation observes the same promises used by the
  // ordinary Lookup result. It starts no additional collection and cannot
  // alter, reject, or persist a source result. The callback receives only a
  // bounded source-health summary; raw payloads remain inside the final
  // response path.
  if (!fast && !compact && options.onSourceSettled) {
    const sourcePromises = new Map<
      Parameters<typeof normalizeLookupSourceSettlement>[0],
      Promise<unknown> | null
    >([
      ['rdap', rdapPromise],
      ['whois', whoisPromise],
      ['domain_evidence', availabilityPromise],
      ['reverse_dns', reverseDnsPromise],
      ['registrar_rdap', registrarRdapPromise],
      ['network_context', networkContextPromise],
      ['security_txt', securityTxtPromise],
      ['external_intelligence', urlscanIntelligencePromise],
      ['malware_host_intelligence', urlhausIntelligencePromise],
      ['malware_ioc_intelligence', threatfoxIntelligencePromise],
    ]);
    const notify = (
      source: Parameters<typeof normalizeLookupSourceSettlement>[0],
      outcome: 'fulfilled' | 'rejected',
      value: unknown,
    ) => {
      try {
        options.onSourceSettled?.(
          normalizeLookupSourceSettlement(source, outcome, value),
        );
      } catch {
        // Presentation callbacks must never change evidence collection.
      }
    };
    for (const source of plannedLookupProgressSources(classified, {
      externalIntelligence,
      malwareHostIntelligence,
      malwareIocIntelligence,
      securityTxt: securityTxtRequested,
    })) {
      const sourcePromise = sourcePromises.get(source) ?? null;
      void Promise.resolve(sourcePromise).then(
        (value) => notify(source, 'fulfilled', value),
        (error) => notify(source, 'rejected', error),
      );
    }
  }

  const [rdapResult, whoisResult, availabilityResult, reverseDnsResult, registrarRdapResult, networkContextResult, securityTxtResult, urlscanIntelligenceResult, urlhausIntelligenceResult, threatfoxIntelligenceResult] = await Promise.allSettled([
    rdapPromise,
    whoisPromise,
    availabilityPromise,
    reverseDnsPromise,
    registrarRdapPromise,
    networkContextPromise,
    securityTxtPromise,
    urlscanIntelligencePromise,
    urlhausIntelligencePromise,
    threatfoxIntelligencePromise,
  ]);
  options.signal?.throwIfAborted();

  const rdapRecord = rdapResult.status === 'fulfilled' ? rdapResult.value : null;
  const whoisChain = whoisResult.status === 'fulfilled' ? whoisResult.value : null;
  const rdapAttempts = rdapRecord && Array.isArray(rdapRecord.attempts)
    ? rdapRecord.attempts
    : rdapResult.status === 'rejected' && Array.isArray(rdapResult.reason?.attempts)
      ? rdapResult.reason.attempts
      : [];

  let registrarRdap: RegistrarRdap | null = null;
  const registryRdapUsable = rdapRecord && rdapRecord.upstreamStatus === 200 && rdapRecord.parsed;
  if (classified.type === 'domain' && rdapEnabled && !compact && registryRdapUsable) {
    if (fast) {
      registrarRdap = {
        status: 'skipped',
        detail: 'Registrar RDAP is omitted in fast RDAP-only mode.',
        endpoint: null,
        transportSecurity: null,
        upstreamStatus: null,
        fetchedAt: null,
        attempt: null,
      };
    } else if (registrarRdapResult.status === 'fulfilled') {
      registrarRdap = registrarRdapResult.value;
    } else {
      registrarRdap = registrarRdapResult.reason?.registrarRdap || {
        status: 'error',
        detail: boundedSourceDetail(registrarRdapResult.reason, 'Registrar RDAP lookup failed'),
        endpoint: null,
        transportSecurity: null,
        upstreamStatus: null,
        fetchedAt: null,
        attempt: null,
      };
    }
  }

  const rdap = !rdapEnabled
    ? { skipped: true, detail: 'RDAP is disabled by deployment policy.' }
    : rdapRecord
    ? { ...rdapRecord, ...(registrarRdap ? { registrarRdap } : {}) }
    : {
        error: rdapResult.status === 'rejected'
          ? errorMessage(rdapResult.reason, 'RDAP lookup failed')
          : 'No RDAP registry found for this query via IANA bootstrap',
        attempts: rdapAttempts,
      };

  let whois: WhoisEnvelope;
  if (!whoisEnabled) {
    whois = { skipped: true, detail: 'WHOIS is disabled by deployment policy.' };
  } else if (skipWhois) {
    whois = { skipped: true, detail: 'WHOIS is omitted in fast RDAP-only mode.' };
  } else if (Array.isArray(whoisChain)) {
    whois = { chain: whoisChain, parsed: parseWhoisChain(whoisChain) };
  } else {
    whois = {
      error: whoisResult.status === 'rejected'
        ? errorMessage(whoisResult.reason, 'WHOIS lookup failed')
        : 'WHOIS returned no referral chain',
    };
  }

  let availability: AvailabilityEnvelope = { applicable: false, type: classified.type };
  if (classified.type === 'domain') {
    if (!availabilityEnabled) {
      availability = {
        applicable: true,
        domain: classified.value,
        state: 'unknown',
        confidence: 'low',
        disabled: true,
        detail: 'Availability analysis is disabled by deployment policy.',
      };
    } else if (availabilityResult.status === 'fulfilled') {
      const result = availabilityResult.value;
      availability = {
        applicable: true,
        domain: classified.value,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        isSubdomain: classified.isSubdomain,
        ...result,
      };
    } else {
      availability = {
        applicable: true,
        domain: classified.value,
        state: 'unknown',
        confidence: 'low',
        detail: errorMessage(availabilityResult.reason, 'Availability lookup failed'),
      };
    }
  }

  const rdapStatus = !rdapEnabled
    ? 'disabled'
    : rdapResult.status === 'rejected'
    ? 'error'
    : !rdapRecord
      ? 'unsupported'
      : rdapRecord.upstreamStatus === 404 ? 'not_found' : 'success';
  const whoisStatus = !whoisEnabled
    ? 'disabled'
    : skipWhois
    ? 'skipped'
    : whoisResult.status === 'rejected' || !Array.isArray(whoisChain)
      ? 'error'
      : whoisChain.length === 1
        ? 'unsupported'
      : whois.parsed && whois.parsed.chainStatus === 'complete' ? 'complete' : 'partial';
  const availabilityStatus = classified.type !== 'domain'
    ? 'not_applicable'
    : !availabilityEnabled ? 'disabled'
    : availabilityResult.status === 'rejected' ? 'error' : 'complete';
  const reverseDns = reverseDnsEligible
    ? !dnsIntelligenceEnabled
      ? skippedReverseDnsIntelligence()
      : reverseDnsResult.status === 'fulfilled' && reverseDnsResult.value
        ? reverseDnsResult.value
        : failedReverseDnsIntelligence(
            reverseDnsResult.status === 'rejected'
              ? reverseDnsResult.reason
              : 'Reverse DNS lookup returned no result',
          )
    : null;
  // This is static access-policy context only. It performs no network work and
  // is deliberately excluded from compact Bulk responses and from every
  // availability input.
  const registryAccess = classified.type === 'domain' && !compact
    ? registryAccessDiagnosticFor(classified.value)
    : null;
  const networkContext = networkContextPromise && networkContextResult.status === 'fulfilled'
    ? networkContextResult.value
    : null;
  const securityTxt = securityTxtPromise
    ? securityTxtResult.status === 'fulfilled'
      ? securityTxtResult.value
      : securityTxtUnavailable(classified.inputHostname, securityTxtResult.reason)
    : null;
  // SSLBL comparison is an exact, local, deep-only enrichment over the leaf
  // certificate already observed by the bounded TLS collector. It performs no
  // request, never contributes to availability, and is omitted from compact
  // Bulk and monitoring responses.
  const sslbl = classified.type === 'domain' && !fast && !compact
    ? inspectCertificateWarningData(
        availability && typeof availability.tls === 'object' ? availability.tls : null,
        {
          ...(options.sslblSnapshot === undefined ? {} : { snapshot: options.sslblSnapshot }),
          ...(options.sslblNow === undefined ? {} : { now: options.sslblNow }),
        },
      )
    : null;
  const networkContextRdap = networkContext && typeof networkContext.rdap === 'object' && networkContext.rdap
    ? networkContext.rdap as Record<string, unknown>
    : null;
  const networkContextEndpoint = networkContext && typeof networkContext.endpoint === 'object' && networkContext.endpoint
    ? networkContext.endpoint as Record<string, unknown>
    : null;

  const lookupTiming = timing.snapshot();
  const diagnostics = {
    version: lookupTiming ? LOOKUP_DIAGNOSTICS_VERSION : LOOKUP_LEGACY_DIAGNOSTICS_VERSION,
    ...(lookupTiming ? { timing: lookupTiming } : {}),
    ...(registryAccess ? { registryAccess } : {}),
    rdap: {
      status: rdapStatus,
      errorCode: rdapStatus === 'disabled'
        ? LOOKUP_ERROR_CODES.FEATURE_DISABLED
        : rdapStatus === 'error'
        ? LOOKUP_ERROR_CODES.RDAP_UPSTREAM_FAILED
        : rdapStatus === 'unsupported' ? LOOKUP_ERROR_CODES.RDAP_UNSUPPORTED : null,
      endpoint: rdapRecord ? rdapRecord.rdapServer || null : null,
      transportSecurity: rdapRecord ? rdapRecord.transportSecurity || null : null,
      httpStatus: rdapRecord ? rdapRecord.upstreamStatus ?? null : null,
      fetchedAt: rdapRecord ? rdapRecord.fetchedAt || null : null,
      attempts: rdapAttempts,
      ...(registrarRdap ? {
        registrar: {
          status: registrarRdap.status,
          endpoint: registrarRdap.endpoint || null,
          transportSecurity: registrarRdap.transportSecurity || null,
          httpStatus: registrarRdap.upstreamStatus ?? null,
          fetchedAt: registrarRdap.fetchedAt || null,
          attempt: registrarRdap.attempt || null,
        },
      } : {}),
    },
    whois: {
      status: whoisStatus,
      errorCode: whoisStatus === 'disabled'
        ? LOOKUP_ERROR_CODES.FEATURE_DISABLED
        : whoisStatus === 'error' ? LOOKUP_ERROR_CODES.WHOIS_UPSTREAM_FAILED : null,
      queriedAt: Array.isArray(whoisChain) && whoisChain[0] ? whoisChain[0].queriedAt || null : null,
      authoritativeHop: whois.parsed ? whois.parsed.authoritativeHop || null : null,
      failedHop: whois.parsed ? whois.parsed.failedHop || null : null,
      conflictingHop: whois.parsed ? whois.parsed.conflictingHop || null : null,
    },
    availability: {
      status: availabilityStatus,
      errorCode: availabilityStatus === 'disabled'
        ? LOOKUP_ERROR_CODES.FEATURE_DISABLED
        : availabilityStatus === 'error' ? LOOKUP_ERROR_CODES.AVAILABILITY_CHECK_FAILED : null,
      resultState: availability.applicable === true ? availability.state || 'unknown' : null,
    },
    ...(reverseDns ? {
      reverseDns: {
        status: reverseDns.status,
        observedAt: reverseDns.observedAt,
        complete: reverseDns.complete,
        truncated: reverseDns.truncated,
      },
    } : {}),
    ...(networkContext ? {
      network: {
        status: networkContext.status,
        address: networkContextEndpoint?.address || null,
        family: networkContextEndpoint?.family || null,
        addressSource: networkContextEndpoint?.selectedFrom || null,
        endpoint: networkContextRdap?.endpoint || null,
        transportSecurity: networkContextRdap?.transportSecurity || null,
        httpStatus: networkContextRdap?.httpStatus ?? null,
        fetchedAt: networkContextRdap?.fetchedAt || null,
        attempts: networkContextRdap?.attempts || [],
      },
    } : {}),
    ...(securityTxt ? {
      securityTxt: {
        status: securityTxt.status,
        state: securityTxt.state,
        endpoint: securityTxt.finalUrl,
        httpStatus: securityTxt.httpStatus,
        observedAt: securityTxt.observedAt,
        complete: securityTxt.complete,
        truncated: securityTxt.truncated,
      },
    } : {}),
    ...(sslbl ? {
      sslbl: {
        status: sslbl.status,
        verdict: sslbl.verdict,
        observedAt: sslbl.observedAt,
        complete: sslbl.complete,
        snapshotUpdatedAt: sslbl.snapshot.sourceUpdatedAt,
      },
    } : {}),
  };

  // Bulk triage only consumes the derived availability evidence and source
  // diagnostics. Omitting raw RDAP JSON and multi-hop WHOIS bodies from that
  // opt-in response prevents large scans from downloading and retaining the
  // same registry payloads the backend already used to build `availability`.
  if (compact) {
    const bulkComparison = !fast
      ? buildBulkComparisonEvidence(availability)
      : null;
    const {
      credentialSurfaceProfile: _credentialSurfaceProfile,
      structuredDataIdentity: _structuredDataIdentity,
      technologyProfile: _technologyProfile,
      pageRoleProfile: _pageRoleProfile,
      clientBehaviorProfile: _clientBehaviorProfile,
      securityPosture: _securityPosture,
      ...compactAvailability
    } = availability;
    return {
      availability: {
        ...compactAvailability,
        ...(bulkComparison ? { bulkComparison } : {}),
      },
      diagnostics,
    };
  }
  const targetDomain = classified.registrableDomain || classified.value;
  const threatIntelligenceProviders: ThreatIntelligenceResult[] = [];
  if (urlscanIntelligencePromise) {
    threatIntelligenceProviders.push(urlscanIntelligenceResult.status === 'fulfilled' && urlscanIntelligenceResult.value
      ? urlscanIntelligenceResult.value
      : createThreatIntelligenceResult(
          URLSCAN_PROVIDER,
          { type: 'domain', value: targetDomain },
          { state: 'error', detail: 'Archived provider intelligence could not be completed.' },
        ));
  }
  if (urlhausIntelligencePromise) {
    threatIntelligenceProviders.push(urlhausIntelligenceResult.status === 'fulfilled' && urlhausIntelligenceResult.value
      ? urlhausIntelligenceResult.value
      : createThreatIntelligenceResult(
          URLHAUS_PROVIDER,
          { type: 'domain', value: targetDomain },
          { state: 'error', detail: 'Malware-host intelligence could not be completed.' },
        ));
  }
  if (threatfoxIntelligencePromise) {
    threatIntelligenceProviders.push(threatfoxIntelligenceResult.status === 'fulfilled' && threatfoxIntelligenceResult.value
      ? threatfoxIntelligenceResult.value
      : createThreatIntelligenceResult(
          THREATFOX_PROVIDER,
          { type: 'domain', value: targetDomain },
          { state: 'error', detail: 'Malware-IOC intelligence could not be completed.' },
        ));
  }
  const threatIntelligence = threatIntelligenceProviders.length
    ? { version: 1, providers: threatIntelligenceProviders }
    : null;
  const registrarRdapParsed = registrarRdap
    && typeof registrarRdap.parsed === 'object'
    && registrarRdap.parsed
    && !Array.isArray(registrarRdap.parsed)
    ? registrarRdap.parsed
    : null;
  const registryInsights = classified.type === 'domain' && !fast && !compact
    ? buildRegistryInsights({
        rdapParsed: rdapRecord?.parsed,
        rdapStatus,
        rdapFetchedAt: rdapRecord?.fetchedAt,
        whoisParsed: whois.parsed,
        whoisStatus,
        whoisQueriedAt: Array.isArray(whoisChain) && whoisChain[0] ? whoisChain[0].queriedAt : null,
        registrarRdapParsed,
        registrarRdapStatus: registrarRdap?.status,
        registrarRdapFetchedAt: registrarRdap?.fetchedAt,
      })
    : null;
  return {
    rdap,
    whois,
    availability,
    diagnostics,
    ...(registryInsights ? { registryInsights } : {}),
    ...(reverseDns ? { reverseDns } : {}),
    ...(networkContext ? { networkContext } : {}),
    ...(securityTxt ? { securityTxt } : {}),
    ...(sslbl ? { sslbl } : {}),
    ...(threatIntelligence ? { threatIntelligence } : {}),
  };
}

export {
  runUnifiedLookup,
  LOOKUP_DIAGNOSTICS_VERSION,
  LOOKUP_LEGACY_DIAGNOSTICS_VERSION,
  LOOKUP_TIMING_VERSION,
  MAX_LOOKUP_TIMING_MS,
  LOOKUP_ERROR_CODES,
};
export type {
  LookupOptions,
  LookupSourceSettlement,
};
