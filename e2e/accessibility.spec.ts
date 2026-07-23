import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { runBulkScan, useTheme } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

async function expectNoAccessibilityViolations(page: Page, testInfo: TestInfo, state: string) {
  const startedAt = Date.now();
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const durationMs = Date.now() - startedAt;
  await testInfo.attach(`axe-${state}.json`, {
    body: JSON.stringify({
      state,
      durationMs,
      passes: results.passes.length,
      incomplete: results.incomplete.length,
      inapplicable: results.inapplicable.length,
    }),
    contentType: 'application/json',
  });
  expect(results.violations, `${state} produced accessibility violations`).toEqual([]);
}

async function installLookupFixture(page: Page) {
  await page.route('**/api/lookup?*', async (route) => {
    const url = new URL(route.request().url());
    const domain = url.searchParams.get('q') || 'portal.example.test';
    const diagnostics = {
      version: 7,
      rdap: { status: 'complete' },
      whois: { status: url.searchParams.get('fast') === '1' ? 'skipped' : 'complete' },
      availability: { status: 'complete' },
    };
    const availability = {
      applicable: true,
      state: 'registered',
      confidence: 'high',
      domain,
      deepScanComplete: url.searchParams.get('fast') !== '1',
      registrar: { name: 'Example Registrar' },
      nameservers: ['ns1.example.net', 'ns2.example.net'],
      dns: { status: 'complete', records: { a: ['192.0.2.10'], mx: ['10 mail.example.net'] } },
    };
    const body = url.searchParams.get('compact') === '1'
      ? { availability, diagnostics }
      : {
          query: domain,
          type: 'domain',
          inputHostname: domain,
          registrableDomain: domain,
          isSubdomain: false,
          availability,
          rdap: {
            upstreamStatus: 200,
            parsed: {
              handle: 'EXAMPLE-1',
              statuses: ['active'],
              lifecycle: { createdDate: '2020-01-02T03:04:05Z', updatedDate: '2026-06-07T08:09:10Z' },
              entities: [],
            },
          },
          whois: { parsed: { registrar: 'Example Registrar' }, chain: [] },
          diagnostics,
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test('scans representative public initial, error, populated, and expanded states', async ({ page }, testInfo) => {
  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expectNoAccessibilityViolations(page, testInfo, 'public-initial-dark-desktop');

  await page.goto('/demo');
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', '{malformed'));
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Stored demo progress was invalid');
  await expectNoAccessibilityViolations(page, testInfo, 'public-error-dark-desktop');

  await page.setViewportSize({ width: 390, height: 844 });
  await useTheme(page, 'light');
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Load synthetic candidates' }).click();
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await page.locator('.technology-card > summary').click();
  await expect(page.locator('.technology-card')).toHaveAttribute('open', '');
  await expectNoAccessibilityViolations(page, testInfo, 'public-populated-expanded-light-mobile');
});

test('scans authenticated desktop and expanded mobile drawer states', async ({ page }, testInfo) => {
  await useTheme(page, 'light');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expectNoAccessibilityViolations(page, testInfo, 'console-initial-light-desktop');

  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/lookup');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await expectNoAccessibilityViolations(page, testInfo, 'console-drawer-dark-mobile');
});

test('scans populated Lookup, Bulk, and guided-investigation states', async ({ page }, testInfo) => {
  await installLookupFixture(page);
  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/lookup');
  await page.locator('#query').fill('portal.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
  const registrySource = page.locator('.sources > details').first();
  await registrySource.locator(':scope > summary').click();
  await expect(registrySource).toHaveAttribute('open', '');
  await expectNoAccessibilityViolations(page, testInfo, 'console-lookup-populated-expanded-dark-desktop');

  await useTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bulk');
  await runBulkScan(page, ['portal.example.test', 'peer.example.test', 'mail.example.test']);
  await expect(page.locator('.results-table tbody tr')).toHaveCount(3);
  await expectNoAccessibilityViolations(page, testInfo, 'console-bulk-populated-light-mobile');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('portal.example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();
  const currentAction = page.locator('.guide .current-action');
  await currentAction.getByRole('button', { name: 'Review requests' }).click();
  await expect(currentAction.getByRole('region', { name: /Review requests for/ })).toBeVisible();
  await expectNoAccessibilityViolations(page, testInfo, 'console-guided-investigation-request-review-light-desktop');
});
