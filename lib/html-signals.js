// Lightweight, dependency-free signals extracted from a domain's already-
// fetched homepage HTML (see fetchHomepage in availability.js) - no
// extra network call or HTML-parsing dependency. The small tokenizer below is
// deliberately bounded and extracts identity, form, resource, and relationship
// context; it is not a browser DOM and never executes page JavaScript.

const { createObservation } = require('./observation');
const { isIP } = require('node:net');
const { domainToASCII } = require('node:url');

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
const MAX_RESOURCE_TAGS = 1024;
const MAX_RESOURCE_ORIGINS = 30;
const MAX_EMBEDDED_ORIGINS = 20;
const MAX_CONTACT_DOMAINS = 20;
const MAX_DOWNLOAD_ORIGINS = 20;
const MAX_DOWNLOAD_FILE_TYPES = 20;
const MAX_TRACKING_IDENTIFIERS = 30;
const MAX_URLS_PER_TAG = 20;
const PAGE_IDENTITY_VERSION = 2;
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
const RELATIONSHIP_TAG_RE = /<(a|img|script|link|iframe|frame|source|video|audio|object|embed)\b[^>]{0,4096}>/gi;
const OVERSIZED_RELATIONSHIP_TAG_RE = /<(?:a|img|script|link|iframe|frame|source|video|audio|object|embed)\b[^>]{4097}/i;
const ATTRIBUTE_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const LANGUAGE_TAG_RE = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const RESOURCE_LINK_RELS = new Set(['stylesheet', 'icon', 'preload', 'prefetch', 'modulepreload', 'manifest']);
const RISKY_DOWNLOAD_EXTENSIONS = new Set([
  '7z', 'apk', 'bat', 'cmd', 'dmg', 'docm', 'exe', 'img', 'iso', 'jar', 'js',
  'msi', 'pkg', 'ps1', 'rar', 'scr', 'vbs', 'xlsm', 'zip',
]);
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const RAW_TEXT_BLOCK_RE = /<(script|style|textarea|template)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi;
const NON_EXECUTING_RAW_TEXT_BLOCK_RE = /<(style|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

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

function markupForTagParsing(html) {
  return html
    .replace(HTML_COMMENT_RE, ' ')
    .replace(RAW_TEXT_BLOCK_RE, '<$1$2>');
}

function markupForTrackingIdentifiers(html) {
  return html
    .replace(HTML_COMMENT_RE, ' ')
    .replace(NON_EXECUTING_RAW_TEXT_BLOCK_RE, ' ');
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

function resolvedBaseUrl(domain, suppliedBaseUrl) {
  const safeFallback = normalizeIdentityUrl(`https://${domain}/`, 'https://invalid.example/');
  const fallbackBase = safeFallback ? safeFallback.url : 'https://invalid.example/';
  const suppliedBase = normalizeIdentityUrl(suppliedBaseUrl, fallbackBase);
  return suppliedBase ? suppliedBase.url : fallbackBase;
}

function addBounded(set, value, limit) {
  if (set.has(value)) return false;
  if (set.size >= limit) return true;
  set.add(value);
  return false;
}

function normalizeContactDomain(value) {
  if (typeof value !== 'string' || !value || value.length > 253 || HAS_CONTROL_CHARACTER_RE.test(value)) return null;
  const ascii = domainToASCII(value.trim().replace(/\.$/, '').toLowerCase());
  if (!ascii || isIP(ascii) || !HOSTNAME_RE.test(ascii)) return null;
  return ascii;
}

function mailtoDomains(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_INPUT_LENGTH || HAS_CONTROL_CHARACTER_RE.test(value) || !/^mailto:/i.test(value)) {
    return { domains: [], truncated: false };
  }
  const recipients = value.slice(7).split('?', 1)[0].split(',');
  const truncated = recipients.length > MAX_URLS_PER_TAG;
  const domains = new Set();
  for (const recipient of recipients.slice(0, MAX_URLS_PER_TAG)) {
    const at = recipient.lastIndexOf('@');
    if (at <= 0) continue;
    const domain = normalizeContactDomain(recipient.slice(at + 1));
    if (domain) domains.add(domain);
  }
  return { domains: [...domains].sort(), truncated };
}

function srcsetUrls(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_INPUT_LENGTH || HAS_CONTROL_CHARACTER_RE.test(value)) {
    return { urls: [], truncated: false };
  }
  // Data URLs may contain unescaped commas, so a lightweight comma splitter
  // cannot distinguish one inline resource from several candidates. Skip the
  // whole attribute and disclose the incomplete parse rather than inventing
  // same-origin resources from fragments of encoded data.
  if (/(?:^|,)\s*data:/i.test(value)) return { urls: [], truncated: true };
  const candidates = value.split(',');
  return {
    urls: candidates.slice(0, MAX_URLS_PER_TAG).map((candidate) => candidate.trim().split(/\s+/, 1)[0]).filter(Boolean),
    truncated: candidates.length > MAX_URLS_PER_TAG,
  };
}

function resourceReferences(tagName, attributes) {
  const references = [];
  if (tagName === 'img') {
    if (attributes.has('src')) references.push({ type: 'image', value: attributes.get('src') });
    const srcset = srcsetUrls(attributes.get('srcset'));
    references.push(...srcset.urls.map((value) => ({ type: 'image', value })));
    return { references, truncated: srcset.truncated };
  }
  if (tagName === 'script' && attributes.has('src')) references.push({ type: 'script', value: attributes.get('src') });
  if (tagName === 'link') {
    const rels = String(attributes.get('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (rels.some((rel) => RESOURCE_LINK_RELS.has(rel)) && attributes.has('href')) {
      references.push({ type: rels.includes('stylesheet') ? 'stylesheet' : 'link', value: attributes.get('href') });
    }
  }
  if (['iframe', 'frame'].includes(tagName) && attributes.has('src')) references.push({ type: 'frame', value: attributes.get('src') });
  if (tagName === 'source') {
    if (attributes.has('src')) references.push({ type: 'media', value: attributes.get('src') });
    const srcset = srcsetUrls(attributes.get('srcset'));
    references.push(...srcset.urls.map((value) => ({ type: 'media', value })));
    return { references, truncated: srcset.truncated };
  }
  if (['video', 'audio'].includes(tagName) && attributes.has('src')) references.push({ type: 'media', value: attributes.get('src') });
  if (tagName === 'video' && attributes.has('poster')) references.push({ type: 'image', value: attributes.get('poster') });
  if (tagName === 'object' && attributes.has('data')) references.push({ type: 'object', value: attributes.get('data') });
  if (tagName === 'embed' && attributes.has('src')) references.push({ type: 'object', value: attributes.get('src') });
  return { references, truncated: false };
}

function downloadExtension(url) {
  try {
    const filename = new URL(url).pathname.split('/').pop() || '';
    const match = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const TRACKING_PATTERNS = [
  { type: 'tag-container', regex: /\b(GTM-[A-Z0-9]{4,12})\b/gi },
  { type: 'analytics-property', regex: /\b(G-[A-Z0-9]{10,16})\b/gi },
  { type: 'legacy-analytics-property', regex: /\b(UA-\d{4,12}-\d{1,4})\b/gi },
  { type: 'advertising-property', regex: /\b(AW-\d{5,20})\b/gi },
];

function trackingIdentifiers(html) {
  const identifiers = new Map();
  let truncated = false;
  for (const pattern of TRACKING_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(html))) {
      const value = match[1].toUpperCase();
      const key = `${pattern.type}:${value}`;
      if (!identifiers.has(key)) {
        if (identifiers.size >= MAX_TRACKING_IDENTIFIERS) {
          truncated = true;
          break;
        }
        identifiers.set(key, { type: pattern.type, value });
      }
    }
  }
  return {
    values: [...identifiers.values()].sort((left, right) => left.type.localeCompare(right.type) || left.value.localeCompare(right.value)),
    truncated,
  };
}

function extractPageRelationships(html, domain, options = {}) {
  const baseUrl = resolvedBaseUrl(domain, options.baseUrl);
  const markup = typeof options.tagMarkup === 'string' ? options.tagMarkup : markupForTagParsing(html);
  const baseOrigin = new URL(baseUrl).origin;
  const resourceKeys = new Set();
  const resourceOrigins = new Set();
  const embeddedOrigins = new Set();
  const contactDomains = new Set();
  const downloadOrigins = new Set();
  const downloadFileTypes = new Set();
  const byType = { image: 0, script: 0, stylesheet: 0, link: 0, frame: 0, media: 0, object: 0 };
  let downloadCount = 0;
  let explicitDownloadCount = 0;
  let riskyDownloadCount = 0;
  let tagsExamined = 0;
  let discardedUrls = 0;
  let tagLimitReached = OVERSIZED_RELATIONSHIP_TAG_RE.test(markup);
  let resourceOriginLimitReached = false;
  let embeddedOriginLimitReached = false;
  let contactDomainLimitReached = false;
  let downloadOriginLimitReached = false;
  let downloadFileTypeLimitReached = false;
  let perTagLimitReached = false;
  let match;
  RELATIONSHIP_TAG_RE.lastIndex = 0;
  while ((match = RELATIONSHIP_TAG_RE.exec(markup))) {
    if (tagsExamined >= MAX_RESOURCE_TAGS) {
      tagLimitReached = true;
      break;
    }
    tagsExamined += 1;
    const tagName = match[1].toLowerCase();
    const attributes = parseAttributes(match[0]);

    if (tagName === 'a') {
      const href = attributes.get('href');
      const contacts = mailtoDomains(href);
      if (contacts.truncated) perTagLimitReached = true;
      for (const contactDomain of contacts.domains) {
        if (addBounded(contactDomains, contactDomain, MAX_CONTACT_DOMAINS)) contactDomainLimitReached = true;
      }
      if (typeof href === 'string' && !/^mailto:/i.test(href)) {
        const normalized = normalizeIdentityUrl(href, baseUrl);
        if (normalized) {
          const extension = downloadExtension(normalized.url);
          const explicit = attributes.has('download');
          const risky = Boolean(extension && RISKY_DOWNLOAD_EXTENSIONS.has(extension));
          if (explicit || risky) {
            downloadCount += 1;
            if (explicit) explicitDownloadCount += 1;
            if (risky) {
              riskyDownloadCount += 1;
              if (addBounded(downloadFileTypes, extension, MAX_DOWNLOAD_FILE_TYPES)) downloadFileTypeLimitReached = true;
            }
            const origin = new URL(normalized.url).origin;
            if (origin !== baseOrigin && addBounded(downloadOrigins, origin, MAX_DOWNLOAD_ORIGINS)) downloadOriginLimitReached = true;
          }
        } else if (attributes.has('download') && href) {
          discardedUrls += 1;
        }
      }
      continue;
    }

    const resources = resourceReferences(tagName, attributes);
    if (resources.truncated) perTagLimitReached = true;
    for (const reference of resources.references) {
      const normalized = normalizeIdentityUrl(reference.value, baseUrl);
      if (!normalized) {
        if (reference.value) discardedUrls += 1;
        continue;
      }
      const key = `${reference.type}:${normalized.url}`;
      if (!resourceKeys.has(key)) {
        resourceKeys.add(key);
        byType[reference.type] += 1;
      }
      const origin = new URL(normalized.url).origin;
      if (origin !== baseOrigin && addBounded(resourceOrigins, origin, MAX_RESOURCE_ORIGINS)) resourceOriginLimitReached = true;
      if (['frame', 'object'].includes(reference.type) && origin !== baseOrigin
        && addBounded(embeddedOrigins, origin, MAX_EMBEDDED_ORIGINS)) embeddedOriginLimitReached = true;
    }
  }

  const tracking = trackingIdentifiers(markupForTrackingIdentifiers(html));
  const truncated = tagLimitReached || resourceOriginLimitReached || embeddedOriginLimitReached
    || contactDomainLimitReached || downloadOriginLimitReached || downloadFileTypeLimitReached
    || perTagLimitReached || tracking.truncated;
  const limitations = [];
  if (tagLimitReached) limitations.push(`Resource parsing reached the ${MAX_RESOURCE_TAGS}-tag or ${MAX_IDENTITY_TAG_LENGTH}-character tag limit.`);
  if (resourceOriginLimitReached) limitations.push(`Only the first ${MAX_RESOURCE_ORIGINS} external resource origins were retained.`);
  if (embeddedOriginLimitReached) limitations.push(`Only the first ${MAX_EMBEDDED_ORIGINS} embedded origins were retained.`);
  if (contactDomainLimitReached) limitations.push(`Only the first ${MAX_CONTACT_DOMAINS} contact domains were retained.`);
  if (downloadOriginLimitReached) limitations.push(`Only the first ${MAX_DOWNLOAD_ORIGINS} external download origins were retained.`);
  if (downloadFileTypeLimitReached) limitations.push(`Only the first ${MAX_DOWNLOAD_FILE_TYPES} risky download file types were retained.`);
  if (perTagLimitReached) limitations.push(`Some srcset URL candidates could not be safely enumerated within the ${MAX_URLS_PER_TAG}-candidate per-tag boundary.`);
  if (tracking.truncated) limitations.push(`Only the first ${MAX_TRACKING_IDENTIFIERS} tracking identifiers were retained.`);
  return {
    resources: {
      count: resourceKeys.size,
      byType,
      externalOrigins: [...resourceOrigins].sort(),
      truncated: tagLimitReached || resourceOriginLimitReached || perTagLimitReached,
    },
    embeddedOrigins: [...embeddedOrigins].sort(),
    contactDomains: [...contactDomains].sort(),
    downloads: {
      count: downloadCount,
      explicitCount: explicitDownloadCount,
      riskyCount: riskyDownloadCount,
      externalOrigins: [...downloadOrigins].sort(),
      riskyFileTypes: [...downloadFileTypes].sort(),
      truncated: tagLimitReached || downloadOriginLimitReached || downloadFileTypeLimitReached,
    },
    trackingIdentifiers: tracking.values,
    truncated,
    limitations,
    diagnostics: { relationshipTagsExamined: tagsExamined, relationshipUrlsDiscarded: discardedUrls },
  };
}

function metaRefreshTarget(content) {
  if (typeof content !== 'string' || content.length > MAX_URL_INPUT_LENGTH || HAS_CONTROL_CHARACTER_RE.test(content)) return null;
  const match = content.match(/(?:^|;)\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/i);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : null;
}

function extractPageIdentity(html, domain, options = {}) {
  const baseUrl = resolvedBaseUrl(domain, options.baseUrl);
  const tagMarkup = markupForTagParsing(html);
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
  let tagLimitReached = OVERSIZED_IDENTITY_TAG_RE.test(tagMarkup);
  let match;
  IDENTITY_TAG_RE.lastIndex = 0;
  while ((match = IDENTITY_TAG_RE.exec(tagMarkup))) {
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
  const relationships = extractPageRelationships(html, domain, { baseUrl, tagMarkup });
  const truncated = sourceTruncated || tagLimitReached || formLimitReached || originLimitReached || pathTruncated || relationships.truncated;
  const limitations = ['Static HTML metadata only; JavaScript-rendered changes are not evaluated.'];
  if (sourceTruncated) limitations.push('Homepage body capture reached its byte limit; identity fields may be incomplete.');
  if (tagLimitReached) limitations.push(`Page identity parsing reached the ${MAX_IDENTITY_TAGS}-tag or ${MAX_IDENTITY_TAG_LENGTH}-character tag limit.`);
  if (formLimitReached) limitations.push(`Only the first ${MAX_FORMS} forms were summarized.`);
  if (originLimitReached) limitations.push(`Only the first ${MAX_FORM_ACTION_ORIGINS} external form-action origins were retained.`);
  if (queryOmitted) limitations.push('Query strings and fragments were omitted from retained page-identity URLs.');
  if (pathTruncated) limitations.push('An overlong page-identity URL path was replaced by its origin.');
  limitations.push(...relationships.limitations);

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
      diagnostics: {
        tagsExamined,
        discardedUrls,
        formsObserved: formCount,
        ...relationships.diagnostics,
      },
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
    resources: relationships.resources,
    embeddedOrigins: relationships.embeddedOrigins,
    contactDomains: relationships.contactDomains,
    downloads: relationships.downloads,
    trackingIdentifiers: relationships.trackingIdentifiers,
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
  MAX_RESOURCE_TAGS,
  MAX_RESOURCE_ORIGINS,
  MAX_EMBEDDED_ORIGINS,
  MAX_CONTACT_DOMAINS,
  MAX_TRACKING_IDENTIFIERS,
  extractHtmlSignals,
  extractPageIdentity,
  extractPageRelationships,
};
