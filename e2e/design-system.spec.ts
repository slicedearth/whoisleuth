import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, useTheme } from './helpers';
import { consoleDestinations } from '../frontend/src/lib/workspaces';

// Coverage for the shared design system: native-sized checkbox controls with
// correct label alignment, the Lookup result's grouped sections and local
// navigation, visually distinguishable action variants, and overflow-safe
// rendering of long untrusted values. Every lookup here is fulfilled from a
// local fixture route; nothing reaches a live registry.

const INTELLIGENCE_CAPABILITIES = {
  version: 1,
  runtime: 'express',
  authoritative: true,
  features: [
    { id: 'lookup', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
    { id: 'urlscan_search', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
    { id: 'urlhaus_host', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
    { id: 'threatfox_domain_ioc', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  ],
  controls: null,
  limitations: [],
};

// A deep-ish result with enough evidence groups to exercise the section
// navigation: assessment + DNS + HTTP evidence plus the always-present
// registry sources and raw response.
function sectionedLookupFixture(domain: string) {
  return {
    query: domain, type: 'domain', registrableDomain: domain,
    availability: {
      state: 'registered', confidence: 'high', domain,
      registrar: { name: 'Fixture Registrar LLC' },
      nameservers: [`ns1.${domain}`, `ns2.${domain}`],
      dns: {
        status: 'partial', source: 'dns', scanMode: 'deep', complete: false, truncated: false,
        records: { a: ['192.0.2.10'], aaaa: [], cname: [], ns: [`ns1.${domain}`], mx: [], spf: [], dmarc: [], caa: [] },
        diagnostics: { cname: { status: 'error', error: 'resolver timed out' } },
      },
      http: {
        version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z', scanMode: 'deep', source: 'http',
        durationMs: 100, complete: true, truncated: false, limitations: [], diagnostics: {},
        requestUrl: `https://${domain}/`, finalUrl: `https://${domain}/`, transportSecurity: 'https',
        redirectCount: 0, redirectLimitReached: false, crossOriginRedirect: false, httpsDowngrade: false,
        redirects: [], attempts: [],
        response: {
          status: 200, contentType: 'text/html', contentLanguage: null, server: null,
          declaredContentLength: null, capturedBodyBytes: 1024, bodyInspected: true, bodyTruncated: false,
          bodyHash: null, securityHeaders: {},
        },
      },
    },
    rdap: { upstreamStatus: 200, parsed: { domain, entitiesByRole: {} } },
    whois: { parsed: {}, chain: [] },
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
  };
}

test('optional intelligence checkboxes stay native-sized and aligned with their labels', async ({ page }) => {
  await page.route('**/api/capabilities', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(INTELLIGENCE_CAPABILITIES),
  }));
  await page.goto('/lookup');

  const group = page.getByRole('group', { name: 'Optional third-party intelligence' });
  await expect(group).toBeVisible();

  for (const size of [
    { width: 1280, height: 800 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(size);
    for (const option of await page.locator('.intelligence-option').all()) {
      const checkbox = option.locator('input[type="checkbox"]');
      const optionBox = await boundingBox(option);
      const checkboxBox = await boundingBox(checkbox);
      // Native control size: the global text-field sizing must not apply.
      expect(checkboxBox.width).toBeLessThanOrEqual(20);
      expect(checkboxBox.height).toBeLessThanOrEqual(20);
      // Contained inside its own label row.
      expect(checkboxBox.x).toBeGreaterThanOrEqual(optionBox.x - 1);
      expect(checkboxBox.x + checkboxBox.width).toBeLessThanOrEqual(optionBox.x + optionBox.width + 1);
      // Aligned with the first line of the label text, not floating below it.
      expect(checkboxBox.y).toBeGreaterThanOrEqual(optionBox.y - 1);
      expect(checkboxBox.y).toBeLessThanOrEqual(optionBox.y + 14);
    }
    await expectNoHorizontalOverflow(page);
  }

  // The control still operates by clicking its label text.
  const first = page.getByRole('checkbox', { name: /Search archived URLscan verdicts/ });
  await page.getByText('Search archived URLscan verdicts').click();
  await expect(first).toBeChecked();
});

test('empty Lookup shows the compact query card without result sections or local navigation', async ({ page }) => {
  await page.goto('/lookup');
  await expect(page.locator('#query')).toBeVisible();
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.locator('.local-nav')).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a data-heavy Lookup result groups evidence into navigable sections', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture('sectioned-result.invalid')),
  }));
  await page.goto('/lookup');
  await page.locator('#query').fill('sectioned-result.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const localNav = page.getByRole('navigation', { name: 'Result sections' });
  await expect(localNav).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Web & DNS' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Registry' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Raw data' })).toBeVisible();
  // Sections that have no evidence in this fixture offer no dead anchors.
  await expect(localNav.getByRole('link', { name: 'External intel' })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Web and DNS evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registry sources' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toBeVisible();
  await expect(page.getByLabel('Source diagnostics')).toContainText('rdap');

  // Structured registry sources stay open for review; the raw unified
  // response stays collapsed and subordinate.
  await expect(page.locator('.sources > details').first()).toHaveAttribute('open', '');
  await expect(page.locator('details.raw')).not.toHaveAttribute('open', '');

  // Keyboard operation: activating an anchor link moves to the section.
  const registryLink = localNav.getByRole('link', { name: 'Registry' });
  await registryLink.focus();
  await registryLink.press('Enter');
  await expect(page).toHaveURL(/#registry$/);
  await expect(page.locator('#registry')).toBeInViewport();

  // The DNS partial-observation warning is visible without extra interaction.
  await expect(page.getByText(/A resolver failure is not evidence that a record is absent/)).toBeVisible();

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await expectNoHorizontalOverflow(page);
  }

  // The local navigation stays a single scrollable row on narrow screens
  // rather than stacking into a tall block.
  const navBox = await boundingBox(localNav);
  expect(navBox.height).toBeLessThanOrEqual(64);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export evidence JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-evidence-sectioned-result\.invalid-.+\.json$/);
});

test('primary, secondary, and destructive actions are visually distinct', async ({ page }) => {
  await useTheme(page, 'dark');
  await page.goto('/brands');
  await page.evaluate(() => {
    const now = '2026-07-13T00:00:00.000Z';
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify([{
      id: 'design-profile', name: 'Design profile', officialDomains: ['official.invalid'], productNames: [],
      tlds: [], approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
      createdAt: now, updatedAt: now, pageBaseline: null,
    }]));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', 'design-profile');
  });
  await page.reload();

  const primary = page.getByRole('button', { name: 'New profile' });
  const neutral = page.getByRole('button', { name: 'Export JSON' }).first();
  const destructive = page.getByRole('button', { name: 'Delete' }).first();

  // Primary: bright gradient with dark text.
  await expect(primary).toHaveCSS('background-image', /linear-gradient/);
  await expect(primary).toHaveCSS('color', 'rgb(7, 16, 28)');
  // Secondary: flat panel, light text, no gradient.
  await expect(neutral).toHaveCSS('background-image', 'none');
  await expect(neutral).toHaveCSS('color', 'rgb(230, 232, 238)');
  // Destructive: rendered in the danger colour.
  await expect(destructive).toHaveCSS('color', 'rgb(255, 107, 107)');
});

test('long untrusted values wrap inside result tiles without page overflow', async ({ page }) => {
  const longLabel = 'a'.repeat(63);
  const domain = `${longLabel}.invalid`;
  const fixture = sectionedLookupFixture(domain);
  fixture.availability.nameservers = [`${'n'.repeat(60)}.${domain}`];
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(fixture),
  }));
  await page.goto('/lookup');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();

  await expect(page.getByRole('heading', { name: domain })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('every workspace renders without page-level overflow at narrow and wide widths', async ({ page }) => {
  for (const path of ['/', ...consoleDestinations.map(({ href }) => href), '/privacy']) {
    await page.goto(path);
    for (const size of [
      { width: 320, height: 640 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await expectNoHorizontalOverflow(page);
    }
  }
});

test('console and policy pages expose one consistent primary heading', async ({ page }) => {
  for (const [path, title, eyebrow] of [
    ['/dashboard', 'Investigation dashboard', 'Console'],
    ['/lookup', 'Lookup', 'Investigate'],
    ['/discover', 'Candidate discovery', 'Discover'],
    ['/bulk', 'Bulk analysis', 'Assess'],
    ['/monitor', 'Investigation workspace', 'Monitor'],
    ['/brands', 'Brand profiles', 'Protect'],
    ['/registry-support', 'Registry support', 'Reference'],
    ['/privacy', 'Privacy policy', 'Policy'],
  ]) {
    await page.goto(path);
    const heading = page.locator('.heading');
    await expect(heading).toHaveCount(1);
    await expect(heading.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(heading.locator('.eyebrow')).toHaveText(eyebrow);
  }
});
