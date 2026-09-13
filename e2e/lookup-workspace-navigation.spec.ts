import { expect, test } from './fixtures';
import { expectLookupTargetAligned, INTELLIGENCE_CAPABILITIES, sectionedLookupFixture } from './lookup-design-fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { caseRecord } from './case-test-fixtures';

test('Lookup evidence navigation and its target remain below the console header', async ({ page }, testInfo) => {
  test.slow();
  await page.route('**/api/lookup?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture('workspace-evidence.invalid')),
  }));
  await page.goto('/lookup');
  await page.locator('#query').fill('workspace-evidence.invalid');
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.locator('#result')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[1280, 720], [1024, 768], [390, 844], [320, 700], [1920, 1080], [2560, 1440]]) {
      await page.setViewportSize({ width: width!, height: height! });
      const expand = page.getByRole('button', { name: 'Expand Registration evidence', exact: true });
      if (!await expand.count()) await page.getByRole('button', { name: 'Collapse Registration evidence', exact: true }).click();
      await expand.click();
      await expectLookupTargetAligned(page, '#registry');
      await expect(page.locator('#registry [data-deferred-state="loading"]')).toHaveCount(0);
      await expect(page.locator('#result')).not.toHaveClass(/lookup-scroll-aligning/u);
      await expectLookupTargetAligned(page, '#registry');
      const geometry = await page.evaluate(() => {
        const header = document.querySelector('.shell > header');
        const navigation = document.querySelector('.local-nav-shell');
        const target = document.getElementById('registry');
        if (!header || !navigation || !target) throw new Error('Lookup navigation geometry is unavailable.');
        return { headerBottom: header.getBoundingClientRect().bottom, navTop: navigation.getBoundingClientRect().top,
          navBottom: navigation.getBoundingClientRect().bottom, targetTop: target.getBoundingClientRect().top };
      });
      expect(geometry.navTop).toBeGreaterThanOrEqual(geometry.headerBottom + 4);
      expect(geometry.targetTop).toBeGreaterThanOrEqual(geometry.navBottom + 4);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`lookup-navigation-${theme}-${width}.png`) });
    }
  }
});

test('Lookup keeps completed evidence identity and a return to the saved Case without recollecting', async ({ page }) => {
  const id = 'lookup-workspace-case';
  const domain = 'workspace-evidence.invalid';
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [caseRecord({ id, domain })] }),
  }, { destination: `/cases?case=${id}` });
  await expect(page.locator(`#case-head-${id}`)).toBeVisible();
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  let collections = 0;
  await page.route('**/api/lookup?*', route => {
    collections += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture(domain)) });
  });
  await page.getByRole('link', { name: 'Look up domain', exact: true }).click();
  const selected = page.getByRole('region', { name: 'Selected Case', exact: true });
  await expect(selected.getByRole('link', { name: domain, exact: true })).toBeVisible();
  await page.reload();
  await expect(selected.getByRole('link', { name: domain, exact: true })).toBeVisible();
  expect(collections).toBe(0);
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  const header = page.locator('.result-head');
  await expect(header.getByRole('heading', { name: domain, exact: true })).toBeVisible();
  await expect(header).toContainText('Deep lookup');
  const observed = await header.locator('time').getAttribute('datetime');
  expect(observed).toBe('2026-07-13T00:00:00.000Z');
  await page.getByRole('radio', { name: /Fast/u }).check();
  await page.locator('#query').fill('different-workspace.invalid');
  await expect(header).toContainText('Deep lookup');
  await expect(header.locator('time')).toHaveAttribute('datetime', observed!);
  await header.getByRole('link', { name: 'Open saved Case', exact: true }).click();
  await expect(page).toHaveURL(`/cases?case=${id}`);
  await page.getByRole('link', { name: 'Return to Lookup', exact: true }).click();
  await expect(header.getByRole('heading', { name: domain, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Case and response evidence', exact: true })).toBeVisible();
  expect(collections).toBe(1);
  const after = await readBrowserLocalCollection(page, 'cases');
  expect(after.manifest.revision).toBe(before.manifest.revision);
  expect(after.records).toEqual(before.records);
});

test('explicit Lookup Case context can be cleared and invalid references do not select another record', async ({ page }) => {
  const id = 'lookup-linked-case';
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [caseRecord({ id, domain: 'linked-case.invalid' })] }),
  }, { destination: `/lookup?q=linked-case.invalid&case=${id}` });
  const selected = page.getByRole('region', { name: 'Selected Case', exact: true });
  await expect(selected).toContainText('linked-case.invalid');
  await selected.getByRole('button', { name: 'Clear Case selection' }).click();
  await page.evaluate(() => { location.hash = 'query'; });
  await expect(selected).toHaveCount(0);
  await page.goto('/lookup?q=linked-case.invalid&case=invalid%20reference');
  await expect(page.getByRole('status').filter({ hasText: 'The Case reference is invalid.' })).toBeVisible();
  await expect(selected).toHaveCount(0);
  await page.goto('/lookup?case=missing-workspace-case');
  await expect(selected).toContainText('no longer in this workspace');
  expect((await readBrowserLocalCollection(page, 'cases')).records).toHaveLength(1);
});

test('optional sources are compact, keyboard accessible and retain explicit Deep consent', async ({ page }, testInfo) => {
  await page.route('**/api/capabilities', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(INTELLIGENCE_CAPABILITIES),
  }));
  let collections = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/lookup') collections += 1; });
  await page.goto('/lookup');
  await page.locator('#query').fill('optional-evidence.invalid');
  const summary = page.locator('.optional-sources > summary');
  const option = page.getByRole('checkbox', { name: /Search archived URLscan verdicts/u });
  await expect(summary).toContainText('None selected');
  await expect(page.locator('.optional-sources')).not.toHaveAttribute('open', '');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(option).toBeVisible();
  await expect(option).toBeDisabled();
  await page.getByRole('radio', { name: /Deep/u }).check();
  await option.check();
  await summary.click();
  await expect(summary).toContainText('1 selected for Deep');
  await expect(option).not.toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[1280, 720], [1024, 768], [390, 844], [320, 700], [1920, 1080], [2560, 1440]]) {
      await page.setViewportSize({ width: width!, height: height! });
      await page.locator('#query').scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`lookup-form-${theme}-${width}.png`) });
    }
  }
  await page.getByRole('radio', { name: /Fast/u }).check();
  await expect(summary).toContainText('1 selected for Deep');
  await summary.click();
  await expect(option).toBeChecked();
  await expect(option).toBeDisabled();
  expect(collections).toBe(0);
});
