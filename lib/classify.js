// Query classification - shared by both the Express server and the Netlify
// Functions so a domain/IP/ASN query is always parsed identically wherever
// this code runs. Every classified value eventually reaches a raw protocol
// call - a WHOIS TCP socket write (lib/whois.js), a DNS query, an RDAP/
// MTA-STS fetch URL - and none of those downstream call sites re-validate
// syntax, so this is the one place responsible for rejecting anything that
// isn't actually safe to hand to them.

const net = require('net');

// A CR/LF here would let one query become multiple lines once it reaches
// lib/whois.js's raw `socket.write(query + '\r\n')` - a normal URL-encoded
// query string (?q=example.com%0D%0AHELP) decodes back into literal control
// characters before this function ever sees them, so this has to be
// checked explicitly, before any other parsing, rather than assumed away.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

function classifyQuery(raw) {
  let q = raw.trim();
  if (CONTROL_CHAR_RE.test(q)) {
    throw new Error('Query contains control characters, which are not valid in a domain, IP, or ASN.');
  }

  q = q.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
  q = q.replace(/^www\./i, '');

  // net.isIP is Node's own IP-address parser - stricter and more correct
  // than a hand-rolled regex (rejects out-of-range IPv4 octets, malformed
  // IPv6 groupings, etc.) and handles both families in one call.
  const ipVersion = net.isIP(q);
  if (ipVersion === 4) return { type: 'ipv4', value: q };
  if (ipVersion === 6) return { type: 'ipv6', value: q };

  const asnMatch = q.match(/^AS(\d+)$/i);
  if (asnMatch) return { type: 'asn', value: `AS${asnMatch[1]}` };
  if (/^\d+$/.test(q)) return { type: 'asn', value: `AS${q}` };

  // Anything left is treated as a domain - validated and IDNA-normalized
  // via the WHATWG URL parser's own hostname handling (the same approach
  // lib/domain-posture.js's normalizeAuditDomain() already uses), so a
  // malformed value (embedded spaces, a stray port suffix, an out-of-range
  // "IP-shaped" string) is rejected here with a clear error instead of
  // failing confusingly several layers down in a DNS/WHOIS/RDAP call - and
  // a real internationalized domain name is correctly punycode-encoded
  // instead of being silently unusable downstream.
  let hostname;
  try {
    hostname = new URL(`https://${q}`).hostname.toLowerCase();
  } catch {
    hostname = '';
  }
  if (!hostname || !hostname.includes('.') || hostname.length > 253) {
    throw new Error(`"${raw.trim()}" is not a valid domain, IP, or ASN.`);
  }
  return { type: 'domain', value: hostname };
}

module.exports = { classifyQuery };
