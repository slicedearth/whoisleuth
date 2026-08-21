import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commonMistakes,
  glossaryTerms,
  guideFaqs,
  publicGuideGoals,
  referenceGuides,
  resultStates,
  toolGuides,
} from '../frontend/src/lib/public-guide.ts';
import {
  dashboard,
  brandsNavigation,
  consoleNavigation,
  consoleNavigationGroups,
  bulkNavigation,
  discoverNavigation,
  isNavigationItemActive,
  isProtectedDestination,
  lookupNavigation,
  monitorAssuranceNavigation,
  monitorNavigation,
  protectedDestinations,
  publicCommandNavigation,
  publicResources,
  referenceNavigation,
  referenceResources,
  toolNavigation,
} from '../frontend/src/lib/workspaces.ts';

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

test('public guide exposes three distinct task-focused starting points', () => {
  assert.equal(publicGuideGoals.length, 3);
  assert.equal(unique(publicGuideGoals.map((goal) => goal.id)), true);
  assert.deepEqual(publicGuideGoals.map((goal) => goal.title), [
    'Inspect one domain',
    'Find brand lookalikes',
    'Track important findings',
  ]);
  assert.equal(publicGuideGoals.every((goal) => goal.steps.length >= 3 && goal.steps.length <= 4), true);
  for (const goal of publicGuideGoals) {
    assert.equal(unique(goal.steps.map((step) => step.id)), true);
    assert.equal(goal.steps.every((step) => /^#[a-z][a-z0-9-]*$/u.test(step.href)), true);
  }
});

test('tool guide covers every public-facing investigation tool once', () => {
  assert.equal(unique(toolGuides.map((tool) => tool.id)), true);
  assert.deepEqual(toolGuides.map((tool) => tool.name), [
    'Lookup',
    'Brands',
    'Discover',
    'Bulk',
    'Monitor',
  ]);
  const monitor = toolGuides.find((tool) => tool.id === 'monitor');
  assert.match(monitor?.result || '', /Respond views.*Assure views/iu);
  assert.match(monitor?.result || '', /evidence-debt matrix.*exact saved Bulk source states.*pinned case gaps/iu);
  assert.match(`${monitor?.result || ''} ${monitor?.next || ''}`, /without starting a request|does not.*start collection/iu);
});

test('navigation, tool guide, and reference guide use one canonical product vocabulary', () => {
  const routeLabel = (item: { href: string; label: string }): [string, string] => [item.href.slice(1), item.label];
  const guideLabel = (item: { id: string; name: string }): [string, string] => [item.id, item.name];
  const sortById = (entries: ReadonlyArray<[string, string]>): Array<[string, string]> => (
    [...entries].sort(([left], [right]) => left.localeCompare(right))
  );

  assert.deepEqual(sortById(toolNavigation.map(routeLabel)), sortById(toolGuides.map(guideLabel)));
  assert.deepEqual(sortById(referenceResources.map(routeLabel)), sortById(referenceGuides.map(guideLabel)));
  assert.deepEqual(consoleNavigation, [
    dashboard,
    lookupNavigation,
    discoverNavigation,
    bulkNavigation,
    monitorNavigation,
    monitorAssuranceNavigation,
    brandsNavigation,
  ]);
  assert.deepEqual(consoleNavigationGroups.map((group) => ({
    label: group.label,
    items: group.items.map((item) => item.label),
  })), [
    { label: 'Start', items: ['Dashboard'] },
    { label: 'Investigate', items: ['Lookup', 'Discover', 'Bulk'] },
    { label: 'Respond', items: ['Monitor'] },
    { label: 'Assure', items: ['Watchlists & controls', 'Brands'] },
  ]);
  assert.deepEqual(consoleNavigationGroups.flatMap((group) => group.items), consoleNavigation);
  assert.deepEqual(protectedDestinations, [...consoleNavigation, ...referenceResources]);
  assert.deepEqual(publicResources.map(({ href, label }) => ({ href, label })), [
    { href: '/resources', label: 'Resources' },
  ]);
  assert.deepEqual(referenceNavigation, [...referenceResources, ...publicResources]);
  assert.deepEqual(publicCommandNavigation.map(({ href, label }) => ({ href, label })), [
    { href: '/', label: 'Public homepage' },
    { href: '/demo', label: 'Synthetic demo' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/terms', label: 'Terms' },
    { href: '/request-policy', label: 'Request policy' },
    { href: '/contact', label: 'Contact' },
  ]);
  assert.equal(unique(publicCommandNavigation.map((item) => item.href)), true);
  assert.equal(allStrings({ consoleNavigation, toolNavigation, referenceResources, publicResources, publicCommandNavigation }).some((value) => /\b(?:portal|workspace)\b/iu.test(value)), false);
});

test('shared Monitor destinations keep exactly one workflow active without changing the route', () => {
  for (const path of ['/monitor', '/monitor?view=inbox', '/monitor?view=cases&case=case-1', '/monitor?view=campaigns', '/monitor?view=relationships', '/monitor?view=unsupported']) {
    const url = new URL(path, 'https://console.example');
    assert.equal(isNavigationItemActive(monitorNavigation, url), true);
    assert.equal(isNavigationItemActive(monitorAssuranceNavigation, url), false);
    assert.equal(isProtectedDestination(url), true);
  }
  for (const path of ['/monitor?view=timeline', '/monitor?view=watchlists&watchlist=review', '/monitor?view=rules']) {
    const url = new URL(path, 'https://console.example');
    assert.equal(isNavigationItemActive(monitorNavigation, url), false);
    assert.equal(isNavigationItemActive(monitorAssuranceNavigation, url), true);
    assert.equal(isProtectedDestination(url), true);
  }
  assert.equal(isNavigationItemActive(brandsNavigation, new URL('/brands', 'https://console.example')), true);
  assert.equal(isProtectedDestination(new URL('/privacy', 'https://console.example')), false);
});

test('glossary, FAQ, state, and mistake content is bounded and deterministic', () => {
  assert.equal(glossaryTerms.length, 59);
  assert.equal(guideFaqs.length, 21);
  assert.equal(resultStates.length, 9);
  assert.equal(commonMistakes.length, 5);
  assert.equal(unique(glossaryTerms.map((item) => item.term)), true);
  assert.equal(unique(guideFaqs.map((item) => item.question)), true);
  assert.deepEqual(glossaryTerms.map((item) => item.term), [...glossaryTerms].map((item) => item.term).sort((a, b) => a.localeCompare(b)));
  assert.match(glossaryTerms.find((item) => item.term === 'Unicode confusable')?.definition || '', /not proof/i);
  assert.match(glossaryTerms.find((item) => item.term === 'PTR')?.definition || '', /not proof/i);
  assert.match(glossaryTerms.find((item) => item.term === 'SOA')?.definition || '', /primary nameserver/i);
  assert.match(glossaryTerms.find((item) => item.term === 'HTTPS service binding')?.definition || '', /does not follow/i);
  const lookupDepthAnswer = guideFaqs.find((item) => item.question === 'Should I use Fast or Deep lookup?')?.answer || '';
  assert.match(lookupDepthAnswer, /For domains, Deep adds SOA/iu);
  assert.match(lookupDepthAnswer, /public IPs.*PTR names/iu);
  assert.match(glossaryTerms.find((item) => item.term === 'Browser-library advisory match')?.definition || '', /not proof/i);
  assert.match(glossaryTerms.find((item) => item.term === 'EPP status')?.definition || '', /does not guarantee/i);
  assert.match(glossaryTerms.find((item) => item.term === 'Registration disclosure')?.definition || '', /unavailable/i);
  assert.match(glossaryTerms.find((item) => item.term === 'Structured identity metadata')?.definition || '', /not verified/i);
  assert.match(glossaryTerms.find((item) => item.term === 'Credential collection surface')?.definition || '', /not a vulnerability or phishing finding/i);
  assert.match(glossaryTerms.find((item) => item.term === 'Website profile snapshot')?.definition || '', /not proof of compromise/i);
  assert.doesNotMatch(guideFaqs.find((item) => item.question === 'How do I export or delete saved work?')?.answer || '', /local-storage controls/iu);

  const strings = allStrings({ publicGuideGoals, toolGuides, referenceGuides, resultStates, glossaryTerms, guideFaqs, commonMistakes });
  assert.equal(strings.every((value) => value.length > 0 && value.length <= 500), true);
  assert.equal(strings.every((value) => !/[\x00-\x1f\x7f]/u.test(value)), true);
  assert.equal(strings.every((value) => !value.includes('—')), true);
});
