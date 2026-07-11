// Lightweight, dependency-free signals extracted from a domain's already-
// fetched homepage HTML (see fetchHomepage in availability.js) - no
// extra network call, no HTML-parsing dependency, just regex over text
// that's already in memory. Meant to catch a cloned/impersonating page even
// when it doesn't share the exact favicon bytes favicon.js compares.

const MAX_TITLE_LENGTH = 200;
const MAX_EXTERNAL_ASSET_HOSTS = 20;

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

// A password input is the single strongest static-HTML tell that a page is
// asking for credentials, regardless of what it claims to be.
const PASSWORD_FIELD_RE = /<input\b[^>]*\btype\s*=\s*["']?password["']?/i;

// Common urgency/social-engineering phrasing used to pressure a visitor
// into entering credentials - not exhaustive, and legitimate sites
// occasionally use similar language too, so this is one signal among
// several, not a verdict on its own (same framing as FOR_SALE_TEXT_RE in
// availability.js).
const PHISHING_LANGUAGE_RE =
  /(verify your account|confirm your identity|unusual (?:sign-?in|login) activity|account has been (?:suspended|limited|locked|restricted)|your account will be (?:suspended|closed|locked|terminated)|click here to (?:verify|confirm|update|restore)|security alert|immediate action required|re-?activate your account|unauthorized access detected|update your (?:payment|billing) (?:information|details)|confirm your password|your password (?:has expired|will expire soon))/i;

// <img>/<script>/<link> tags loading a resource from an absolute, external
// URL - a common phishing-kit tell is hotlinking the real brand's own logo/
// CSS/JS instead of copying it. Relative URLs (the common case, same
// origin) are skipped since they have no host to extract. Deliberately
// scoped to resource tags, not every <a href> - an outbound link to the
// real site is normal on all sorts of pages; a resource pulled live from it
// during page load is not.
const ASSET_TAG_RE = /<(?:img|script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
const ABSOLUTE_URL_HOST_RE = /^(?:https?:)?\/\/([^/]+)/i;

function stripWwwPrefix(host) {
  return host.toLowerCase().replace(/^www\./, '');
}

function extractExternalAssetHosts(html, ownDomain) {
  const ownHost = stripWwwPrefix(ownDomain);
  const hosts = new Set();
  let match;
  ASSET_TAG_RE.lastIndex = 0;
  while ((match = ASSET_TAG_RE.exec(html))) {
    const hostMatch = match[1].match(ABSOLUTE_URL_HOST_RE);
    if (!hostMatch) continue;
    const host = stripWwwPrefix(hostMatch[1]);
    if (host && host !== ownHost) hosts.add(host);
    if (hosts.size >= MAX_EXTERNAL_ASSET_HOSTS) break;
  }
  return [...hosts];
}

function extractPageTitle(html) {
  const match = html.match(TITLE_RE);
  if (!match) return null;
  const title = match[1].replace(/\s+/g, ' ').trim();
  if (!title) return null;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH)}…` : title;
}

function extractHtmlSignals(html, domain) {
  const phishingMatch = html.match(PHISHING_LANGUAGE_RE);
  return {
    pageTitle: extractPageTitle(html),
    hasPasswordField: PASSWORD_FIELD_RE.test(html),
    phishingLanguageMatch: phishingMatch ? phishingMatch[0] : null,
    externalAssetHosts: extractExternalAssetHosts(html, domain),
  };
}

module.exports = { extractHtmlSignals };
