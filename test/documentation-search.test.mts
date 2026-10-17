import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentationSearch, documentationSearchDocuments } from '../frontend/src/lib/documentation-search.ts';
import { resolveCommandReferenceHash, commandReferenceSections } from '../frontend/src/lib/public-cli-sections.ts';
import { relatedPublicReferences } from '../frontend/src/lib/public-reference-navigation.ts';
import { PUBLIC_PRERENDERED_ROUTES } from '../lib/prerendered-routes.mts';

const publicRoutes = new Set<string>(PUBLIC_PRERENDERED_ROUTES);
function isPublicDocumentationHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('?')) return false;
  const url = new URL(href, 'https://docs.example');
  return url.origin === 'https://docs.example' && publicRoutes.has(url.pathname)
    && href.split('#')[0] === url.pathname;
}

test('documentation search finds commands, concepts and tasks using only public content', () => {
  const search = createDocumentationSearch();
  assert.ok(search('verify-artifact').some(result => result.href === '/cli#command-verify-artifact'));
  assert.ok(search('DMARC').some(result => result.href === '/resources#term-dmarc'));
  assert.ok(search('brand lookalikes').some(result => result.href === '/resources#find-brand-lookalikes'));
  assert.ok(search('supplied message').some(result => result.href === '/resources#review-a-message'));
  assert.ok(search('encrypted workspace').some(result => result.href === '/resources#track-important-findings'));
  assert.ok(search('link inspector').some(result => result.href === '/link-inspector'));
  assert.deepEqual(search('  '), []);
  assert.deepEqual(search('unmatchabletokenexample'), []);
  assert.ok(search('domain').length <= 12);
  assert.deepEqual(search('x'.repeat(256) + ' DMARC'), search('x'.repeat(256)));
  const documents = documentationSearchDocuments();
  assert.equal(new Set(documents.map(item => item.href)).size, documents.length);
  assert.ok(documents.filter(item => item.category === 'Methodology').length > 1);
  for (const item of documents) {
    assert.ok(isPublicDocumentationHref(item.href), `Documentation destination must use an exact public route: ${item.href}`);
    assert.ok(!item.href.includes('?'));
    assert.ok(item.description.length > 0);
  }
  // Independent privacy expectations must survive a mistaken classification.
  for (const href of ['/dashboard', '/lookup#result', '/discover', '/bulk', '/cases', '/monitor', '/brands', '/login',
    'https://docs.example/cli', 'https://external.example/cli', '//docs.example/cli', '//external.example/cli',
    '/cli?target=private', '/link-inspector?input=private', '/resources/../lookup', '/cli/']) {
    assert.equal(isPublicDocumentationHref(href), false, 'Private, external, query-bearing and aliased destinations must remain excluded.');
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
