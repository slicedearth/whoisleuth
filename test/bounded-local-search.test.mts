import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildBoundedSearchIndex } from '../lib/bounded-local-search.mts';

describe('bounded local candidate search', () => {
  test('narrows substring and multi-token candidates without fuzzy expansion', () => {
    const index = buildBoundedSearchIndex([
      { id: 'exact', terms: ['portal.invalid', 'priority review'] },
      { id: 'substring', terms: ['secure-portal.invalid'] },
      { id: 'unrelated', terms: ['unrelated.invalid'] },
    ]);
    assert.deepEqual([...index.candidateIds('portal.invalid')].sort(), ['exact', 'substring']);
    assert.deepEqual([...index.candidateIds('priority review', ['priority', 'review'])], ['exact']);
    assert.deepEqual([...index.candidateIds('portl.invalid')], []);
  });

  test('keeps short-query and document bounds explicit', () => {
    const index = buildBoundedSearchIndex([
      { id: 'one', terms: ['one.invalid'] },
      { id: 'two', terms: ['two.invalid'] },
    ], 1);
    assert.equal(index.documentCount, 1);
    assert.equal(index.truncated, true);
    assert.deepEqual([...index.candidateIds('o')], ['one']);
  });
});
