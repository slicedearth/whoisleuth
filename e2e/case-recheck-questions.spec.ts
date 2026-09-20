import { expect, test } from './fixtures';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { caseRecord, openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';

const domain = 'recheck-questions.example', target = `login.${domain}`;
const questionText = 'Is the reported sign-in page still served?';
const conditions = 'Same selected page and unauthenticated desktop viewport.';
const before = '2026-08-01T10:00:00.000Z', after = '2026-08-02T10:00:00.000Z';
const pin = { field: 'http.status', label: 'Page response', value: '200', source: 'Fixture page', sourceState: 'complete',
  completeness: 'complete', observedAt: before, observationHostname: target };

async function openReview(page: import('@playwright/test').Page) {
  const workspace = await openCaseResponseWorkspace(page); await openCaseSection(page, 'Response');
  const section = workspace.getByRole('region', { name: 'Case independent review and closure' });
  const disclosure = section.locator(':scope > details');
  if (!await disclosure.evaluate(element => (element as HTMLDetailsElement).open)) await disclosure.locator(':scope > summary').click();
  return section;
}

test('saved recheck questions preserve drafts and bind later source-qualified answers to their original conditions', async ({ page }, testInfo) => {
  await openSeededTimelineCase(page, domain, [caseRecord({ domain, evidencePins: [{ ...pin, id: 'baseline-pin' },
    { ...pin, id: 'failed-pin', sourceState: 'failed', completeness: 'partial', observedAt: after },
    { ...pin, id: 'current-pin', value: '404', observedAt: after }] })], CASE_SCHEMA_VERSION);
  let section = await openReview(page);
  await section.getByText('Recheck questions', { exact: true }).click();
  const plan = section.getByRole('form', { name: 'Save a recheck question' });
  await plan.getByLabel('Question', { exact: true }).fill(questionText);
  await plan.getByLabel('Target hostname', { exact: true }).fill(target);
  await plan.getByLabel('Baseline evidence', { exact: true }).selectOption('baseline-pin');
  await plan.getByLabel('Comparison conditions', { exact: true }).fill(conditions);
  await openCaseSection(page, 'Assessment'); await openCaseSection(page, 'Response');
  await expect(plan.getByLabel('Question', { exact: true })).toHaveValue(questionText);
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await plan.getByRole('button', { name: 'Save recheck question', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('out of storage space');
  expect((await readBrowserLocalCollection(page, 'cases')).records[0]!.value.assertions).toEqual([]);
  await expect(plan.getByLabel('Comparison conditions', { exact: true })).toHaveValue(conditions);
  await plan.getByRole('button', { name: 'Save recheck question', exact: true }).click();
  const questions = section.getByRole('list', { name: 'Saved recheck questions' });
  await expect(questions).toContainText(questionText);
  await expect(questions.getByRole('link', { name: 'Prepare recheck', exact: true })).toHaveAttribute('href', `/lookup?q=${target}&case=case-1`);
  let saved = (await readBrowserLocalCollection(page, 'cases')).records[0]!.value;
  expect(saved.observedEffects.reviews).toEqual([]);
  expect(saved.assertions[0]!.recheck).toEqual({ targetHostname: target, baselinePinId: 'baseline-pin', conditions });
  const form = section.getByRole('form', { name: 'Record a recheck', exact: true });
  await form.getByRole('combobox', { name: 'Saved question', exact: true }).selectOption({ label: questionText });
  await form.getByRole('combobox', { name: 'Comparison conditions', exact: true }).selectOption('comparable');
  await form.getByRole('combobox', { name: 'Observed effect', exact: true }).selectOption('not_reproduced');
  for (const id of ['baseline-pin', 'failed-pin']) {
    await form.getByLabel('Evidence pin', { exact: true }).selectOption(id);
    await form.getByRole('button', { name: 'Record independent review', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('complete observation under comparable conditions');
    expect((await readBrowserLocalCollection(page, 'cases')).records[0]!.value.observedEffects.reviews).toEqual([]);
  }
  await form.getByLabel('Evidence pin', { exact: true }).selectOption('current-pin');
  const submit = form.getByRole('button', { name: 'Record independent review', exact: true });
  await submit.focus(); await page.keyboard.press('Enter');
  const history = section.getByRole('list', { name: 'Independent observed-effect reviews' });
  await expect(history).toContainText(questionText); await expect(submit).toBeFocused();
  saved = (await readBrowserLocalCollection(page, 'cases')).records[0]!.value;
  expect(saved.observedEffects.reviews).toEqual([expect.objectContaining({ state: 'not_reproduced', observedAt: after, source: 'Fixture page',
    evidencePinId: 'current-pin', completeness: 'complete', recheck: { questionId: saved.assertions[0]!.id, question: questionText,
      targetHostname: target, baselinePinId: 'baseline-pin', conditions, conditionsMatch: 'comparable' } })]);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await questions.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`recheck-questions-${theme}-${width}.png`) });
    }
  }
  await page.reload(); section = await openReview(page);
  await expect(section.getByRole('list', { name: 'Independent observed-effect reviews' })).toContainText(conditions);
  await section.locator('summary').filter({ hasText: /^Recheck questions\s*· 1 open$/u }).click();
  await section.getByRole('button', { name: `Resolve question: ${questionText}`, exact: true }).click();
  await expect(section.getByRole('list', { name: 'Saved recheck questions' })).toHaveCount(0);
  expect((await readBrowserLocalCollection(page, 'cases')).records[0]!.value.observedEffects.reviews).toEqual(saved.observedEffects.reviews);
});

test('a recheck answer cannot silently use a question resolved in another tab', async ({ page, context }) => {
  await openSeededTimelineCase(page, domain, [caseRecord({ domain, assertions: [{ id: 'planned-question', kind: 'next_step', statement: questionText,
    state: 'open', createdAt: before, updatedAt: before, recheck: { targetHostname: target, baselinePinId: null, conditions } }] })], CASE_SCHEMA_VERSION);
  const section = await openReview(page), form = section.getByRole('form', { name: 'Record a recheck', exact: true });
  await form.getByRole('combobox', { name: 'Saved question', exact: true }).selectOption('planned-question');
  await form.getByRole('combobox', { name: 'Observed effect', exact: true }).selectOption('still_observed');
  await form.getByRole('textbox', { name: 'Limitations one per line', exact: true }).fill('Keep this pending answer.');
  const peer = await context.newPage();
  try {
    await peer.goto(page.url()); const other = await openReview(peer);
    await other.locator('summary').filter({ hasText: /^Recheck questions\s*· 1 open$/u }).click();
    await other.getByRole('button', { name: `Resolve question: ${questionText}`, exact: true }).click();
    await expect(other.getByRole('list', { name: 'Saved recheck questions' })).toHaveCount(0);
    await page.bringToFront();
    await form.getByRole('button', { name: 'Record independent review', exact: true }).click();
    const conflict = page.getByRole('alert').or(page.getByRole('status', { name: 'Case workspace action status' }))
      .filter({ hasText: /question changed or was resolved/u });
    await expect(conflict).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'Limitations one per line', exact: true })).toHaveValue('Keep this pending answer.');
    expect((await readBrowserLocalCollection(page, 'cases')).records[0]!.value.observedEffects.reviews).toEqual([]);
  } finally { await peer.close(); }
});
