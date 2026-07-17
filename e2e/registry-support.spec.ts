import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test('the dashboard and console navigation expose the registry-support reference', async ({ page }) => {
  await page.goto('/dashboard');

  const dashboardLink = page.locator('.workspace-card').filter({ hasText: 'Registry support' });
  await expect(dashboardLink).toHaveAttribute('href', '/registry-support');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Registry support' })).toHaveAttribute('href', '/registry-support');

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

  await expect(page.getByText('Catalogue v5')).toBeVisible();
  await expect(page.locator('.summary-grid article').filter({ hasText: 'Explicit suffixes' }).locator('strong')).toHaveText('12');
  await expect(page.locator('tbody tr')).toHaveCount(12);

  const search = page.getByLabel('Suffix or capability');
  await search.fill('bracketed');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('.jp');

  await search.clear();
  await page.locator('#coverage-filter').selectOption('access_documented');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody')).toContainText('.es');
  await expect(page.locator('tbody')).toContainText('.vn');

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

test('the registry-support reference remains readable without horizontal overflow on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/registry-support');

  await expect(page.getByLabel('Suffix or capability')).toBeVisible();
  await expect(page.locator('#coverage-filter')).toBeVisible();
  await page.getByLabel('Suffix or capability').fill('vn');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
