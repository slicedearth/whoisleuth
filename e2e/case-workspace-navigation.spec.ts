import { expect, test } from './fixtures';
import { openCaseSection } from './console-navigation';
import { caseRecord, snapshot } from './case-test-fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, failNextBrowserLocalCollectionReadAfterWrite, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';

async function seedCases(page: import('@playwright/test').Page, destination = '/cases') {
  await page.goto('/cases');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [
      caseRecord({ id: 'workspace-first', domain: 'first-work.example', evidenceHistory: [snapshot()] }),
      caseRecord({ id: 'workspace-second', domain: 'second-work.example' }),
    ] }),
  }, { destination });
}

test('Case detail replaces the list and returns to its retained filters and focus', async ({ page }) => {
  await seedCases(page);
  const search = page.getByRole('textbox', { name: 'Search', exact: true });
  await search.fill('first-work');
  const row = page.locator('#case-head-workspace-first');
  await row.click();
  await expect(page).toHaveURL('/cases?case=workspace-first');
  await expect(page.getByRole('heading', { name: 'first-work.example', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved Cases', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Track a domain', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Case sections' }).getByRole('link')).toHaveText(['Summary', 'Evidence', 'Assessment', 'Response', 'History']);
  await expect(page.getByRole('group', { name: 'Case response presentation', includeHidden: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: /^Additional tags/, includeHidden: true })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Retained Case records' })).toContainText('1 snapshot');
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await expect(search).toHaveValue('first-work');
  await expect(page.locator('.case-head')).toHaveCount(1);
  await expect(row).toBeFocused();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'first-work.example', exact: true })).toBeVisible();
});

test('Case section changes preserve independent drafts and browser history without collecting', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/lookup**', async route => { requests.push(route.request().url()); await route.abort(); });
  await seedCases(page, '/cases?case=workspace-first');
  await openCaseSection(page, 'History');
  await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Unsaved note');
  await page.getByRole('textbox', { name: 'What did you do or decide?', exact: true }).fill('Unsaved manual step');
  await openCaseSection(page, 'Assessment');
  await page.getByRole('textbox', { name: 'Conclusion summary', exact: true }).fill('Unsaved conclusion');
  await openCaseSection(page, 'Response');
  await page.getByRole('textbox', { name: 'Recipient or owner', exact: true }).fill('Unsaved recipient');
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Conclusion summary', exact: true })).toHaveValue('Unsaved conclusion');
  await openCaseSection(page, 'History');
  await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('Unsaved note');
  await expect(page.getByRole('textbox', { name: 'What did you do or decide?', exact: true })).toHaveValue('Unsaved manual step');
  await openCaseSection(page, 'Response');
  await expect(page.getByRole('textbox', { name: 'Recipient or owner', exact: true })).toHaveValue('Unsaved recipient');
  expect(requests).toEqual([]);
});

test('a committed Case history write with a failed reread is not offered as a failed save', async ({ page }) => {
  await seedCases(page, '/cases?case=workspace-first&section=history');
  await expect(page.getByRole('textbox', { name: 'What did you do or decide?', exact: true })).toBeVisible();
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await page.getByRole('textbox', { name: 'What did you do or decide?', exact: true }).fill('Reviewed the retained evidence');
  await page.getByRole('button', { name: 'Record manual step', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('The change was saved, but Cases could not be reread.');
  await expect(page.getByRole('textbox', { name: 'What did you do or decide?', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Record manual step', exact: true })).toBeFocused();
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(saved.records.find(item => item.value.id === 'workspace-first')?.value.manualTrail).toHaveLength(1);
});

test('legacy response deep links still open the packet and Case follow-up keeps an exact scope', async ({ page }) => {
  await seedCases(page, '/monitor?view=cases&case=workspace-first&response=1#case-response-workspace-first');
  await expect(page).toHaveURL('/cases?case=workspace-first&response=1#case-response-workspace-first');
  await expect(page.getByRole('navigation', { name: 'Case sections' }).getByRole('link', { name: 'Response', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#case-response-preflight-workspace-first')).toHaveAttribute('open', '');
  await expect(page.locator('#case-response-preflight-workspace-first > summary')).toBeFocused();
  await openCaseSection(page, 'History');
  await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Keep this draft through response navigation');
  await page.goBack();
  await expect(page.locator('#case-response-preflight-workspace-first > summary')).toBeFocused();
  await expect(page.locator('#case-response-preflight-workspace-first > summary')).toBeInViewport({ ratio: 1 });
  await page.goForward();
  await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('Keep this draft through response navigation');
  await page.getByRole('link', { name: 'Review follow-up', exact: true }).click();
  await expect(page).toHaveURL('/monitor?view=inbox&queue=all&case-review=workspace-first');
  await expect(page.getByRole('group', { name: 'Review queue' })).toContainText('Selected Case');
  await expect(page.getByRole('link', { name: 'Show all Cases', exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`Case sections stay usable across mobile and wide desktop in ${theme}`, async ({ page }, testInfo) => {
    await seedCases(page, '/cases?case=workspace-first');
    await useTheme(page, theme);
    for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
      await page.setViewportSize(viewport);
      for (const section of ['Summary', 'Evidence', 'Assessment', 'Response', 'History'] as const) {
        await openCaseSection(page, section);
        await expectNoHorizontalOverflow(page);
      }
      await openCaseSection(page, 'Summary');
      await page.screenshot({ path: testInfo.outputPath(`case-${theme}-${viewport.width}.png`), fullPage: true });
    }
  });
}
