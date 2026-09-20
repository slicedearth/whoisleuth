import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, migrateLegacyBrowserData, openDashboardGuidedInvestigation, useTheme } from './helpers';

const viewports = [
  { width: 320, height: 700 }, { width: 390, height: 844 },
  { width: 1024, height: 768 }, { width: 1280, height: 720 },
  { width: 1920, height: 1080 }, { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
] as const;

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('empty Monitor and Brands prioritise useful first actions across desktop and mobile themes', async ({ page }, testInfo) => {
  test.slow();
  await migrateLegacyBrowserData(page, {}, { clearStorage: true, destination: '/monitor' });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/monitor');
      const inbox = page.getByRole('region', { name: 'Review inbox', exact: true });
      await expect(inbox.getByRole('heading', { name: 'No retained review items', exact: true })).toBeVisible();
      const start = inbox.getByRole('link', { name: 'Investigate a domain', exact: true });
      await expect(start).toHaveAttribute('href', '/lookup');
      await expect(start).toBeInViewport();
      await expect(inbox.getByRole('group', { name: 'Review queue', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Evidence gaps', exact: true })).toHaveCount(0);
      await expect(page.locator('details.monitor-reports')).toHaveCount(0);
      await capture(page, testInfo, `monitor-empty-${theme}-${viewport.width}`);
      if (viewport.width <= 390) {
        await page.getByRole('tab', { name: /^Inbox/u }).focus();
        await page.keyboard.press('End');
        const rules = page.getByRole('tab', { name: /^Relationships/u });
        await expect(rules).toBeFocused();
        await expect(rules).toHaveAttribute('aria-selected', 'true');
        await expect(rules).toBeInViewport({ ratio: 1 });
        await page.reload();
        await expect(rules).toHaveAttribute('aria-selected', 'true');
        await expect(rules).toBeInViewport({ ratio: 1 });
      }

      await page.goto('/brands');
      const create = page.getByRole('button', { name: 'New profile', exact: true });
      await expect(create).toBeEnabled();
      await expect(page.getByRole('tablist', { name: 'Brands views', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export JSON', exact: true })).toHaveCount(0);
      await create.click();
      const form = page.getByRole('form', { name: 'Brand Profile', exact: true });
      await expect(form.getByLabel('Brand name', { exact: true })).toBeFocused();
      await form.getByLabel('Brand name', { exact: true }).fill('Example organisation');
      await form.getByLabel('Official domains', { exact: true }).fill('official.example');
      const options = form.locator('details.profile-options');
      await expect(options).toHaveCount(3);
      for (const option of await options.all()) await expect(option).toHaveJSProperty('open', false);
      await capture(page, testInfo, `brand-first-profile-${theme}-${viewport.width}`);
      await options.filter({ has: page.getByText('Rights and official channels', { exact: true }) }).locator(':scope > summary').click();
      await form.getByRole('button', { name: 'Add channel', exact: true }).click();
      await expect(form.getByLabel('Official channel 1 platform', { exact: true })).toBeVisible();
      await form.getByLabel('Official channel 1 exact public URL', { exact: true }).fill('https://social.example/official');
      await capture(page, testInfo, `brand-optional-fields-${theme}-${viewport.width}`, true);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/brands?view=assets');
  await expect(page.getByRole('tab', { name: /^Assets/u })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Brand asset register', exact: true })).toBeVisible();
});

test('retained guidance is compact beside the actual tool and expands through a native keyboard control', async ({ page }, testInfo) => {
  test.slow();
  const collectionRequests: string[] = [];
  page.on('request', (request) => { if (/\/api\/(?:lookup|availability|discover|ct-search|bulk)/u.test(request.url())) collectionRequests.push(request.url()); });
  await page.goto('/dashboard');
  await openDashboardGuidedInvestigation(page);
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('guide.example');
  await page.getByRole('button', { name: 'Start guide', exact: true }).click();
  await expect(page.locator('details.work-plan')).toHaveJSProperty('open', true);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/lookup');
      const plan = page.locator('details.work-plan');
      await expect(plan).toHaveJSProperty('open', false);
      await expect(page.locator('#query')).toBeInViewport();
      await capture(page, testInfo, `guide-compact-${theme}-${viewport.width}`);
      const summary = plan.locator(':scope > summary');
      await summary.focus();
      await summary.press('Enter');
      await expect(plan).toHaveJSProperty('open', true);
      await expect(summary).toBeFocused();
      await expect(plan.getByRole('combobox', { name: 'Review step', exact: true })).toBeVisible();
      await expect(plan.getByRole('button', { name: 'Review requests', exact: true })).toBeVisible();
      await capture(page, testInfo, `guide-expanded-${theme}-${viewport.width}`, true);
      await summary.press('Enter');
      await expect(plan).toHaveJSProperty('open', false);
    }
  }
  expect(collectionRequests).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 720 });
});
