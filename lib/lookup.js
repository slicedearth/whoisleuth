// Unified single-query orchestration shared by Express and Netlify.
//
// The browser used to call the RDAP, WHOIS, and availability functions
// separately. On serverless deployments those functions do not share an
// in-memory cache, so availability repeated registry work that RDAP/WHOIS had
// just performed. This module fetches each registration source once and feeds
// those exact results into availability classification.

const { fetchRdapRecord } = require('./rdap');
const { buildWhoisChain, parseWhoisChain } = require('./whois');
const { checkDomainAvailability } = require('./availability');
const { OPERATION_BUDGET_ERROR_CODE } = require('./operation-budget');
const { FEATURE_DISABLED_ERROR_CODE, featureDecision, networkFeaturePolicy } = require('./feature-policy');

const LOOKUP_DIAGNOSTICS_VERSION = 3;
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

function errorMessage(err, fallback) {
  return String(err && err.message ? err.message : fallback);
}

async function runUnifiedLookup(classified, options = {}) {
  const fetchRdap = options.fetchRdapRecord || fetchRdapRecord;
  const fetchWhois = options.buildWhoisChain || buildWhoisChain;
  const checkAvailability = options.checkDomainAvailability || checkDomainAvailability;
  const fast = options.fast === true;
  const compact = options.compact === true;
  const featurePolicy = options.featurePolicy || networkFeaturePolicy();
  const rdapEnabled = featureDecision('rdap', featurePolicy).enabled;
  const whoisEnabled = featureDecision('whois', featurePolicy).enabled;
  const availabilityEnabled = featureDecision('availability', featurePolicy).enabled;
  const skipWhois = fast || !whoisEnabled;

  const rdapPromise = rdapEnabled ? fetchRdap(classified.type, classified.value) : Promise.resolve(null);
  const whoisPromise = skipWhois ? Promise.resolve(null) : fetchWhois(classified.value);
  const availabilityPromise = classified.type === 'domain' && availabilityEnabled
    ? checkAvailability(classified.value, {
        fast,
        featurePolicy,
        rdapRecordPromise: rdapPromise,
        whoisChainPromise: whoisPromise,
      })
    : null;

  const [rdapResult, whoisResult, availabilityResult] = await Promise.allSettled([
    rdapPromise,
    whoisPromise,
    availabilityPromise,
  ]);

  const rdapRecord = rdapResult.status === 'fulfilled' ? rdapResult.value : null;
  const whoisChain = whoisResult.status === 'fulfilled' ? whoisResult.value : null;
  const rdapAttempts = rdapRecord && Array.isArray(rdapRecord.attempts)
    ? rdapRecord.attempts
    : rdapResult.status === 'rejected' && Array.isArray(rdapResult.reason?.attempts)
      ? rdapResult.reason.attempts
      : [];

  const rdap = !rdapEnabled
    ? { skipped: true, detail: 'RDAP is disabled by deployment policy.' }
    : rdapRecord
    ? { ...rdapRecord }
    : {
        error: rdapResult.status === 'rejected'
          ? errorMessage(rdapResult.reason, 'RDAP lookup failed')
          : 'No RDAP registry found for this query via IANA bootstrap',
        attempts: rdapAttempts,
      };

  let whois;
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

  /** @type {any} */
  let availability = { applicable: false, type: classified.type };
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
  return { rdap, whois, availability, diagnostics };
}

module.exports = {
  runUnifiedLookup,
  LOOKUP_DIAGNOSTICS_VERSION,
  LOOKUP_ERROR_CODES,
};
