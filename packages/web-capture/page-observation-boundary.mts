import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import { MAX_PAGE_OBSERVATIONS, PAGE_BEHAVIOUR_VERSION, pageObservationOrigin, readPageBehaviour, type PageBehaviour, type PageRequestObservation } from '../investigation/page-behaviour.mts';
import { MAX_WEB_CAPTURE_DOM_ELEMENTS, MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS } from '../contracts/web-capture.mts';
import { requestedActionHints } from '../investigation/requested-action-hints.mts';

type RawElement = { position: number; kind: 'script' | 'frame' | 'form'; url: string | null; base: string | null; inlineText: string | null; inline: boolean; integrity: boolean; method: string | null; passwordFields: number };
type RawProjection = { elements: RawElement[]; partial: boolean; clipboardWriteAttempts: number };
const BOUNDARY = '__whoisleuthPageObservationsV1';

/** Runs before page scripts; retain native accessors rather than page-overridden methods. */
export function installPageObservationIntrinsics({ name, elements: maximumElements, observations: maximumObservations, characters: maximumCharacters }: {
  name: string; elements: number; observations: number; characters: number;
}) {
  const apply = Reflect.apply, push = Array.prototype.push, lower = String.prototype.toLowerCase;
  const walk = Document.prototype.createTreeWalker, next = TreeWalker.prototype.nextNode, attr = Element.prototype.getAttribute;
  const tag = Object.getOwnPropertyDescriptor(Element.prototype, 'tagName')!.get!;
  const content = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!.get!;
  const base = Object.getOwnPropertyDescriptor(Node.prototype, 'baseURI')!.get!;
  const formElements = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements')!.get!;
  const formMethod = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'method')!.get!;
  const documentUrl = Object.getOwnPropertyDescriptor(Document.prototype, 'URL')!.get!;
  const listLength = Object.getOwnPropertyDescriptor(HTMLCollection.prototype, 'length')!.get!;
  const listItem = HTMLCollection.prototype.item, documentValue = document;
  const minimum = Math.min, Reject = Promise.reject.bind(Promise), Exception = DOMException;
  let clipboardWriteAttempts = 0;
  if (typeof Clipboard !== 'undefined') for (const method of ['write', 'writeText']) {
    Object.defineProperty(Clipboard.prototype, method, { configurable: false, writable: false, value: () => {
      clipboardWriteAttempts = minimum(1_000_000, clipboardWriteAttempts + 1);
      return Reject(new Exception('Clipboard writes are blocked during capture.', 'NotAllowedError'));
    } });
  }
  Object.defineProperty(globalThis, name, { configurable: false, writable: false, value: (): RawProjection => {
    const result: RawElement[] = [], walker = apply(walk, documentValue, [documentValue, 1]);
    let node = apply(next, walker, []), position = 0, retainedCharacters = 0, controlVisits = 0, partial = false;
    const bounded = (value: string, maximum: number) => { if (value.length > maximum) { partial = true; return null; } return value; };
    while (node && position < maximumElements) {
      position++;
      const kind = apply(lower, apply(tag, node, []), []);
      if (kind === 'script' || kind === 'iframe' || kind === 'frame' || kind === 'form') {
        if (result.length >= maximumObservations) { partial = true; break; }
        const attributeUrl = apply(attr, node, [kind === 'form' ? 'action' : 'src']);
        const url = kind === 'form' && !attributeUrl ? apply(documentUrl, documentValue, []) as string : attributeUrl ?? '';
        const baseUrl = apply(base, node, []) as string;
        const admittedUrl = bounded(url, 8_192), admittedBase = bounded(baseUrl, 8_192);
        let inlineText: string | null = null;
        if (kind === 'script' && attributeUrl === null) {
          const value = apply(content, node, []) ?? '';
          if (value.length <= maximumCharacters - retainedCharacters) { inlineText = value; retainedCharacters += value.length; }
          else partial = true;
        }
        let passwordFields = 0;
        if (kind === 'form') {
          const controls = apply(formElements, node, []), length = apply(listLength, controls, []) as number;
          const remaining = maximumElements - controlVisits;
          if (length > remaining) partial = true;
          for (let index = 0; index < minimum(length, remaining); index++) {
            controlVisits++;
            const control = apply(listItem, controls, [index]);
            if (control && apply(lower, apply(attr, control, ['type']) ?? '', []) === 'password') passwordFields++;
          }
        }
        apply(push, result, [{ position, kind: kind === 'iframe' ? 'frame' : kind,
          url: admittedUrl, base: admittedBase, inlineText, inline: kind === 'script' && attributeUrl === null,
          integrity: !!apply(attr, node, ['integrity']), method: kind === 'form' ? apply(formMethod, node, []) : null, passwordFields }]);
      }
      node = apply(next, walker, []);
    }
    partial ||= node !== null;
    return { elements: result, partial, clipboardWriteAttempts };
  } });
}

export async function installPageObservationBoundary(context: BrowserContext) {
  await context.addInitScript(installPageObservationIntrinsics, { name: BOUNDARY, elements: MAX_WEB_CAPTURE_DOM_ELEMENTS,
    observations: MAX_PAGE_OBSERVATIONS, characters: MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS });
}

export async function collectPageElements(page: Page): Promise<RawProjection> {
  return page.evaluate(name => {
    const boundary = (globalThis as unknown as Record<string, unknown>)[name];
    if (typeof boundary !== 'function') throw new Error('Page observation boundary unavailable.');
    return boundary();
  }, BOUNDARY);
}

export function buildPageBehaviour(raw: RawProjection, requests: readonly PageRequestObservation[], bodyText: string, partial: boolean): PageBehaviour {
  const elements = raw.elements.map(value => ({ position: value.position, kind: value.kind,
    origin: value.inline || value.url === null || value.base === null || value.kind === 'frame' && !value.url ? null : pageObservationOrigin(value.url, value.base), inline: value.inline,
    integrity: value.kind === 'script' ? value.integrity ? 'present' as const : 'absent' as const : 'not_applicable' as const,
    method: value.method === null ? null : value.method === 'get' || value.method === 'post' ? value.method : 'other' as const,
    passwordFields: value.passwordFields,
    scriptSha256: value.inlineText === null ? null : createHash('sha256').update(value.inlineText).digest('hex') }));
  const actionHints = requestedActionHints(bodyText);
  return readPageBehaviour({ version: PAGE_BEHAVIOUR_VERSION, state: partial || raw.partial ? 'partial' : 'observed', requests: [...requests].sort((a, b) => a.position - b.position), elements, actionHints, clipboardWriteAttempts: raw.clipboardWriteAttempts });
}
