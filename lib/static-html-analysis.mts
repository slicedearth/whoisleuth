// One bounded tokenization pass over the already-captured homepage body. The
// parse5 tokenizer applies HTML tokenization rules without constructing a DOM,
// so deeply nested hostile markup cannot create an unbounded element tree.
// Only normalized start-tag markup and capped script indicators are retained.

import { Tokenizer, TokenizerMode, type TokenHandler } from 'parse5';

type StaticScript = {
  reference: string | null;
  inlineContent: string;
  mediaType: string | null;
};

type StaticHtmlAnalysis = {
  markup: string;
  scripts: StaticScript[];
  inputLimitReached: boolean;
  tagLimitReached: boolean;
  scriptLimitReached: boolean;
  inlineLimitReached: boolean;
  tagsExamined: number;
  inlineCharactersExamined: number;
};

const MAX_STATIC_HTML_CHARS = 300_000;
const MAX_STATIC_HTML_TAGS = 8_192;
const MAX_TECHNOLOGY_TAGS = 2_048;
const MAX_TAG_LENGTH = 4_096;
const MAX_ATTRIBUTES_PER_TAG = 128;
const MAX_SCRIPT_ELEMENTS = 64;
const MAX_SCRIPT_REFERENCE_LENGTH = 2_048;
const MAX_SCRIPT_MEDIA_TYPE_LENGTH = 120;
const MAX_INLINE_SCRIPT_CHARS = 32_768;
const MAX_INLINE_SCRIPT_TOTAL_CHARS = 65_536;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
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

function analyzeStaticHtml(value: unknown): StaticHtmlAnalysis {
  const supplied = typeof value === 'string' ? value : '';
  const inputLimitReached = supplied.length > MAX_STATIC_HTML_CHARS;
  const html = supplied.slice(0, MAX_STATIC_HTML_CHARS);
  const markup: string[] = [];
  const scripts: StaticScript[] = [];
  let tokenizer: Tokenizer;
  let activeInlineScript: StaticScript | null = null;
  let tagsExamined = 0;
  let inlineCharactersExamined = 0;
  let tagLimitReached = false;
  let scriptLimitReached = false;
  let inlineLimitReached = false;

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

  const handler: TokenHandler = {
    onStartTag(token) {
      const tagName = token.tagName.toLowerCase();
      const rawTextMode = RAW_TEXT_MODES[tagName];
      if (!token.selfClosing && rawTextMode !== undefined) tokenizer.state = rawTextMode;

      if (tagsExamined >= MAX_STATIC_HTML_TAGS) {
        tagLimitReached = true;
        activeInlineScript = null;
        return;
      }
      tagsExamined += 1;

      if (markup.length < MAX_TECHNOLOGY_TAGS) {
        const serialized = serializedStartTag(tagName, token.attrs);
        if (serialized.limitReached) tagLimitReached = true;
        if (serialized.markup) markup.push(serialized.markup);
      } else {
        tagLimitReached = true;
      }

      if (tagName !== 'script') {
        activeInlineScript = null;
        return;
      }
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
      if (token.tagName.toLowerCase() === 'script') activeInlineScript = null;
    },
    onCharacter(token) {
      appendInlineScript(token.chars);
    },
    onNullCharacter(token) {
      appendInlineScript(token.chars);
    },
    onWhitespaceCharacter(token) {
      appendInlineScript(token.chars);
    },
    onComment() {},
    onDoctype() {},
    onEof() {},
  };

  tokenizer = new Tokenizer({ sourceCodeLocationInfo: false }, handler);
  tokenizer.write(html, true);

  return {
    markup: markup.join('\n'),
    scripts,
    inputLimitReached,
    tagLimitReached,
    scriptLimitReached,
    inlineLimitReached,
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
  MAX_STATIC_HTML_CHARS,
  MAX_STATIC_HTML_TAGS,
  MAX_TAG_LENGTH,
  MAX_TECHNOLOGY_TAGS,
  analyzeStaticHtml,
};

export type {
  StaticHtmlAnalysis,
  StaticScript,
};
