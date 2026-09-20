// Structural technology clues over the existing bounded HTML tree. Resolved
// URLs are transient: only fixed, source-neutral evidence descriptions survive.
import type { StaticHtmlAnalysis, StaticHtmlElement } from './static-html-analysis.mts';

type ResolvedReference = Readonly<{ url: URL; embedded: boolean }>;
export type TechnologyMarkupContext = Readonly<{
  elements: readonly StaticHtmlElement[];
  resources: readonly ResolvedReference[];
  navigation: readonly ResolvedReference[];
}>;
export type TechnologyMarkupRule = Readonly<{
  matches(context: TechnologyMarkupContext): boolean;
  embedded?(context: TechnologyMarkupContext): boolean;
  reviewMarkup: string;
  embeddedReviewMarkup?: string;
}>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

export function attributeValue(element: StaticHtmlElement, name: string): string {
  return element.attributes.find((attribute) => attribute.name === name)?.value.toLowerCase() ?? '';
}

export function hasAttributes(element: StaticHtmlElement, ...names: string[]): boolean {
  return element.attributes.some((attribute) => names.includes(attribute.name));
}

function httpUrl(value: unknown, base?: URL): URL | null {
  if (typeof value !== 'string' || value.length > 2048 || CONTROL_RE.test(value) || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function createTechnologyMarkupContext(
  analysis: StaticHtmlAnalysis,
  effectiveBaseUrl: unknown,
  documentOrigin: unknown,
): TechnologyMarkupContext {
  const elements = analysis.elements.filter((element) => element.html && element.name !== 'template');
  const documentUrl = httpUrl(documentOrigin);
  const suppliedBase = effectiveBaseUrl ?? analysis.effectiveBaseUrl;
  const base = httpUrl(suppliedBase) ?? documentUrl;
  // A reserved base permits legacy minimised relative references without
  // attributing an absolute external URL to an unknown document origin.
  const resolutionBase = base ?? new URL('https://document.invalid/');
  const references = (element: StaticHtmlElement, names: readonly string[]): ResolvedReference[] => (
    element.attributes.flatMap((attribute) => {
      if (!names.includes(attribute.name)) return [];
      if (attribute.value.trim().startsWith('#')) return [];
      const url = httpUrl(attribute.value, resolutionBase);
      if (!url) return [];
      const relative = !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(attribute.value.trim());
      const embedded = documentUrl
        ? url.origin !== documentUrl.origin
        : Boolean(base || suppliedBase || documentOrigin) || !relative;
      return [{ url, embedded }];
    })
  );
  const resources: ResolvedReference[] = [];
  const navigation: ResolvedReference[] = [];
  for (const element of elements) {
    switch (element.name) {
      case 'script': case 'img': case 'iframe': case 'frame':
      case 'source': case 'audio': case 'embed':
        resources.push(...references(element, ['src']));
        break;
      case 'video': resources.push(...references(element, ['src', 'poster'])); break;
      case 'link': {
        const relations = attributeValue(element, 'rel').trim().split(/\s+/u);
        // Existing minimised inputs retain a link reference without its rel.
        // Explicit document metadata or navigation relations are not assets.
        if (!hasAttributes(element, 'rel') || relations.some((relation) => ['stylesheet', 'preload', 'modulepreload', 'icon'].includes(relation))) {
          resources.push(...references(element, ['href']));
        }
        break;
      }
      case 'object': resources.push(...references(element, ['data'])); break;
      case 'input':
        if (attributeValue(element, 'type') === 'image') resources.push(...references(element, ['src']));
        break;
      case 'a': case 'area': navigation.push(...references(element, ['href'])); break;
    }
  }
  return { elements, resources, navigation };
}

export function elementMarker(
  matches: (element: StaticHtmlElement) => boolean,
  reviewMarkup: string,
): TechnologyMarkupRule {
  return { matches: ({ elements }) => elements.some(matches), reviewMarkup };
}

export function resourceMarker(
  matches: (url: URL) => boolean,
  reviewPath: string,
): TechnologyMarkupRule {
  const sharedOrigin = reviewPath.startsWith('https://');
  return {
    matches: ({ resources }) => resources.some(({ url }) => matches(url)),
    embedded: ({ resources }) => sharedOrigin || !resources.some(({ url, embedded }) => !embedded && matches(url)),
    reviewMarkup: `<link href="${reviewPath}">`,
    embeddedReviewMarkup: `<link href="${sharedOrigin ? reviewPath : `https://embedded.invalid${reviewPath}`}">`,
  };
}

export function navigationMarker(
  matches: (url: URL) => boolean,
  reviewPath: string,
): TechnologyMarkupRule {
  return {
    matches: ({ navigation }) => navigation.some(({ url }) => matches(url)),
    embedded: ({ navigation }) => !navigation.some(({ url, embedded }) => !embedded && matches(url)),
    reviewMarkup: `<a href="${reviewPath}"></a>`,
    embeddedReviewMarkup: `<a href="https://embedded.invalid/${reviewPath}"></a>`,
  };
}
