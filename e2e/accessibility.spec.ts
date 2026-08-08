import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { runBulkScan, useTheme } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const REQUIRED_MANUAL_RULES = new Set([
  'aria-prohibited-attr',
  'aria-valid-attr-value',
  'link-in-text-block',
]);
const REVIEWED_INCOMPLETE_RULES_BY_STATE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'public-initial-dark-desktop': ['color-contrast'],
  'public-resource-dark-desktop': ['color-contrast'],
  'public-error-dark-desktop': ['color-contrast'],
  'public-populated-expanded-light-mobile': ['color-contrast'],
  'public-contact-unavailable-dark-mobile': ['color-contrast'],
  'public-guide-dark-mobile': ['color-contrast'],
  'public-privacy-dark-mobile': ['color-contrast'],
  'public-resources-dark-mobile': ['color-contrast'],
  'public-terms-dark-mobile': ['color-contrast'],
  'public-request-policy-dark-mobile': ['color-contrast'],
  'console-initial-light-desktop': ['color-contrast'],
  'console-brands-initial-light-desktop': ['color-contrast'],
  'console-discover-initial-light-desktop': ['color-contrast'],
  'console-monitor-initial-light-desktop': ['color-contrast'],
  'console-drawer-dark-mobile': ['color-contrast', 'skip-link'],
  'console-registry-support-expanded-dark-mobile': ['color-contrast'],
  'console-lookup-populated-expanded-dark-desktop': ['color-contrast'],
  'console-bulk-populated-light-mobile': ['color-contrast'],
  'console-guided-investigation-request-review-light-desktop': ['color-contrast'],
  'public-login-dark-mobile': ['color-contrast'],
});

async function expectResolvedDocumentReferences(page: Page, state: string) {
  const integrity = await page.evaluate(() => {
    const duplicateIds = [...document.querySelectorAll<HTMLElement>('[id]')]
      .map((element) => element.id)
      .filter((id, index, ids) => id && ids.indexOf(id) !== index)
      .filter((id, index, ids) => ids.indexOf(id) === index);
    const missingReferences: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('[aria-controls],[aria-labelledby],[aria-describedby]')) {
      for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
        const references = element.getAttribute(attribute)?.trim().split(/\s+/u).filter(Boolean) ?? [];
        for (const reference of references) {
          if (!document.getElementById(reference)) {
            missingReferences.push(`${element.tagName.toLowerCase()}[${attribute}] -> #${reference}`);
          }
        }
      }
    }
    return { duplicateIds, missingReferences };
  });
  expect(integrity.duplicateIds, `${state} contained duplicate document IDs`).toEqual([]);
  expect(integrity.missingReferences, `${state} contained unresolved accessibility references`).toEqual([]);
}

async function expectNoAccessibilityViolations(page: Page, testInfo: TestInfo, state: string) {
  const startedAt = Date.now();
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .options({ rules: { 'target-size': { enabled: true } } })
    .analyze();
  const durationMs = Date.now() - startedAt;
  const reviewedIncompleteRules = REVIEWED_INCOMPLETE_RULES_BY_STATE[state];
  expect(reviewedIncompleteRules, `${state} has no reviewed incomplete-rule contract`).toBeDefined();
  expect(
    results.incomplete.map((result) => result.id).sort(),
    `${state} changed its reviewed incomplete accessibility rules`,
  ).toEqual([...(reviewedIncompleteRules ?? [])].sort());
  await testInfo.attach(`axe-${state}.json`, {
    body: JSON.stringify({
      state,
      durationMs,
      passes: results.passes.length,
      incomplete: results.incomplete.map((result) => result.id),
      inapplicable: results.inapplicable.length,
    }),
    contentType: 'application/json',
  });
  expect(results.violations, `${state} produced accessibility violations`).toEqual([]);
  const unresolvedRequiredRules = results.incomplete
    .filter((result) => REQUIRED_MANUAL_RULES.has(result.id))
    .map((result) => ({
      id: result.id,
      targets: result.nodes.map((node) => node.target),
    }));
  expect(
    unresolvedRequiredRules,
    `${state} left required accessibility rules unresolved`,
  ).toEqual([]);
  await expectResolvedDocumentReferences(page, state);
}

async function expectSequentialHeadingOrder(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
  expect(results.violations, `${state} produced a heading-order violation`).toEqual([]);
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

test('public and dashboard support content exposes semantic labels and link cues', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Synthetic WHOISleuth console preview' }),
  ).toBeVisible();
  const attribution = page.getByRole('link', { name: 'slicedearth' });
  expect(
    await attribution.evaluate((element) => getComputedStyle(element).textDecorationLine),
  ).toContain('underline');

  await page.goto('/dashboard');
  await expect(
    page.getByRole('navigation', { name: 'Investigation help' }),
  ).toBeVisible();
});

test('scans representative public initial, error, populated, and expanded states', async ({ page }, testInfo) => {
  test.slow();
  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expectNoAccessibilityViolations(page, testInfo, 'public-initial-dark-desktop');
  await expectSequentialHeadingOrder(page, 'public homepage');

  await page.goto('/resources/rdap-vs-whois');
  await expectNoAccessibilityViolations(page, testInfo, 'public-resource-dark-desktop');

  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
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
  const lookupEvidenceHeading = page.getByRole('heading', { name: 'Synthetic lookup evidence' });
  await expect(lookupEvidenceHeading).toHaveCSS('position', 'absolute');
  expect((await lookupEvidenceHeading.boundingBox())?.height).toBeLessThanOrEqual(1);
  await page.locator('.technology-card > summary').click();
  await expect(page.locator('.technology-card')).toHaveAttribute('open', '');
  await expectNoAccessibilityViolations(page, testInfo, 'public-populated-expanded-light-mobile');
  await expectSequentialHeadingOrder(page, 'public populated demo');
  await page.getByRole('button', { name: 'Open synthetic case in Monitor' }).click();
  const caseEvidenceHeading = page.getByRole('heading', { name: 'Synthetic case evidence' });
  await expect(caseEvidenceHeading).toHaveCSS('position', 'absolute');
  expect((await caseEvidenceHeading.boundingBox())?.height).toBeLessThanOrEqual(1);
  await expectSequentialHeadingOrder(page, 'public monitor demo');
});

test('scans public policy and protected-contact routes', async ({ page }, testInfo) => {
  test.slow();
  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/contact-route', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ available: false, siteKey: null, categories: [] }),
  }));

  for (const [route, state] of [
    ['/contact', 'public-contact-unavailable-dark-mobile'],
    ['/guide', 'public-guide-dark-mobile'],
    ['/privacy', 'public-privacy-dark-mobile'],
    ['/resources', 'public-resources-dark-mobile'],
    ['/terms', 'public-terms-dark-mobile'],
    ['/request-policy', 'public-request-policy-dark-mobile'],
  ] as const) {
    await page.goto(route);
    await expectNoAccessibilityViolations(page, testInfo, state);
    await expectSequentialHeadingOrder(page, state);
  }
});

test('scans authenticated desktop and expanded mobile drawer states', async ({ page }, testInfo) => {
  test.slow();
  await useTheme(page, 'light');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expectNoAccessibilityViolations(page, testInfo, 'console-initial-light-desktop');

  for (const [route, state] of [
    ['/brands', 'console-brands-initial-light-desktop'],
    ['/discover', 'console-discover-initial-light-desktop'],
    ['/monitor', 'console-monitor-initial-light-desktop'],
  ] as const) {
    await page.goto(route);
    await expectNoAccessibilityViolations(page, testInfo, state);
  }

  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/lookup');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await expectNoAccessibilityViolations(page, testInfo, 'console-drawer-dark-mobile');

  await page.goto('/registry-support');
  await page.getByLabel('Suffix or capability').fill('bv');
  await page.getByText('Review BV profile', { exact: true }).click();
  await expectNoAccessibilityViolations(page, testInfo, 'console-registry-support-expanded-dark-mobile');
});

test('scans populated Lookup, Bulk, and guided-investigation states', async ({ page }, testInfo) => {
  test.slow();
  await installLookupFixture(page);
  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/lookup');
  await page.locator('#query').fill('portal.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
  const visibility = page.getByRole('group', { name: 'Evidence family visibility' });
  const collapseAll = visibility.getByRole('button', { name: 'Collapse all' });
  const expandAll = visibility.getByRole('button', { name: 'Expand all' });
  await expect(collapseAll).toHaveAttribute('aria-disabled', 'true');
  await expandAll.click();
  await expect(expandAll).toBeFocused();
  await expect(expandAll).toHaveAttribute('aria-disabled', 'true');
  await collapseAll.click();
  await expect(collapseAll).toBeFocused();
  await expect(collapseAll).toHaveAttribute('aria-disabled', 'true');
  await expandAll.click();
  await page.locator('details.detailed-assessment > summary').click();
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

test.describe('anonymous login accessibility', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('scans the unauthenticated login form', async ({ page }, testInfo) => {
    await useTheme(page, 'dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Console sign-in' })).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo, 'public-login-dark-mobile');
    await expectSequentialHeadingOrder(page, 'public login');
  });
});
