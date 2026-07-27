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
  consoleNavigation,
  protectedDestinations,
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
});

test('navigation, tool guide, and reference guide use one canonical product vocabulary', () => {
  const routeLabel = (item: { href: string; label: string }): [string, string] => [item.href.slice(1), item.label];
  const guideLabel = (item: { id: string; name: string }): [string, string] => [item.id, item.name];
  const sortById = (entries: ReadonlyArray<[string, string]>): Array<[string, string]> => (
    [...entries].sort(([left], [right]) => left.localeCompare(right))
  );

  assert.deepEqual(sortById(toolNavigation.map(routeLabel)), sortById(toolGuides.map(guideLabel)));
  assert.deepEqual(sortById(referenceResources.map(routeLabel)), sortById(referenceGuides.map(guideLabel)));
  assert.deepEqual(consoleNavigation, [dashboard, ...toolNavigation]);
  assert.deepEqual(protectedDestinations, [dashboard, ...toolNavigation, ...referenceResources]);
  assert.equal(allStrings({ dashboard, toolNavigation, referenceResources }).some((value) => /\b(?:portal|workspace)\b/iu.test(value)), false);
});

test('glossary, FAQ, state, and mistake content is bounded and deterministic', () => {
  assert.equal(glossaryTerms.length, 47);
  assert.equal(guideFaqs.length, 18);
  assert.equal(resultStates.length, 9);
  assert.equal(commonMistakes.length, 5);
  assert.equal(unique(glossaryTerms.map((item) => item.term)), true);
  assert.equal(unique(guideFaqs.map((item) => item.question)), true);
  assert.deepEqual(glossaryTerms.map((item) => item.term), [...glossaryTerms].map((item) => item.term).sort((a, b) => a.localeCompare(b)));
  assert.match(glossaryTerms.find((item) => item.term === 'Unicode confusable')?.definition || '', /not proof/i);
  assert.match(glossaryTerms.find((item) => item.term === 'PTR')?.definition || '', /not proof/i);
  assert.match(glossaryTerms.find((item) => item.term === 'SOA')?.definition || '', /primary nameserver/i);
  assert.match(glossaryTerms.find((item) => item.term === 'HTTPS service binding')?.definition || '', /does not follow/i);
  assert.match(glossaryTerms.find((item) => item.term === 'Browser-library advisory match')?.definition || '', /not proof/i);
  assert.match(glossaryTerms.find((item) => item.term === 'Structured identity metadata')?.definition || '', /not verified/i);
  assert.match(glossaryTerms.find((item) => item.term === 'Credential collection surface')?.definition || '', /not a vulnerability or phishing finding/i);
  assert.doesNotMatch(guideFaqs.find((item) => item.question === 'How do I export or delete saved work?')?.answer || '', /local-storage controls/iu);

  const strings = allStrings({ publicGuideGoals, toolGuides, referenceGuides, resultStates, glossaryTerms, guideFaqs, commonMistakes });
  assert.equal(strings.every((value) => value.length > 0 && value.length <= 500), true);
  assert.equal(strings.every((value) => !/[\x00-\x1f\x7f]/u.test(value)), true);
  assert.equal(strings.every((value) => !value.includes('—')), true);
});
