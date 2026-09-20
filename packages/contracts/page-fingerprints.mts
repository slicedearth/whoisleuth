export const PAGE_FINGERPRINT_VERSION = 2;
export const PAGE_FINGERPRINT_PARSERS = Object.freeze({
  1: 'static-tag-sequence-v1',
  [PAGE_FINGERPRINT_VERSION]: 'html-tree-v2',
} as const);

export const MAX_STATIC_HTML_TAGS = 8_192;
export const MAX_STATIC_HTML_NODES = MAX_STATIC_HTML_TAGS * 3;
export const MAX_STATIC_HTML_DEPTH = 512;
// Each admitted element emits a start and end event; other nodes emit at most
// one event. The parser admits three mandatory document elements additionally.
export const MAX_STATIC_HTML_TREE_EVENTS = MAX_STATIC_HTML_NODES + MAX_STATIC_HTML_TAGS + 3;

export const PAGE_FINGERPRINT_TOKEN_LIMITS = Object.freeze({
  1: 4_096,
  [PAGE_FINGERPRINT_VERSION]: MAX_STATIC_HTML_TREE_EVENTS,
} satisfies Record<keyof typeof PAGE_FINGERPRINT_PARSERS, number>);
