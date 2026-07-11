// Query classification - shared by both the Express server and the Netlify
// Functions so a domain/IP/ASN query is always parsed identically wherever
// this code runs. Every classified value eventually reaches a raw protocol
// call - a WHOIS TCP socket write (lib/whois.js), a DNS query, an RDAP/
// MTA-STS fetch URL - and none of those downstream call sites re-validate
// syntax, so this is the one place responsible for rejecting anything that
// isn't actually safe to hand to them.
//
// Domains are classified to their *registrable* domain via the Public Suffix
// List (tldts). Registries only publish RDAP/WHOIS records at the registrable-
// domain level, so a lookup for `login.example.com` must query `example.com` -
// otherwise an arbitrary subdomain's RDAP 404 would be misread as "available
// to register" when the underlying registration plainly exists. Both the
// original input hostname and the resolved registrable domain are returned so
// callers can look up the latter while still showing the user what they typed.

const net = require('net');
const { parse } = require('tldts');

// A CR/LF here would let one query become multiple lines once it reaches
// lib/whois.js's raw `socket.write(query + '\r\n')` - a normal URL-encoded
// query string (?q=example.com%0D%0AHELP) decodes back into literal control
// characters before this function ever sees them, so this has to be
// checked explicitly, before any other parsing, rather than assumed away.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

// 32-bit ASN ceiling (RFC 6793 four-octet ASNs). AS0 and AS4294967295 are
// reserved but syntactically valid; anything above is not an ASN at all.
const MAX_ASN = 4294967295;

// A registrable-domain label: LDH (letter/digit/hyphen), 1-63 characters, no
// leading or trailing hyphen. tldts already rejects empty labels, over-long
// labels, leading/trailing hyphens, and public-suffix-only inputs (all yield
// a null registrable domain) - but it does NOT reject underscores, so this is
// the explicit backstop that catches `foo_bar.com` and makes the full rule
// checkable in one place.
function isValidRegistrableLabel(label) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label);
}

function classifyQuery(raw) {
  const trimmed = raw.trim();
  if (CONTROL_CHAR_RE.test(trimmed)) {
    throw new Error('Query contains control characters, which are not valid in a domain, IP, or ASN.');
  }

  // Strip a scheme and any path/query/fragment. A single terminal root dot
  // (`example.com.`, the fully-qualified form) is normalized away, but more
  // than one is malformed - a valid name has at most one root label.
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
  if (/\.\.+$/.test(withoutScheme)) {
    throw new Error(`"${trimmed}" has more than one terminal dot.`);
  }
  const q = withoutScheme.replace(/\.$/, '');

  // net.isIP is Node's own IP-address parser - stricter and more correct
  // than a hand-rolled regex (rejects out-of-range IPv4 octets, malformed
  // IPv6 groupings, etc.) and handles both families in one call.
  const ipVersion = net.isIP(q);
  if (ipVersion === 4) return { type: 'ipv4', value: q };
  if (ipVersion === 6) return { type: 'ipv6', value: q };

  const asnMatch = q.match(/^AS(\d+)$/i) || q.match(/^(\d+)$/);
  if (asnMatch) {
    const num = Number(asnMatch[1]);
    if (!Number.isInteger(num) || num < 0 || num > MAX_ASN) {
      throw new Error(`"${trimmed}" is not a valid ASN (must be an integer 0-${MAX_ASN}).`);
    }
    return { type: 'asn', value: `AS${num}` };
  }

  // Domain: IDNA-normalize via the WHATWG URL parser (punycode-encodes an
  // internationalized name, strips a stray port), then resolve the registrable
  // domain via the Public Suffix List.
  let inputHostname;
  try {
    inputHostname = new URL(`https://${q}`).hostname.toLowerCase();
  } catch {
    inputHostname = '';
  }
  if (!inputHostname || !inputHostname.includes('.') || inputHostname.length > 253) {
    throw new Error(`"${trimmed}" is not a valid domain, IP, or ASN.`);
  }

  const registrableDomain = parse(inputHostname).domain;
  if (!registrableDomain) {
    throw new Error(`"${trimmed}" is not a registrable domain (no public-suffix match).`);
  }
  if (!registrableDomain.split('.').every(isValidRegistrableLabel)) {
    throw new Error(`"${trimmed}" contains an invalid domain label (underscores, empty, or malformed labels are not registrable).`);
  }

  return {
    type: 'domain',
    value: registrableDomain,
    inputHostname,
    registrableDomain,
    isSubdomain: inputHostname !== registrableDomain,
  };
}

module.exports = { classifyQuery, MAX_ASN };
