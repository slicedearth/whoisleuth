import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { caseRecord } from './case-test-fixtures';
import { openCaseMetadata, openInboxReview } from './console-navigation';
import { migrateLegacyBrowserData, readBrowserLocalCollection, expectNoHorizontalOverflow, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { REVIEW_SESSION_SCHEMA, REVIEW_SESSION_VERSION } from '../packages/contracts/review-session-contract.mts';

const NOW = '2026-09-13T10:00:00.000Z';
test.use({ timezoneId: 'America/New_York' });
async function seed(page: Page, count = 30) {
  await page.clock.setFixedTime(NOW);
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION,
    cases: Array.from({ length: count }, (_, index) => caseRecord({ id: `resume-${String(index).padStart(2, '0')}`, domain: `resume${String(index).padStart(2, '0')}.example`,
      status: 'new', evidenceHistory: [], createdAt: NOW, updatedAt: NOW })),
  } }, { clearStorage: true, destination: '/monitor?view=inbox&queue=all' });
}
async function checkpoint(page: Page) {
  const control = page.locator('.review-session');
  if (await control.getAttribute('open') === null) await control.locator(':scope > summary').click();
  await expect(control.getByRole('button', { name: 'Save current position', exact: true })).toBeEnabled();
  return control;
}

test('review navigation spans pages and an explicit checkpoint restores filters, selection and separate drafts', async ({ page }, testInfo) => {
  const requests: string[] = [];
  await page.route(/\/api\/(lookup|dns|tls|certificates?|certificate-transparency)(\/|\?|$)/u, async route => { requests.push(route.request().url()); await route.abort(); });
  await seed(page);
  const inbox = page.getByRole('region', { name: 'Review inbox', exact: true });
  await inbox.getByText('Advanced filters', { exact: true }).click();
  await inbox.getByRole('combobox', { name: 'Item type', exact: true }).selectOption('case');
  await inbox.getByRole('combobox', { name: 'Source', exact: true }).selectOption('case');
  const items = inbox.locator('.items > li');
  await expect(items).toHaveCount(25);
  await openInboxReview(items.first());
  await items.first().locator('details.lifecycle-controls > summary').click();
  await items.first().getByRole('combobox', { name: 'Review outcome', exact: true }).selectOption('open');
  await items.first().getByLabel('Rationale', { exact: true }).fill('Unfinished first review.\nKeep the contrary observation.');
  await items.first().getByLabel('Next review', { exact: true }).fill('2026-10-15T12:30:45.678');
  const firstTitle = await items.first().getByRole('heading').textContent();
  await openInboxReview(items.nth(24));
  await items.nth(24).getByRole('button', { name: 'Next item', exact: true }).click();
  const pages = inbox.getByRole('navigation', { name: 'Review inbox pages', exact: true });
  await expect(pages.getByRole('status')).toHaveText('Page 2 of 2');
  await expect(items).toHaveCount(5);
  await expect(items.first().locator(':scope > details > summary')).toBeFocused();
  const selectedTitle = await items.first().getByRole('heading').textContent();
  let control = await checkpoint(page);
  await control.getByRole('button', { name: 'Save current position', exact: true }).click();
  await expect(control.getByRole('status')).toContainText('Review position saved');
  const cases = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 30 });
  const saved = (await readBrowserLocalCollection(page, 'review_session', { minimumRecords: 1 })).records[0]!.value;
  expect(saved.drafts).toHaveLength(1);
  expect(saved.drafts[0]!.rationale).toContain('contrary observation');
  await page.reload();
  control = await checkpoint(page);
  await control.getByRole('button', { name: 'Resume saved review', exact: true }).click();
  await expect(pages.getByRole('status')).toHaveText('Page 2 of 2');
  await expect(items.first().getByRole('heading')).toHaveText(selectedTitle!);
  await expect(items.first().locator(':scope > details > summary')).toBeFocused();
  await inbox.getByText('Advanced filters', { exact: true }).click();
  await expect(inbox.getByRole('combobox', { name: 'Item type', exact: true })).toHaveValue('case');
  await expect(inbox.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue('case');
  await items.first().getByRole('button', { name: 'Previous item', exact: true }).click();
  await expect(pages.getByRole('status')).toHaveText('Page 1 of 2');
  await expect(items.nth(24).locator(':scope > details > summary')).toBeFocused();
  await openInboxReview(items.first());
  await expect(items.first().getByRole('heading')).toHaveText(firstTitle!);
  await items.first().locator('details.lifecycle-controls > summary').click();
  await expect(items.first().getByLabel('Rationale', { exact: true })).toHaveValue('Unfinished first review.\nKeep the contrary observation.');
  await expect(items.first().getByLabel('Next review', { exact: true })).toHaveValue('2026-10-15T12:30:45.678');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 30 })).records).toEqual(cases.records);
  expect((await readBrowserLocalCollection(page, 'analyst_review_state')).records).toHaveLength(0);
  await items.first().getByRole('button', { name: 'Record decision', exact: true }).click();
  const decision = (await readBrowserLocalCollection(page, 'analyst_review_state', { minimumRecords: 1 })).records[0]!.value;
  expect(decision.reviewDueAt).toBe('2026-10-15T12:30:45.678Z');
  expect(decision.rationale).toBe('Unfinished first review. Keep the contrary observation.');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720]] as const) {
      await page.setViewportSize({ width, height }); await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`review-session-${theme}-${width}.png`), fullPage: true });
    }
  }
  expect(requests).toEqual([]);
});

test('saving a review position rejects a peer-tab creation or replacement until explicitly reloaded', async ({ page, context }) => {
  await seed(page, 2);
  const peer = await context.newPage();
  try {
    await peer.clock.setFixedTime(NOW); await peer.goto('/monitor?view=inbox&queue=all');
    const current = await checkpoint(page), other = await checkpoint(peer);
    await current.getByRole('button', { name: 'Save current position', exact: true }).click();
    await expect(current.getByRole('status')).toContainText('Review position saved');
    const first = (await readBrowserLocalCollection(page, 'review_session', { minimumRecords: 1 })).records;
    await other.getByRole('button', { name: 'Save current position', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Another tab saved a review position');
    expect((await readBrowserLocalCollection(peer, 'review_session', { minimumRecords: 1 })).records).toEqual(first);
    await other.getByRole('button', { name: 'Reload saved position', exact: true }).click();
    await other.getByRole('button', { name: 'Save current position', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Review position saved');
    await current.getByRole('button', { name: 'Save current position', exact: true }).click();
    await expect(current.getByRole('status')).toContainText('Nothing was overwritten');
  } finally { await peer.close(); }
});

test('returning from a Case revalidates the saved review and blocks an older-evidence draft', async ({ page }) => {
  await seed(page, 1);
  const item = page.locator('.review-inbox .items > li').first();
  await openInboxReview(item); await item.locator('details.lifecycle-controls > summary').click();
  await item.getByRole('combobox', { name: 'Review outcome', exact: true }).selectOption('open');
  await item.getByLabel('Rationale', { exact: true }).fill('An earlier-evidence draft.');
  const control = await checkpoint(page);
  await control.getByRole('button', { name: 'Save current position', exact: true }).click();
  await expect(control.getByRole('status')).toContainText('Review position saved');
  await item.getByRole('link', { name: 'Review', exact: true }).click();
  await openCaseMetadata(page);
  await page.getByRole('combobox', { name: /^Status/u }).selectOption('reviewing');
  await expect(page.getByRole('status', { name: 'Case workspace action status', exact: true })).toContainText('Set resume00.example to Reviewing.');
  await page.reload();
  await page.getByRole('link', { name: 'Return to saved review', exact: true }).click();
  await expect(page.locator('.review-session').getByRole('status')).toContainText('changed since this checkpoint');
  await item.locator('details.lifecycle-controls > summary').click();
  await expect(item.getByLabel('Rationale', { exact: true })).toHaveValue('An earlier-evidence draft.');
  await expect(item.getByRole('button', { name: 'Record decision', exact: true })).toBeDisabled();
  await item.getByRole('button', { name: 'Use draft with current evidence', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Record decision', exact: true })).toBeEnabled();
  expect((await readBrowserLocalCollection(page, 'analyst_review_state')).records).toHaveLength(0);
});

test('an uncertain restored review cannot be resubmitted and draft removal recovers keyboard focus', async ({ page }) => {
  await seed(page, 1);
  let item = page.locator('.review-inbox .items > li').first();
  await openInboxReview(item);
  await item.locator('details.lifecycle-controls > summary').click();
  await item.getByRole('combobox', { name: 'Review outcome', exact: true }).selectOption('open');
  await item.getByLabel('Rationale', { exact: true }).fill('Keep this uncertain review separate from committed decisions.');
  let control = await checkpoint(page);
  await control.getByRole('button', { name: 'Save current position', exact: true }).click();
  await expect(control.getByRole('status')).toContainText('Review position saved');
  const cases = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records.map(record => record.value);
  const saved = (await readBrowserLocalCollection(page, 'review_session', { minimumRecords: 1 })).records[0]!.value;
  expect(saved.drafts).toHaveLength(1);
  const uncertainSaved = { ...saved, drafts: saved.drafts.map(draft => ({ ...draft, uncertain: true })) };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases },
    'whoisleuth-review-session-v1': { schema: REVIEW_SESSION_SCHEMA, version: REVIEW_SESSION_VERSION, records: [uncertainSaved] },
  }, { clearStorage: true, destination: '/monitor?view=inbox&queue=all' });
  control = await checkpoint(page);
  await control.getByRole('button', { name: 'Resume saved review', exact: true }).click();
  item = page.locator('.review-inbox .items > li').first();
  await item.locator('details.lifecycle-controls > summary').click();
  await expect(item.getByText('This draft may already have been saved.', { exact: false })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Record decision', exact: true })).toBeDisabled();
  await expect(item.getByLabel('Rationale', { exact: true })).toBeDisabled();
  const drafts = page.locator('.current-drafts');
  await drafts.locator(':scope > summary').click();
  await expect(drafts).toContainText('does not cancel or undo a write');
  await drafts.getByRole('button', { name: /^Discard uncertain draft 1:/u }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#review-inbox-title')).toBeFocused();
  await expect(drafts).toHaveCount(0);
  await item.locator('details.lifecycle-controls > summary').click();
  await expect(item.getByLabel('Rationale', { exact: true })).toHaveValue('');
  expect((await readBrowserLocalCollection(page, 'analyst_review_state')).records).toHaveLength(0);
  await control.getByRole('button', { name: 'Discard saved position and forms', exact: true }).click();
  await expect(control.getByRole('button', { name: 'Save current position', exact: true })).toBeFocused();
  expect((await readBrowserLocalCollection(page, 'review_session')).records).toHaveLength(0);
});
