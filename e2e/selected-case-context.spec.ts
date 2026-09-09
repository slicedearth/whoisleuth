import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { TEST_SITE_PASSWORD } from './constants';
import { caseRecord, snapshot } from './case-test-fixtures';
import { currentActionFixture } from './case-response-fixtures';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import { currentBrowserLocalDocument, expandLookupFamilies, expectNoHorizontalOverflow, failNextBrowserLocalCollectionRead, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';

const DOMAIN = 'selected-context.example';
const CASE_ID = 'selected-context';
const WHEN = '2026-06-01T00:00:00.000Z';

async function seed(page: Page) {
  const record = {
    ...caseRecord({ id: CASE_ID, domain: DOMAIN, disposition: 'suspicious', evidenceHistory: [snapshot()],
      evidencePins: [{ id: 'context-pin', label: 'Observed credential field', value: 'A password field was observed.', source: 'Fixture HTTP capture', observedAt: WHEN, createdAt: WHEN, collectionDepth: 'deep', completeness: 'partial', limitations: ['The source capture was incomplete.'] }],
      assertions: [{ id: 'context-hypothesis', kind: 'hypothesis', statement: 'The page may impersonate an account portal.', rationale: 'Analyst hypothesis, not a source verdict.', evidencePinIds: ['context-pin'], state: 'open', createdAt: WHEN, updatedAt: WHEN }],
      actions: [currentActionFixture({ id: 'context-action', type: 'security_contact_report', recipient: 'security@example.test', contactSource: 'Reviewed public contact', routeObservedAt: WHEN, contactLimitations: ['Manual submission only.'], dueAt: null, targetState: 'acknowledged', reference: 'receipt-example', followUpAt: '2026-06-08T00:00:00.000Z', outcome: 'Receipt acknowledged; no independent removal finding.', createdAt: WHEN, updatedAt: '2026-06-02T00:00:00.000Z' })],
    }),
    decisions: [{ id: 'context-decision', summary: 'Review the suspected impersonation', rationale: 'The retained field needs corroborating evidence.', confidence: 'unknown', confidenceBasis: 'The capture is partial.', evidencePinIds: ['context-pin'], createdAt: WHEN }],
  };
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [record, caseRecord({ id: 'other-context', domain: 'other-context.example' })] }) }, { destination: `/cases?case=${CASE_ID}` });
  await expect(page.locator(`#case-head-${CASE_ID}`)).toHaveAttribute('aria-expanded', 'true');
}

async function navigate(page: Page, label: string) {
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: new RegExp(`^${label}\\b`, 'u') }).click();
}

test('selected Case context follows tool navigation without changing saved evidence or collecting', async ({ page }) => {
  await seed(page);
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const collections: string[] = [];
  page.on('request', (request) => { if (/\/api\/(?:lookup|discover|bulk|mail)/u.test(request.url())) collections.push(request.url()); });
  await expect(page.getByRole('region', { name: 'Selected Case', exact: true })).toHaveCount(0);
  await navigate(page, 'Bulk');
  const context = page.getByRole('region', { name: 'Selected Case', exact: true });
  await expect(context.getByRole('link', { name: DOMAIN, exact: true })).toBeVisible();
  await context.locator('summary').click();
  await expect(context.getByRole('region', { name: 'Case hypotheses' })).toContainText('may impersonate');
  await expect(context.getByRole('region', { name: 'Case decisions' })).toContainText('needs corroborating evidence');
  await expect(context.getByRole('region', { name: 'Case evidence pins' })).toContainText('source capture was incomplete');
  await expect(context.getByRole('region', { name: 'Case report history' })).toContainText('receipt-example');
  await expect(context.getByRole('region', { name: 'Case report history' })).toContainText('no independent removal finding');
  await expect(context.getByRole('region', { name: 'Case follow-up dates' }).locator('time')).toHaveAttribute('datetime', '2026-06-08T00:00:00.000Z');
  for (const label of ['Lookup', 'Discover', 'Brands', 'Monitor', 'Dashboard']) {
    await navigate(page, label);
    await expect(context.getByRole('link', { name: DOMAIN, exact: true })).toBeVisible();
  }
  expect(collections).toEqual([]);
  const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(after.manifest.revision).toBe(before.manifest.revision);
  expect(after.records).toEqual(before.records);
  await context.getByRole('button', { name: 'Clear Case selection' }).click();
  await expect(context).toHaveCount(0);
  await expect(page.getByRole('main')).toBeFocused();
  expect((await readBrowserLocalCollection(page, 'cases')).records).toHaveLength(2);
});

test('an unrelated Lookup does not replace context until an explicit Case action commits', async ({ page }) => {
  await seed(page);
  await navigate(page, 'Lookup');
  const context = page.getByRole('region', { name: 'Selected Case', exact: true });
  let requests = 0;
  await page.route('**/api/lookup?*', async (route) => { requests += 1; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture('different-context.example')) }); });
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.locator('#query').fill('different-context.example');
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'different-context.example', exact: true })).toBeVisible();
  await expect(context.getByRole('link', { name: DOMAIN, exact: true })).toBeVisible();
  await expandLookupFamilies(page);
  await page.locator('.case-card').getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(context.getByRole('link', { name: 'different-context.example', exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await navigate(page, 'Bulk');
  await expect(context.getByRole('link', { name: 'different-context.example', exact: true })).toBeVisible();
});

test('Case context rereads on focus, reports failed reads and recovers without a write', async ({ page, context: browser }) => {
  await seed(page);
  await navigate(page, 'Bulk');
  const context = page.getByRole('region', { name: 'Selected Case', exact: true });
  await expect(context.getByRole('link', { name: DOMAIN, exact: true })).toBeVisible();
  await failNextBrowserLocalCollectionRead(page, 'cases');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(context).toContainText('Its saved state is unknown.');
  await expect(context.getByRole('link', { name: DOMAIN, exact: true })).toHaveCount(0);
  await context.getByRole('button', { name: 'Retry Case read' }).click();
  await expect(context.getByRole('link', { name: DOMAIN, exact: true })).toBeVisible();
  const peer = await browser.newPage();
  try {
    await peer.goto(`/cases?case=${CASE_ID}`);
    await expect(peer.locator(`#case-head-${CASE_ID}`)).toHaveAttribute('aria-expanded', 'true');
    peer.once('dialog', (dialog) => dialog.accept());
    await peer.locator(`#case-delete-${CASE_ID}`).click();
    await expect(peer.getByRole('status', { name: 'Case workspace action status' })).toContainText(`Deleted the case for ${DOMAIN}`);
  } finally { await peer.close(); }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(context).toContainText('no longer in this browser workspace');
  await expect(context.getByRole('link', { name: 'other-context.example', exact: true })).toHaveCount(0);
});

test('Case links retain modified-click behaviour and selection clears on reload and sign-out', async ({ page, context: browser }) => {
  await seed(page);
  await navigate(page, 'Bulk');
  const context = page.getByRole('region', { name: 'Selected Case', exact: true });
  const opened = browser.waitForEvent('page');
  await context.getByRole('link', { name: DOMAIN, exact: true }).click({ modifiers: ['ControlOrMeta'] });
  const peer = await opened;
  try { await expect(peer).toHaveURL(`/cases?case=${CASE_ID}`); await expect(peer.locator(`#case-head-${CASE_ID}`)).toHaveAttribute('aria-expanded', 'true'); }
  finally { await peer.close(); }
  await expect(page).toHaveURL('/bulk');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bulk', exact: true })).toBeVisible();
  await expect(context).toHaveCount(0);
  await navigate(page, 'Cases');
  await page.locator(`#case-head-${CASE_ID}`).click();
  await navigate(page, 'Bulk');
  await expect(context).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Password').fill(TEST_SITE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(context).toHaveCount(0);
  expect((await readBrowserLocalCollection(page, 'cases')).records).toHaveLength(2);
});

test('selected Case context has compact native controls and readable expanded content across viewports', async ({ page }, testInfo) => {
  test.slow();
  await seed(page);
  await navigate(page, 'Bulk');
  const context = page.getByRole('region', { name: 'Selected Case', exact: true });
  for (const theme of ['light', 'dark']) {
    await useTheme(page, theme as 'light' | 'dark');
    for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      await expect(context.getByRole('link', { name: DOMAIN, exact: true })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(context.locator('details')).not.toHaveAttribute('open');
      const collapsed = await context.boundingBox();
      expect(collapsed).not.toBeNull();
      expect(collapsed!.height).toBeLessThan(viewport.height / 3);
      const summary = context.locator('summary');
      await summary.focus(); await page.keyboard.press('Enter');
      await expect(context.locator('details')).toHaveAttribute('open', '');
      await expect(summary).toBeFocused();
      await expect(context.getByRole('heading', { name: 'Selected evidence (1 pin)', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const clear = await context.getByRole('button', { name: 'Clear Case selection' }).boundingBox();
      expect(clear).not.toBeNull(); expect(clear!.height).toBeGreaterThanOrEqual(44);
      const disclosure = await summary.boundingBox();
      expect(disclosure).not.toBeNull();
      const focusExtent = await summary.evaluate((element) => {
        const style = getComputedStyle(element);
        return Math.max(0, Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset));
      });
      expect(disclosure!.y - focusExtent).toBeGreaterThanOrEqual(clear!.y + clear!.height);
      await page.evaluate(() => window.scrollTo(0, 0));
      const name = `selected-case-${theme}-${viewport.width}.png`;
      const path = testInfo.outputPath(name); await page.screenshot({ path }); await testInfo.attach(name, { path, contentType: 'image/png' });
      await summary.focus(); await page.keyboard.press('Enter');
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
});
