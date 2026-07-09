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

async function fetchHomepageText(domain) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' };
  for (const scheme of ['https', 'http']) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await safeFetch(`${scheme}://${domain}`, { signal: controller.signal, headers });
      clearTimeout(timeout);
      // A truncated homepage is still fine here - only used to scan for a
      // for-sale text match, not parsed as well-formed content.
      if (res.ok) return (await readTextCapped(res, MAX_HOMEPAGE_BYTES)).text;
    } catch {
      clearTimeout(timeout);
    }
  }
  return null;
}

// fast: true skips the WHOIS fallback (no TCP:43 chain) and the homepage
// fetch (no for-sale/parking detection) - just RDAP plus the signals
// derivable from it (age, expiry proximity, privacy). Meant for scanning
// large sourcing candidate lists quickly and gently on registry rate
// limits; anything it can't resolve (state "unknown") is meant to get a
// follow-up deep check (fast: false, the default) on the shortlist only.
async function checkDomainAvailability(domain, { fast = false } = {}) {
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
    const record = await fetchRdapRecord('domain', domain);
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
        registrar = parsed.registrar;
        registrant = parsed.registrant;
        abuse = parsed.abuse;
        const events = Array.isArray(parsed.events) ? parsed.events : [];
        createdDate = (events.find((e) => e.action === 'registration') || {}).date || null;
        expiryDate = (events.find((e) => e.action === 'expiration') || {}).date || null;
        rdapFound = true;
      }
    }
  } catch {
    /* fall through to WHOIS-based detection (deep mode only) */
  }

  let whoisChain = null;
  if (!rdapFound && !fast) {
    try {
      whoisChain = await buildWhoisChain(domain);
      const parsed = parseWhoisChain(whoisChain);
      if (parsed.notFound) {
        return {
          state: 'available',
          confidence: 'medium',
          detail: 'WHOIS reports no matching record for this domain.',
          source: 'whois',
        };
      }
      if (parsed.nameservers.length) nameservers = parsed.nameservers;
      if (parsed.statuses.length) statuses = parsed.statuses.map((s) => s.toLowerCase());
      if (parsed.registrar) {
        registrar = { handle: null, name: parsed.registrar, org: null, email: parsed.abuseEmail || null, phone: parsed.abusePhone || null };
      } else if (parsed.adminOrg || parsed.adminName || parsed.adminEmail) {
        // No standard "Registrar:" field (e.g. the .gt web-lookup fallback) -
        // its admin contact is functionally the registrar/reseller of record.
        registrar = { handle: null, name: parsed.adminOrg || parsed.adminName || null, org: parsed.adminOrg || null, email: parsed.adminEmail || null, phone: null };
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

  // Registered - look for for-sale/parked/inactive signals (homepage fetch,
  // deep mode only), and check for a configured mail exchanger as a
  // phishing-risk signal (a lookalike domain that can receive/send mail is
  // capable of running credential-harvesting or BEC campaigns).
  const nsSignal = nameservers.find((ns) => PARKING_NS_PATTERNS.some((re) => re.test(ns)));
  let forSaleSignal = nsSignal ? `parking nameserver (${nsSignal})` : null;
  let activityStatus = nsSignal ? 'parked' : 'unknown';

  const [page, mx] = await Promise.all([
    fetchHomepageText(domain).catch(() => null),
    checkEmailSecuritySignals(domain),
  ]);

  if (page) {
    const saleMatch = page.match(FOR_SALE_TEXT_RE);
    if (saleMatch) {
      forSaleSignal = forSaleSignal || `homepage text ("${saleMatch[0]}")`;
      activityStatus = 'parked';
    } else if (activityStatus === 'unknown') {
      activityStatus = 'active';
    }
  } else if (activityStatus === 'unknown') {
    activityStatus = 'no_site';
  }

  if (!forSaleSignal) {
    return {
      state: 'registered',
      confidence: 'high',
      detail: 'Domain is registered and shows no for-sale signals.',
      activityStatus,
      ...mx,
      ...baseInfo,
    };
  }

  return {
    state: 'for_sale',
    confidence: 'medium',
    detail: `Detected a for-sale listing (${forSaleSignal}).`,
    activityStatus,
    ...mx,
    ...baseInfo,
  };
}

module.exports = {
  parseWhoisDate,
  computeAgeDays,
  computeDaysUntil,
  isPrivacyProtected,
  fetchHomepageText,
  checkDomainAvailability,
};
