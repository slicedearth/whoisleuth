import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentationSearch, documentationSearchDocuments } from '../frontend/src/lib/documentation-search.ts';
import { resolveCommandReferenceHash, commandReferenceSections } from '../frontend/src/lib/public-cli-sections.ts';
import { relatedPublicReferences } from '../frontend/src/lib/public-reference-navigation.ts';

test('documentation search finds commands, concepts and tasks using only public content', () => {
  const search = createDocumentationSearch();
  assert.ok(search('verify-artifact').some(result => result.href === '/cli#command-verify-artifact'));
  assert.ok(search('DMARC').some(result => result.href === '/resources#term-dmarc'));
  assert.ok(search('brand lookalikes').some(result => result.href === '/resources#find-brand-lookalikes'));
  assert.deepEqual(search('  '), []);
  assert.deepEqual(search('unmatchabletokenexample'), []);
  assert.ok(search('domain').length <= 12);
  assert.deepEqual(search('x'.repeat(256) + ' DMARC'), search('x'.repeat(256)));
  const documents = documentationSearchDocuments();
  assert.equal(new Set(documents.map(item => item.href)).size, documents.length);
  assert.ok(documents.filter(item => item.category === 'Methodology').length > 1);
  for (const item of documents) {
    assert.match(item.href, /^\/(?:resources|cli|examples|methodology|coverage)(?:\/|#|$)/u);
    assert.ok(!item.href.includes('?'));
    assert.ok(item.description.length > 0);
  }
});

test('command subsection links resolve exactly without confusing command names', () => {
  assert.deepEqual(resolveCommandReferenceHash('#command-lookup'), { id: 'lookup', anchor: 'command-lookup' });
  assert.deepEqual(resolveCommandReferenceHash('#command-lookup--inputs'), { id: 'lookup', anchor: 'command-lookup--inputs' });
  for (const section of commandReferenceSections('workflow-run')) assert.equal(resolveCommandReferenceHash(section.href)?.id, 'workflow-run');
  for (const hash of ['#commands', '#command-lookup-other', '#command-lookup--unknown', '#command-unknown--inputs', '#command-lookup%23inputs']) assert.equal(resolveCommandReferenceHash(hash), null);
});

test('related documentation follows the guide task rather than catalogue ordering', () => {
  const related = relatedPublicReferences('/resources/lookalike-domain-checker');
  assert.ok(related.some(item => item.href.startsWith('/demo')));
  assert.ok(related.some(item => item.href.startsWith('/resources#')));
  assert.ok(!related.some(item => item.href === '/resources/lookalike-domain-checker'));
  assert.ok(relatedPublicReferences('/cli').some(item => item.href === '/examples'));
});
