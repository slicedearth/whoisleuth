// Lightweight, dependency-free signals extracted from a domain's already-
// fetched homepage HTML (see fetchHomepage in availability.js) - no
// extra network call or HTML-parsing dependency. The small tokenizer below is
// deliberately bounded and extracts only identity metadata and form targets;
// it is not a browser DOM and never attempts to execute page JavaScript.

const { createObservation } = require('./observation');

const MAX_TITLE_LENGTH = 200;
const MAX_PHISHING_MATCH_LENGTH = 200;
const MAX_EXTERNAL_ASSET_HOSTS = 20;
const MAX_IDENTITY_TAGS = 512;
const MAX_IDENTITY_TAG_LENGTH = 4096;
const MAX_IDENTITY_TEXT = 200;
const MAX_GENERATOR_LENGTH = 120;
const MAX_URL_INPUT_LENGTH = 4096;
const MAX_URL_OUTPUT_LENGTH = 2048;
const MAX_FORMS = 50;
const MAX_FORM_ACTION_ORIGINS = 10;
const PAGE_IDENTITY_VERSION = 1;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/g;
const HAS_CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

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
const IDENTITY_TAG_RE = /<(html|link|meta|form)\b[^>]{0,4096}>/gi;
const OVERSIZED_IDENTITY_TAG_RE = /<(?:html|link|meta|form)\b[^>]{4097}/i;
const ATTRIBUTE_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const LANGUAGE_TAG_RE = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;

function stripWwwPrefix(host) {
  return host.toLowerCase().replace(/^www\./, '');
}

function boundedHtmlText(value, maxLength, ellipsis = false) {
  const text = String(value == null ? '' : value)
    .replace(CONTROL_CHARACTER_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return ellipsis ? `${text.slice(0, maxLength)}…` : text.slice(0, maxLength);
}

function extractExternalAssetHosts(html, ownDomain) {
  const ownHost = stripWwwPrefix(ownDomain);
  const hosts = new Set();
  let match;
  ASSET_TAG_RE.lastIndex = 0;
  while ((match = ASSET_TAG_RE.exec(html))) {
    const hostMatch = match[1].match(ABSOLUTE_URL_HOST_RE);
    if (!hostMatch) continue;
    if (HAS_CONTROL_CHARACTER_RE.test(hostMatch[1])) continue;
    const host = stripWwwPrefix(hostMatch[1]);
    if (host && host !== ownHost) hosts.add(host);
    if (hosts.size >= MAX_EXTERNAL_ASSET_HOSTS) break;
  }
  return [...hosts];
}

function extractPageTitle(html) {
  const match = html.match(TITLE_RE);
  if (!match) return null;
  return boundedHtmlText(match[1], MAX_TITLE_LENGTH, true);
}

function parseAttributes(tag) {
  const start = tag.search(/\s/);
  if (start === -1) return new Map();
  const attributes = new Map();
  ATTRIBUTE_RE.lastIndex = 0;
  let match;
  while ((match = ATTRIBUTE_RE.exec(tag.slice(start)))) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function normalizeLanguage(value) {
  if (typeof value !== 'string' || value.length > 35 || HAS_CONTROL_CHARACTER_RE.test(value)) return null;
  const normalized = value.trim();
  return LANGUAGE_TAG_RE.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeIdentityUrl(value, baseUrl) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_INPUT_LENGTH || HAS_CONTROL_CHARACTER_RE.test(value)) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized, baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
    const queryOmitted = Boolean(parsed.search || parsed.hash);
    parsed.search = '';
    parsed.hash = '';
    let url = parsed.toString();
    let pathTruncated = false;
    if (url.length > MAX_URL_OUTPUT_LENGTH) {
      parsed.pathname = '/';
      url = parsed.toString();
      pathTruncated = true;
    }
    if (url.length > MAX_URL_OUTPUT_LENGTH) return null;
    return { url, queryOmitted, pathTruncated };
  } catch {
    return null;
  }
}

function metaRefreshTarget(content) {
  if (typeof content !== 'string' || content.length > MAX_URL_INPUT_LENGTH || HAS_CONTROL_CHARACTER_RE.test(content)) return null;
  const match = content.match(/(?:^|;)\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/i);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : null;
}

function extractPageIdentity(html, domain, options = {}) {
  const safeFallback = normalizeIdentityUrl(`https://${domain}/`, 'https://invalid.example/');
  const fallbackBase = safeFallback ? safeFallback.url : 'https://invalid.example/';
  const suppliedBase = normalizeIdentityUrl(options.baseUrl, fallbackBase);
  const baseUrl = suppliedBase ? suppliedBase.url : fallbackBase;
  const parsedBase = new URL(baseUrl);
  const baseOrigin = parsedBase.origin;
  const baseUsesHttps = parsedBase.protocol === 'https:';
  const externalFormOrigins = new Set();
  let documentLanguage = null;
  let canonical = null;
  let metaRefresh = null;
  let openGraphTitle = null;
  let openGraphSiteName = null;
  let openGraphUrl = null;
  let generator = null;
  let formCount = 0;
  let postFormCount = 0;
  let insecureActionCount = 0;
  let tagsExamined = 0;
  let discardedUrls = 0;
  let formLimitReached = false;
  let originLimitReached = false;
  let tagLimitReached = OVERSIZED_IDENTITY_TAG_RE.test(html);
  let match;
  IDENTITY_TAG_RE.lastIndex = 0;
  while ((match = IDENTITY_TAG_RE.exec(html))) {
    if (tagsExamined >= MAX_IDENTITY_TAGS) {
      tagLimitReached = true;
      break;
    }
    tagsExamined += 1;
    const tagName = match[1].toLowerCase();
    const attributes = parseAttributes(match[0]);

    if (tagName === 'html' && documentLanguage === null) {
      documentLanguage = normalizeLanguage(attributes.get('lang'));
      continue;
    }

    if (tagName === 'link' && canonical === null) {
      const rel = String(attributes.get('rel') || '').toLowerCase().split(/\s+/);
      if (rel.includes('canonical')) {
        canonical = normalizeIdentityUrl(attributes.get('href'), baseUrl);
        if (!canonical && attributes.has('href')) discardedUrls += 1;
      }
      continue;
    }

    if (tagName === 'meta') {
      const name = String(attributes.get('name') || '').trim().toLowerCase();
      const property = String(attributes.get('property') || '').trim().toLowerCase();
      const httpEquiv = String(attributes.get('http-equiv') || '').trim().toLowerCase();
      const content = attributes.get('content');
      if (httpEquiv === 'refresh' && metaRefresh === null) {
        const target = metaRefreshTarget(content);
        metaRefresh = normalizeIdentityUrl(target, baseUrl);
        if (!metaRefresh && (target || (typeof content === 'string' && /(?:^|;)\s*url\s*=/i.test(content)))) discardedUrls += 1;
      } else if (property === 'og:title' && openGraphTitle === null) {
        openGraphTitle = boundedHtmlText(content, MAX_IDENTITY_TEXT, true);
      } else if (property === 'og:site_name' && openGraphSiteName === null) {
        openGraphSiteName = boundedHtmlText(content, MAX_IDENTITY_TEXT, true);
      } else if (property === 'og:url' && openGraphUrl === null) {
        openGraphUrl = normalizeIdentityUrl(content, baseUrl);
        if (content && !openGraphUrl) discardedUrls += 1;
      } else if (name === 'generator' && generator === null) {
        generator = boundedHtmlText(content, MAX_GENERATOR_LENGTH, true);
      }
      continue;
    }

    if (tagName === 'form') {
      if (formCount >= MAX_FORMS) {
        formLimitReached = true;
        continue;
      }
      formCount += 1;
      if (String(attributes.get('method') || 'get').trim().toLowerCase() === 'post') postFormCount += 1;
      if (!attributes.has('action') || !String(attributes.get('action')).trim()) continue;
      const action = normalizeIdentityUrl(attributes.get('action'), baseUrl);
      if (!action) {
        discardedUrls += 1;
        continue;
      }
      const actionOrigin = new URL(action.url).origin;
      if (baseUsesHttps && action.url.startsWith('http:')) insecureActionCount += 1;
      if (actionOrigin !== baseOrigin) {
        if (externalFormOrigins.size < MAX_FORM_ACTION_ORIGINS) externalFormOrigins.add(actionOrigin);
        else if (!externalFormOrigins.has(actionOrigin)) originLimitReached = true;
      }
    }
  }

  const queryOmitted = [canonical, metaRefresh, openGraphUrl].some((item) => item?.queryOmitted);
  const pathTruncated = [canonical, metaRefresh, openGraphUrl].some((item) => item?.pathTruncated);
  const sourceTruncated = options.sourceTruncated === true;
  const truncated = sourceTruncated || tagLimitReached || formLimitReached || originLimitReached || pathTruncated;
  const limitations = ['Static HTML metadata only; JavaScript-rendered changes are not evaluated.'];
  if (sourceTruncated) limitations.push('Homepage body capture reached its byte limit; identity fields may be incomplete.');
  if (tagLimitReached) limitations.push(`Page identity parsing reached the ${MAX_IDENTITY_TAGS}-tag or ${MAX_IDENTITY_TAG_LENGTH}-character tag limit.`);
  if (formLimitReached) limitations.push(`Only the first ${MAX_FORMS} forms were summarized.`);
  if (originLimitReached) limitations.push(`Only the first ${MAX_FORM_ACTION_ORIGINS} external form-action origins were retained.`);
  if (queryOmitted) limitations.push('Query strings and fragments were omitted from retained page-identity URLs.');
  if (pathTruncated) limitations.push('An overlong page-identity URL path was replaced by its origin.');

  return {
    identityVersion: PAGE_IDENTITY_VERSION,
    ...createObservation({
      status: truncated ? 'partial' : 'success',
      observedAt: options.observedAt,
      scanMode: 'deep',
      source: 'html',
      complete: !truncated,
      truncated,
      limitations,
      diagnostics: { tagsExamined, discardedUrls, formsObserved: formCount },
    }),
    documentLanguage,
    canonical,
    metaRefresh,
    openGraph: { title: openGraphTitle, siteName: openGraphSiteName, url: openGraphUrl },
    generator,
    forms: {
      count: formCount,
      postCount: postFormCount,
      insecureActionCount,
      externalActionOrigins: [...externalFormOrigins].sort(),
      truncated: formLimitReached || originLimitReached,
    },
  };
}

function extractHtmlSignals(html, domain, options = {}) {
  const phishingMatch = html.match(PHISHING_LANGUAGE_RE);
  return {
    pageTitle: extractPageTitle(html),
    hasPasswordField: PASSWORD_FIELD_RE.test(html),
    phishingLanguageMatch: phishingMatch ? boundedHtmlText(phishingMatch[0], MAX_PHISHING_MATCH_LENGTH) : null,
    externalAssetHosts: extractExternalAssetHosts(html, domain),
    pageIdentity: options.includePageIdentity === false ? null : extractPageIdentity(html, domain, options),
  };
}

module.exports = {
  PAGE_IDENTITY_VERSION,
  MAX_IDENTITY_TAGS,
  MAX_FORMS,
  MAX_FORM_ACTION_ORIGINS,
  extractHtmlSignals,
  extractPageIdentity,
};
