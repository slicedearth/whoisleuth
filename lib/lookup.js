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

function errorMessage(err, fallback) {
  return String(err && err.message ? err.message : fallback);
}

async function runUnifiedLookup(classified, options = {}) {
  const fetchRdap = options.fetchRdapRecord || fetchRdapRecord;
  const fetchWhois = options.buildWhoisChain || buildWhoisChain;
  const checkAvailability = options.checkDomainAvailability || checkDomainAvailability;
  const fast = options.fast === true;

  const rdapPromise = fetchRdap(classified.type, classified.value);
  const whoisPromise = fetchWhois(classified.value);
  const availabilityPromise = classified.type === 'domain'
    ? checkAvailability(classified.value, {
        fast,
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

  const rdap = rdapRecord
    ? { ...rdapRecord }
    : {
        error: rdapResult.status === 'rejected'
          ? errorMessage(rdapResult.reason, 'RDAP lookup failed')
          : 'No RDAP registry found for this query via IANA bootstrap',
      };

  let whois;
  if (Array.isArray(whoisChain)) {
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
    if (availabilityResult.status === 'fulfilled') {
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

  return { rdap, whois, availability };
}

module.exports = { runUnifiedLookup };
