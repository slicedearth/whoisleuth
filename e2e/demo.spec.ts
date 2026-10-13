import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { expectFocusedResultsVisible, expectNoHorizontalOverflow, useTheme } from './helpers';
import { THEME_STORAGE_KEY } from '../frontend/src/lib/theme.ts';
import { holdPacketFileDigest } from './held-packet-digest';

test.use({ storageState: { cookies: [], origins: [] } });

test('fictional walkthroughs preserve selected order, evidence attribution and practice isolation', async ({ page }, testInfo) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo#case-practice');
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  const draft = practice.locator('form[data-recovery-form="evidence-pin"]').getByLabel('Label', { exact: true });
  await draft.fill('Keep this unsubmitted practice draft');
  const facts = practice.getByRole('region', { name: 'Case observations', exact: true }).locator('.evidence-fact');
  const factsBefore = await facts.allTextContents();
  expect(factsBefore.length).toBeGreaterThan(0);
  const storedBefore = await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }));
  const walkthrough = practice.getByText('Present selected fictional evidence', { exact: true }).locator('..');
  const summary = walkthrough.locator(':scope > summary');
  const start = walkthrough.getByRole('button', { name: 'Start walkthrough', exact: true });
  await expect(walkthrough).not.toHaveAttribute('open');
  await summary.focus(); await summary.press('Enter');
  await expect(start).toBeDisabled();
  await expect(walkthrough.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await walkthrough.getByRole('checkbox', { name: 'Include Earlier page', exact: true }).check();
  await walkthrough.getByRole('checkbox', { name: 'Include Later capture did not complete', exact: true }).check();
  await walkthrough.getByRole('button', { name: 'Move step 2 earlier', exact: true }).click();
  await expect(walkthrough.getByRole('button', { name: 'Move step 1 later', exact: true })).toBeFocused();
  const order = walkthrough.getByRole('list', { name: 'Selected fictional evidence order', exact: true });
  await expect(order.locator('li > span')).toHaveText(['Later capture did not complete', 'Earlier page']);
  await start.focus(); await start.press('Enter');
  const slide = walkthrough.locator('section');
  await expect(slide.getByRole('heading')).toHaveText('Fictional evidence 1 of 2');
  await expect(slide.getByRole('heading')).toBeFocused();
  await expect(slide).toContainText('Fictional later capture');
  await expect(slide).toContainText('source state: unavailable');
  await expect(slide).toContainText('No later page content is available. This cannot establish absence.');
  await expect(walkthrough.getByRole('button', { name: 'Previous evidence', exact: true })).toBeDisabled();
  await walkthrough.getByRole('button', { name: 'Next evidence', exact: true }).click();
  await expect(slide.getByRole('heading')).toHaveText('Fictional evidence 2 of 2');
  await expect(slide.getByRole('heading')).toBeFocused();
  await expect(slide.locator('.evidence-fact > strong')).toHaveText('Earlier page');
  await expect(slide.locator('time')).toHaveAttribute('datetime', '2026-09-01T12:00:00.000Z');
  await expect(walkthrough.getByRole('button', { name: 'Next evidence', exact: true })).toBeDisabled();
  await walkthrough.getByRole('list', { name: 'Fictional walkthrough sequence', exact: true }).getByRole('button', { name: 'Later capture did not complete', exact: true }).click();
  await expect(slide).toContainText('source state: unavailable');
  await page.getByRole('checkbox', { name: 'Larger practice reading', exact: true }).check();
  await expect(draft).toHaveValue('Keep this unsubmitted practice draft');
  expect(await facts.allTextContents()).toEqual(factsBefore);
  expect(await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }))).toEqual(storedBefore);
  for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 });
    await useTheme(page, theme);
    await slide.getByRole('heading').focus();
    await expectFocusedResultsVisible(page, slide.getByRole('heading'), slide.getByRole('heading'));
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.practice-walkthrough').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`practice-walkthrough-${theme}-${width}.png`) });
  }
  await walkthrough.getByRole('button', { name: 'Edit walkthrough selection', exact: true }).click();
  await expect(walkthrough.locator('legend')).toBeFocused();
  await expect(walkthrough.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await walkthrough.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(start).toBeDisabled();
  await expect(walkthrough.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await walkthrough.getByRole('checkbox', { name: 'Include Earlier page', exact: true }).check();
  await summary.click(); await summary.click();
  await expect(start).toBeDisabled();
  await expect(walkthrough.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await walkthrough.getByRole('checkbox', { name: 'Include Earlier page', exact: true }).check();
  await page.getByText('Practise with real Case forms', { exact: true }).click();
  await page.getByText('Practise with real Case forms', { exact: true }).click();
  await expect(walkthrough).not.toHaveAttribute('open');
  await summary.click();
  await expect(start).toBeDisabled();
  await expect(draft).toHaveValue('Keep this unsubmitted practice draft');
  expect(await facts.allTextContents()).toEqual(factsBefore);
  await walkthrough.getByRole('checkbox', { name: 'Include Earlier page', exact: true }).check();
  await page.getByRole('combobox', { name: 'Practice scenario', exact: true }).selectOption('provider-resolved');
  await page.getByRole('button', { name: 'Discard practice and change scenario', exact: true }).click();
  await expect(walkthrough).not.toHaveAttribute('open');
  await summary.click();
  await expect(start).toBeDisabled();
  await walkthrough.getByRole('checkbox', { name: 'Include Earlier page', exact: true }).check();
  await practice.getByRole('button', { name: 'Discard practice and restart', exact: true }).click();
  await expect(walkthrough).not.toHaveAttribute('open');
  await summary.click();
  await expect(start).toBeDisabled();
  await walkthrough.getByRole('checkbox', { name: 'Include Earlier page', exact: true }).check();
  await page.goto('/resources');
  await page.goto('/demo#case-practice');
  await summary.click();
  await expect(start).toBeDisabled();
  await verifyIsolation();
});

test('practice scenarios require deliberate replacement and keep provider outcomes distinct', async ({ page }, testInfo) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.goto('/examples');
  await page.locator('#related-hosts summary').click();
  await page.getByRole('link', { name: 'Open the related-host practice', exact: true }).click();
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  const label = practice.locator('form[data-recovery-form="evidence-pin"]').getByLabel('Label', { exact: true });
  const scenario = page.getByRole('combobox', { name: 'Practice scenario', exact: true });
  const followTour = async (id: string) => {
    // A real same-route link exercises client navigation without reloading the draft.
    await page.evaluate(id => {
      const link = document.createElement('a');
      link.href = `/demo?practice=${encodeURIComponent(id)}#case-practice`;
      link.textContent = 'Follow another fictional tour'; link.id = 'fixture-tour-link';
      document.body.append(link);
    }, id);
    await page.locator('#fixture-tour-link').click();
    await page.locator('#fixture-tour-link').evaluate(link => link.remove());
  };
  await expect(scenario).toHaveValue('related-hosts');
  await expect(practice).toContainText('accounts.parent.example/service-a');
  await label.fill('Keep my practice draft');
  await followTour('contradictory-sources');
  await expect(scenario).toHaveValue('contradictory-sources');
  await expect(label).toHaveValue('Keep my practice draft');
  await expect(practice).toContainText('accounts.parent.example/service-a');
  await page.getByRole('button', { name: 'Keep current practice', exact: true }).click();
  await expect(scenario).toHaveValue('related-hosts');
  await followTour('not-a-scenario');
  await expect(page.getByRole('status').filter({ hasText: 'That fictional tour is not available in this build.' })).toBeVisible();
  await expect(label).toHaveValue('Keep my practice draft');
  await expect(scenario).toHaveValue('related-hosts');
  await followTour('contradictory-sources');
  await expect(scenario).toHaveValue('contradictory-sources');
  await page.getByRole('button', { name: 'Discard practice and change scenario', exact: true }).click();
  await expect(label).toHaveValue('');
  await expect(practice.getByRole('heading', { name: 'Practise a Case review', exact: true })).toBeFocused();
  await expect(practice).toContainText('Separate review reported no credential form');
  await scenario.selectOption('provider-resolved');
  await page.getByRole('button', { name: 'Discard practice and change scenario', exact: true }).click();
  await expect(practice).toContainText('Provider-reported outcome: provider reports resolved');
  await practice.getByText('Check your reasoning', { exact: true }).click();
  await expect(practice.getByRole('list', { name: 'Practice record checks' })).toContainText('Not yet recorded: The incomplete later capture is recorded as unavailable');
  await practice.getByRole('button', { name: 'Discard practice and restart', exact: true }).click();
  await expect(scenario).toHaveValue('provider-resolved');
  await expect(practice).toContainText('Provider-reported outcome: provider reports resolved');
  for (const theme of ['light', 'dark'] as const) for (const width of [320, 1280]) {
    await useTheme(page, theme); await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page);
    if (captureVisualEvidenceEnabled()) {
      await scenario.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`practice-tour-${theme}-${width}.png`) });
    }
  }
  expect((await new AxeBuilder({ page }).include('.practice-reading').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await verifyIsolation();
});

test('fictional inference exercises explain evidence limits without recording answers or changing practice drafts', async ({ page }, testInfo) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo#case-practice');
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  const scenario = page.getByRole('combobox', { name: 'Practice scenario', exact: true });
  const exercise = practice.getByRole('region', { name: 'Fictional inference exercise', exact: true });
  const disclosure = practice.getByText('Find the weak inference', { exact: true });
  const explanation = exercise.getByRole('region', { name: 'Inference explanation', exact: true });
  await expect(practice).toBeVisible();
  await expect(disclosure).toHaveCount(0);
  const storedBefore = await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }));

  for (const [id, weak, bounded, reason] of [
    ['related-hosts', /prove one operator controls both pages/u, /two different affected identities/u, /not proof of common control/u],
    ['contradictory-sources', /proves the complete capture was wrong/u, /includes a credential form/u, /no recorded path or viewport/u],
    ['provider-resolved', /confirms that the page has been removed/u, /^The provider reported resolution/u, /independent capture failed/u],
    ['trust-claim', /proves that this separate campaign is authorised/u, /text and image describe different organisers/u, /not authority for this campaign/u],
    ['dependent-sources', /response that reused it are independent observations/u, /response declares reuse/u, /Repetition is not a separate observation/u],
  ] as const) {
    await scenario.selectOption(id);
    await page.getByRole('button', { name: 'Discard practice and change scenario', exact: true }).click();
    await practice.getByRole('button', { name: '2. Record a conclusion', exact: true }).click();
    const draft = practice.getByLabel('Conclusion summary', { exact: true });
    await draft.fill('Keep this unsubmitted explanation');
    await disclosure.focus(); await disclosure.press('Enter');
    await expect(exercise.getByRole('radio')).toHaveCount(3);
    await expect(exercise.getByRole('button', { name: 'Explain this choice', exact: true })).toBeDisabled();
    await exercise.getByText('Supplied evidence', { exact: true }).click();
    const evidence = exercise.getByRole('list', { name: 'Original fictional evidence', exact: true });
    await expect(evidence).toContainText('Fictional');
    await expect(evidence).toContainText('source state: unavailable');
    await expect(evidence).not.toContainText('Keep this unsubmitted explanation');
    await exercise.getByText('Supplied evidence', { exact: true }).click();
    const boundedChoice = exercise.getByRole('radio', { name: bounded });
    await boundedChoice.focus(); await boundedChoice.press('Space');
    await exercise.getByRole('button', { name: 'Explain this choice', exact: true }).click();
    await expect(explanation.getByRole('heading')).toHaveText('This statement stays within the supplied evidence');
    await expect(explanation.getByRole('heading')).toBeFocused();
    await exercise.getByRole('radio', { name: weak }).check();
    await expect(explanation).toHaveCount(0);
    await exercise.getByRole('button', { name: 'Explain this choice', exact: true }).click();
    await expect(explanation.getByRole('heading')).toHaveText('This conclusion goes beyond the evidence');
    await expect(explanation).toContainText(reason);
    await expect(draft).toHaveValue('Keep this unsubmitted explanation');
    await explanation.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(exercise.getByRole('group', { name: 'Which conclusion goes beyond the evidence?', exact: true }).locator('legend')).toBeFocused();
    await expect(exercise.getByRole('radio', { checked: true })).toHaveCount(0);
    await exercise.getByRole('radio', { name: weak }).check();
    await exercise.getByRole('button', { name: 'Explain this choice', exact: true }).click();
  }

  expect(await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }))).toEqual(storedBefore);
  const retainedDraft = practice.getByLabel('Conclusion summary', { exact: true });
  const presentationOptions = page.getByRole('group', { name: 'Optional fictional presentation', exact: true });
  await expect(presentationOptions.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Fictional practice companion', exact: true })).toHaveCount(0);
  await presentationOptions.getByRole('checkbox', { name: 'Larger practice reading', exact: true }).check();
  await presentationOptions.getByRole('checkbox', { name: 'Show practice companion', exact: true }).check();
  await expect(page.getByRole('complementary', { name: 'Fictional practice companion', exact: true })).toBeVisible();
  await expect(retainedDraft).toHaveValue('Keep this unsubmitted explanation');
  await expect(explanation).toContainText('Repetition is not a separate observation');
  expect(await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }))).toEqual(storedBefore);
  for (const density of ['comfortable', 'compact'] as const) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: /^Colour theme,/u }).click();
    await page.getByLabel('Reading density').selectOption(density);
    await page.getByLabel('Reading density').press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-density', density);
    for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: width === 320 ? 700 : 720 });
      await useTheme(page, theme);
      await explanation.getByRole('heading').focus();
      await expectFocusedResultsVisible(page, explanation.getByRole('heading'), explanation.getByRole('heading'));
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('.inference-practice').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      if (captureVisualEvidenceEnabled()) {
        await page.screenshot({ path: testInfo.outputPath(`inference-${density}-${theme}-${width}-viewport.png`) });
        await exercise.screenshot({ path: testInfo.outputPath(`inference-${density}-${theme}-${width}.png`) });
        await presentationOptions.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`practice-presentation-${density}-${theme}-${width}.png`) });
      }
    }
  }
  await disclosure.click(); await disclosure.click();
  await expect(explanation).toHaveCount(0);
  await expect(exercise.getByRole('radio', { checked: true })).toHaveCount(0);
  await exercise.getByRole('radio').first().check();
  await practice.getByRole('button', { name: '1. Pin a fact', exact: true }).click();
  await expect(exercise).toHaveCount(0);
  await practice.getByRole('button', { name: '2. Record a conclusion', exact: true }).click();
  await disclosure.click();
  await expect(exercise.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(practice.getByLabel('Conclusion summary', { exact: true })).toHaveValue('Keep this unsubmitted explanation');
  await practice.getByText('Check your reasoning', { exact: true }).click();
  await expect(practice.getByRole('list', { name: 'Practice record checks', exact: true })).toContainText('Not yet recorded: The decision links retained evidence');
  await exercise.getByRole('radio').first().check();
  await page.getByText('Practise with real Case forms', { exact: true }).click();
  await page.getByText('Practise with real Case forms', { exact: true }).click();
  await expect(exercise).toHaveCount(0);
  await disclosure.click();
  await expect(exercise.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(practice.getByLabel('Conclusion summary', { exact: true })).toHaveValue('Keep this unsubmitted explanation');
  await verifyIsolation();
});

test('bounded practice examples preserve scope, reported mechanisms and source-reuse qualifications', async ({ page }, testInfo) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.goto('/demo#case-practice');
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  const scenario = page.getByRole('combobox', { name: 'Practice scenario', exact: true });
  const select = async (id: string) => {
    await scenario.selectOption(id);
    await page.getByRole('button', { name: 'Discard practice and change scenario', exact: true }).click();
    await expect(practice.getByRole('heading', { name: 'Practise a Case review', exact: true })).toBeFocused();
  };
  for (const [id, observation] of [
    ['compromised-page', 'Separate ordinary root-page capture'],
    ['hosted-object', 'Unrelated tenant with shared infrastructure'],
    ['related-hosts', 'Service B identity claim'],
    ['ad-redirect', 'Replacement and advertisement remain unresolved'],
    ['conditional-presentation', 'Different desktop root capture'],
    ['requested-amendment', 'Logo-only supplied image account'],
  ]) {
    await select(id!);
    await expect(practice.getByText(observation!, { exact: true }).first()).toBeVisible();
    if (id === 'conditional-presentation') {
      const capture = practice.getByRole('region', { name: 'Fictional capture conditions', exact: true });
      const summary = capture.getByText('Compare capture conditions', { exact: true });
      await summary.focus(); await summary.press('Enter');
      const choices = capture.getByRole('checkbox');
      await expect(choices).toHaveCount(3);
      await choices.nth(0).focus(); await choices.nth(0).press('Space');
      await choices.nth(1).check();
      const matrix = capture.getByRole('region', { name: 'Selected capture condition comparison', exact: true });
      await expect(matrix.getByRole('row', { name: /^Declared viewport/ })).toContainText('Different declarations');
      await expect(matrix.getByRole('row', { name: /^Declared viewport/ })).toContainText('390 × 844');
      await expect(matrix.getByRole('row', { name: /^Declared viewport/ })).toContainText('1280 × 720');
      await expect(matrix.getByRole('row', { name: /^Declared observer/ })).toContainText('Not fully declared');
      await choices.nth(2).check();
      await expect(matrix.getByRole('row', { name: /^Declared viewport/ })).toContainText('Not fully declared');
      await expect(capture.getByRole('button', { name: /Use as .* page/ })).toHaveCount(0);
      for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: width === 320 ? 700 : 720 });
        await useTheme(page, theme); await expectNoHorizontalOverflow(page);
        expect((await new AxeBuilder({ page }).include('.capture-condition-matrix').analyze()).violations).toEqual([]);
        await matrix.focus(); await expect(matrix).toBeFocused();
        if (width === 320) {
          await matrix.press('ArrowRight');
          await expect.poll(() => matrix.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
          await matrix.evaluate(element => element.scrollLeft = 0);
        }
        if (captureVisualEvidenceEnabled()) await matrix.screenshot({ path: testInfo.outputPath(`demo-conditions-${theme}-${width}.png`) });
      }
    }
  }
  await select('conditional-presentation');
  await practice.getByText('Compare capture conditions', { exact: true }).click();
  await expect(practice.locator('.capture-condition-matrix').getByRole('status')).toHaveText('0 of 3 observations selected · maximum 20');
  await expect(practice.getByRole('region', { name: 'Selected capture condition comparison', exact: true })).toHaveCount(0);
  await select('identity-actions');
  await practice.getByText('Review the supplied action mechanisms', { exact: true }).click();
  const mechanisms = practice.getByRole('list', { name: 'Supplied identity action mechanisms', exact: true });
  await expect(mechanisms.getByRole('listitem')).toHaveCount(7);
  await expect(mechanisms).toContainText('session · imported record');
  await expect(mechanisms).toContainText('support call · reported action');
  await expect(mechanisms).toContainText('occurrence time unknown');
  await select('trust-claim');
  await practice.getByRole('button', { name: '2. Record a conclusion', exact: true }).click();
  await practice.getByText('Compare explanations', { exact: true }).click();
  await expect(practice.getByRole('list', { name: 'Evidence across explanations', exact: true }).getByRole('listitem')).toHaveCount(2);
  await expect(practice).toContainText('organisation-existence record do not decide campaign authority or fraud');
  await select('dependent-sources');
  await practice.getByText('Review source reuse and disclosure', { exact: true }).click();
  await expect(practice.getByText('Selected evidence has retained shared-source or derivation context.', { exact: false }).first()).toBeVisible();
  await practice.getByText('Evidence relationships and shared sources', { exact: true }).and(practice.locator('summary')).click();
  await expect(practice.getByText('A later result may reuse your submitted report.', { exact: false })).toBeVisible();
  await expect(practice.getByRole('list', { name: 'Analyst-declared evidence relationships', exact: true }).getByRole('listitem')).toHaveCount(1);
  await practice.getByRole('button', { name: '2. Record a conclusion', exact: true }).click();
  const decision = practice.locator('form[data-recovery-form="decision"]');
  await decision.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await decision.getByRole('combobox', { name: 'Review reason', exact: true }).selectOption('other_reviewed');
  await decision.getByLabel('Conclusion summary', { exact: true }).fill('The provider result reuses the original report');
  await decision.getByLabel('Evidence-based rationale', { exact: true }).fill('The supplied response declares its source; this is not a second independent observation.');
  await decision.getByRole('checkbox', { name: /Provider explicitly reused the report/u }).check();
  await decision.getByRole('button', { name: 'Record conclusion', exact: true }).click();
  await expect(decision.getByLabel('Conclusion summary', { exact: true })).toHaveValue('');
  await practice.getByRole('button', { name: '1. Pin a fact', exact: true }).click();
  const sourceFocus = practice.getByRole('combobox', { name: 'Trace sources for', exact: true });
  await sourceFocus.selectOption({ label: 'The provider result reuses the original report' });
  const trace = practice.getByRole('region', { name: 'Selected evidence source trace', exact: true });
  await expect(trace.getByRole('status')).toContainText('Active relationships in trace: 1');
  const relationships = practice.getByRole('list', { name: 'Analyst-declared evidence relationships', exact: true });
  await expect(relationships).toContainText('Original supplied report');
  await expect(relationships).not.toContainText('Separately documented page observation');
  const unknown = await sourceFocus.getByRole('option', { name: /Provider collection method unknown/u }).getAttribute('value');
  expect(unknown).toBeTruthy(); await sourceFocus.selectOption(unknown!);
  await expect(trace.getByRole('status')).toContainText('Active relationships in trace: 0');
  await expect(trace).toContainText('This does not establish independence.');
  await sourceFocus.selectOption({ label: 'The provider result reuses the original report' });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(practice).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  expect((await new AxeBuilder({ page }).include('.case-practice').analyze()).violations).toEqual([]);
  await verifyIsolation();
});

async function isolateCasePractice(page: Page) {
  const requests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && path !== '/api/session') requests.push(path);
  });
  await page.addInitScript(() => {
    const accesses: string[] = [];
    Object.defineProperty(window, '__practiceStorageAccess', { value: accesses });
    IDBFactory.prototype.open = function(name) { accesses.push(`open:${name}`); throw new Error('Practice must not open saved work.'); };
    IDBFactory.prototype.deleteDatabase = function(name) { accesses.push(`delete:${name}`); throw new Error('Practice must not delete saved work.'); };
    localStorage.setItem('saved-work-sentinel', 'Keep this saved value.');
    sessionStorage.setItem('saved-work-sentinel', 'Keep this tab value.');
  });
  return async () => {
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __practiceStorageAccess: string[] }).__practiceStorageAccess)).toEqual([]);
    expect(await page.evaluate(() => [localStorage.getItem('saved-work-sentinel'), sessionStorage.getItem('saved-work-sentinel')])).toEqual(['Keep this saved value.', 'Keep this tab value.']);
    const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
    await expect(practice.locator('a[href], input[type=file]')).toHaveCount(0);
  };
}

test('source-linked and containment practice uses real offline reviews without saved-work access', async ({ page }) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.goto('/resources/domain-investigation-workflow');
  await page.getByRole('link', { name: 'Practise supplied evidence and handoff review', exact: true }).click();
  await expect(page).toHaveURL(/\/demo#case-practice$/u);
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  await practice.getByText('Try source-linked offline review', { exact: true }).click();
  await practice.getByRole('button', { name: 'Review supplied text and context', exact: true }).click();
  const source = practice.getByRole('region', { name: 'Fictional source-linked review', exact: true });
  await expect(source.getByRole('heading', { name: 'Source-linked review', exact: true })).toBeFocused();
  await expect(source).toContainText('2 literal indicators');
  await source.getByText('Inspect the source-linked review reports', { exact: true }).click();
  const review = JSON.parse(await source.locator('pre').innerText());
  expect(review.intake.indicators.map((item: { kind: string }) => item.kind)).toEqual(['sha256', 'ipv4']);
  expect(review.intake.distributionContext.channel).toBe('advertisement');
  expect(review.history.state).toBe('partial');
  await practice.getByRole('button', { name: '4. Rehearse separate response scopes', exact: true }).click();
  await practice.getByText('Preview the separate internal follow-up', { exact: true }).click();
  await practice.getByRole('button', { name: 'Preview fictional internal handoff', exact: true }).click();
  const disclosure = practice.getByRole('region', { name: 'Fictional containment disclosure', exact: true });
  await expect(disclosure.getByRole('heading', { name: 'Fictional containment disclosure', exact: true })).toBeFocused();
  await disclosure.getByText('Inspect exact fictional containment disclosure', { exact: true }).click();
  const handoff = JSON.parse(await disclosure.locator('pre').innerText());
  expect(handoff.assertions).toHaveLength(1); expect(handoff.assertions[0].state).toBe('open'); expect(handoff.evidencePins).toHaveLength(1);
  await practice.getByLabel('Include the linked supporting pin', { exact: true }).uncheck();
  await expect(disclosure).toHaveCount(0);
  await practice.getByRole('button', { name: 'Preview fictional internal handoff', exact: true }).click();
  await expect(disclosure).toContainText('not selected');
  await practice.getByRole('combobox', { name: 'Practice handoff audience', exact: true }).selectOption('public');
  await practice.getByRole('button', { name: 'Preview fictional internal handoff', exact: true }).click();
  await expect(disclosure).toContainText('0 selected request');
  await expect(disclosure).not.toContainText('Is the credential form still present?');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme); await page.setViewportSize({ width: 320, height: 800 });
    await expect(disclosure).toBeVisible(); await expectNoHorizontalOverflow(page);
  }
  expect((await new AxeBuilder({ page }).include('.case-practice').analyze()).violations).toEqual([]);
  await verifyIsolation();
});

test('fictional draft comparison shares the complete read-only view without saved-work or delivery access', async ({ page }, testInfo) => {
  const verifyIsolation = await isolateCasePractice(page);
  let downloads = 0; page.on('download', () => downloads++);
  await page.goto('/demo#case-practice');
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  await practice.getByRole('button', { name: '4. Rehearse separate response scopes', exact: true }).click();
  await practice.getByText('Compare fictional response drafts', { exact: true }).click();
  const comparison = practice.getByRole('region', { name: 'Fictional response draft comparison', exact: true });
  const prepare = comparison.getByRole('button', { name: 'Compare supplied fictional drafts', exact: true });
  await expect(prepare).toBeVisible();
  await expect(comparison.getByRole('heading', { name: 'Fictional draft differences', exact: true })).toHaveCount(0);
  await prepare.focus(); await prepare.press('Enter');
  await expect(comparison.getByRole('heading', { name: 'Fictional draft differences', exact: true })).toBeFocused();
  await expect(comparison).toContainText('Both packets remain unauthorised drafts.');
  await comparison.getByRole('button', { name: 'Inspect Recipient Route', exact: true }).click();
  const values = comparison.getByRole('region', { name: 'Selected comparison values', exact: true });
  await expect(values.getByRole('region', { name: 'Baseline draft value', exact: true })).toContainText('earlier-desk@example.invalid');
  await expect(values.getByRole('region', { name: 'Comparison draft value', exact: true })).toContainText('later-desk@example.invalid');
  await comparison.getByRole('button', { name: 'Inspect Incident', exact: true }).click();
  await expect(values.getByRole('region', { name: 'Baseline draft value', exact: true })).toContainText('https://case-practice.example/offer');
  await expect(values.getByRole('region', { name: 'Comparison draft value', exact: true })).toContainText('https://distribution.example/ad/7');
  const omitted = comparison.locator('.records > li').filter({ hasText: 'Only in baseline draft' }).first();
  await omitted.getByRole('button').click();
  await expect(values.getByText('Not present in this selected copy.', { exact: true })).toBeVisible();
  const history = comparison.getByRole('button', { name: /^Inspect Escalation History /u });
  await history.focus(); await history.press('Enter');
  await expect(values.getByRole('heading', { level: 4 })).toBeFocused();
  await expect(values.getByRole('region', { name: 'Baseline draft value', exact: true })).toContainText('"kind":"page"');
  await expect(values.getByRole('region', { name: 'Comparison draft value', exact: true })).toContainText('"kind":"advertisement"');
  for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
    await values.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.practice-packets').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (captureVisualEvidenceEnabled()) {
      await values.getByRole('heading', { level: 4 }).focus();
      await expect(values.getByRole('heading', { level: 4 })).toBeFocused();
      await comparison.screenshot({ path: testInfo.outputPath(`fictional-packets-${theme}-${width}.png`) });
      await values.screenshot({ path: testInfo.outputPath(`fictional-packet-values-${theme}-${width}.png`) });
    }
  }
  // A current failure is unavailable, not an empty or successfully compared pair.
  await comparison.getByRole('button', { name: 'Clear fictional comparison', exact: true }).click();
  await holdPacketFileDigest(page, true); await prepare.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { packetDigestHeld: boolean }).packetDigestHeld)).toBe(true);
  await page.evaluate(() => (window as unknown as { releasePacketDigest: () => Promise<void> }).releasePacketDigest());
  await expect(comparison.getByRole('alert')).toHaveText('The fictional drafts could not be compared. Your practice Case and drafts are unchanged.');
  await expect(comparison.getByRole('region', { name: 'Selected comparison values', exact: true })).toHaveCount(0);
  await expect(prepare).toBeEnabled(); await prepare.click();
  await expect(comparison.getByRole('heading', { name: 'Fictional draft differences', exact: true })).toBeFocused();
  await expect(comparison.getByRole('alert')).toHaveCount(0);
  await verifyIsolation(); expect(downloads).toBe(0);
});

test('fictional packet comparison discards held completions without overwriting practice drafts or replacement scopes', async ({ page }) => {
  const verifyIsolation = await isolateCasePractice(page);
  let downloads = 0; page.on('download', () => downloads++);
  await page.goto('/demo#case-practice');
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  const draft = practice.locator('form[data-recovery-form="evidence-pin"]').getByLabel('Label', { exact: true });
  await draft.fill('Keep this practice draft');
  const disclosure = practice.getByText('Compare fictional response drafts', { exact: true });
  const comparison = practice.getByRole('region', { name: 'Fictional response draft comparison', exact: true });
  const prepare = comparison.getByRole('button', { name: 'Compare supplied fictional drafts', exact: true });
  const ready = comparison.getByRole('heading', { name: 'Fictional draft differences', exact: true });
  async function open() {
    await practice.getByRole('button', { name: '4. Rehearse separate response scopes', exact: true }).click();
    if (await disclosure.locator('..').getAttribute('open') === null) await disclosure.click();
    await expect(prepare).toBeVisible();
  }
  for (const disposal of ['clear', 'close', 'outer', 'step', 'scenario', 'restart'] as const) {
    await open();
    // Alternate old success/failure; neither may overwrite a replacement pair.
    await holdPacketFileDigest(page, ['close', 'step', 'restart'].includes(disposal));
    await prepare.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { packetDigestHeld: boolean }).packetDigestHeld)).toBe(true);
    await expect(ready).toHaveCount(0);
    if (disposal === 'clear') await comparison.getByRole('button', { name: 'Clear fictional comparison', exact: true }).click();
    else if (disposal === 'close') { await disclosure.click(); await expect(comparison).toHaveCount(0); }
    else if (disposal === 'outer') {
      const outer = page.getByText('Practise with real Case forms', { exact: true });
      await outer.click(); await expect(comparison).toHaveCount(0); await outer.click();
    } else if (disposal === 'step') {
      await practice.getByRole('button', { name: '1. Pin a fact', exact: true }).click();
      await expect(comparison).toHaveCount(0); await expect(draft).toHaveValue('Keep this practice draft');
    } else if (disposal === 'scenario') {
      await page.getByRole('combobox', { name: 'Practice scenario', exact: true }).selectOption('provider-resolved');
      await page.getByRole('button', { name: 'Discard practice and change scenario', exact: true }).click();
      await expect(practice).toContainText('Provider-reported outcome: provider reports resolved');
      await expect(comparison).toHaveCount(0);
      await page.getByRole('combobox', { name: 'Practice scenario', exact: true }).selectOption('credential-form');
      await page.getByRole('button', { name: 'Discard practice and change scenario', exact: true }).click();
    } else {
      await practice.getByRole('button', { name: 'Discard practice and restart', exact: true }).click();
      await expect(comparison).toHaveCount(0); await expect(draft).toHaveValue('');
    }
    await open(); await expect(ready).toHaveCount(0); await prepare.click(); await expect(ready).toBeVisible();
    const identities = comparison.getByText('Fictional packet identities', { exact: true }).locator('..').locator('code');
    await expect(identities).toHaveCount(2);
    const replacement = await identities.allTextContents();
    await page.evaluate(() => (window as unknown as { releasePacketDigest: () => Promise<void> }).releasePacketDigest());
    await expect(identities).toHaveText(replacement); await expect(ready).toBeVisible();
    await expect(comparison.getByRole('alert')).toHaveCount(0); await expect(prepare).toBeEnabled();
    await comparison.getByRole('button', { name: 'Clear fictional comparison', exact: true }).click();
  }
  await verifyIsolation(); expect(downloads).toBe(0);
});

test('requested-evidence practice creates only a drafting amendment without saved-work access', async ({ page }) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.goto('/demo#case-practice');
  await page.getByRole('combobox', { name: 'Practice scenario', exact: true }).selectOption('requested-amendment');
  await page.getByRole('button', { name: 'Discard practice and change scenario', exact: true }).click();
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  await practice.getByRole('button', { name: '4. Prepare requested evidence', exact: true }).click();
  const requested = practice.locator('.requested-evidence');
  await requested.locator(':scope > summary').click();
  await requested.getByRole('button', { name: 'Review requested evidence', exact: true }).click();
  const form = requested.getByRole('form', { name: 'Requested evidence review', exact: true });
  await expect(form.getByRole('combobox', { name: 'Evidence preparation', exact: true })).toBeFocused();
  await form.getByRole('checkbox', { name: 'Requested exact-page evidence · Fictional supplied capture', exact: true }).check();
  await form.getByLabel('Preparation or unavailability reason', { exact: true }).fill('The supplied earlier record is selected; the later capture remains unavailable.');
  await form.getByRole('button', { name: 'Save evidence preparation', exact: true }).click();
  await requested.getByRole('button', { name: 'Create drafting amendment', exact: true }).click();
  await expect(requested.getByRole('button', { name: 'Review amendment · drafting', exact: true })).toBeVisible();
  await expect(requested.getByText('Delivery recorded', { exact: true })).toHaveCount(0);
  await requested.getByText('Request source and packet', { exact: true }).click();
  await expect(requested.locator('code')).toHaveText('a'.repeat(64));
  await verifyIsolation();
});

test('real Case forms practise evidence, conclusions and inconclusive rechecks without saved-work access', async ({ page }, testInfo) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.goto('/demo#case-practice');
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  await expect(practice).toBeVisible();
  const pin = practice.locator('form[data-recovery-form="evidence-pin"]');
  await pin.getByLabel('Label', { exact: true }).fill('Practice fact');
  await pin.getByLabel('Fact', { exact: true }).fill('The fictional page asks for an email address and password.');
  await pin.getByLabel('Source', { exact: true }).fill('Fictional supplied capture');
  await pin.getByLabel('Observed at', { exact: true }).fill('2026-09-01T12:00');
  await expect(pin.getByRole('status')).toContainText('page only');
  await practice.getByRole('button', { name: '2. Record a conclusion', exact: true }).click();
  await expect(practice.locator('#practice-assessment')).toBeFocused();
  await practice.getByRole('button', { name: '1. Pin a fact', exact: true }).click();
  await expect(pin.getByLabel('Label', { exact: true })).toHaveValue('Practice fact');
  await pin.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await expect(pin.getByLabel('Fact', { exact: true })).toHaveValue('');
  await expect(practice.locator('.practice-status')).toContainText('nothing was written to your saved workspace');

  await practice.getByRole('button', { name: '2. Record a conclusion', exact: true }).click();
  const decision = practice.locator('form[data-recovery-form="decision"]');
  await decision.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await decision.getByRole('combobox', { name: 'Review reason', exact: true }).selectOption('other_reviewed');
  await decision.getByLabel('Conclusion summary', { exact: true }).fill('The claimed identity needs verification');
  await decision.getByLabel('Evidence-based rationale', { exact: true }).fill('The form requests credentials, but its operator and purpose are not established.');
  await decision.getByRole('checkbox', { name: /Practice fact/u }).check();
  await decision.getByRole('button', { name: 'Record conclusion', exact: true }).click();
  await expect(decision.getByLabel('Conclusion summary', { exact: true })).toHaveValue('');
  await expect(practice.getByRole('region', { name: 'Case assessment' })).toContainText('The claimed identity needs verification');

  await practice.getByRole('button', { name: '3. Review a later capture', exact: true }).click();
  const recheck = practice.locator('form[data-recovery-form="observed-effect"]');
  await recheck.getByRole('combobox', { name: 'Saved question', exact: true }).selectOption({ label: 'Is the credential form still present?' });
  const laterId = await recheck.getByRole('combobox', { name: 'Current evidence', exact: true }).locator('option').filter({ hasText: 'Later capture did not complete' }).getAttribute('value');
  expect(laterId).toBeTruthy();
  await recheck.getByRole('combobox', { name: 'Current evidence', exact: true }).selectOption(laterId!);
  await recheck.getByRole('combobox', { name: 'Comparison conditions', exact: true }).selectOption('comparable');
  await recheck.getByRole('combobox', { name: 'Observed effect', exact: true }).selectOption('not_reproduced');
  await recheck.getByRole('button', { name: 'Record independent outcome', exact: true }).click();
  await expect(recheck.getByRole('alert')).toContainText('requires a complete observation');
  await expect(practice.getByRole('list', { name: 'Practice recheck records' })).toHaveCount(0);
  await recheck.getByRole('combobox', { name: 'Observed effect', exact: true }).selectOption('unavailable');
  await recheck.getByRole('button', { name: 'Record independent outcome', exact: true }).click();
  await expect(practice.getByRole('list', { name: 'Practice recheck records' })).toContainText('unavailable · partial · Fictional later capture');
  await expect(recheck.getByRole('button', { name: 'Record independent outcome', exact: true })).toBeFocused();
  await practice.getByRole('button', { name: '4. Rehearse separate response scopes', exact: true }).click();
  await practice.getByRole('button', { name: 'Prepare fictional recipient copies', exact: true }).click();
  await expect(practice.locator('#practice-response')).toBeFocused();
  const pageCopy = practice.getByRole('region', { name: 'Page recipient material', exact: true });
  const adCopy = practice.getByRole('region', { name: 'Advertisement recipient material', exact: true });
  await expect(pageCopy).toContainText('page-review@example.invalid');
  await expect(adCopy).toContainText('ad-review@example.invalid');
  await expect(pageCopy).toContainText('https://case-practice.example/offer');
  await expect(adCopy).toContainText('https://distribution.example/ad/7');
  await practice.getByText('Exact incident-object coverage · 2 retained objects', { exact: true }).click();
  const coverage = practice.getByRole('region', { name: 'Incident link coverage table', exact: true });
  const pageRow = coverage.getByRole('row').filter({ hasText: 'https://case-practice.example/offer' });
  const adRow = coverage.getByRole('row').filter({ hasText: 'https://distribution.example/ad/7' });
  await expect(pageRow).toContainText('1 explicitly bound action');
  await expect(adRow).toContainText('1 explicitly bound action');
  const inspectPage = pageRow.getByRole('button', { name: 'Inspect response history', exact: true });
  await inspectPage.focus(); await inspectPage.press('Enter');
  const pageHistoryHeading = practice.getByText('Response history · page · https://case-practice.example/offer', { exact: true });
  const pageHistory = pageHistoryHeading.locator('..');
  const adHistory = practice.getByText('Response history · advertisement · https://distribution.example/ad/7', { exact: true }).locator('..');
  await expect(pageHistoryHeading).toBeFocused();
  await pageHistory.getByText('Action and recipient context · 1', { exact: true }).click();
  await expect(pageHistory).toContainText('Current action: drafting');
  await expect(pageHistory).toContainText('No exact-object delivery event retained.');
  for (const copy of [pageCopy, adCopy]) {
    await copy.getByText('Inspect exact fictional recipient material', { exact: true }).click();
    const material = JSON.parse(await copy.locator('pre').innerText()) as { selectedEvidence: Record<string, unknown>[] };
    expect(material.selectedEvidence.length).toBeGreaterThan(0);
    expect(material.selectedEvidence.every(pin => !Object.hasOwn(pin, 'value'))).toBe(true);
  }
  await expect(practice.getByRole('button', { name: 'Record separate simulated deliveries', exact: true })).toBeDisabled();
  await practice.getByRole('checkbox', { name: 'I reviewed the fictional page recipient’s exact scope and selected references', exact: true }).check();
  await practice.getByRole('checkbox', { name: 'I reviewed the separate fictional advertisement recipient’s scope and limitations', exact: true }).check();
  await practice.getByRole('button', { name: 'Confirm fictional disclosure review', exact: true }).click();
  await practice.getByRole('button', { name: 'Record separate simulated deliveries', exact: true }).click();
  const records = practice.getByRole('list', { name: 'Practice response records', exact: true });
  await expect(records).toContainText('Practice-only page delivery reference');
  await expect(records).toContainText('Practice-only ad delivery reference');
  await expect(records).toContainText('Practice-only page acknowledgement');
  await expect(practice.locator('#practice-response')).toBeFocused();
  await pageHistory.getByText('Recorded deliveries · 1', { exact: true }).click();
  await expect(pageHistory).toContainText('Practice-only page delivery reference');
  await expect(pageHistory).toContainText('Exact packet identity, preparation time and historical recipient are not retained');
  await pageHistory.getByText('Source-attributed response events · 1', { exact: true }).click();
  await expect(pageHistory).toContainText('accepted for review · provider');
  await expect(adHistory.getByText(/^Source-attributed response events/u)).toHaveCount(0);
  await practice.getByRole('button', { name: 'Record supplied independent review and close only the page scope', exact: true }).click();
  await expect(records.locator(':scope > li').filter({ hasText: 'page-review@example.invalid' })).toContainText('terminal');
  await expect(records.locator(':scope > li').filter({ hasText: 'ad-review@example.invalid' })).toContainText('submitted');
  await expect(practice.locator('.practice-status')).toContainText('advertisement remains unresolved');
  await expect(pageRow).toContainText('Analyst-resolved link');
  await expect(adRow).toContainText('Open link');
  await expect(adRow).toContainText('independent reviews: 0');
  await pageHistory.getByText(/^Independent object reviews ·/u).click();
  await expect(pageHistory).toContainText('not reproduced · complete');
  for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
    await pageHistoryHeading.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.coverage').analyze()).violations).toEqual([]);
    if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`practice-response-${theme}-${width}.png`) });
  }
  await verifyIsolation();
});

test('Case practice is reachable, responsive and discarded on restart or reload', async ({ page }, testInfo) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.goto('/resources');
  const practiceLink = page.getByRole('region', { name: 'Practise with fictional evidence', exact: true })
    .getByRole('link').and(page.locator('a[href="/demo#case-practice"]'));
  await expect(practiceLink).toHaveAccessibleName(/Case/iu);
  await practiceLink.focus();
  await practiceLink.press('Enter');
  await expect(page).toHaveURL(/\/demo#case-practice$/u);
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  const form = practice.locator('form[data-recovery-form="evidence-pin"]');
  await expect(form).toBeVisible();
  await form.getByLabel('Label', { exact: true }).fill('Discard this practice draft');
  await expect(form.getByRole('status')).toContainText('page only');
  await practice.getByRole('button', { name: 'Discard practice and restart', exact: true }).click();
  await expect(practice.getByRole('heading', { name: 'Practise a Case review', exact: true })).toBeFocused();
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('');
  await form.getByLabel('Label', { exact: true }).fill('Discard this on reload too');
  await expect(form.getByRole('status')).toContainText('page only');
  await page.reload();
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('');
  for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      for (const name of ['1. Pin a fact', '2. Record a conclusion', '3. Review a later capture']) {
        await practice.getByRole('button', { name, exact: true }).click();
        const ids = ['practice-evidence', 'practice-assessment', 'practice-recheck'];
        for (const [index, id] of ids.entries()) {
          const heading = practice.locator(`#${id}`);
          await expect(heading).toHaveCount(1);
          if (index === Number(name[0]) - 1) await expect(heading).toBeVisible(); else await expect(heading).toBeHidden();
        }
        await expectNoHorizontalOverflow(page);
        if (width === 320 || width === 1280) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`case-practice-${name[0]}-${theme}-${width}.png`) }); }
      }
      if (width === 320 || width === 1280) expect((await new AxeBuilder({ page }).include('#case-practice').analyze()).violations).toEqual([]);
    }
  }
  await verifyIsolation();
});

test('the suspicious-domain and change-review scenarios can start directly', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/demo');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [390, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`scenario-choices-${theme}-${width}.png`) }); }
    }
  }
  await page.getByRole('button', { name: 'Inspect suspicious domain' }).click();
  await expect(page.getByRole('heading', { name: 'exampleshop-login.example', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Open synthetic Case' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand details: Relationships and history evidence' }).click();
  const evidence = page.getByRole('region', { name: 'Where this result came from', exact: true });
  await expect(evidence).toBeVisible();
  const decorative = page.getByRole('region', { name: 'Decorative fictional source-map cover', exact: true });
  await expect(decorative).toHaveCount(0);
  const stored = await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }));
  const preview = page.getByRole('button', { name: 'Preview decorative source-map cover', exact: true });
  await preview.focus(); await preview.press('Enter');
  await expect(decorative).toBeVisible();
  await expect(decorative).not.toContainText('exampleshop');
  const geometry = await decorative.locator('svg').evaluate(svg => ({
    viewBox: svg.getAttribute('viewBox'),
    elements: [...svg.children].map(element => ({ tag: element.tagName, attrs: [...element.attributes].map(attribute => [attribute.name, attribute.value]) })),
  }));
  expect(geometry.elements.length).toBeGreaterThan(1);
  for (const element of geometry.elements) {
    expect(['line','circle']).toContain(element.tag);
    for (const [name, value] of element.attrs) {
      if (name === 'class') { expect(value).toMatch(/^svelte-[a-z0-9]+$/u); continue; }
      expect(['x1','x2','y1','y2','cx','cy','r']).toContain(name); expect(Number.isFinite(Number(value))).toBe(true);
    }
  }
  await page.getByRole('button', { name: 'Clear decorative cover', exact: true }).click();
  await expect(decorative).toHaveCount(0);
  await preview.click();
  expect(await decorative.locator('svg').evaluate(svg => ({ viewBox: svg.getAttribute('viewBox'), elements: [...svg.children].map(element => ({ tag: element.tagName, attrs: [...element.attributes].map(attribute => [attribute.name, attribute.value]) })) }))).toEqual(geometry);
  expect(await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }))).toEqual(stored);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [390, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await evidence.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`scenario-evidence-${theme}-${width}.png`) }); }
      if (captureVisualEvidenceEnabled()) { await decorative.screenshot({ path: testInfo.outputPath(`decorative-cover-${theme}-${width}.png`) }); }
    }
  }
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(decorative).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare a reported change' }).click();
  await expect(page.getByRole('heading', { name: 'Document and revisit exampleshop-login.example' })).toBeFocused();
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await expect(page.getByRole('heading', { name: 'Repeated evidence and material changes stay distinct' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export synthetic case report' })).toBeVisible();
  expect(apiRequests.filter(url => new URL(url).pathname !== '/api/session')).toEqual([]);
});

async function progressToLookup(page: Page) {
  const workspace = page.locator('#demo-workspace');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Define the official identity' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.locator('.discover-candidates article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  await expect(page.getByRole('heading', { name: 'Prioritise candidates without collapsing evidence' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Inspect exampleshop-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'exampleshop-login.example' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
}

async function workspaceTop(page: Page) {
  return page.locator('#demo-workspace').evaluate((element) => Math.round(element.getBoundingClientRect().top));
}

async function workspaceNeedsScroll(page: Page) {
  return page.locator('#demo-workspace').evaluate((element) => {
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    return Math.abs(element.getBoundingClientRect().top - margin) > 1;
  });
}

test('completes the guided synthetic workflow without investigation requests or production-store access', async ({ page }, testInfo) => {
  test.slow();
  const verifyIsolation = await isolateCasePractice(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const apiRequestPaths: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) apiRequestPaths.push(pathname);
  });

  await page.goto('/demo');
  await expect(page.locator('.demo-footer').getByRole('link', { name: 'Sign in to investigate' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('heading', { name: 'Explore a synthetic domain investigation.' })).toBeVisible();
  await expect(page.getByText('Synthetic demo · State resets with this tab')).toBeVisible();
  await expect(page.locator('.demo-stage-summary')).toContainText('Tool substep 1 of 6');
  await expect(page.getByRole('button', { name: /Dashboard.*Current/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: /Cases.*Upcoming/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Define the official identity' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Example Shop' })).toBeVisible();
  await expect(page.getByText(/exampleshop\.example · Complete/)).toBeVisible();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeFocused();

  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.getByRole('heading', { name: 'Three candidates, two evidence origins' })).toBeVisible();
  await expect(page.locator('.discover-candidates article')).toHaveCount(3);
  await expect(page.getByText('Certificate Transparency · 2 certificate observations')).toBeVisible();
  await expect(page.getByText('Generated candidate · generated locally')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Bulk.*Upcoming/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  await expect(page.getByRole('heading', { name: 'Prioritise candidates without collapsing evidence' })).toBeFocused();
  await expect(page.locator('.candidate')).toHaveCount(3);
  await page.getByRole('button', { name: 'High priority · 1' }).click();
  await expect(page.locator('.candidate')).toHaveCount(1);

  await page.getByRole('button', { name: 'Inspect exampleshop-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'exampleshop-login.example' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'What needs analyst attention?' })).toBeVisible();
  await expect(page.locator('.demo-decision-brief .priority-cue')).toHaveText('Elevated review priority');
  await expect(page.locator('.demo-decision-brief')).not.toContainText('78/100');
  await expect(page.getByText('Three review cues')).toBeVisible();
  const familyControls = page.locator('.lookup-family button[aria-expanded]');
  await expect(familyControls).toHaveCount(5);
  expect(await familyControls.evaluateAll((buttons) => buttons.every((button) => button.getAttribute('aria-expanded') === 'false'))).toBe(true);
  const monitorHandoff = page.getByRole('button', { name: 'Open synthetic Case' });
  await expect(monitorHandoff).toBeVisible();
  await expect(monitorHandoff).toBeInViewport();
  await expect(page.locator('#demo-evidence-registry')).toHaveCount(0);
  await expect(page.locator('.dns-card')).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand details: Registration evidence' }).click();
  await expect(page.locator('#demo-evidence-registry')).toBeVisible();
  const authorityTrace = page.getByRole('region', { name: 'Registration authority trace' });
  await expect(authorityTrace).toContainText('primary publication for domain existence');
  await expect(authorityTrace).toContainText('cannot decide domain existence');

  await page.getByRole('button', { name: 'Expand details: Web, DNS, and TLS evidence' }).click();
  await expect(page.locator('#demo-evidence-registry')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'DNS evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'HTTP evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TLS and certificate evidence' })).toBeVisible();
  await expect(page.getByText('Also separated in the signed-in Console')).toBeVisible();
  const http = page.getByRole('group', { name: 'HTTP evidence', exact: true });
  const checkHttpScope = async (origin: string, response: string) => {
    const summary = http.locator(':scope > summary');
    await summary.focus();
    if (await http.getAttribute('open') === null) await summary.press('Enter');
    for (const [label, value] of [
      ['Requested URL', 'Not retained'], ['Final URL', 'Not retained'],
      ['Final origin', origin], ['Response', response],
    ] as const) {
      const row = http.getByRole('article').filter({ has: page.getByText(label, { exact: true }) });
      await expect(row).toHaveCount(1);
      await expect(row.getByText(value, { exact: true })).toBeVisible();
    }
    await expect(http.getByText('Connection attempts', { exact: true })).toHaveCount(0);
    await expect(http).toContainText('fixed demonstration evidence, not a live website observation');
  };
  await checkHttpScope('https://exampleshop-login.example', 'HTTP 200');
  const viewport = page.viewportSize();
  const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of ['light', 'dark'] as const) for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await expectNoHorizontalOverflow(page);
    if (captureVisualEvidenceEnabled()) {
      await http.getByRole('article').filter({ has: page.getByText('Final URL', { exact: true }) })
        .evaluate(row => row.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: testInfo.outputPath(`demo-http-${theme}-${width}.png`) });
    }
  }
  await page.evaluate(value => {
    if (value) document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
  }, originalTheme);
  if (viewport) await page.setViewportSize(viewport);

  await page.getByRole('button', { name: 'Expand details: Relationships and history evidence' }).click();
  await expect(page.locator('.dns-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Where this result came from' })).toBeVisible();
  await page.getByRole('link', { name: /^Registry/ }).click();
  await expect(page.locator('#demo-evidence-registry')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse details: Registration evidence' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#demo-family-web .family-details')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand details: Relationships and history evidence' }).click();
  const relationshipTabs = page.getByRole('tablist', { name: 'Synthetic relationship and history view' });
  const evidenceTab = relationshipTabs.getByRole('tab', { name: /^Evidence/ });
  await evidenceTab.focus();
  await evidenceTab.press('End');
  await expect(relationshipTabs.getByRole('tab', { name: /^Timeline/ })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Observed lifecycle' })).toBeVisible();

  await page.getByRole('button', { name: 'Expand details: Source quality evidence' }).click();
  await expect(page.getByRole('heading', { name: 'Where this result came from' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Overlapping collection timing for 4 source branches' })).toBeVisible();
  await expect(page.locator('.timing-summary')).toContainText('Network context');
  const scope = page.locator('#demo-source-quality .scope-disclosure');
  await scope.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
  await expect(scope.getByRole('region', { name: 'Registry RDAP scope', exact: true })).toContainText('exampleshop-login.example');
  await expect(scope.getByRole('region', { name: 'WHOIS scope', exact: true })).toContainText('Observation time unavailable');
  await expect(scope.getByRole('region', { name: 'DNS scope', exact: true })).toContainText('Exact outcome not retained');
  const httpScope = scope.getByRole('region', { name: 'HTTP scope', exact: true });
  for (const label of ['Requested URL', 'Final URL']) await expect(httpScope.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText('Not retained');
  const tlsScope = scope.getByRole('region', { name: 'TLS connection and certificate scope', exact: true });
  await expect(tlsScope.locator('dl > div').filter({ has: page.getByText('Connection hostname (SNI)', { exact: true }) }).locator('dd')).toHaveText('Not retained');
  for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('#demo-source-quality').analyze()).violations).toEqual([]);
    await scope.locator(':scope > summary').focus();
    if (captureVisualEvidenceEnabled()) await scope.screenshot({ path: testInfo.outputPath(`demo-scope-${theme}-${width}.png`) });
  }

  await page.getByRole('button', { name: 'Expand details: Decision context' }).click();
  const acquisition = page.locator('details.acquisition');
  await acquisition.locator(':scope > summary').click();
  const acquisitionContext = acquisition.getByLabel('Acquisition evidence context');
  await expect(acquisitionContext).toContainText('exampleshop-login.example · Fictional example');
  await expect(acquisitionContext).toContainText('Time unavailable');
  await expect(acquisitionContext.locator('time')).toHaveCount(0);
  await acquisition.locator('details.review-prompts > summary').click();
  await acquisition.getByRole('button', { name: 'Mail dependencies unavailable Unavailable', exact: true }).click();
  await expect(acquisition.getByRole('article', { name: 'Mail dependencies unavailable', exact: true })).toBeFocused();
  await expect(acquisition.getByLabel('Current decision')).toHaveValue('unresolved');

  await monitorHandoff.click();
  await expect(page.getByRole('heading', { name: 'Document and revisit exampleshop-login.example' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Document and revisit exampleshop-login.example' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Watchlist activity' })).toHaveCount(0);

  await page.getByRole('combobox', { name: /^Status/u }).selectOption('reviewing');
  await expect(page.getByRole('status')).toHaveText('Synthetic case updated.');
  await page.getByLabel('Analyst note').fill('Fixture reviewed for demonstration.');
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  const changeReview = page.locator('.change-review');
  await expect(changeReview.getByRole('heading', { name: 'Repeated evidence and material changes stay distinct' })).toBeVisible();
  await expect(changeReview).toContainText('2 retained observations');
  await expect(changeReview).toContainText('matched this retained state');
  await expect(changeReview).toContainText('Material change');
  await expect(page.locator('.retained-case')).toContainText('History entries2');
  await expect(page.getByRole('heading', { name: /^Evidence timeline.*2 snapshots$/u })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pin checkpoint /u })).toHaveCount(0);
  await page.getByText('Explore the retained investigation timeline', { exact: true }).click();
  const retainedTimeline = page.getByRole('region', { name: 'Investigation timeline', exact: true });
  const journalRows = await retainedTimeline.locator('.timeline-list').innerText();
  await retainedTimeline.getByRole('checkbox', { name: 'Field journal reading layout', exact: true }).check();
  expect(await retainedTimeline.locator('.timeline-list').innerText()).toBe(journalRows);
  await expect(retainedTimeline.locator('a[href]')).toHaveCount(0);
  await retainedTimeline.getByText('Evidence family coverage', { exact: true }).click();
  const families = retainedTimeline.getByRole('list', { name: 'Evidence families', exact: true });
  const combined = families.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Show Combined observations', exact: true }) });
  await expect(combined).toContainText('2 retained records');
  await expect(families.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Show DNS', exact: true }) })).toContainText('0 retained records');
  await combined.getByRole('button').focus(); await page.keyboard.press('Enter');
  await expect(retainedTimeline.locator('.timeline-list > li')).toHaveCount(2);
  for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.timeline-workspace').analyze()).violations).toEqual([]);
    await combined.getByRole('button').focus();
    if (captureVisualEvidenceEnabled()) {
      await families.screenshot({ path: testInfo.outputPath(`demo-families-${theme}-${width}.png`) });
      await retainedTimeline.locator('.timeline-list').screenshot({ path: testInfo.outputPath(`demo-journal-${theme}-${width}.png`) });
    }
  }
  await page.getByText('Explore the retained investigation timeline', { exact: true }).click();

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage).sort(),
  }));
  expect(storage.local).toEqual(['saved-work-sentinel', THEME_STORAGE_KEY].sort());
  expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');
  expect(storage.session).toEqual(['saved-work-sentinel', 'whoisleuth:synthetic-demo:v1'].sort());
  await verifyIsolation();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export synthetic case report' }).click();
  const download = await downloadPromise;
  const body = await (await download.createReadStream()).toArray();
  const payload = JSON.parse(Buffer.concat(body).toString('utf-8'));
  expect(download.suggestedFilename()).toBe('whoisleuth-synthetic-demo-case.json');
  expect(payload).toMatchObject({ schema: 'whoisleuth.synthetic-demo-case', version: 5, synthetic: true, case: { domain: 'exampleshop-login.example', status: 'monitoring', note: 'Fixture reviewed for demonstration.' } });
  expect(payload.timeline).toHaveLength(2);
  expect(payload.evidence.registry.source).toBe('Registry RDAP fixture');
  expect(payload.evidence.securityTxt.state).toBe('present');
  expect(payload.evidence.credentialSurface.categories.password).toBe(1);
  expect(payload.evidence.structuredIdentity.entities[0].name).toBe('Example Shop account service');
  expect(payload.evidence.observedNetwork.address).toBe('203.0.113.44');

  await page.reload();
  const restoredHeading = page.getByRole('heading', { name: 'Document and revisit exampleshop-login.example' });
  await expect(restoredHeading).toBeVisible();
  await expect(restoredHeading).not.toBeFocused();
  await page.getByRole('navigation', { name: 'Synthetic tool substeps' }).getByRole('button', { name: /^Bulk/ }).click();
  await page.getByRole('button', { name: 'All candidates · 3' }).click();
  await page.getByRole('button', { name: 'Inspect exampleshop.invalid', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'exampleshop.invalid', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Expand details: Web, DNS, and TLS evidence' }).click();
  await checkHttpScope('Not retained', 'Not observed');
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
  expect(apiRequestPaths.length).toBeGreaterThan(0);
  expect(apiRequestPaths.every((path) => path === '/api/session')).toBe(true);
  await verifyIsolation();
});

test('settles long-to-short stage transitions at one stable workspace anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/demo');
  await progressToLookup(page);
  await page.getByRole('button', { name: 'Open synthetic Case' }).click();
  await expect(page.getByRole('heading', { name: 'Document and revisit exampleshop-login.example' })).toBeFocused();
  await expect(page.locator('#demo-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { name: 'Document and revisit exampleshop-login.example' })).toBeInViewport({ ratio: 1 });
  await expect.poll(() => workspaceNeedsScroll(page), { timeout: 2500 }).toBe(false);
  const settledTop = await workspaceTop(page);
  expect(await workspaceTop(page)).toBe(settledTop);

  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await page.getByRole('button', { name: 'Review Lookup evidence' }).click();
  await expect(page.getByRole('heading', { name: 'exampleshop-login.example' })).toBeFocused();
  await expect(page.locator('#demo-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { name: 'exampleshop-login.example', exact: true })).toBeInViewport({ ratio: 1 });
  await expect.poll(() => workspaceNeedsScroll(page), { timeout: 2500 }).toBe(false);
  const returnTop = await workspaceTop(page);
  expect(await workspaceTop(page)).toBe(returnTop);
});

test('retains the stage surface until scrolling completes or reaches its bounded fallback', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    Element.prototype.scrollIntoView = function noAutomaticScroll() {};
  });
  await page.goto('/demo');
  const workspace = page.locator('#demo-workspace');

  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await workspaceNeedsScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Begin with Brands' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(workspace).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { name: 'Define the official identity' })).toBeFocused();
  expect(await workspace.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThan(0);

  await page.evaluate(() => window.dispatchEvent(new Event('scrollend')));
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await expect(workspace).toHaveCSS('min-height', '0px');

  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await workspaceNeedsScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Use synthetic profile' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(workspace).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeFocused();
  expect(await workspace.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThan(0);
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 2500 });
  await expect(workspace).toHaveCSS('min-height', '0px');
});

test('keeps the guided workflow usable at narrow mobile widths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/demo');
  const rail = page.locator('.demo-steps');
  const stageSummary = page.locator('.demo-stage-summary');
  expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await rail.locator('button').evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().height >= 44))).toBe(true);
  await expect(stageSummary).toBeVisible();
  await expect(stageSummary).toContainText('Tool substep 1 of 6');
  await expect(stageSummary.locator('span')).toBeHidden();
  await expect(page.locator('.hero-full-title')).toBeVisible();
  await expect(page.locator('.hero-compact-title')).toHaveCount(1);
  await expect(page.locator('.hero-compact-title')).toBeHidden();
  await expect(page.locator('.demo-panel')).toHaveCSS('min-height', '0px');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.locator('.hero-full-title')).toHaveCount(1);
  await expect(page.locator('.hero-full-title')).toBeHidden();
  await expect(page.locator('.hero-compact-title')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use synthetic profile' })).toBeInViewport();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.locator('.discover-candidates article')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  const desktopMap = page.locator('.map-frame');
  await expect(desktopMap).toHaveCount(1);
  await expect(desktopMap).toBeHidden();
  await expect(page.locator('.map-mobile')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Inspect exampleshop-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'exampleshop-login.example' })).toBeFocused();
  const activeStageCenterOffset = () => rail.evaluate((element) => {
    const active = element.querySelector('[aria-current="step"]');
    if (!active) return Number.POSITIVE_INFINITY;
    const railRect = element.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    return Math.abs((activeRect.left + activeRect.right) / 2 - (railRect.left + railRect.right) / 2);
  });
  await expect.poll(activeStageCenterOffset).toBeLessThanOrEqual(3);
  await expect(page.locator('.lookup-family button[aria-expanded="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open synthetic Case' })).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  await rail.evaluate((element) => element.scrollTo({ left: 0, behavior: 'auto' }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'exampleshop-login.example' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'exampleshop-login.example' })).not.toBeFocused();
  await expect(page.locator('.hero-full-title')).toHaveCount(1);
  await expect(page.locator('.hero-full-title')).toBeHidden();
  await expect(page.locator('.hero-compact-title')).toBeVisible();
  await expect.poll(activeStageCenterOffset).toBeLessThanOrEqual(3);

  await page.setViewportSize({ width: 360, height: 760 });
  await page.getByRole('button', { name: 'Expand details: Registration evidence' }).click();
  await expect(page.getByRole('region', { name: 'Exact source comparisons' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Expand details: Web, DNS, and TLS evidence' }).click();
  await expect(page.getByRole('heading', { name: 'TLS and certificate evidence' })).toBeVisible();
  await page.setViewportSize({ width: 393, height: 852 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Open synthetic Case' }).click();
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await expect(page.getByRole('heading', { name: 'Repeated evidence and material changes stay distinct' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Watchlist activity' })).toHaveCount(0);
  const mobileChangeArrows = page.locator('.change-list dd b');
  await expect(mobileChangeArrows.first()).toBeVisible();
  expect(await mobileChangeArrows.evaluateAll((arrows) => arrows.every((arrow) => {
    const row = arrow.closest('dd');
    if (!row) return false;
    const arrowBounds = arrow.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    return getComputedStyle(arrow).transform === 'none'
      && getComputedStyle(arrow, '::after').content.includes('↓')
      && arrowBounds.left >= rowBounds.left
      && arrowBounds.right <= rowBounds.right;
  }))).toBe(true);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeFocused();
  await expect(page.locator('.hero-full-title')).toBeVisible();
  await expect(page.locator('.hero-compact-title')).toHaveCount(1);
  await expect(page.locator('.hero-compact-title')).toBeHidden();
});

test('recovers safely from malformed and future tab state', async ({ page }) => {
  // Seed before application scripts run. The prerendered heading does not prove
  // onMount has finished reading (and removing) invalid tab state.
  await page.addInitScript(() => {
    const seeded = 'test:demo-invalid-state-seeded';
    if (sessionStorage.getItem(seeded)) return;
    sessionStorage.setItem('whoisleuth:synthetic-demo:v1', '{malformed');
    sessionStorage.setItem(seeded, '1');
  });
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Stored demo progress was invalid or unsupported and has been reset.');
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', JSON.stringify({ version: 99, profileReady: true })));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Stored demo progress was invalid or unsupported and has been reset.');
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
});

test('keeps progressing in memory when tab storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === 'whoisleuth:synthetic-demo:v1') throw new DOMException('Storage disabled', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.getByRole('heading', { name: 'Three candidates, two evidence origins' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Loaded three synthetic candidates.');
  await expect(page.getByRole('button', { name: /Bulk.*Upcoming/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  await expect(page.getByRole('heading', { name: 'Prioritise candidates without collapsing evidence' })).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Progress updated in memory');
});

test('uses immediate focus-safe transitions when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo');
  const start = page.getByRole('button', { name: 'Begin with Brands' });
  await start.focus();
  await start.press('Enter');
  await expect(page.getByRole('heading', { name: 'Define the official identity' })).toBeFocused();
  await expect(page.locator('#demo-workspace')).toHaveCSS('min-height', '0px');
  const firstTop = await workspaceTop(page);
  expect(await workspaceTop(page)).toBe(firstTop);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});
