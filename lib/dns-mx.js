// Email-infrastructure DNS lookups - used as phishing-risk signals for
// registered typosquat/lookalike domains. MX alone only means a domain can
// receive mail; SPF and DMARC are what actually let it send mail that
// passes receiving servers' spoofing checks, so a lookalike with all three
// configured is set up to run a convincing phishing/BEC campaign, not just
// sitting parked. Shared by the Express server and the Netlify Functions
// via lib/availability.js, same as the other lib/ modules.

const dns = require('dns').promises;

async function checkMxRecords(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return { hasMx: records.length > 0, mxHosts: records.map((r) => r.exchange) };
  } catch {
    return { hasMx: false, mxHosts: [] };
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

module.exports = { checkMxRecords, checkSpfRecord, checkDmarcRecord, checkEmailSecuritySignals };
