// Domain availability check.
//
// Determines registered vs. available vs. expiring via RDAP/WHOIS, and flags
// likely for-sale listings by checking for known parking/marketplace
// nameservers and "for sale" listing language on the domain's own homepage.
// This does not attempt to price the domain - registries don't publish sale
// prices, and that's proprietary marketplace data.
//
// Shared by the Express server and the Netlify Functions.

const { fetchRdapRecord } = require('./rdap');
const { buildWhoisChain, parseWhoisChain } = require('./whois');
const { safeFetch, readTextCapped } = require('./safe-fetch');
const { checkEmailSecuritySignals } = require('./dns-mx');
const { fetchFaviconHash } = require('./favicon');
const { extractHtmlSignals } = require('./html-signals');

const MAX_HOMEPAGE_BYTES = 300000;

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

// ---------------------------------------------------------------------------
// Acquisition/sourcing signals: domain age, privacy-redaction, expiry
// proximity, and site-activity status. These read data already fetched by
// checkDomainAvailability (RDAP/WHOIS dates and registrant info) - none of
// this triggers extra registry queries.
// ---------------------------------------------------------------------------

// new Date() only reliably parses ISO 8601 - these cover the non-ISO WHOIS
// date formats seen across ccTLDs this project already supports (.cr, .kr,
// .tr, .it), so domain age / expiry-proximity actually work for them too,
// not just RDAP-backed (mostly gTLD) domains.
function parseWhoisDate(str) {
  if (!str) return null;
  const iso = new Date(str);
  if (!Number.isNaN(iso.getTime())) return iso;

  // DD.MM.YYYY[ HH:MM:SS] - e.g. .cr/.at "14.03.2024 10:46:48"
  let m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/);
  if (m) {
    const [, d, mo, y, h, mi, s] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(s || 0)));
  }

  // YYYY. MM. DD.[ ] - e.g. .kr "2006. 09. 18."
  m = str.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
  if (m) {
    const [, y, mo, d] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d));
  }

  // YYYY-Mon-DD[.] - e.g. .tr "1999-Feb-16."
  m = str.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})\.?/);
  if (m) {
    const parsed = new Date(`${m[2]} ${m[3]}, ${m[1]} UTC`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function computeAgeDays(dateStr) {
  const d = parseWhoisDate(dateStr);
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
}

function computeDaysUntil(dateStr) {
  const d = parseWhoisDate(dateStr);
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

// Only ever called after a lookup has already succeeded (this runs inside
// checkDomainAvailability once RDAP or WHOIS has returned real data), so a
// missing/empty registrant here isn't "we don't know" - it means the
// registry gave us a response with no usable contact in it, which for
// sourcing purposes (can I reach this owner from this data alone?) is the
// same practical answer as an explicit privacy-proxy service: no.
function isPrivacyProtected(registrant) {
  if (!registrant) return true;
  const blob = [registrant.name, registrant.org, registrant.email].filter(Boolean).join(' ');
  if (!blob) return true; // record exists but every contact field is blank - that's redaction
  return PRIVACY_MARKERS.some((re) => re.test(blob));
}

// RDAP Lookup retains a bounded multi-value contact inventory, but Bulk and
// watchlist availability records deliberately keep the historical compact
// shape. This prevents repeated contact arrays and registry links from
// expanding browser-local stores or flowing into case evidence implicitly.
function compactContact(contact) {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return null;
  const compact = {
    handle: contact.handle || null,
    name: contact.name || null,
    org: contact.org || null,
    email: contact.email || null,
    phone: contact.phone || null,
    address: contact.address || null,
  };
  return Object.values(compact).some(Boolean) ? compact : null;
}

// Fetches enough of the homepage for the lightweight HTML signals below and
// preserves why the probe failed. A failed request is not evidence that a
// domain has "no site": transient DNS/TLS/network failures, a slow origin, or
// an HTTP error can all produce the same null body. Keeping that distinction
// avoids turning an inconclusive probe into a false inactivity claim.
async function fetchHomepage(domain, { fetcher = safeFetch } = {}) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' };
  const failures = [];
  for (const scheme of ['https', 'http']) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetcher(`${scheme}://${domain}`, { signal: controller.signal, headers });
      // A truncated homepage is still fine here - only used to scan for a
      // for-sale text match, not parsed as well-formed content. The
      // timeout stays armed through this read (cleared in `finally` below,
      // not here) - a malicious site could otherwise send headers
      // immediately and then trickle or stall the body forever, hanging
      // this worker with no deadline once the timer above is disarmed.
      if (res.ok) {
        return {
          text: (await readTextCapped(res, MAX_HOMEPAGE_BYTES)).text,
          status: 'fetched',
          detail: `Homepage responded over ${scheme.toUpperCase()} (HTTP ${res.status}).`,
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
      };
    } catch (err) {
      const reason = err && err.name === 'AbortError'
        ? 'timed out after 6 seconds'
        : String(err && err.message ? err.message : 'request failed')
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .slice(0, 180);
      failures.push(`${scheme.toUpperCase()} ${reason}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    text: null,
    status: 'inconclusive',
    detail: failures.length
      ? `Could not confirm homepage activity: ${failures.join('; ')}.`
      : 'Could not confirm homepage activity.',
  };
}

function deriveWebsiteActivity(homepageStatus, hasFavicon, alreadyParked = false) {
  if (alreadyParked) return 'parked';
  if (homepageStatus === 'fetched' || homepageStatus === 'responded' || hasFavicon) return 'active';
  return 'unreachable';
}

// fast: true skips the WHOIS fallback (no TCP:43 chain) and the homepage
// fetch (no for-sale/parking detection) - just RDAP plus the signals
// derivable from it (age, expiry proximity, privacy). Meant for scanning
// large sourcing candidate lists quickly and gently on registry rate
// limits; anything it can't resolve (state "unknown") is meant to get a
// follow-up deep check (fast: false, the default) on the shortlist only.
async function checkDomainAvailability(domain, options = {}) {
  const fast = options.fast === true;
  const hasPreloadedRdap = Object.prototype.hasOwnProperty.call(options, 'rdapRecord');
  const hasPreloadedWhois = Object.prototype.hasOwnProperty.call(options, 'whoisChain');
  const hasPreloadedRdapPromise = Object.prototype.hasOwnProperty.call(options, 'rdapRecordPromise');
  const hasPreloadedWhoisPromise = Object.prototype.hasOwnProperty.call(options, 'whoisChainPromise');
  let nameservers = [];
  let statuses = [];
  let rdapServer = null;
  let rdapFound = false;
  let registrar = null;
  let registrant = null;
  let abuse = null;
  let createdDate = null;
  let expiryDate = null;

  try {
    // Shared with /api/rdap (lib/rdap.js's fetchRdapRecord) rather than a
    // separate fetch+parse here - same registry data either way, and this
    // also picks up that function's short-TTL cache (lib/lookup-cache.js)
    // and upstream timeout for free.
    const record = hasPreloadedRdapPromise
      ? await options.rdapRecordPromise
      : hasPreloadedRdap
        ? options.rdapRecord
        : await fetchRdapRecord('domain', domain);
    if (record) {
      rdapServer = record.rdapServer;
      if (record.upstreamStatus === 404) {
        return {
          state: 'available',
          confidence: 'high',
          detail: 'The registry\'s RDAP service has no record for this domain.',
          source: 'rdap',
          rdapServer: record.rdapServer,
        };
      }
      if (record.parsed) {
        const parsed = record.parsed;
        statuses = Array.isArray(parsed.statuses) ? parsed.statuses.map((s) => s.toLowerCase()) : [];
        nameservers = Array.isArray(parsed.nameservers) ? parsed.nameservers : [];
        registrar = compactContact(parsed.registrar);
        registrant = compactContact(parsed.registrant);
        abuse = compactContact(parsed.abuse);
        const events = Array.isArray(parsed.events) ? parsed.events : [];
        createdDate = parsed.lifecycle?.createdDate
          || (events.find((e) => e.action === 'registration') || {}).date || null;
        expiryDate = parsed.lifecycle?.expiryDate
          || (events.find((e) => e.action === 'expiration') || {}).date || null;
        rdapFound = true;
      }
    }
  } catch {
    /* fall through to WHOIS-based detection (deep mode only) */
  }

  let whoisChain = null;
  let whoisParsed = null;
  if (!rdapFound && !fast) {
    try {
      whoisChain = hasPreloadedWhoisPromise
        ? await options.whoisChainPromise
        : hasPreloadedWhois
          ? options.whoisChain
          : await buildWhoisChain(domain);
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
      if (parsed.statuses.length) statuses = parsed.statuses.map((s) => s.toLowerCase());
      if (parsed.registrar) {
        registrar = {
          handle: null,
          ianaId: parsed.registrarIanaId || null,
          name: parsed.registrar,
          org: null,
          email: parsed.abuseEmail || null,
          phone: parsed.abusePhone || null,
        };
      } else if (parsed.adminOrg) {
        // No standard "Registrar:" field (e.g. the .gt web-lookup fallback) -
        // its admin contact is functionally the registrar/reseller of record.
        // Requires an actual organization name, not just parsed.adminName/
        // adminEmail alone - some registries with no registrar concept at all
        // (e.g. .edu, where EDUCAUSE is itself the registry) only have a
        // named individual as "Administrative Contact", and labeling that
        // person as if they were the registrar would be actively misleading.
        registrar = { handle: null, name: parsed.adminOrg, org: parsed.adminOrg, email: parsed.adminEmail || null, phone: null };
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
    } catch {
      /* if both RDAP and WHOIS fail, we simply can't determine availability */
    }
  }

  if (!rdapFound && (fast || !whoisChain)) {
    return {
      state: 'unknown',
      confidence: 'low',
      detail: fast
        ? 'No RDAP data for this TLD/domain in a fast scan - run a deep check for a WHOIS-based result.'
        : 'Could not reach RDAP or WHOIS for this domain to determine its status.',
    };
  }

  // WHOIS ran and was not a confirmed not-found, but produced no positive
  // registration evidence either - e.g. the registry answered inconclusively
  // or every referral hop failed/rate-limited. Report "unknown" rather than
  // fabricating "registered" from an empty record.
  const hasWhoisRegistrationData = whoisParsed?.registrationStatus === 'registered'
    || Boolean(registrar) || Boolean(createdDate) || Boolean(expiryDate)
    || nameservers.length > 0 || statuses.length > 0;
  if (!rdapFound && !hasWhoisRegistrationData) {
    return {
      state: 'unknown',
      confidence: 'low',
      detail: whoisParsed && whoisParsed.failedHop
        ? `WHOIS was inconclusive - a referral hop did not answer conclusively (${whoisParsed.failedHop}).`
        : 'WHOIS returned no conclusive registration data for this domain.',
      source: 'whois',
    };
  }

  const domainAgeDays = computeAgeDays(createdDate);
  const expiresInDays = computeDaysUntil(expiryDate);
  const privacyProtected = isPrivacyProtected(registrant);

  const baseInfo = {
    nameservers,
    statuses,
    registrar,
    registrant,
    abuse,
    createdDate,
    expiryDate,
    rdapServer,
    domainAgeDays,
    expiresInDays,
    privacyProtected,
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
      confidence: 'high',
      detail: 'Domain is registered. Run a deep check for parking/for-sale detection.',
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

  // Homepage + MX resolve in parallel; the favicon fetch is sequenced after
  // the homepage so it can use any <link rel="icon"> the page declares (many
  // sites serve no /favicon.ico and only point to a CDN PNG this way). One
  // extra round-trip on the already-slow deep path, in exchange for finding
  // favicons the bare /favicon.ico probe would miss.
  const [homepage, mx] = await Promise.all([
    fetchHomepage(domain).catch((err) => ({
      text: null,
      status: 'inconclusive',
      detail: `Could not confirm homepage activity: ${String(err && err.message ? err.message : 'request failed').slice(0, 180)}.`,
    })),
    checkEmailSecuritySignals(domain),
  ]);
  const page = homepage.text;
  const favicon = await fetchFaviconHash(domain, { html: page || '' }).catch(() => null);
  const faviconHash = favicon ? favicon.hash : null;
  const faviconPHash = favicon ? favicon.phash : null;

  /** @type {{ pageTitle: string | null, hasPasswordField: boolean, phishingLanguageMatch: string | null, externalAssetHosts: string[] }} */
  let htmlSignals = { pageTitle: null, hasPasswordField: false, phishingLanguageMatch: null, externalAssetHosts: [] };

  if (homepage.status === 'fetched') {
    if (page) {
      const saleMatch = page.match(FOR_SALE_TEXT_RE);
      if (saleMatch) {
        forSaleSignal = forSaleSignal || `homepage text ("${saleMatch[0]}")`;
        activityStatus = 'parked';
      }
      htmlSignals = extractHtmlSignals(page, domain);
    }
  }

  const faviconProvedActive = homepage.status === 'inconclusive' && Boolean(favicon);
  const websiteProbeStatus = faviconProvedActive ? 'responded' : homepage.status;
  const websiteProbeDetail = faviconProvedActive
    ? `${homepage.detail} A favicon responded successfully, confirming an active web service.`
    : homepage.detail;
  activityStatus = deriveWebsiteActivity(homepage.status, Boolean(favicon), activityStatus === 'parked');

  if (!forSaleSignal) {
    return {
      state: 'registered',
      confidence: 'high',
      detail: 'Domain is registered and shows no for-sale signals.',
      activityStatus,
      websiteProbeStatus,
      websiteProbeDetail,
      faviconHash,
      faviconPHash,
      ...htmlSignals,
      ...mx,
      ...baseInfo,
    };
  }

  return {
    state: 'for_sale',
    confidence: 'medium',
    detail: `Detected a for-sale listing (${forSaleSignal}).`,
    activityStatus,
    websiteProbeStatus,
    websiteProbeDetail,
    faviconHash,
    faviconPHash,
    ...htmlSignals,
    ...mx,
    ...baseInfo,
  };
}

module.exports = {
  checkDomainAvailability,
  fetchHomepage,
  deriveWebsiteActivity,
};
