// Email-infrastructure DNS lookups - used as phishing-risk signals for
// registered typosquat/lookalike domains. MX alone only means a domain can
// receive mail; SPF and DMARC are what actually let it send mail that
// passes receiving servers' spoofing checks, so a lookalike with all three
// configured is set up to run a convincing phishing/BEC campaign, not just
// sitting parked. Shared by the Express server and the Netlify Functions
// via lib/availability.js, same as the other lib/ modules.

const dns = require('dns').promises;

// Pure classification, split out from the DNS I/O below so the null-MX rule
// itself - the part that actually had the bug - can be unit-tested against
// synthetic record arrays without touching the network or mocking dns.
//
// RFC 7505 "null MX" - a single record pointing at the root domain (".") is
// a domain explicitly declaring it accepts no mail, not "mail is
// configured". Node's resolver strips the trailing dot from the target, so
// the root comes back as "" as well as ".".
function classifyMxRecords(records) {
  const realRecords = records.filter((r) => r.exchange !== '.' && r.exchange !== '');
  // Distinct from simply having no MX record at all - a null MX is a
  // deliberate "this domain never accepts mail" declaration, not an absence
  // of configuration. Not currently used for scoring (both cases already
  // correctly score as hasMx: false); exposed for callers that want to tell
  // the two apart.
  const hasNullMx = records.length > 0 && realRecords.length === 0;
  return { hasMx: realRecords.length > 0, hasNullMx, mxHosts: realRecords.map((r) => r.exchange) };
}

async function checkMxRecords(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return classifyMxRecords(records);
  } catch {
    return { hasMx: false, hasNullMx: false, mxHosts: [] };
  }
}

// SPF is a TXT record on the domain itself (not a subdomain), starting
// with "v=spf1" - it authorizes which servers may send mail claiming to be
// from this domain.
async function checkSpfRecord(domain) {
  try {
    const records = await dns.resolveTxt(domain);
    return records.some((chunks) => chunks.join('').trim().toLowerCase().startsWith('v=spf1'));
  } catch {
    return false;
  }
}

// DMARC lives on the fixed _dmarc.<domain> subdomain, as a TXT record
// starting with "v=DMARC1" - tells receiving servers what to do with mail
// that fails SPF/DKIM, which is the piece that actually makes spoofed mail
// more likely to land in an inbox instead of a spam folder.
async function checkDmarcRecord(domain) {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    return records.some((chunks) => chunks.join('').trim().toLowerCase().startsWith('v=dmarc1'));
  } catch {
    return false;
  }
}

// Runs all three lookups in parallel - independent DNS queries, no reason
// to serialize them.
async function checkEmailSecuritySignals(domain) {
  const [mx, hasSpf, hasDmarc] = await Promise.all([
    checkMxRecords(domain),
    checkSpfRecord(domain),
    checkDmarcRecord(domain),
  ]);
  return { ...mx, hasSpf, hasDmarc };
}

module.exports = { checkEmailSecuritySignals, classifyMxRecords };
