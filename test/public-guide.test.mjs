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

function unique(values) {
  return new Set(values).size === values.length;
}

function allStrings(value) {
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
  const routeLabel = (item) => [item.href.slice(1), item.label];
  const guideLabel = (item) => [item.id, item.name];
  const sortById = (entries) => [...entries].sort(([left], [right]) => left.localeCompare(right));

  assert.deepEqual(sortById(toolNavigation.map(routeLabel)), sortById(toolGuides.map(guideLabel)));
  assert.deepEqual(sortById(referenceResources.map(routeLabel)), sortById(referenceGuides.map(guideLabel)));
  assert.deepEqual(consoleNavigation, [dashboard, ...toolNavigation]);
  assert.deepEqual(protectedDestinations, [dashboard, ...toolNavigation, ...referenceResources]);
  assert.equal(allStrings({ dashboard, toolNavigation, referenceResources }).some((value) => /\b(?:portal|workspace)\b/iu.test(value)), false);
});

test('glossary, FAQ, state, and mistake content is bounded and deterministic', () => {
  assert.equal(glossaryTerms.length, 31);
  assert.equal(guideFaqs.length, 12);
  assert.equal(resultStates.length, 5);
  assert.equal(commonMistakes.length, 5);
  assert.equal(unique(glossaryTerms.map((item) => item.term)), true);
  assert.equal(unique(guideFaqs.map((item) => item.question)), true);
  assert.deepEqual(glossaryTerms.map((item) => item.term), [...glossaryTerms].map((item) => item.term).sort((a, b) => a.localeCompare(b)));

  const strings = allStrings({ publicGuideGoals, toolGuides, referenceGuides, resultStates, glossaryTerms, guideFaqs, commonMistakes });
  assert.equal(strings.every((value) => value.length > 0 && value.length <= 500), true);
  assert.equal(strings.every((value) => !/[\x00-\x1f\x7f]/u.test(value)), true);
  assert.equal(strings.every((value) => !value.includes('—')), true);
});
