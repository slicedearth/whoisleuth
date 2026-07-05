// Query classification - shared by both the Express server and the Netlify
// Functions so a domain/IP/ASN query is always parsed identically wherever
// this code runs.

function classifyQuery(raw) {
  let q = raw.trim();
  q = q.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
  q = q.replace(/^www\./i, '');

  const ipv4Re = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const asnRe = /^AS(\d+)$/i;

  if (ipv4Re.test(q)) return { type: 'ipv4', value: q };
  if (q.includes(':') && /^[0-9a-fA-F:]+$/.test(q)) return { type: 'ipv6', value: q };

  const asnMatch = q.match(asnRe);
  if (asnMatch) return { type: 'asn', value: `AS${asnMatch[1]}` };
  if (/^\d+$/.test(q)) return { type: 'asn', value: `AS${q}` };

  return { type: 'domain', value: q.toLowerCase() };
}

module.exports = { classifyQuery };
