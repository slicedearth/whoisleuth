// One bounded native HTML parse over the already-captured homepage body.
// Consumers share element/attribute evidence instead of reparsing reconstructed
// markup. Only bounded transient projections leave this module, never a DOM.
import {
  htmlTreeEvents, isHtmlElement, parseBoundedHtml,
  MAX_STATIC_HTML_CHARS, MAX_STATIC_HTML_TAGS, MAX_STATIC_HTML_TREE_EVENTS,
} from './bounded-html-document.mts';

import {
  MAX_CSP_META_POLICIES,
  MAX_RESPONSE_POLICY_HEADER_BYTES,
} from './response-policy.mts';
import { MAX_FAVICON_BYTES, MAX_FAVICON_CANDIDATES } from './outbound-request-bounds.mts';
import {
  MAX_PAGE_PUBLICATION_DECLARATIONS,
  MAX_PAGE_PUBLICATION_META_ELEMENTS,
  MAX_PAGE_PUBLICATION_ROBOTS_DIRECTIVES,
} from './homepage-metadata-contract.mts';

type StaticScript = {
  reference: string | null;
  inlineContent: string;
  mediaType: string | null;
};

type StaticCspMetaPolicy = {
  content: string;
  beforeScript: boolean;
};

type StaticCredentialCategory = 'password' | 'email' | 'username' | 'one_time_code' | 'payment';
type StaticFormMethod = 'missing' | 'get' | 'post' | 'dialog' | 'other';
type StaticFormAnalysis = {
  formsObserved: number;
  inputsObserved: number;
  classifiedInputs: number;
  categories: Record<StaticCredentialCategory, number>;
  methods: Record<StaticFormMethod, number>;
  actions: {
    sameOrigin: number;
    external: number;
    missing: number;
    cleartext: number;
    unclassified: number;
  };
  truncated: boolean;
};

type StaticPublicationMetadata = {
  truncated: boolean;
  documentTruncated: boolean;
  robots: {
    observed: boolean;
    malformed: boolean;
    truncated: boolean;
    directives: string[];
    recognizedDirectiveCount: number;
    unknownDirectiveCount: number;
    conflicting: boolean;
  };
  twitterCard: {
    observed: boolean;
    malformed: boolean;
    truncated: boolean;
    cardTypes: string[];
    declarationCount: number;
    titlePresent: boolean;
    descriptionPresent: boolean;
    imagePresent: boolean;
    imageAltPresent: boolean;
    sitePresent: boolean;
    creatorPresent: boolean;
    playerPresent: boolean;
    appPresent: boolean;
  };
  headings: { truncated: boolean; total: number; h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
  images: {
    totalComplete: boolean;
    classificationComplete: boolean;
    truncated: boolean;
    total: number;
    altMissing: number;
    altEmpty: number;
    altNonEmpty: number;
    altUnclassified: number;
  };
  renderBlockingCandidates: { truncated: boolean; script: number; stylesheet: number; total: number };
};

type StaticHtmlAnalysis = {
  title: string | null;
  effectiveBaseUrl: string | null;
  baseHrefState: 'absent' | 'valid' | 'invalid';
  elements: StaticHtmlElement[];
  iconLinks: Array<{ href: string; priority: number }>;
  tokens: StaticHtmlToken[];
  visibleText: string;
  structureTokens: string[];
  scripts: StaticScript[];
  cspMetaPolicies: StaticCspMetaPolicy[];
  cspMetaLimitReached: boolean;
  forms: StaticFormAnalysis;
  publicationMetadata: StaticPublicationMetadata;
  inputLimitReached: boolean;
  tagLimitReached: boolean;
  structureLimitReached: boolean;
  scriptLimitReached: boolean;
  inlineLimitReached: boolean;
  visibleTextLimitReached: boolean;
  tagsExamined: number;
  inlineCharactersExamined: number;
};

type StaticHtmlElement = {
  name: string;
  html: boolean;
  attributes: Array<{ name: string; value: string }>;
  attributesTruncated: boolean;
  parent: number | null;
  inHead: boolean;
};
type StaticHtmlToken =
  | { kind: 'start'; element: StaticHtmlElement }
  | { kind: 'end'; name: string }
  | { kind: 'text'; value: string };

const MAX_STATIC_STRUCTURE_TOKENS = MAX_STATIC_HTML_TREE_EVENTS;
const MAX_TAG_LENGTH = 4_096;
const MAX_ATTRIBUTES_PER_TAG = 128;
const MAX_SCRIPT_ELEMENTS = 64;
const MAX_SCRIPT_REFERENCE_LENGTH = 2_048;
const MAX_SCRIPT_MEDIA_TYPE_LENGTH = 120;
const MAX_INLINE_SCRIPT_TOTAL_CHARS = 65_536;
const MAX_INLINE_SCRIPT_CHARS = MAX_INLINE_SCRIPT_TOTAL_CHARS;
const MAX_STATIC_VISIBLE_TEXT_CHARS = MAX_STATIC_HTML_CHARS;
const MAX_STATIC_FORMS = 50;
const MAX_STATIC_INPUTS = 500;
const MAX_STATIC_PUBLICATION_META_ELEMENTS = MAX_PAGE_PUBLICATION_META_ELEMENTS;
const MAX_STATIC_PUBLICATION_DECLARATIONS = MAX_PAGE_PUBLICATION_DECLARATIONS;
const MAX_STATIC_ROBOTS_DIRECTIVES = MAX_PAGE_PUBLICATION_ROBOTS_DIRECTIVES;
const MAX_FORM_ATTRIBUTE_LENGTH = 2_048;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;
const CONTROL_CHARACTER_RE_GLOBAL = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu;
const PAYMENT_AUTOCOMPLETE_TOKENS = new Set([
  'cc-name',
  'cc-given-name',
  'cc-additional-name',
  'cc-family-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-type',
  'transaction-currency',
  'transaction-amount',
]);
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const NON_VISIBLE_TEXT_TAGS = new Set(['head', 'script', 'style', 'template', 'noscript', 'iframe', 'noembed', 'noframes']);
const ROBOTS_DIRECTIVES = new Set([
  'all', 'follow', 'index', 'max-image-preview', 'max-snippet', 'max-video-preview',
  'noarchive', 'nocache', 'nofollow', 'noimageindex', 'noindex', 'none', 'nositelinkssearchbox',
  'nosnippet', 'notranslate', 'unavailable_after',
]);
const JAVASCRIPT_MEDIA_TYPES = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript',
  'application/x-javascript', 'text/ecmascript', 'text/javascript', 'text/javascript1.0',
  'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4',
  'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
]);

type StaticHtmlAnalysisOptions = {
  baseUrl?: unknown;
  includeVisibleText?: boolean;
};

function attributeValue(
  attributes: Array<{ name: string; value: string }>,
  name: string,
  maximumLength = MAX_FORM_ATTRIBUTE_LENGTH,
  lowercase = true,
): { present: boolean; value: string | null; truncated: boolean } {
  const attribute = attributes
    .slice(0, MAX_ATTRIBUTES_PER_TAG)
    .find((candidate) => candidate.name.toLowerCase() === name);
  if (!attribute) return { present: false, value: null, truncated: attributes.length > MAX_ATTRIBUTES_PER_TAG };
  if (attribute.value.length > maximumLength || CONTROL_CHARACTER_RE.test(attribute.value)) {
    return { present: true, value: null, truncated: true };
  }
  return {
    present: true,
    value: lowercase ? attribute.value.trim().toLowerCase() : attribute.value.trim(),
    truncated: attributes.length > MAX_ATTRIBUTES_PER_TAG,
  };
}

function safeBaseUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > MAX_FORM_ATTRIBUTE_LENGTH || CONTROL_CHARACTER_RE.test(value)) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.hostname
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function formMethod(attributes: Array<{ name: string; value: string }>): { value: StaticFormMethod; truncated: boolean } {
  const method = attributeValue(attributes, 'method', 24);
  if (!method.present && method.truncated) return { value: 'other', truncated: true };
  if (!method.present || method.value === '') return { value: 'missing', truncated: method.truncated };
  if (method.value === null) return { value: 'other', truncated: true };
  return {
    value: ['get', 'post', 'dialog'].includes(method.value)
      ? method.value as StaticFormMethod
      : 'other',
    truncated: method.truncated,
  };
}

function formAction(
  attributes: Array<{ name: string; value: string }>,
  resolutionBase: URL | null,
  documentOrigin: string | null,
): {
  relationship: 'sameOrigin' | 'external' | 'missing' | 'unclassified';
  cleartext: boolean;
  truncated: boolean;
} {
  const action = attributeValue(attributes, 'action', MAX_FORM_ATTRIBUTE_LENGTH, false);
  if (!action.present && action.truncated) {
    return { relationship: 'unclassified', cleartext: false, truncated: true };
  }
  if (!action.present || action.value === '') {
    return { relationship: 'missing', cleartext: false, truncated: action.truncated };
  }
  if (action.value === null) {
    return { relationship: 'unclassified', cleartext: false, truncated: true };
  }
  if (!resolutionBase || !documentOrigin) {
    return { relationship: 'unclassified', cleartext: false, truncated: action.truncated };
  }
  try {
    const parsed = new URL(action.value, resolutionBase);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
      return { relationship: 'unclassified', cleartext: false, truncated: action.truncated };
    }
    return {
      relationship: parsed.origin === documentOrigin ? 'sameOrigin' : 'external',
      cleartext: parsed.protocol === 'http:',
      truncated: action.truncated,
    };
  } catch {
    return { relationship: 'unclassified', cleartext: false, truncated: action.truncated };
  }
}

function inputCategories(
  attributes: Array<{ name: string; value: string }>,
): { values: StaticCredentialCategory[]; truncated: boolean } {
  if (attributes.length > MAX_ATTRIBUTES_PER_TAG) return { values: [], truncated: true };
  const type = attributeValue(attributes, 'type', 40);
  const autocomplete = attributeValue(attributes, 'autocomplete', 160);
  const disabled = attributeValue(attributes, 'disabled', 10).present;
  const truncated = type.truncated || autocomplete.truncated;
  if (disabled || type.value === 'hidden') return { values: [], truncated };

  const normalizedType = type.value || 'text';
  const autocompleteTokens = (autocomplete.value || '').split(/\s+/u).filter(Boolean).slice(0, 16);
  const categories = new Set<StaticCredentialCategory>();
  if (normalizedType === 'password' || autocompleteTokens.some((token) => ['current-password', 'new-password'].includes(token))) {
    categories.add('password');
  }
  if (normalizedType === 'email' || autocompleteTokens.includes('email')) categories.add('email');
  if (autocompleteTokens.includes('username')) categories.add('username');
  if (autocompleteTokens.includes('one-time-code')) categories.add('one_time_code');
  if (autocompleteTokens.some((token) => PAYMENT_AUTOCOMPLETE_TOKENS.has(token))) categories.add('payment');
  return { values: [...categories], truncated };
}

function scriptReference(attributes: Array<{ name: string; value: string }>): string | null {
  for (const attribute of attributes.slice(0, MAX_ATTRIBUTES_PER_TAG)) {
    if (attribute.name.toLowerCase() !== 'src') continue;
    if (
      attribute.value.length === 0
      || attribute.value.length > MAX_SCRIPT_REFERENCE_LENGTH
      || CONTROL_CHARACTER_RE.test(attribute.value)
    ) return null;
    return attribute.value;
  }
  return null;
}

function scriptMediaType(attributes: Array<{ name: string; value: string }>): string | null {
  for (const attribute of attributes.slice(0, MAX_ATTRIBUTES_PER_TAG)) {
    if (attribute.name.toLowerCase() !== 'type') continue;
    if (
      attribute.value.length === 0
      || attribute.value.length > MAX_SCRIPT_MEDIA_TYPE_LENGTH
      || CONTROL_CHARACTER_RE.test(attribute.value)
    ) return null;
    return attribute.value.trim().toLowerCase().split(';', 1)[0] || null;
  }
  return null;
}

function classicScriptCandidate(attributes: Array<{ name: string; value: string }>): { candidate: boolean; truncated: boolean } {
  const type = attributeValue(attributes, 'type', MAX_SCRIPT_MEDIA_TYPE_LENGTH);
  const asyncAttribute = attributeValue(attributes, 'async', 10);
  const deferAttribute = attributeValue(attributes, 'defer', 10);
  const truncated = type.truncated || asyncAttribute.truncated || deferAttribute.truncated;
  if (asyncAttribute.present || deferAttribute.present || type.value === 'module') return { candidate: false, truncated };
  return {
    candidate: !type.present || type.value === '' || Boolean(type.value && JAVASCRIPT_MEDIA_TYPES.has(type.value)),
    truncated,
  };
}

function stylesheetCandidate(attributes: Array<{ name: string; value: string }>): { candidate: boolean; truncated: boolean } {
  const rel = attributeValue(attributes, 'rel', 320);
  const href = attributeValue(attributes, 'href', MAX_SCRIPT_REFERENCE_LENGTH);
  const disabled = attributeValue(attributes, 'disabled', 10);
  const media = attributeValue(attributes, 'media', 120);
  return {
    candidate: rel.value?.split(/\s+/u).includes('stylesheet') === true
      && href.present && Boolean(href.value) && !disabled.present
      && (!media.present || media.value === '' || media.value === 'all' || media.value === 'screen'),
    truncated: rel.truncated || href.truncated || disabled.truncated || media.truncated,
  };
}

function analyzeStaticHtml(value: unknown, options: StaticHtmlAnalysisOptions = {}): StaticHtmlAnalysis {
  const parsed = parseBoundedHtml(value);
  const { inputLimitReached } = parsed;
  const documentUrl = safeBaseUrl(options.baseUrl);
  let effectiveBaseUrl = documentUrl;
  let baseHrefState: StaticHtmlAnalysis['baseHrefState'] = 'absent';
  const includeVisibleText = options.includeVisibleText === true;
  const elements: StaticHtmlElement[] = [];
  const iconLinks: StaticHtmlAnalysis['iconLinks'] = [];
  const iconCounts: [number, number] = [0, 0];
  const tokens: StaticHtmlToken[] = [];
  const elementStack: number[] = [];
  const visibleTextParts: string[] = [];
  const structureTokens: string[] = [];
  const scripts: StaticScript[] = [];
  const cspMetaPolicies: StaticCspMetaPolicy[] = [];
  const forms: StaticFormAnalysis = {
    formsObserved: 0,
    inputsObserved: 0,
    classifiedInputs: 0,
    categories: { password: 0, email: 0, username: 0, one_time_code: 0, payment: 0 },
    methods: { missing: 0, get: 0, post: 0, dialog: 0, other: 0 },
    actions: { sameOrigin: 0, external: 0, missing: 0, cleartext: 0, unclassified: 0 },
    truncated: false,
  };
  const publicationMetadata: StaticPublicationMetadata = {
    truncated: false,
    documentTruncated: false,
    robots: {
      observed: false,
      malformed: false,
      truncated: false,
      directives: [],
      recognizedDirectiveCount: 0,
      unknownDirectiveCount: 0,
      conflicting: false,
    },
    twitterCard: {
      observed: false,
      malformed: false,
      truncated: false,
      cardTypes: [],
      declarationCount: 0,
      titlePresent: false,
      descriptionPresent: false,
      imagePresent: false,
      imageAltPresent: false,
      sitePresent: false,
      creatorPresent: false,
      playerPresent: false,
      appPresent: false,
    },
    headings: { truncated: false, total: 0, h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    images: {
      totalComplete: true,
      classificationComplete: true,
      truncated: false,
      total: 0,
      altMissing: 0,
      altEmpty: 0,
      altNonEmpty: 0,
      altUnclassified: 0,
    },
    renderBlockingCandidates: { truncated: false, script: 0, stylesheet: 0, total: 0 },
  };
  const robotDirectives = new Set<string>();
  const twitterCardTypes = new Set<string>();
  let activeInlineScript: StaticScript | null = null;
  let tagsExamined = 0;
  let inlineCharactersExamined = 0;
  let tagLimitReached = parsed.constructionLimitReached;
  let structureLimitReached = false;
  let scriptLimitReached = false;
  let inlineLimitReached = false;
  let visibleTextLimitReached = false;
  let cspMetaLimitReached = false;
  let publicationMetaElements = 0;
  let robotDirectiveTokens = 0;
  let publicationTagLimitReached = parsed.constructionLimitReached;
  let insideExplicitHead = false;
  let insideHead = false;
  let scriptElementSeen = false;
  let nonVisibleTextDepth = 0;
  let visibleTextCharacters = 0;
  let titleDepth = 0;
  let titleCharacters = 0;
  const titleParts: string[] = [];
  const pendingFormActions: Array<Array<{ name: string; value: string }>> = [];

  function appendTitle(chars: string): void {
    if (titleDepth === 0 || !chars || titleCharacters >= 201) return;
    const retained = chars.slice(0, 201 - titleCharacters);
    titleParts.push(retained);
    titleCharacters += retained.length;
  }

  function appendInlineScript(chars: string): void {
    if (!activeInlineScript || !chars) return;
    const totalRemaining = MAX_INLINE_SCRIPT_TOTAL_CHARS - inlineCharactersExamined;
    const retainedLength = Math.max(0, Math.min(chars.length, totalRemaining));
    if (retainedLength > 0) {
      activeInlineScript.inlineContent += chars.slice(0, retainedLength);
      inlineCharactersExamined += retainedLength;
    }
    if (retainedLength < chars.length) inlineLimitReached = true;
  }

  function appendStructureToken(value: string): void {
    if (structureTokens.length >= MAX_STATIC_STRUCTURE_TOKENS) {
      structureLimitReached = true;
      return;
    }
    structureTokens.push(value);
  }

  function appendVisibleText(chars: string): void {
    if (!includeVisibleText || nonVisibleTextDepth > 0 || !chars) return;
    const remaining = MAX_STATIC_VISIBLE_TEXT_CHARS - visibleTextCharacters;
    const retainedLength = Math.max(0, Math.min(chars.length, remaining));
    if (retainedLength > 0) {
      visibleTextParts.push(chars.slice(0, retainedLength));
      visibleTextCharacters += retainedLength;
    }
    if (retainedLength < chars.length) visibleTextLimitReached = true;
  }

  function appendToken(token: StaticHtmlToken): void {
    if (tokens.length >= MAX_STATIC_STRUCTURE_TOKENS) structureLimitReached = true;
    else tokens.push(token);
  }

  for (const event of htmlTreeEvents(parsed.document)) {
    if (event.kind === 'text') {
      appendInlineScript(event.text);
      appendTitle(event.text);
      appendVisibleText(event.text);
      if (nonVisibleTextDepth === 0) appendToken({ kind: 'text', value: event.text });
      continue;
    }
    const node = event.element;
    const tagName = node.tagName.toLowerCase();
    const htmlElement = isHtmlElement(node);
    if (event.kind === 'end') {
      elementStack.pop();
      if (tagName === 'script') activeInlineScript = null;
      if (htmlElement && tagName === 'title') titleDepth = 0;
      if (htmlElement && tagName === 'head') { insideHead = false; insideExplicitHead = false; }
      if (!htmlElement || !VOID_TAGS.has(tagName)) {
        appendStructureToken(`/${tagName}`);
        appendToken({ kind: 'end', name: tagName });
      }
      if (NON_VISIBLE_TEXT_TAGS.has(tagName)) nonVisibleTextDepth -= 1;
      continue;
    }
    {
      const token = { attrs: node.attrs };
      if (NON_VISIBLE_TEXT_TAGS.has(tagName)) nonVisibleTextDepth += 1;
      if (node.sourceCodeLocation?.startTag) tagsExamined += 1;
      appendStructureToken(htmlElement && VOID_TAGS.has(tagName) ? `${tagName}/` : tagName);
      if (htmlElement && tagName === 'head') {
        insideHead = true;
        insideExplicitHead = Boolean(node.sourceCodeLocation?.startTag);
      }
      const inPublicationHead = insideHead;
      const attributes: StaticHtmlElement['attributes'] = [];
      let attributeLength = 0;
      for (const attribute of node.attrs) {
        attributeLength += attribute.name.length + attribute.value.length;
        if (attributes.length >= MAX_ATTRIBUTES_PER_TAG || attributeLength > MAX_TAG_LENGTH) break;
        attributes.push({ name: attribute.name, value: attribute.value });
      }
      const element: StaticHtmlElement = {
        name: tagName, html: htmlElement, attributes,
        attributesTruncated: attributes.length !== node.attrs.length,
        parent: elementStack.at(-1) ?? null, inHead: insideHead,
      };
      elementStack.push(elements.length);
      elements.push(element);
      appendToken({ kind: 'start', element });
      // Foreign drawing attributes are not HTML technology, form or resource
      // inputs. Their per-element omission still reaches fingerprinting, but
      // must not make unrelated HTML evidence incomplete.
      if (htmlElement && element.attributesTruncated) tagLimitReached = true;
      if (!htmlElement) continue;
      if (tagName === 'link') {
        const rel = node.attrs.find((attribute) => attribute.name === 'rel')?.value;
        const href = node.attrs.find((attribute) => attribute.name === 'href')?.value.trim();
        if (rel && rel.length <= 128 && href) {
          const relations = rel.toLowerCase().split(/[\t\n\f\r ]+/u);
          const priority = relations.includes('icon') ? 0
            : relations.some((relation) => ['apple-touch-icon', 'apple-touch-icon-precomposed'].includes(relation)) ? 1 : null;
          // Inline image bytes have their own bound; the general 4 KiB
          // attribute projection must not silently discard supported icons.
          const maxHref = /^data:/iu.test(href) ? MAX_FAVICON_BYTES * 3 + 128 : 2048;
          if (priority !== null && iconCounts[priority] < MAX_FAVICON_CANDIDATES && href.length <= maxHref) {
            iconLinks.push({ href, priority });
            iconCounts[priority] += 1;
          }
        }
      }
      // The first document base applies even when it appears in the body;
      // publication metadata's separate head-only policy does not govern URLs.
      if (tagName === 'base' && baseHrefState === 'absent') {
        const href = attributeValue(token.attrs, 'href', MAX_FORM_ATTRIBUTE_LENGTH, false);
        if (href.truncated && !href.present) {
          effectiveBaseUrl = documentUrl;
          baseHrefState = 'invalid';
        } else if (href.present) {
          try {
            const parsed = href.value !== null && documentUrl ? new URL(href.value, documentUrl) : null;
            if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
              throw new Error('Invalid document base URL.');
            }
            effectiveBaseUrl = parsed;
            baseHrefState = 'valid';
          } catch {
            effectiveBaseUrl = documentUrl;
            baseHrefState = 'invalid';
          }
        }
      }
      if (tagName === 'title' && titleParts.length === 0) titleDepth = 1;
      if (/^h[1-6]$/u.test(tagName)) {
        const key = tagName as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        publicationMetadata.headings[key] += 1;
        publicationMetadata.headings.total += 1;
      }
      if (tagName === 'img') {
        publicationMetadata.images.total += 1;
        const alt = attributeValue(token.attrs, 'alt', MAX_FORM_ATTRIBUTE_LENGTH);
        if (alt.truncated) {
          publicationMetadata.truncated = true;
          publicationMetadata.images.classificationComplete = false;
          publicationMetadata.images.truncated = true;
        }
        if (alt.truncated && (!alt.present || alt.value === null)) publicationMetadata.images.altUnclassified += 1;
        else if (!alt.present) publicationMetadata.images.altMissing += 1;
        else if (alt.value === '') publicationMetadata.images.altEmpty += 1;
        else if (alt.value !== null) publicationMetadata.images.altNonEmpty += 1;
      }

      if (insideExplicitHead && tagName === 'script') {
        const candidate = classicScriptCandidate(token.attrs);
        if (candidate.truncated) {
          publicationMetadata.truncated = true;
          publicationMetadata.renderBlockingCandidates.truncated = true;
        }
        if (candidate.candidate) publicationMetadata.renderBlockingCandidates.script += 1;
      } else if (insideExplicitHead && tagName === 'link') {
        const candidate = stylesheetCandidate(token.attrs);
        if (candidate.truncated) {
          publicationMetadata.truncated = true;
          publicationMetadata.renderBlockingCandidates.truncated = true;
        }
        if (candidate.candidate) publicationMetadata.renderBlockingCandidates.stylesheet += 1;
      }

      if (tagName === 'meta' && insideHead) {
        const httpEquiv = attributeValue(token.attrs, 'http-equiv', 64);
        if (httpEquiv.value === 'content-security-policy') {
          const content = attributeValue(token.attrs, 'content', MAX_RESPONSE_POLICY_HEADER_BYTES, false);
          if (content.value === null || !content.value) {
            cspMetaLimitReached = cspMetaLimitReached || content.present || content.truncated;
          } else if (cspMetaPolicies.length >= MAX_CSP_META_POLICIES) {
            cspMetaLimitReached = true;
          } else {
            cspMetaPolicies.push({ content: content.value, beforeScript: !scriptElementSeen });
          }
        }
      }

      if (tagName === 'meta' && inPublicationHead) {
        const name = attributeValue(token.attrs, 'name', 120);
        const property = attributeValue(token.attrs, 'property', 120);
        const suppliedKeys = [name.value, property.value].filter((value): value is string => Boolean(value));
        const key = suppliedKeys[0] || null;
        const conflictingKeys = suppliedKeys.length > 1 && new Set(suppliedKeys).size > 1;
        if (name.truncated || property.truncated) {
          publicationMetadata.truncated = true;
          // An over-bound or control-bearing key can hide which declaration
          // family it belongs to. Mark both bounded declaration families
          // partial instead of emitting a root state its children contradict.
          publicationMetadata.robots.truncated = true;
          publicationMetadata.twitterCard.truncated = true;
        }
        const publicationKey = suppliedKeys.some((value) => value === 'robots' || value.startsWith('twitter:'));
        const processPublication = publicationKey
          && publicationMetaElements < MAX_STATIC_PUBLICATION_META_ELEMENTS;
        if (publicationKey && !processPublication) {
          publicationMetadata.truncated = true;
          if (suppliedKeys.includes('robots')) publicationMetadata.robots.truncated = true;
          if (suppliedKeys.some((value) => value.startsWith('twitter:'))) publicationMetadata.twitterCard.truncated = true;
        } else if (processPublication) {
          publicationMetaElements += 1;
        }
        if (processPublication && conflictingKeys) {
          if (suppliedKeys.includes('robots')) {
            publicationMetadata.robots.observed = true;
            publicationMetadata.robots.malformed = true;
          }
          if (suppliedKeys.some((value) => value.startsWith('twitter:'))) {
            publicationMetadata.twitterCard.observed = true;
            publicationMetadata.twitterCard.malformed = true;
          }
        } else if (processPublication && key === 'robots') {
          publicationMetadata.robots.observed = true;
          const content = attributeValue(token.attrs, 'content', 1_024);
          if (content.value === null || content.truncated) {
            publicationMetadata.robots.malformed = true;
            publicationMetadata.truncated = publicationMetadata.truncated || content.truncated;
            publicationMetadata.robots.truncated = publicationMetadata.robots.truncated || content.truncated;
          } else {
            for (const suppliedDirective of content.value.split(/[,\t\n\f\r ]+/u)) {
              if (robotDirectiveTokens >= MAX_STATIC_ROBOTS_DIRECTIVES) {
                publicationMetadata.truncated = true;
                publicationMetadata.robots.truncated = true;
                break;
              }
              robotDirectiveTokens += 1;
              const directive = suppliedDirective.trim();
              if (!directive) {
                publicationMetadata.robots.malformed = true;
                continue;
              }
              const directiveName = directive.split(':', 1)[0]!.trim().replace(/\s+/gu, '_');
              if (ROBOTS_DIRECTIVES.has(directiveName)) {
                publicationMetadata.robots.recognizedDirectiveCount += 1;
                robotDirectives.add(directiveName);
              } else {
                publicationMetadata.robots.unknownDirectiveCount += 1;
              }
            }
          }
        } else if (processPublication && key?.startsWith('twitter:')) {
          const category = key === 'twitter:card' ? 'card'
            : key === 'twitter:title' ? 'title'
              : key === 'twitter:description' ? 'description'
                : key === 'twitter:image:alt' ? 'imageAlt'
                  : key === 'twitter:image' || key.startsWith('twitter:image:') ? 'image'
                    : key === 'twitter:site' || key.startsWith('twitter:site:') ? 'site'
                      : key === 'twitter:creator' || key.startsWith('twitter:creator:') ? 'creator'
                        : key === 'twitter:player' || key.startsWith('twitter:player:') ? 'player'
                          : key === 'twitter:app' || key.startsWith('twitter:app:') ? 'app'
                            : null;
          if (category) {
            publicationMetadata.twitterCard.observed = true;
            if (publicationMetadata.twitterCard.declarationCount >= MAX_STATIC_PUBLICATION_DECLARATIONS) {
              publicationMetadata.truncated = true;
              publicationMetadata.twitterCard.truncated = true;
            } else {
              publicationMetadata.twitterCard.declarationCount += 1;
              const content = attributeValue(token.attrs, 'content', 1_024);
              if (content.value === null || content.truncated || !content.value) {
                publicationMetadata.twitterCard.malformed = true;
                publicationMetadata.truncated = publicationMetadata.truncated || content.truncated;
                publicationMetadata.twitterCard.truncated = publicationMetadata.twitterCard.truncated || content.truncated;
              } else if (category === 'card') {
                twitterCardTypes.add(
                  ['summary', 'summary_large_image', 'player', 'app'].includes(content.value)
                    ? content.value
                    : 'other',
                );
              } else if (category === 'title') publicationMetadata.twitterCard.titlePresent = true;
              else if (category === 'description') publicationMetadata.twitterCard.descriptionPresent = true;
              else if (category === 'image') publicationMetadata.twitterCard.imagePresent = true;
              else if (category === 'imageAlt') publicationMetadata.twitterCard.imageAltPresent = true;
              else if (category === 'site') publicationMetadata.twitterCard.sitePresent = true;
              else if (category === 'creator') publicationMetadata.twitterCard.creatorPresent = true;
              else if (category === 'player') publicationMetadata.twitterCard.playerPresent = true;
              else if (category === 'app') publicationMetadata.twitterCard.appPresent = true;
            }
          }
        }
      }

      if (tagName === 'form') {
        if (forms.formsObserved >= MAX_STATIC_FORMS) {
          forms.truncated = true;
        } else {
          forms.formsObserved += 1;
          const method = formMethod(token.attrs);
          forms.methods[method.value] += 1;
          pendingFormActions.push(token.attrs);
          if (method.truncated || token.attrs.length > MAX_ATTRIBUTES_PER_TAG) forms.truncated = true;
        }
      } else if (tagName === 'input') {
        if (forms.inputsObserved >= MAX_STATIC_INPUTS) {
          forms.truncated = true;
        } else {
          forms.inputsObserved += 1;
          const categories = inputCategories(token.attrs);
          if (categories.truncated) forms.truncated = true;
          if (categories.values.length) forms.classifiedInputs += 1;
          for (const category of categories.values) forms.categories[category] += 1;
        }
      }

      if (tagName !== 'script') {
        activeInlineScript = null;
        continue;
      }
      scriptElementSeen = true;
      if (scripts.length >= MAX_SCRIPT_ELEMENTS) {
        scriptLimitReached = true;
        activeInlineScript = null;
        continue;
      }
      const reference = scriptReference(token.attrs);
      const script = {
        reference,
        inlineContent: '',
        mediaType: scriptMediaType(token.attrs),
      };
      scripts.push(script);
      activeInlineScript = reference ? null : script;
    }
  }

  for (const attributes of pendingFormActions) {
    const action = formAction(attributes, effectiveBaseUrl, documentUrl?.origin ?? null);
    forms.actions[action.relationship] += 1;
    if (action.cleartext) forms.actions.cleartext += 1;
    if (action.truncated) forms.truncated = true;
  }
  if ((baseHrefState as StaticHtmlAnalysis['baseHrefState']) === 'invalid') forms.truncated = true;

  publicationMetadata.truncated = publicationMetadata.truncated || inputLimitReached || publicationTagLimitReached;
  publicationMetadata.documentTruncated = inputLimitReached || publicationTagLimitReached;
  if (publicationMetadata.documentTruncated) {
    publicationMetadata.robots.truncated = true;
    publicationMetadata.twitterCard.truncated = true;
    publicationMetadata.headings.truncated = true;
    publicationMetadata.images.totalComplete = false;
    publicationMetadata.images.classificationComplete = false;
    publicationMetadata.images.truncated = true;
    publicationMetadata.renderBlockingCandidates.truncated = true;
  }
  publicationMetadata.robots.directives = [...robotDirectives].sort();
  publicationMetadata.robots.conflicting = (
    (robotDirectives.has('index') || robotDirectives.has('all'))
      && (robotDirectives.has('noindex') || robotDirectives.has('none'))
  ) || (
    (robotDirectives.has('follow') || robotDirectives.has('all'))
      && (robotDirectives.has('nofollow') || robotDirectives.has('none'))
  );
  publicationMetadata.twitterCard.cardTypes = [...twitterCardTypes].sort().slice(0, 8);
  if (twitterCardTypes.size > 8) publicationMetadata.truncated = true;
  publicationMetadata.renderBlockingCandidates.total = publicationMetadata.renderBlockingCandidates.script
    + publicationMetadata.renderBlockingCandidates.stylesheet;

  return {
    title: (() => {
      const value = titleParts.join('').replace(CONTROL_CHARACTER_RE_GLOBAL, ' ').replace(/\ufffd/gu, ' ').replace(/\s+/gu, ' ').trim();
      if (!value) return null;
      return value.length > 200 ? `${value.slice(0, 199)}…` : value;
    })(),
    effectiveBaseUrl: effectiveBaseUrl?.toString() ?? null,
    baseHrefState,
    elements,
    iconLinks: iconLinks.sort((left, right) => left.priority - right.priority).slice(0, MAX_FAVICON_CANDIDATES),
    tokens,
    visibleText: visibleTextParts.join('').replace(CONTROL_CHARACTER_RE_GLOBAL, ' ').replace(/\s+/gu, ' '),
    structureTokens,
    scripts,
    cspMetaPolicies,
    cspMetaLimitReached,
    forms,
    publicationMetadata,
    inputLimitReached,
    tagLimitReached,
    structureLimitReached,
    scriptLimitReached,
    inlineLimitReached,
    visibleTextLimitReached,
    tagsExamined,
    inlineCharactersExamined,
  };
}

export {
  MAX_ATTRIBUTES_PER_TAG,
  MAX_INLINE_SCRIPT_CHARS,
  MAX_INLINE_SCRIPT_TOTAL_CHARS,
  MAX_SCRIPT_ELEMENTS,
  MAX_SCRIPT_MEDIA_TYPE_LENGTH,
  MAX_STATIC_FORMS,
  MAX_STATIC_HTML_CHARS,
  MAX_STATIC_INPUTS,
  MAX_STATIC_PUBLICATION_META_ELEMENTS,
  MAX_STATIC_PUBLICATION_DECLARATIONS,
  MAX_STATIC_ROBOTS_DIRECTIVES,
  MAX_STATIC_HTML_TAGS,
  MAX_STATIC_STRUCTURE_TOKENS,
  MAX_STATIC_VISIBLE_TEXT_CHARS,
  MAX_TAG_LENGTH,
  analyzeStaticHtml,
};

export type {
  StaticCredentialCategory,
  StaticCspMetaPolicy,
  StaticFormAnalysis,
  StaticFormMethod,
  StaticHtmlAnalysis,
  StaticHtmlElement,
  StaticHtmlToken,
  StaticHtmlAnalysisOptions,
  StaticPublicationMetadata,
  StaticScript,
};
