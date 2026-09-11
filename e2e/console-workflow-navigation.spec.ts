import { expect, test } from './fixtures';
import { caseRecord, createCase, snapshot } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION } from '../packages/cases/case-model.mts';
import { expectNoHorizontalOverflow, failNextBrowserLocalCollectionRead, holdBrowserLocalTransaction, migrateLegacyBrowserData, openDashboardSecondaryWorkspaces, readBrowserLocalCollection, useTheme } from './helpers';
import { productionChunkPath } from './production-build';

test('search remains escapable while its destinations are loading or unavailable', async ({ page }) => {
  const chunk = productionChunkPath('src/lib/console-command-navigation.ts');
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${chunk}`, async route => {
    await pending;
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'throw new Error("Synthetic navigation module failure");' });
  });
  try {
    await page.goto('/dashboard');
    const trigger = page.getByRole('button', { name: 'Open console navigation', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Go to' });
    await expect(dialog.getByRole('status').filter({ hasText: 'Loading destinations' })).toBeVisible();
    await expect(dialog).not.toContainText('No matching destination');
    await expect(dialog.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    release();
    await trigger.click();
    await expect(dialog.getByRole('alert')).toContainText('Destinations could not be loaded');
    await expect(dialog.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByRole('button', { name: 'Reload destinations', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Saved work', exact: true }).click();
    await expect(dialog.getByRole('searchbox', { name: 'Search saved work' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.unroute(`**${chunk}`);
    await trigger.click();
    await dialog.getByRole('button', { name: 'Pages and tools', exact: true }).click();
    await dialog.getByRole('button', { name: 'Reload destinations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await trigger.click();
    await expect(dialog.getByRole('combobox')).toBeFocused();
    await expect(dialog.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByRole('option').first()).toBeVisible();
  } finally { release(); }
});

test('Dashboard rereads peer-tab saved work on focus and recovers a failed read without writing', async ({ page, context }) => {
  const collectionRequests: string[] = [];
  await context.route('**/api/lookup**', async route => { collectionRequests.push(route.request().url()); await route.abort(); });
  await seedWork(page);
  const recent = page.getByRole('region', { name: 'Recent Cases', exact: true });
  await expect(recent).toContainText('review.example');
  const peer = await context.newPage();
  try {
    await peer.goto('/cases');
    await createCase(peer, 'second-review.example');
    await page.bringToFront();
    const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
    // Chromium automation keeps every page focused; deliver the reactivation
    // event explicitly without reloading, altering storage or invoking app code.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(recent).toContainText('second-review.example');
    await expect(page).toHaveURL('/dashboard');
    await failNextBrowserLocalCollectionRead(page, 'cases');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const retry = page.getByRole('button', { name: 'Refresh saved-work summary', exact: true });
    await expect(retry).toBeEnabled();
    await expect(recent).toContainText('Cases could not be read');
    await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toHaveCount(0);
    await retry.click();
    await expect(recent).toContainText('second-review.example');
    await expect(retry).toHaveCount(0);
    await expect(recent.getByRole('heading', { name: 'Recent Cases', exact: true })).toBeFocused();
    await failNextBrowserLocalCollectionRead(page, 'cases');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(retry).toBeEnabled();
    const target = page.getByRole('textbox', { name: 'Investigate a target', exact: true });
    const release = await holdBrowserLocalTransaction(page);
    try {
      await retry.click();
      await expect(retry).toBeDisabled();
      await target.fill('unsaved.example');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    } finally { await release(); }
    await expect(retry).toHaveCount(0);
    await expect(target).toBeFocused();
    await expect(target).toHaveValue('unsaved.example');
    const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
    expect(after.manifest.revision).toBe(before.manifest.revision);
    expect(after.records).toEqual(before.records);
    expect(collectionRequests).toEqual([]);
  } finally { await peer.close(); }
});

async function seedWork(page: import('@playwright/test').Page) {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [caseRecord({
      id: 'navigation-case', domain: 'review.example',
      evidenceHistory: [snapshot({ riskModelVersion: null, profileContextState: 'unavailable' })],
    })] },
  }, { clearStorage: true, destination: '/dashboard' });
}

test('Dashboard opens its exact attention set and retains a direct recent Case destination', async ({ page }) => {
  const collectionRequests: string[] = [];
  await page.route('**/api/lookup**', async route => { collectionRequests.push(route.request().url()); await route.abort(); });
  await seedWork(page);
  const items = page.getByRole('list', { name: 'Items needing attention' });
  await expect(items.getByRole('link').first()).toBeVisible();
  const title = await items.getByRole('link').first().innerText();
  await page.getByRole('link', { name: 'Open review inbox', exact: true }).click();
  await expect(page).toHaveURL('/monitor?view=inbox&attention=1');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('region', { name: 'Recent Cases' }).getByRole('link', { name: /review\.example/ }).click();
  await expect(page).toHaveURL('/cases?case=navigation-case');
  await expect(page.locator('#case-head-navigation-case')).toBeVisible();
  expect(collectionRequests).toEqual([]);
});

test('a selected Dashboard review opens Case assessment and returns to the same inbox item', async ({ page }) => {
  const collectionRequests: string[] = [];
  await page.route('**/api/lookup**', async route => { collectionRequests.push(route.request().url()); await route.abort(); });
  await seedWork(page);
  const attention = page.getByRole('list', { name: 'Items needing attention' }).getByRole('link').first();
  const title = await attention.innerText();
  await attention.click();
  await expect(page).toHaveURL(/\/monitor\?view=inbox&attention=1&review=/u);
  const inboxUrl = new URL(page.url());
  const returnHref = `${inboxUrl.pathname}${inboxUrl.search}${inboxUrl.hash}`;
  const selected = page.getByRole('region', { name: 'Review inbox', exact: true }).locator('.items > li').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });
  const review = selected.getByRole('link', { name: 'Review', exact: true });
  await expect(review).toHaveAttribute('href', '/cases?case=navigation-case&section=assessment');
  await review.click();
  await expect(page.getByRole('navigation', { name: 'Case sections', exact: true }).getByRole('link', { name: 'Assessment', exact: true })).toHaveAttribute('aria-current', 'page');
  const returnLink = page.getByRole('link', { name: 'Return to review inbox', exact: true });
  await expect(returnLink).toHaveAttribute('href', returnHref);
  await returnLink.click();
  await expect(page).toHaveURL(returnHref);
  await expect(selected).toBeVisible();
  expect(collectionRequests).toEqual([]);
});

test('global saved-work search opens an existing Case without collecting and restores keyboard focus', async ({ page }) => {
  const collectionRequests: string[] = [];
  await page.route('**/api/lookup**', async route => { collectionRequests.push(route.request().url()); await route.abort(); });
  await seedWork(page);
  await page.goto('/lookup');
  const trigger = page.getByRole('button', { name: 'Open console navigation', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  await dialog.getByRole('button', { name: 'Saved work', exact: true }).click();
  const search = dialog.getByRole('searchbox', { name: 'Search saved work' });
  await expect(search).toBeFocused();
  await search.fill('review.example');
  const result = dialog.getByRole('list', { name: 'Local investigation search results' });
  await expect(result).toContainText('review.example');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Saved work', exact: true }).click();
  await dialog.getByRole('searchbox', { name: 'Search saved work' }).fill('review.example');
  await result.getByRole('link', { name: /^Open case/ }).click();
  await expect(page).toHaveURL('/cases?case=navigation-case');
  await expect(dialog).toHaveCount(0);
  expect(collectionRequests).toEqual([]);
});

test('review and monitoring navigation expose their own views and preserve history', async ({ page }) => {
  await page.goto('/monitor');
  const tabs = page.getByRole('tablist', { name: 'Monitor views' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await tabs.getByRole('tab', { name: /^Inbox/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /^Campaigns/ })).toBeFocused();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Monitoring', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(tabs.getByRole('tab', { name: /^Watchlists/ })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(tabs.getByRole('tab', { name: /^Campaigns/ })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/monitor?view=cases&case=navigation-case#case-response-navigation-case');
  await expect(page).toHaveURL('/cases?case=navigation-case#case-response-navigation-case');
});

test('global and embedded saved-work search keep independent labels and query drafts', async ({ page }) => {
  await seedWork(page);
  await openDashboardSecondaryWorkspaces(page);
  const embedded = page.getByRole('region', { name: 'Search saved work', exact: true });
  const embeddedInput = embedded.getByRole('searchbox', { name: 'Search saved work' });
  await embeddedInput.fill('embedded query');
  const embeddedId = await embeddedInput.getAttribute('id');
  await page.getByRole('button', { name: 'Open console navigation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  await dialog.getByRole('button', { name: 'Saved work', exact: true }).click();
  const globalInput = dialog.getByRole('searchbox', { name: 'Search saved work' });
  await expect(globalInput).toBeFocused();
  const globalId = await globalInput.getAttribute('id');
  expect(globalId).toBeTruthy();
  expect(globalId).not.toBe(embeddedId);
  await dialog.locator('label').filter({ hasText: 'Search saved work' }).click();
  await expect(globalInput).toBeFocused();
  await globalInput.fill('review.example');
  await expect(dialog.getByRole('list', { name: 'Local investigation search results' })).toContainText('review.example');
  await page.keyboard.press('Escape');
  await expect(embeddedInput).toHaveValue('embedded query');
});

for (const theme of ['light', 'dark'] as const) {
  test(`console work queue remains usable from mobile to wide desktop in ${theme}`, async ({ page }, testInfo) => {
    await seedWork(page);
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920, 2560]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await expect(page.getByRole('heading', { name: 'Attention needed', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`dashboard-${theme}-${width}.png`), fullPage: true });
    }
  });
}
