// Native HTML tree construction over an already-captured body. Resource limits
// are enforced while nodes are created, including implied/reconstructed nodes;
// a post-parse traversal limit alone would not bound hostile parser work.
import { parse, defaultTreeAdapter as adapter, type DefaultTreeAdapterTypes, type TreeAdapter } from 'parse5';
import { MAX_HOMEPAGE_BYTES } from './outbound-request-bounds.mts';

// UTF-8 decoding cannot produce more UTF-16 code units than captured bytes.
// Direct string callers share this ceiling; tree construction remains bounded
// independently of the source size.
export const MAX_STATIC_HTML_CHARS = MAX_HOMEPAGE_BYTES;
export const MAX_STATIC_HTML_TAGS = 8_192;
export const MAX_STATIC_HTML_NODES = MAX_STATIC_HTML_TAGS * 3;
export const MAX_STATIC_HTML_DEPTH = 512;
const MAX_CONSTRUCTED_ATTRIBUTE_CHARS = MAX_STATIC_HTML_CHARS * 4;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

export function parseBoundedHtml(value: unknown) {
  const supplied = typeof value === 'string' ? value : '';
  const stop = new Error('Static HTML construction limit reached.');
  let document: DefaultTreeAdapterTypes.Document | undefined;
  let nodes = 0;
  let elements = 0;
  let depth = 0;
  let attributeCharacters = 0;
  let constructionLimitReached = false;
  function reserveNode(): void {
    if (nodes >= MAX_STATIC_HTML_NODES) throw stop;
    nodes += 1;
  }
  function reserveAttributes(attributes: Element['attrs']): void {
    for (const attribute of attributes) {
      attributeCharacters += attribute.name.length + attribute.value.length;
      if (attributeCharacters > MAX_CONSTRUCTED_ATTRIBUTE_CHARS) throw stop;
    }
  }
  const boundedAdapter: TreeAdapter<DefaultTreeAdapterTypes.DefaultTreeAdapterMap> = {
    ...adapter,
    createDocument() {
      reserveNode();
      document = adapter.createDocument();
      return document;
    },
    createDocumentFragment() { reserveNode(); return adapter.createDocumentFragment(); },
    createElement(name, namespace, attributes) {
      // Allow the three mandatory document elements in addition to source tags.
      // Reconstructed formatting elements also consume this finite allowance.
      if (elements >= MAX_STATIC_HTML_TAGS + 3) throw stop;
      elements += 1;
      reserveAttributes(attributes);
      reserveNode();
      return adapter.createElement(name, namespace, attributes);
    },
    createCommentNode(text) { reserveNode(); return adapter.createCommentNode(text); },
    insertText(parent, text) {
      const previous = parent.childNodes.at(-1);
      if (!previous || !adapter.isTextNode(previous)) reserveNode();
      adapter.insertText(parent, text);
    },
    insertTextBefore(parent, text, reference) {
      const previous = parent.childNodes[parent.childNodes.indexOf(reference) - 1];
      if (!previous || !adapter.isTextNode(previous)) reserveNode();
      adapter.insertTextBefore(parent, text, reference);
    },
    setDocumentType(parent, name, publicId, systemId) {
      if (!parent.childNodes.some((node) => node.nodeName === '#documentType')) reserveNode();
      adapter.setDocumentType(parent, name, publicId, systemId);
    },
    adoptAttributes(element, attributes) {
      reserveAttributes(attributes);
      adapter.adoptAttributes(element, attributes);
    },
    onItemPush() {
      depth += 1;
      if (depth > MAX_STATIC_HTML_DEPTH) throw stop;
    },
    onItemPop() { depth -= 1; },
  };
  try {
    parse(supplied.slice(0, MAX_STATIC_HTML_CHARS), {
      treeAdapter: boundedAdapter,
      sourceCodeLocationInfo: true,
      scriptingEnabled: true,
    });
  } catch (error) {
    if (error !== stop) throw error;
    constructionLimitReached = true;
  }
  // Parser or adapter failures are not silently re-labelled as empty evidence.
  if (!document) throw new Error('Static HTML document was not initialised.');
  return { document, inputLimitReached: supplied.length > MAX_STATIC_HTML_CHARS, constructionLimitReached };
}

export type HtmlTreeEvent =
  | { kind: 'start' | 'end'; element: Element }
  | { kind: 'text'; text: string };

export function isHtmlElement(node: Node): node is Element {
  return adapter.isElementNode(node) && node.namespaceURI === HTML_NAMESPACE;
}

// Iterative native-tree order, without entering inert template fragments.
// Foreign elements are retained for structure, not interpreted as HTML forms.
export function* htmlTreeEvents(document: DefaultTreeAdapterTypes.Document): Generator<HtmlTreeEvent> {
  const pending: Array<{ node: Node; exit: boolean }> = [{ node: document, exit: false }];
  while (pending.length) {
    const { node, exit } = pending.pop()!;
    if (adapter.isElementNode(node)) {
      yield { kind: exit ? 'end' : 'start', element: node };
      if (exit) continue;
      pending.push({ node, exit: true });
      if (isHtmlElement(node) && node.tagName === 'template') continue;
    } else if (adapter.isTextNode(node)) {
      yield { kind: 'text', text: node.value };
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.childNodes[index]!, exit: false });
      }
    }
  }
}
