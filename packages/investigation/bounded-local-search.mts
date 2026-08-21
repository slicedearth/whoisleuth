// Bounded in-memory candidate indexing shared by browser-local search surfaces.
// MiniSearch narrows candidates only; callers remain responsible for applying
// their authoritative exact/ranking semantics to every returned document.

import MiniSearch from 'minisearch';

export const MAX_BOUNDED_SEARCH_DOCUMENTS = 100_000;
export const MAX_BOUNDED_SEARCH_TERMS_PER_DOCUMENT = 32;
export const MAX_BOUNDED_SEARCH_TERM_LENGTH = 300;
export const MAX_BOUNDED_SEARCH_QUERY_LENGTH = 300;

export type BoundedSearchDocument = Readonly<{
  id: string;
  terms: readonly string[];
}>;

export type BoundedSearchIndex = Readonly<{
  documentCount: number;
  truncated: boolean;
  candidateIds(query: string, tokens?: readonly string[]): ReadonlySet<string>;
}>;

type IndexedDocument = { id: string; grams: string };

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function gramToken(value: string): string {
  return [...value].map((character) => character.codePointAt(0)!.toString(16)).join('-');
}

function trigrams(value: string): string[] {
  const characters = [...normalize(value)];
  if (characters.length < 3) return [];
  const output = new Set<string>();
  for (let index = 0; index <= characters.length - 3; index += 1) {
    output.add(gramToken(characters.slice(index, index + 3).join('')));
  }
  return [...output];
}

function intersect(sets: readonly ReadonlySet<string>[]): Set<string> {
  const [first, ...rest] = [...sets].sort((left, right) => left.size - right.size);
  if (!first) return new Set();
  return new Set([...first].filter((value) => rest.every((set) => set.has(value))));
}

export function buildBoundedSearchIndex(
  documents: readonly BoundedSearchDocument[],
  maximumDocuments = MAX_BOUNDED_SEARCH_DOCUMENTS,
): BoundedSearchIndex {
  const limit = Math.max(0, Math.min(MAX_BOUNDED_SEARCH_DOCUMENTS, Math.trunc(maximumDocuments)));
  const selected = documents.slice(0, limit);
  const miniSearch = new MiniSearch<IndexedDocument>({
    fields: ['grams'],
    idField: 'id',
    storeFields: ['id'],
    tokenize: (value) => value.split(' ').filter(Boolean),
    processTerm: (term) => term,
  });
  miniSearch.addAll(selected.map((document) => ({
    id: document.id,
    grams: [...new Set(document.terms
      .slice(0, MAX_BOUNDED_SEARCH_TERMS_PER_DOCUMENT)
      .filter((term) => typeof term === 'string' && term.length <= MAX_BOUNDED_SEARCH_TERM_LENGTH && !CONTROL_RE.test(term))
      .flatMap(trigrams))].join(' '),
  })));

  function matches(value: string): Set<string> {
    if (!value || value.length > MAX_BOUNDED_SEARCH_QUERY_LENGTH || CONTROL_RE.test(value)) return new Set();
    const grams = trigrams(value);
    if (!grams.length) return new Set(selected.map((document) => document.id));
    return new Set(miniSearch.search(grams.join(' '), { combineWith: 'AND' }).map((result) => String(result.id)));
  }

  return Object.freeze({
    documentCount: selected.length,
    truncated: documents.length > selected.length,
    candidateIds(query: string, tokens: readonly string[] = []): ReadonlySet<string> {
      const whole = matches(query);
      if (tokens.length < 2) return whole;
      const tokenMatches = intersect(tokens.map(matches));
      return new Set([...whole, ...tokenMatches]);
    },
  });
}
