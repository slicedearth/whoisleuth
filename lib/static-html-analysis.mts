// One bounded tokenization pass over the already-captured homepage body. The
// parse5 tokenizer applies HTML tokenization rules without constructing a DOM,
// so deeply nested hostile markup cannot create an unbounded element tree.
// Only normalized start-tag markup and capped script indicators are retained.

import { Tokenizer, TokenizerMode, type TokenHandler } from 'parse5';

import {
  MAX_CSP_META_POLICIES,
  MAX_RESPONSE_POLICY_HEADER_BYTES,
} from './response-policy.mts';

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

type StaticHtmlAnalysis = {
  markup: string;
  visibleText: string;
  structureTokens: string[];
  scripts: StaticScript[];
  cspMetaPolicies: StaticCspMetaPolicy[];
  cspMetaLimitReached: boolean;
  forms: StaticFormAnalysis;
  inputLimitReached: boolean;
  tagLimitReached: boolean;
  structureLimitReached: boolean;
  scriptLimitReached: boolean;
  inlineLimitReached: boolean;
  visibleTextLimitReached: boolean;
  tagsExamined: number;
  inlineCharactersExamined: number;
};

const MAX_STATIC_HTML_CHARS = 300_000;
const MAX_STATIC_HTML_TAGS = 8_192;
const MAX_STATIC_STRUCTURE_TOKENS = 4_096;
const MAX_TECHNOLOGY_TAGS = 2_048;
const MAX_TAG_LENGTH = 4_096;
const MAX_ATTRIBUTES_PER_TAG = 128;
const MAX_SCRIPT_ELEMENTS = 64;
const MAX_SCRIPT_REFERENCE_LENGTH = 2_048;
const MAX_SCRIPT_MEDIA_TYPE_LENGTH = 120;
const MAX_INLINE_SCRIPT_CHARS = 32_768;
const MAX_INLINE_SCRIPT_TOTAL_CHARS = 65_536;
const MAX_STATIC_VISIBLE_TEXT_CHARS = MAX_STATIC_HTML_CHARS;
const MAX_STATIC_FORMS = 50;
const MAX_STATIC_INPUTS = 500;
const MAX_FORM_ATTRIBUTE_LENGTH = 2_048;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
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
const RAW_TEXT_MODES: Readonly<Record<string, number>> = Object.freeze({
  iframe: TokenizerMode.RAWTEXT,
  noembed: TokenizerMode.RAWTEXT,
  noframes: TokenizerMode.RAWTEXT,
  script: TokenizerMode.SCRIPT_DATA,
  style: TokenizerMode.RAWTEXT,
  template: TokenizerMode.RAWTEXT,
  textarea: TokenizerMode.RCDATA,
  title: TokenizerMode.RCDATA,
  xmp: TokenizerMode.RAWTEXT,
});
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const NON_VISIBLE_TEXT_TAGS = new Set(['script', 'style', 'template']);

type StaticHtmlAnalysisOptions = {
  baseUrl?: unknown;
  includeVisibleText?: boolean;
};

function attributeValue(
  attributes: Array<{ name: string; value: string }>,
  name: string,
  maximumLength = MAX_FORM_ATTRIBUTE_LENGTH,
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
    value: attribute.value.trim().toLowerCase(),
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
  baseUrl: URL | null,
): {
  relationship: 'sameOrigin' | 'external' | 'missing' | 'unclassified';
  cleartext: boolean;
  truncated: boolean;
} {
  const action = attributeValue(attributes, 'action');
  if (!action.present && action.truncated) {
    return { relationship: 'unclassified', cleartext: false, truncated: true };
  }
  if (!action.present || action.value === '') {
    return { relationship: 'missing', cleartext: false, truncated: action.truncated };
  }
  if (action.value === null) {
    return { relationship: 'unclassified', cleartext: false, truncated: true };
  }
  if (!baseUrl) {
    return { relationship: 'unclassified', cleartext: false, truncated: action.truncated };
  }
  try {
    const parsed = new URL(action.value, baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
      return { relationship: 'unclassified', cleartext: false, truncated: action.truncated };
    }
    return {
      relationship: parsed.origin === baseUrl.origin ? 'sameOrigin' : 'external',
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

function serializedStartTag(
  tagName: string,
  attributes: Array<{ name: string; value: string }>,
): { markup: string | null; limitReached: boolean } {
  let serialized = `<${tagName.toLowerCase()}`;
  let limitReached = attributes.length > MAX_ATTRIBUTES_PER_TAG;
  for (const attribute of attributes.slice(0, MAX_ATTRIBUTES_PER_TAG)) {
    const candidate = ` ${attribute.name.toLowerCase()}="${attribute.value.toLowerCase()}"`;
    if (serialized.length + candidate.length + 1 > MAX_TAG_LENGTH) {
      limitReached = true;
      break;
    }
    serialized += candidate;
  }
  return {
    markup: serialized.length + 1 <= MAX_TAG_LENGTH ? `${serialized}>` : null,
    limitReached,
  };
}

function analyzeStaticHtml(value: unknown, options: StaticHtmlAnalysisOptions = {}): StaticHtmlAnalysis {
  const supplied = typeof value === 'string' ? value : '';
  const inputLimitReached = supplied.length > MAX_STATIC_HTML_CHARS;
  const html = supplied.slice(0, MAX_STATIC_HTML_CHARS);
  const baseUrl = safeBaseUrl(options.baseUrl);
  const includeVisibleText = options.includeVisibleText === true;
  const markup: string[] = [];
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
  let tokenizer: Tokenizer;
  let activeInlineScript: StaticScript | null = null;
  let tagsExamined = 0;
  let inlineCharactersExamined = 0;
  let tagLimitReached = false;
  let structureLimitReached = false;
  let scriptLimitReached = false;
  let inlineLimitReached = false;
  let visibleTextLimitReached = false;
  let cspMetaLimitReached = false;
  let insideExplicitHead = false;
  let scriptElementSeen = false;
  let nonVisibleTextDepth = 0;
  let visibleTextCharacters = 0;

  function appendInlineScript(chars: string): void {
    if (!activeInlineScript || !chars) return;
    const perScriptRemaining = MAX_INLINE_SCRIPT_CHARS - activeInlineScript.inlineContent.length;
    const totalRemaining = MAX_INLINE_SCRIPT_TOTAL_CHARS - inlineCharactersExamined;
    const retainedLength = Math.max(0, Math.min(chars.length, perScriptRemaining, totalRemaining));
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

  const handler: TokenHandler = {
    onStartTag(token) {
      const tagName = token.tagName.toLowerCase();
      const rawTextMode = RAW_TEXT_MODES[tagName];
      if (!token.selfClosing && rawTextMode !== undefined) tokenizer.state = rawTextMode;
      if (!token.selfClosing && NON_VISIBLE_TEXT_TAGS.has(tagName)) nonVisibleTextDepth += 1;

      if (tagsExamined >= MAX_STATIC_HTML_TAGS) {
        tagLimitReached = true;
        activeInlineScript = null;
        return;
      }
      tagsExamined += 1;
      appendStructureToken(token.selfClosing || VOID_TAGS.has(tagName) ? `${tagName}/` : tagName);

      if (tagName === 'head') insideExplicitHead = true;
      if (tagName === 'meta' && insideExplicitHead) {
        const httpEquiv = attributeValue(token.attrs, 'http-equiv', 64);
        if (httpEquiv.value === 'content-security-policy') {
          const content = attributeValue(token.attrs, 'content', MAX_RESPONSE_POLICY_HEADER_BYTES);
          if (content.value === null || !content.value) {
            cspMetaLimitReached = cspMetaLimitReached || content.present || content.truncated;
          } else if (cspMetaPolicies.length >= MAX_CSP_META_POLICIES) {
            cspMetaLimitReached = true;
          } else {
            cspMetaPolicies.push({ content: content.value, beforeScript: !scriptElementSeen });
          }
        }
      }

      if (markup.length < MAX_TECHNOLOGY_TAGS) {
        const serialized = serializedStartTag(tagName, token.attrs);
        if (serialized.limitReached) tagLimitReached = true;
        if (serialized.markup) markup.push(serialized.markup);
      } else {
        tagLimitReached = true;
      }

      if (tagName === 'form') {
        if (forms.formsObserved >= MAX_STATIC_FORMS) {
          forms.truncated = true;
        } else {
          forms.formsObserved += 1;
          const method = formMethod(token.attrs);
          forms.methods[method.value] += 1;
          const action = formAction(token.attrs, baseUrl);
          forms.actions[action.relationship] += 1;
          if (action.cleartext) forms.actions.cleartext += 1;
          if (method.truncated || action.truncated) forms.truncated = true;
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
        return;
      }
      scriptElementSeen = true;
      if (scripts.length >= MAX_SCRIPT_ELEMENTS) {
        scriptLimitReached = true;
        activeInlineScript = null;
        return;
      }
      const reference = scriptReference(token.attrs);
      const script = {
        reference,
        inlineContent: '',
        mediaType: scriptMediaType(token.attrs),
      };
      scripts.push(script);
      activeInlineScript = reference ? null : script;
    },
    onEndTag(token) {
      const tagName = token.tagName.toLowerCase();
      if (tagName === 'script') activeInlineScript = null;
      if (tagName === 'head') insideExplicitHead = false;
      if (!VOID_TAGS.has(tagName)) appendStructureToken(`/${tagName}`);
      if (NON_VISIBLE_TEXT_TAGS.has(tagName) && nonVisibleTextDepth > 0) nonVisibleTextDepth -= 1;
    },
    onCharacter(token) {
      appendInlineScript(token.chars);
      appendVisibleText(token.chars);
    },
    onNullCharacter(token) {
      appendInlineScript(token.chars);
      appendVisibleText(token.chars);
    },
    onWhitespaceCharacter(token) {
      appendInlineScript(token.chars);
      appendVisibleText(token.chars);
    },
    onComment() {},
    onDoctype() {},
    onEof() {},
  };

  tokenizer = new Tokenizer({ sourceCodeLocationInfo: false }, handler);
  tokenizer.write(html, true);

  return {
    markup: markup.join('\n'),
    visibleText: visibleTextParts.join(''),
    structureTokens,
    scripts,
    cspMetaPolicies,
    cspMetaLimitReached,
    forms,
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
  MAX_STATIC_HTML_TAGS,
  MAX_STATIC_STRUCTURE_TOKENS,
  MAX_STATIC_VISIBLE_TEXT_CHARS,
  MAX_TAG_LENGTH,
  MAX_TECHNOLOGY_TAGS,
  analyzeStaticHtml,
};

export type {
  StaticCredentialCategory,
  StaticCspMetaPolicy,
  StaticFormAnalysis,
  StaticFormMethod,
  StaticHtmlAnalysis,
  StaticHtmlAnalysisOptions,
  StaticScript,
};
