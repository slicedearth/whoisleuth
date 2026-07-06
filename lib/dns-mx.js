// MX-record lookup - used as a phishing-risk signal for registered
// typosquat/lookalike domains (a domain configured to receive mail is
// capable of running credential-harvesting or BEC campaigns, not just
// sitting parked). Shared by the Express server and the Netlify Functions
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

module.exports = { checkMxRecords };
