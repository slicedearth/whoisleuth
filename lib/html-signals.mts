// Bounded signals extracted from a domain's already-fetched homepage HTML (see
// fetchHomepage in availability.mts), with no extra network request. Existing
// conservative field extractors share one standards-compliant static parser
// pass for technology, browser-library, and structured-data projections. None
// of these helpers creates a browser DOM or executes page JavaScript.

import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import { analyzeCredentialSurfaceProfile } from './credential-surface-profile.mts';
import { analyzeClientBehavior } from './client-behavior-profile.mts';
import { createObservation } from '../packages/evidence/observation.mts';
import { createPageFingerprints } from './page-fingerprints.mts';
import { detectPageLanguageSignal } from './page-language-signals.mts';
import { analyzePageRole } from './page-role-profile.mts';
import { analyzeCspMetaPolicies } from './response-policy.mts';
import { analyzeStaticHtml, type StaticHtmlAnalysis, type StaticPublicationMetadata } from './static-html-analysis.mts';
import { analyzeStructuredDataIdentity } from './structured-data-identity.mts';
import { analyzeWebsiteTechnology } from './website-technology.mts';
import {
  PAGE_PUBLICATION_LIMITATIONS,
  PAGE_PUBLICATION_METADATA_VERSION,
} from './homepage-metadata-contract.mts';

type NormalizedIdentityUrl = { url: string; queryOmitted: boolean; pathTruncated: boolean };
type HtmlSignalOptions = {
  baseUrl?: string;
  effectiveBaseUrl?: string;
  documentOrigin?: string;
  baseHrefState?: 'absent' | 'valid' | 'invalid';
  htmlAnalysis?: StaticHtmlAnalysis;
  sourceTruncated?: boolean;
  exactBodyHash?: unknown;
  httpServer?: unknown;
  responseHeaders?: unknown;
  observedAt?: string;
  includePageIdentity?: boolean;
  includePublicationMetadata?: boolean;
  includeCredentialSurfaceProfile?: boolean;
  includeStructuredDataIdentity?: boolean;
  includeTechnologyProfile?: boolean;
  activityStatus?: unknown;
};
type ResourceType = 'image' | 'script' | 'stylesheet' | 'link' | 'frame' | 'media' | 'object';
type ResourceReference = { type: ResourceType; value: string };
type TrackingIdentifier = { type: string; value: string };

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
const PAGE_IDENTITY_VERSION = 3;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu;
const HAS_CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;

// <img>/<script>/<link> tags loading a resource from an absolute, external
// URL - a common phishing-kit tell is hotlinking the real brand's own logo/
// CSS/JS instead of copying it. Relative URLs (the common case, same
// origin) are skipped since they have no host to extract. Deliberately
// scoped to resource tags, not every <a href> - an outbound link to the
// real site is normal on all sorts of pages; a resource pulled live from it
// during page load is not.
const IDENTITY_TAGS = new Set(['html', 'link', 'meta', 'form']);
const RELATIONSHIP_TAGS = new Set(['a', 'img', 'script', 'link', 'iframe', 'frame', 'source', 'video', 'audio', 'object', 'embed']);
const LANGUAGE_TAG_RE = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const RESOURCE_LINK_RELS = new Set(['stylesheet', 'icon', 'preload', 'prefetch', 'modulepreload', 'manifest']);
const RISKY_DOWNLOAD_EXTENSIONS = new Set([
  '7z', 'apk', 'bat', 'cmd', 'dmg', 'docm', 'exe', 'img', 'iso', 'jar', 'js',
  'msi', 'pkg', 'ps1', 'rar', 'scr', 'vbs', 'xlsm', 'zip',
]);

function stripWwwPrefix(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function boundedHtmlText(value: unknown, maxLength: number, ellipsis = false): string | null {
  const text = String(value == null ? '' : value)
    .replace(CONTROL_CHARACTER_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return ellipsis ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text.slice(0, maxLength);
}

function extractExternalAssetHosts(analysis: StaticHtmlAnalysis, ownDomain: string, documentUrl: string): string[] {
  const ownHost = stripWwwPrefix(ownDomain);
  const hosts = new Set<string>();
  for (const element of analysis.elements) {
    if (!element.html || !['img', 'script', 'link'].includes(element.name)) continue;
    const attribute = element.attributes.find((attribute) => attribute.name === (element.name === 'link' ? 'href' : 'src'));
    const resource = normalizeIdentityUrl(attribute?.value, analysis.effectiveBaseUrl ?? documentUrl);
    if (!resource) continue;
    const host = stripWwwPrefix(new URL(resource.url).hostname);
    if (host && host !== ownHost) hosts.add(host);
    if (hosts.size >= MAX_EXTERNAL_ASSET_HOSTS) break;
  }
  return [...hosts];
}

function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 35 || HAS_CONTROL_CHARACTER_RE.test(value)) return null;
  const normalized = value.trim();
  return LANGUAGE_TAG_RE.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeIdentityUrl(value: unknown, baseUrl: string): NormalizedIdentityUrl | null {
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

function resolvedBaseUrl(domain: string, suppliedBaseUrl: unknown): string {
  const safeFallback = normalizeIdentityUrl(`https://${domain}/`, 'https://invalid.example/');
  const fallbackBase = safeFallback ? safeFallback.url : 'https://invalid.example/';
  const suppliedBase = normalizeIdentityUrl(suppliedBaseUrl, fallbackBase);
  return suppliedBase ? suppliedBase.url : fallbackBase;
}

function addBounded(set: Set<string>, value: string, limit: number): boolean {
  if (set.has(value)) return false;
  if (set.size >= limit) return true;
  set.add(value);
  return false;
}

function normalizeContactDomain(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 253 || HAS_CONTROL_CHARACTER_RE.test(value)) return null;
  const ascii = domainToASCII(value.trim().replace(/\.$/, '').toLowerCase());
  if (!ascii || isIP(ascii) || !HOSTNAME_RE.test(ascii)) return null;
  return ascii;
}

function mailtoDomains(value: unknown): { domains: string[]; truncated: boolean } {
  if (typeof value !== 'string' || value.length > MAX_URL_INPUT_LENGTH || HAS_CONTROL_CHARACTER_RE.test(value) || !/^mailto:/i.test(value)) {
    return { domains: [], truncated: false };
  }
  const recipients = (value.slice(7).split('?', 1)[0] ?? '').split(',');
  const truncated = recipients.length > MAX_URLS_PER_TAG;
  const domains = new Set<string>();
  for (const recipient of recipients.slice(0, MAX_URLS_PER_TAG)) {
    const at = recipient.lastIndexOf('@');
    if (at <= 0) continue;
    const domain = normalizeContactDomain(recipient.slice(at + 1));
    if (domain) domains.add(domain);
  }
  return { domains: [...domains].sort(), truncated };
}

function srcsetUrls(value: unknown): { urls: string[]; truncated: boolean } {
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
    urls: candidates
      .slice(0, MAX_URLS_PER_TAG)
      .map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? '')
      .filter(Boolean),
    truncated: candidates.length > MAX_URLS_PER_TAG,
  };
}

function resourceReferences(tagName: string, attributes: Map<string, string>): { references: ResourceReference[]; truncated: boolean } {
  const references: ResourceReference[] = [];
  const pushAttribute = (type: ResourceReference['type'], name: string) => {
    const value = attributes.get(name);
    if (value !== undefined) references.push({ type, value });
  };
  if (tagName === 'img') {
    pushAttribute('image', 'src');
    const srcset = srcsetUrls(attributes.get('srcset'));
    references.push(...srcset.urls.map((value): ResourceReference => ({ type: 'image', value })));
    return { references, truncated: srcset.truncated };
  }
  if (tagName === 'script') pushAttribute('script', 'src');
  if (tagName === 'link') {
    const rels = String(attributes.get('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (rels.some((rel) => RESOURCE_LINK_RELS.has(rel))) {
      pushAttribute(rels.includes('stylesheet') ? 'stylesheet' : 'link', 'href');
    }
  }
  if (['iframe', 'frame'].includes(tagName)) pushAttribute('frame', 'src');
  if (tagName === 'source') {
    pushAttribute('media', 'src');
    const srcset = srcsetUrls(attributes.get('srcset'));
    references.push(...srcset.urls.map((value): ResourceReference => ({ type: 'media', value })));
    return { references, truncated: srcset.truncated };
  }
  if (['video', 'audio'].includes(tagName)) pushAttribute('media', 'src');
  if (tagName === 'video') pushAttribute('image', 'poster');
  if (tagName === 'object') pushAttribute('object', 'data');
  if (tagName === 'embed') pushAttribute('object', 'src');
  return { references, truncated: false };
}

function downloadExtension(url: string): string | null {
  try {
    const filename = new URL(url).pathname.split('/').pop() || '';
    const match = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

const TRACKING_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'tag-container', regex: /\b(GTM-[A-Z0-9]{4,12})\b/gi },
  { type: 'analytics-property', regex: /\b(G-[A-Z0-9]{10,16})\b/gi },
  { type: 'legacy-analytics-property', regex: /\b(UA-\d{4,12}-\d{1,4})\b/gi },
  { type: 'advertising-property', regex: /\b(AW-\d{5,20})\b/gi },
];

function trackingIdentifiers(html: string): { values: TrackingIdentifier[]; truncated: boolean } {
  const identifiers = new Map<string, TrackingIdentifier>();
  let truncated = false;
  for (const pattern of TRACKING_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(html))) {
      const value = (match[1] ?? '').toUpperCase();
      if (!value) continue;
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

function extractPageRelationships(analysis: StaticHtmlAnalysis, domain: string, options: HtmlSignalOptions = {}) {
  const documentUrl = resolvedBaseUrl(domain, options.baseUrl);
  const baseUrl = resolvedBaseUrl(domain, options.effectiveBaseUrl ?? documentUrl);
  const baseOrigin = options.documentOrigin ?? new URL(documentUrl).origin;
  const resourceKeys = new Set<string>();
  const resourceOrigins = new Set<string>();
  const embeddedOrigins = new Set<string>();
  const contactDomains = new Set<string>();
  const downloadOrigins = new Set<string>();
  const downloadFileTypes = new Set<string>();
  const byType: Record<ResourceType, number> = { image: 0, script: 0, stylesheet: 0, link: 0, frame: 0, media: 0, object: 0 };
  let downloadCount = 0;
  let explicitDownloadCount = 0;
  let riskyDownloadCount = 0;
  let tagsExamined = 0;
  let discardedUrls = 0;
  let tagLimitReached = analysis.inputLimitReached || analysis.tagLimitReached;
  let resourceOriginLimitReached = false;
  let embeddedOriginLimitReached = false;
  let contactDomainLimitReached = false;
  let downloadOriginLimitReached = false;
  let downloadFileTypeLimitReached = false;
  let perTagLimitReached = false;
  let resourceCountLimitReached = false;
  for (const element of analysis.elements) {
    if (!element.html || !RELATIONSHIP_TAGS.has(element.name)) continue;
    if (tagsExamined >= MAX_RESOURCE_TAGS) {
      tagLimitReached = true;
      break;
    }
    tagsExamined += 1;
    const tagName = element.name;
    const attributes = new Map(element.attributes.map(({ name, value }) => [name, value]));
    if (element.attributesTruncated) tagLimitReached = true;

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
            if (risky && extension) {
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
        if (resourceKeys.size >= MAX_RESOURCE_TAGS) { resourceCountLimitReached = true; continue; }
        resourceKeys.add(key);
        byType[reference.type] += 1;
      }
      const origin = new URL(normalized.url).origin;
      if (origin !== baseOrigin && addBounded(resourceOrigins, origin, MAX_RESOURCE_ORIGINS)) resourceOriginLimitReached = true;
      if (['frame', 'object'].includes(reference.type) && origin !== baseOrigin
        && addBounded(embeddedOrigins, origin, MAX_EMBEDDED_ORIGINS)) embeddedOriginLimitReached = true;
    }
  }

  const tracking = trackingIdentifiers([
    ...analysis.elements.filter((element) => element.html).flatMap((element) => element.attributes.map((attribute) => attribute.value)),
    ...analysis.scripts.map((script) => script.inlineContent),
  ].join('\n'));
  if (analysis.scriptLimitReached || analysis.inlineLimitReached) tracking.truncated = true;
  const truncated = tagLimitReached || resourceOriginLimitReached || embeddedOriginLimitReached
    || contactDomainLimitReached || downloadOriginLimitReached || downloadFileTypeLimitReached
    || perTagLimitReached || resourceCountLimitReached || tracking.truncated;
  const limitations: string[] = [];
  if (tagLimitReached) limitations.push(`Resource parsing reached the ${MAX_RESOURCE_TAGS}-tag or ${MAX_IDENTITY_TAG_LENGTH}-character tag limit.`);
  if (resourceOriginLimitReached) limitations.push(`Only the first ${MAX_RESOURCE_ORIGINS} external resource origins were retained.`);
  if (embeddedOriginLimitReached) limitations.push(`Only the first ${MAX_EMBEDDED_ORIGINS} embedded origins were retained.`);
  if (contactDomainLimitReached) limitations.push(`Only the first ${MAX_CONTACT_DOMAINS} contact domains were retained.`);
  if (downloadOriginLimitReached) limitations.push(`Only the first ${MAX_DOWNLOAD_ORIGINS} external download origins were retained.`);
  if (downloadFileTypeLimitReached) limitations.push(`Only the first ${MAX_DOWNLOAD_FILE_TYPES} risky download file types were retained.`);
  if (perTagLimitReached) limitations.push(`Some srcset URL candidates could not be safely enumerated within the ${MAX_URLS_PER_TAG}-candidate per-tag boundary.`);
  if (resourceCountLimitReached) limitations.push(`Only the first ${MAX_RESOURCE_TAGS} distinct resource references were examined.`);
  if (tracking.truncated) limitations.push(`Only the first ${MAX_TRACKING_IDENTIFIERS} tracking identifiers were retained.`);
  return {
    resources: {
      count: resourceKeys.size,
      byType,
      externalOrigins: [...resourceOrigins].sort(),
      truncated: tagLimitReached || resourceOriginLimitReached || perTagLimitReached || resourceCountLimitReached,
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
    diagnostics: {
      relationshipTagsExamined: tagsExamined,
      relationshipUrlsDiscarded: discardedUrls,
      trackingIdentifiersTruncated: tracking.truncated,
    },
  };
}

function metaRefreshTarget(content: unknown): string | null {
  if (typeof content !== 'string' || content.length > MAX_URL_INPUT_LENGTH || HAS_CONTROL_CHARACTER_RE.test(content)) return null;
  const match = content.match(/(?:^|;)\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/i);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : null;
}

function extractPageIdentity(html: string, domain: string, options: HtmlSignalOptions = {}) {
  const documentUrl = resolvedBaseUrl(domain, options.baseUrl);
  const analysis = options.htmlAnalysis ?? analyzeStaticHtml(html, { baseUrl: documentUrl, includeVisibleText: true });
  const baseUrl = resolvedBaseUrl(domain, options.effectiveBaseUrl ?? analysis.effectiveBaseUrl ?? documentUrl);
  const baseHrefState = options.baseHrefState ?? analysis.baseHrefState;
  const parsedDocument = new URL(documentUrl);
  const baseOrigin = options.documentOrigin ?? parsedDocument.origin;
  const baseUsesHttps = parsedDocument.protocol === 'https:';
  const externalFormOrigins = new Set<string>();
  let documentLanguage: string | null = null;
  let canonical: NormalizedIdentityUrl | null = null;
  let metaRefresh: NormalizedIdentityUrl | null = null;
  let openGraphTitle: string | null = null;
  let openGraphSiteName: string | null = null;
  let openGraphUrl: NormalizedIdentityUrl | null = null;
  let generator: string | null = null;
  let formCount = 0;
  let postFormCount = 0;
  let insecureActionCount = 0;
  let tagsExamined = 0;
  let discardedUrls = 0;
  let formLimitReached = false;
  let originLimitReached = false;
  let tagLimitReached = analysis.inputLimitReached || analysis.tagLimitReached;
  for (const element of analysis.elements) {
    if (!element.html || !IDENTITY_TAGS.has(element.name)) continue;
    if (tagsExamined >= MAX_IDENTITY_TAGS) {
      tagLimitReached = true;
      break;
    }
    tagsExamined += 1;
    const tagName = element.name;
    const attributes = new Map(element.attributes.map(({ name, value }) => [name, value]));
    if (element.attributesTruncated) tagLimitReached = true;

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
  const relationships = extractPageRelationships(analysis, domain, { baseUrl: documentUrl, effectiveBaseUrl: baseUrl, documentOrigin: baseOrigin });
  const fingerprints = createPageFingerprints(html, {
    baseUrl: documentUrl,
    htmlAnalysis: analysis,
    exactBodyHash: options.exactBodyHash,
    sourceTruncated,
    resources: relationships.resources,
    trackingIdentifiers: relationships.trackingIdentifiers,
    identifiersTruncated: relationships.diagnostics.trackingIdentifiersTruncated === true,
  });
  const truncated = sourceTruncated || baseHrefState === 'invalid' || tagLimitReached || formLimitReached || originLimitReached
    || pathTruncated || relationships.truncated || fingerprints.truncated;
  const limitations: string[] = ['Static HTML metadata only; JavaScript-rendered changes are not evaluated.'];
  if (sourceTruncated) limitations.push('Homepage body capture reached its byte limit; identity fields may be incomplete.');
  if (baseHrefState === 'invalid') limitations.push('The first bounded document base URL was invalid; relative URL relationships use the response URL and remain partial.');
  if (tagLimitReached) limitations.push(`Page identity parsing reached the ${MAX_IDENTITY_TAGS}-tag or ${MAX_IDENTITY_TAG_LENGTH}-character tag limit.`);
  if (formLimitReached) limitations.push(`Only the first ${MAX_FORMS} forms were summarized.`);
  if (originLimitReached) limitations.push(`Only the first ${MAX_FORM_ACTION_ORIGINS} external form-action origins were retained.`);
  if (queryOmitted) limitations.push('Query strings and fragments were omitted from retained page-identity URLs.');
  if (pathTruncated) limitations.push('An overlong page-identity URL path was replaced by its origin.');
  limitations.push(...relationships.limitations);
  limitations.push(...fingerprints.limitations);

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
    fingerprints,
  };
}

function publicationSourceStatus(
  observed: boolean,
  malformed: boolean,
  truncated: boolean,
): 'observed' | 'not_observed' | 'partial' | 'malformed' {
  if (truncated) return 'partial';
  if (malformed) return 'malformed';
  return observed ? 'observed' : 'not_observed';
}

function buildPagePublicationMetadata(
  analysis: StaticPublicationMetadata,
  sourceTruncated: boolean,
) {
  const truncated = sourceTruncated || analysis.truncated;
  const malformed = analysis.robots.malformed || analysis.twitterCard.malformed;
  const incomplete = truncated || malformed;
  const limitations: string[] = [
    PAGE_PUBLICATION_LIMITATIONS.scope,
  ];
  if (sourceTruncated) limitations.push(PAGE_PUBLICATION_LIMITATIONS.body);
  if (analysis.truncated) limitations.push(PAGE_PUBLICATION_LIMITATIONS.bounds);
  if (malformed) limitations.push(PAGE_PUBLICATION_LIMITATIONS.malformed);
  const cardTypes = analysis.twitterCard.cardTypes;
  const suppliedCardType = cardTypes.length === 1 ? cardTypes[0] : null;
  const cardType = suppliedCardType && ['summary', 'summary_large_image', 'player', 'app', 'other'].includes(suppliedCardType)
    ? suppliedCardType
    : cardTypes.length > 1 ? 'other' : null;
  const documentTruncated = sourceTruncated || analysis.documentTruncated;
  const robotsStatus = publicationSourceStatus(
    analysis.robots.observed,
    analysis.robots.malformed,
    documentTruncated || analysis.robots.truncated,
  );
  const twitterStatus = publicationSourceStatus(
    analysis.twitterCard.observed,
    analysis.twitterCard.malformed,
    documentTruncated || analysis.twitterCard.truncated,
  );
  return {
    version: PAGE_PUBLICATION_METADATA_VERSION,
    status: incomplete ? 'partial' : 'success',
    complete: !incomplete,
    truncated,
    limitations,
    robots: {
      status: robotsStatus,
      complete: robotsStatus === 'observed' || robotsStatus === 'not_observed',
      truncated: robotsStatus === 'partial',
      directives: analysis.robots.directives,
      recognizedDirectiveCount: analysis.robots.recognizedDirectiveCount,
      unknownDirectiveCount: analysis.robots.unknownDirectiveCount,
      conflicting: analysis.robots.conflicting,
    },
    twitterCard: {
      status: twitterStatus,
      complete: twitterStatus === 'observed' || twitterStatus === 'not_observed',
      truncated: twitterStatus === 'partial',
      cardType,
      declarationCount: analysis.twitterCard.declarationCount,
      titlePresent: analysis.twitterCard.titlePresent,
      descriptionPresent: analysis.twitterCard.descriptionPresent,
      imagePresent: analysis.twitterCard.imagePresent,
      imageAltPresent: analysis.twitterCard.imageAltPresent,
      sitePresent: analysis.twitterCard.sitePresent,
      creatorPresent: analysis.twitterCard.creatorPresent,
      playerPresent: analysis.twitterCard.playerPresent,
      appPresent: analysis.twitterCard.appPresent,
    },
    headings: {
      ...analysis.headings,
      complete: !documentTruncated && !analysis.headings.truncated,
      truncated: documentTruncated || analysis.headings.truncated,
    },
    images: {
      ...analysis.images,
      totalComplete: !documentTruncated && analysis.images.totalComplete,
      classificationComplete: !documentTruncated && analysis.images.classificationComplete,
      truncated: documentTruncated || analysis.images.truncated,
    },
    renderBlockingCandidates: {
      ...analysis.renderBlockingCandidates,
      complete: !documentTruncated && !analysis.renderBlockingCandidates.truncated,
      truncated: documentTruncated || analysis.renderBlockingCandidates.truncated,
      scope: 'explicit-head-static-v1',
    },
  };
}

function domainSaleLandingPage(analysis: StaticHtmlAnalysis, domain: string): boolean {
  if (analysis.inputLimitReached || analysis.tagLimitReached || analysis.visibleTextLimitReached) return false;
  const title = analysis.title?.trim().toLowerCase() ?? '';
  const content = analysis.visibleText.trim().toLowerCase();
  const saleSuffix = /^\s+(?:(?:is|may be)\s+)?(?:for sale|available for purchase|available for lease)(?:[.!?:\s]|$)/u;
  const explicitSale = (value: string): boolean => {
    const genericSubject = /^(?:(?:this|the) domain(?: name)?|domain(?: name)?)/u.exec(value)?.[0];
    return (genericSubject !== undefined && saleSuffix.test(value.slice(genericSubject.length)))
      || (value.startsWith(domain) && saleSuffix.test(value.slice(domain.length)));
  };
  const explicitPurchase = /^(?:buy|purchase|own|bid on|inquire about) (?:this|the) domain(?: name)?(?:[.!?:\s]|$)/u;
  // A short, directly worded landing page is sufficient. Long articles need
  // corroborating page-title and transaction-control evidence; a generic
  // commerce CTA or quoted example cannot classify the domain for sale.
  if (content.length <= 240 && (explicitSale(content) || explicitPurchase.test(content))) return true;
  if (!explicitSale(title) && !explicitPurchase.test(title)) return false;
  if (!/(?:this domain(?: name)? (?:is )?for sale|buy this domain|purchase this domain|domain name for sale)/u.test(content)) return false;
  return analysis.elements.some((element) => element.html
    && ['form', 'button', 'a'].includes(element.name));
}

function extractHtmlSignals(html: string, domain: string, options: HtmlSignalOptions = {}) {
  const documentUrl = resolvedBaseUrl(domain, options.baseUrl);
  const htmlAnalysis = options.htmlAnalysis ?? analyzeStaticHtml(html, { baseUrl: documentUrl, includeVisibleText: true });
  const effectiveBaseUrl = htmlAnalysis.effectiveBaseUrl ?? documentUrl;
  const documentOrigin = new URL(documentUrl).origin;
  const pageIdentity = options.includePageIdentity === false ? null : extractPageIdentity(html, domain, {
    ...options,
    baseUrl: documentUrl,
    effectiveBaseUrl,
    documentOrigin,
    baseHrefState: htmlAnalysis.baseHrefState,
    htmlAnalysis,
  });
  const includeCredentialSurfaceProfile = pageIdentity && options.includeCredentialSurfaceProfile === true;
  const includeStructuredDataIdentity = pageIdentity && options.includeStructuredDataIdentity !== false;
  const includeTechnologyProfile = pageIdentity && options.includeTechnologyProfile !== false;
  const includeDerivedPageProfiles = Boolean(pageIdentity);
  const pageIdentityOutput: (NonNullable<typeof pageIdentity> & {
    publicationMetadata?: ReturnType<typeof buildPagePublicationMetadata>;
  }) | null = pageIdentity && htmlAnalysis && options.includePublicationMetadata !== false
    ? {
        ...pageIdentity,
        publicationMetadata: buildPagePublicationMetadata(
          htmlAnalysis.publicationMetadata,
          options.sourceTruncated === true,
        ),
      }
    : pageIdentity;
  const pageLanguageSignal = detectPageLanguageSignal(html, pageIdentity?.documentLanguage, htmlAnalysis);
  const domainSaleSignal = options.sourceTruncated !== true && domainSaleLandingPage(htmlAnalysis, domain)
    ? 'explicit domain-sale landing-page content' : null;
  return {
    domainSaleSignal,
    pageTitle: htmlAnalysis.title,
    hasPasswordField: htmlAnalysis.forms.categories.password > 0,
    phishingLanguageMatch: pageLanguageSignal?.label ?? null,
    hasExternalFormAction: pageIdentity
      ? pageIdentity.forms.externalActionOrigins.length > 0
      : null,
    externalAssetHosts: extractExternalAssetHosts(htmlAnalysis, domain, documentUrl),
    cspMetaPolicy: analyzeCspMetaPolicies(htmlAnalysis.cspMetaPolicies, htmlAnalysis.cspMetaLimitReached),
    pageIdentity: pageIdentityOutput,
    credentialSurfaceProfile: includeCredentialSurfaceProfile && htmlAnalysis ? analyzeCredentialSurfaceProfile({
      htmlAnalysis,
      observedAt: options.observedAt,
      sourceTruncated: options.sourceTruncated,
    }) : null,
    structuredDataIdentity: includeStructuredDataIdentity && htmlAnalysis ? analyzeStructuredDataIdentity({
      htmlAnalysis,
      baseUrl: effectiveBaseUrl,
      observedAt: options.observedAt,
      sourceTruncated: options.sourceTruncated,
    }) : null,
    technologyProfile: includeTechnologyProfile && htmlAnalysis ? analyzeWebsiteTechnology({
      htmlAnalysis,
      generator: pageIdentity.generator,
      httpServer: options.httpServer,
      responseHeaders: options.responseHeaders,
      resourceOrigins: pageIdentity.resources.externalOrigins,
      effectiveBaseUrl,
      documentOrigin,
      observedAt: options.observedAt,
      sourceTruncated: options.sourceTruncated,
    }) : null,
    pageRoleProfile: includeDerivedPageProfiles && htmlAnalysis ? analyzePageRole({
      htmlAnalysis,
      pageTitle: htmlAnalysis.title,
      activityStatus: domainSaleSignal ? 'parked' : options.activityStatus,
      observedAt: options.observedAt,
      sourceTruncated: options.sourceTruncated,
    }) : null,
    clientBehaviorProfile: includeDerivedPageProfiles && htmlAnalysis ? analyzeClientBehavior({
      htmlAnalysis,
      observedAt: options.observedAt,
      sourceTruncated: options.sourceTruncated,
    }) : null,
  };
}

export {
  PAGE_IDENTITY_VERSION,
  PAGE_PUBLICATION_METADATA_VERSION,
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
};
