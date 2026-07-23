import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test('the Dashboard and console navigation expose the registry-support reference', async ({ page }) => {
  await page.goto('/dashboard');

  const dashboardLink = page.getByRole('link', { name: /Check domain-ending support/ });
  await expect(dashboardLink).toHaveAttribute('href', '/registry-support');
  await expect(page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Registry support' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Reference' }).getByRole('link', { name: 'Registry support' })).toHaveAttribute('href', '/registry-support');

  await dashboardLink.click();
  await expect(page).toHaveURL('/registry-support');
  await expect(page.getByRole('heading', { name: 'Registry support', exact: true })).toBeVisible();
});

test('the registry-support catalogue filters locally and retains explicit interpretation limits', async ({ page }) => {
  const unexpectedApiRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(pathname)) {
      unexpectedApiRequests.push(pathname);
    }
  });

  await page.goto('/registry-support');

  await expect(page.getByText('Catalogue v26')).toBeVisible();
  await expect(page.locator('.summary-grid article').filter({ hasText: 'Explicit suffixes' }).locator('strong')).toHaveText('312');
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await expect(page.locator('.result-count')).toContainText('Showing 1–50 of 312 matching profiles (312 total)');
  const standards = page.getByRole('region', { name: 'Generic TLD RDAP snapshot' });
  await expect(standards).toContainText('1113 / 1113');
  await expect(standards).toContainText('12 / 14');
  await expect(standards).toContainText('.edu');
  await expect(standards).toContainText('.mil');
  await expect(standards).toContainText('.arpa');

  await page.locator('#registry-sort-direction').selectOption('desc');
  await expect(page.locator('tbody tr').first().locator('td[data-label="Suffix"] > code')).toHaveText('.zw');
  await page.locator('#registry-sort-direction').selectOption('asc');

  const search = page.getByLabel('Suffix or capability');
  await search.fill('punktum domain');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('.dk');

  await search.fill('iana cc colon');
  await expect(page.locator('tbody tr')).toHaveCount(43);
  await expect(page.locator('tbody')).toContainText('.as');
  await expect(page.locator('tbody')).toContainText('.sr');
  await expect(page.locator('tbody')).toContainText('.to');
  await expect(page.locator('tbody')).toContainText('.zm');

  await search.fill('iana cc negative');
  await expect(page.locator('tbody tr')).toHaveCount(31);
  await expect(page.locator('tbody')).toContainText('.ag');
  await expect(page.locator('tbody')).toContainText('.vg');

  await search.fill('iana referral unverified');
  await expect(page.locator('tbody tr')).toHaveCount(17);
  await expect(page.locator('tbody')).toContainText('.bo');
  await expect(page.locator('tbody')).toContainText('.vi');

  await search.clear();
  await page.locator('#coverage-filter').selectOption('access_documented');
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await expect(page.locator('.result-count')).toContainText('Showing 1–50 of 94 matching profiles (312 total)');
  await expect(page.locator('tbody')).toContainText('.ao');
  await expect(page.locator('tbody')).toContainText('.ch');
  await expect(page.locator('tbody')).toContainText('.es');
  await expect(page.locator('tbody')).toContainText('.gr');
  await expect(page.locator('tbody')).toContainText('.arpa');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(44);
  await expect(page.locator('.result-count')).toContainText('Showing 51–94 of 94 matching profiles (312 total)');
  await expect(page.locator('tbody')).toContainText('.mil');
  await expect(page.locator('tbody')).toContainText('.vn');
  await expect(page.locator('tbody')).toContainText('.zw');

  await search.fill('no matching capability');
  await expect(page.getByRole('heading', { name: 'No matching profiles' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Coverage is not live registry status.' })).toBeVisible();
  expect(unexpectedApiRequests).toEqual([]);
});

test('profile details preserve provenance and safe external-link behavior', async ({ page }) => {
  await page.goto('/registry-support');
  await page.getByLabel('Suffix or capability').fill('uk');
  await page.getByText('Review UK profile').click();

  const row = page.locator('tbody tr');
  await expect(row).toContainText('Profile ID');
  await expect(row).toContainText('fixture coverage does not prove current reachability');
  const links = row.locator('a[target="_blank"]');
  await expect(links).toHaveCount(4);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
    await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/);
  }
});

test('the local inspector explains explicit and generic suffix support without a request', async ({ page }) => {
  const unexpectedApiRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(pathname)) unexpectedApiRequests.push(pathname);
  });
  await page.goto('/registry-support');

  const input = page.getByRole('searchbox', { name: 'Domain or suffix', exact: true });
  const inspectButton = page.getByRole('button', { name: 'Inspect support' });
  await expect(inspectButton).toBeEnabled();
  await input.fill('.com');
  await inspectButton.click();
  const result = page.locator('.inspection-card');
  await expect(result).toContainText('Generic fallback');
  await expect(result).toContainText('.com');
  await expect(result).toContainText('Discovery only');
  await expect(result).toContainText('IANA bootstrap discovery');

  await input.fill('.mil');
  await inspectButton.click();
  await expect(result).toContainText('Explicit suffix profile');
  await expect(result).toContainText('Sponsored');
  await expect(result).toContainText('No service published by IANA');

  await input.fill('portal.example.uk');
  await inspectButton.click();
  await expect(result).toContainText('Explicit suffix profile');
  await expect(result).toContainText('.uk');

  await input.fill('https://example.invalid/path');
  await inspectButton.click();
  await expect(page.getByRole('heading', { name: 'Unsupported input format' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.inspection-output')).toHaveCount(0);
  await expect(input).toHaveValue('');
  expect(unexpectedApiRequests).toEqual([]);
});

test('the inspector resolves an explicit IDN suffix and remains mobile-safe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/registry-support');
  await page.getByRole('searchbox', { name: 'Domain or suffix', exact: true }).fill('example.சிங்கப்பூர்');
  await page.getByRole('button', { name: 'Inspect support' }).click();

  await expect(page.locator('.inspection-card')).toContainText('.xn--clchc0ea0b2g2a9gcd');
  await expect(page.locator('.inspection-card')).toContainText('Explicit suffix profile');
  await expectNoHorizontalOverflow(page);
});

test('the registry-support reference remains readable without horizontal overflow on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/registry-support');

  const consoleNavigation = page.locator('#console-navigation');
  const interpretation = page.locator('main .interpretation');
  await expect(consoleNavigation).toHaveCSS('position', 'fixed');
  await expect(interpretation).toHaveCSS('position', 'static');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'true');
  await expect(consoleNavigation).toHaveCSS('transform', 'none');
  await expect(page.getByRole('navigation', { name: 'Reference' }).getByRole('link', { name: 'Registry support' })).toBeVisible();
  await expect(interpretation).toHaveCSS('position', 'static');
  await expect(interpretation).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false');

  const sectionIntros = page.locator('.section-intro');
  await expect(sectionIntros).toHaveCount(3);
  await expect(sectionIntros.first()).toHaveCSS('display', 'block');
  for (const heading of await sectionIntros.getByRole('heading').all()) {
    const box = await heading.boundingBox();
    expect(box?.width).toBeGreaterThan(200);
  }

  await expect(page.getByLabel('Suffix or capability')).toBeVisible();
  await expect(page.locator('#coverage-filter')).toBeVisible();
  await page.getByLabel('Suffix or capability').fill('vn');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
