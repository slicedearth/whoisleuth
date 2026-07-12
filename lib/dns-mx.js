// Pure MX classification shared by deep DNS intelligence and the owned-domain
// posture audit.

// Keeping the null-MX rule pure lets it be tested against synthetic record
// arrays without touching the network or mocking DNS.
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

module.exports = { classifyMxRecords };
