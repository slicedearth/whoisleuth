// Independent browser expectations for the CSP source-list/fallback rules.
// Fixture scripts only set local document attributes; no network operation is
// performed and no fetched application script is executed.
export const CSP_POLICY_FIXTURES = [
  { name: 'invalid nonce', policy: "script-src 'unsafe-inline' 'nonce-!invalid'", blocks: true, attributes: true },
  { name: 'valid nonce grammar', policy: "script-src 'unsafe-inline' 'nonce-abcd'", blocks: false, attributes: false },
  { name: 'element override', policy: "script-src 'none'; script-src-elem 'unsafe-inline'", blocks: true, attributes: false },
  { name: 'element denial', policy: "script-src 'unsafe-inline'; script-src-elem 'none'", blocks: false, attributes: true },
  { name: 'attribute denial', policy: "default-src 'unsafe-inline'; script-src-attr 'none'", blocks: true, attributes: false },
  { name: 'strict dynamic', policy: "script-src 'unsafe-inline' 'strict-dynamic'", blocks: false, attributes: false },
  { name: 'policy intersection', policy: "script-src 'unsafe-inline', script-src 'none'", blocks: false, attributes: false },
  { name: 'first duplicate wins', policy: "script-src-elem 'none'; script-src-elem 'unsafe-inline'; script-src-attr 'unsafe-inline'", blocks: false, attributes: true },
] as const;
