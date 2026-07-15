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
import type { ClassifiedQuery } from './classify.mts';
import { FEATURE_DISABLED_ERROR_CODE, featureDecision, networkFeaturePolicy } from './feature-policy.mts';
import { lookupUrlscanDomain, URLSCAN_PROVIDER } from './urlscan-intelligence.mts';
import { lookupUrlhausDomain, URLHAUS_PROVIDER } from './urlhaus-intelligence.mts';
import { createThreatIntelligenceResult } from './threat-intelligence-contract.mts';
import type { ThreatIntelligenceResult } from './threat-intelligence-contract.mts';

type LookupOptions = {
  fetchRdapRecord?: typeof fetchRdapRecord;
  fetchRegistrarRdapRecord?: typeof fetchRegistrarRdapRecord;
  buildWhoisChain?: typeof buildWhoisChain;
  checkDomainAvailability?: typeof checkDomainAvailability;
  lookupUrlscanDomain?: typeof lookupUrlscanDomain;
  lookupUrlhausDomain?: typeof lookupUrlhausDomain;
  fast?: boolean;
  compact?: boolean;
  externalIntelligence?: boolean;
  malwareHostIntelligence?: boolean;
  featurePolicy?: ReturnType<typeof networkFeaturePolicy>;
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

const LOOKUP_DIAGNOSTICS_VERSION = 4;
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

async function runUnifiedLookup(classified: ClassifiedQuery, options: LookupOptions = {}) {
  const fetchRdap = options.fetchRdapRecord || fetchRdapRecord;
  const fetchRegistrarRdap = options.fetchRegistrarRdapRecord || fetchRegistrarRdapRecord;
  const fetchWhois = options.buildWhoisChain || buildWhoisChain;
  const checkAvailability = options.checkDomainAvailability || checkDomainAvailability;
  const fetchUrlscanIntelligence = options.lookupUrlscanDomain || lookupUrlscanDomain;
  const fetchUrlhausIntelligence = options.lookupUrlhausDomain || lookupUrlhausDomain;
  const fast = options.fast === true;
  const compact = options.compact === true;
  const externalIntelligence = options.externalIntelligence === true;
  const malwareHostIntelligence = options.malwareHostIntelligence === true;
  const featurePolicy = options.featurePolicy || networkFeaturePolicy();
  const rdapEnabled = featureDecision('rdap', featurePolicy).enabled;
  const whoisEnabled = featureDecision('whois', featurePolicy).enabled;
  const availabilityEnabled = featureDecision('availability', featurePolicy).enabled;
  const skipWhois = fast || !whoisEnabled;

  const rdapPromise = rdapEnabled ? fetchRdap(classified.type, classified.value) : Promise.resolve(null);
  const whoisPromise = skipWhois ? Promise.resolve(null) : fetchWhois(classified.value);
  // Registrar RDAP is a separately attributed deep-lookup enrichment. It may
  // overlap the WHOIS chain, but it never joins the promises used to decide
  // availability and can add up to its own bounded timeout to a deep lookup.
  const registrarRdapPromise: Promise<RegistrarRdap | null> | null = classified.type === 'domain' && rdapEnabled && !fast && !compact
    ? rdapPromise.then((record) => record && record.upstreamStatus === 200 && record.parsed
        ? fetchRegistrarRdap(classified.value, record)
        : null)
    : null;
  const availabilityPromise = classified.type === 'domain' && availabilityEnabled
    ? checkAvailability(classified.value, {
        fast,
        featurePolicy,
        rdapRecordPromise: rdapPromise,
        whoisChainPromise: whoisPromise,
      })
    : null;
  const urlscanIntelligencePromise: Promise<ThreatIntelligenceResult | null> | null = externalIntelligence
    && classified.type === 'domain'
    && !fast
    && !compact
    ? fetchUrlscanIntelligence(classified.registrableDomain || classified.value)
    : null;
  const urlhausIntelligencePromise: Promise<ThreatIntelligenceResult | null> | null = malwareHostIntelligence
    && classified.type === 'domain'
    && !fast
    && !compact
    ? fetchUrlhausIntelligence(classified.registrableDomain || classified.value)
    : null;

  const [rdapResult, whoisResult, availabilityResult, registrarRdapResult, urlscanIntelligenceResult, urlhausIntelligenceResult] = await Promise.allSettled([
    rdapPromise,
    whoisPromise,
    availabilityPromise,
    registrarRdapPromise,
    urlscanIntelligencePromise,
    urlhausIntelligencePromise,
  ]);

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
      : whois.parsed && whois.parsed.chainStatus === 'complete' ? 'complete' : 'partial';
  const availabilityStatus = classified.type !== 'domain'
    ? 'not_applicable'
    : !availabilityEnabled ? 'disabled'
    : availabilityResult.status === 'rejected' ? 'error' : 'complete';

  const diagnostics = {
    version: LOOKUP_DIAGNOSTICS_VERSION,
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
  };

  // Bulk triage only consumes the derived availability evidence and source
  // diagnostics. Omitting raw RDAP JSON and multi-hop WHOIS bodies from that
  // opt-in response prevents large scans from downloading and retaining the
  // same registry payloads the backend already used to build `availability`.
  if (compact) return { availability, diagnostics };
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
  const threatIntelligence = threatIntelligenceProviders.length
    ? { version: 1, providers: threatIntelligenceProviders }
    : null;
  return {
    rdap,
    whois,
    availability,
    diagnostics,
    ...(threatIntelligence ? { threatIntelligence } : {}),
  };
}

export {
  runUnifiedLookup,
  LOOKUP_DIAGNOSTICS_VERSION,
  LOOKUP_ERROR_CODES,
};
