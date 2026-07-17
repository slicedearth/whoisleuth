import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

const GUIDE_KEY = 'whoisleuth:investigation-guide:v1';

test('the dashboard starts a tab-scoped guide without starting analysis', async ({ page }) => {
  const analysisRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:lookup|rdap|whois|availability|ct-search)(?:\?|$)/.test(request.url())) analysisRequests.push(request.url());
  });

  await page.goto('/dashboard');
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('Portal.Example.Test.');
  await page.getByRole('button', { name: 'Start guide' }).click();

  await expect(page).toHaveURL('/lookup?q=portal.example.test');
  const guide = page.locator('.guide');
  await expect(guide).toContainText('portal.example.test');
  await expect(guide.getByRole('link', { name: /Lookup/ })).toHaveAttribute('aria-current', 'step');
  await expect(guide).toContainText('Opened records navigation only. It does not mean evidence was collected or reviewed.');
  await expect(page.getByRole('textbox', { name: 'Domain, IP address, ASN, or domain list' })).toHaveValue('portal.example.test');
  expect(analysisRequests).toEqual([]);

  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored).toMatchObject({ version: 1, domain: 'portal.example.test', visitedStages: ['lookup'] });
  expect(Object.keys(stored).sort()).toEqual(['createdAt', 'domain', 'updatedAt', 'version', 'visitedStages']);
});

test('the dashboard rejects non-domain guide targets without changing route or storage', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('https://example.test/path');
  await page.getByRole('button', { name: 'Start guide' }).click();

  await expect(page.getByRole('alert')).toHaveText('Enter one valid domain without a URL, path, port, or spaces.');
  await expect(page).toHaveURL('/dashboard');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBeNull();
});

test('the guide prefills Discover and marks opened stages without implying completion', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();

  const guide = page.locator('.guide');
  await guide.getByRole('link', { name: /Discover/ }).click();
  await expect(page).toHaveURL('/discover?q=example.test');
  await expect(page.getByRole('textbox', { name: 'Brand or domain' })).toHaveValue('example.test');
  await expect(page.locator('.candidate')).toHaveCount(0);
  await expect(guide.getByRole('link', { name: /Discover/ })).toHaveAttribute('aria-current', 'step');
  await expect(guide.getByRole('link', { name: /Lookup/ })).toContainText('Opened');
  await expect(guide.getByRole('link', { name: /Discover/ })).toContainText('Current');
  await expect(guide).not.toContainText('Complete');

  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('ending a guide removes only its tab-scoped navigation record', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();
  await page.locator('.guide').getByRole('button', { name: 'End guide' }).click();

  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBeNull();
  await expect(page).toHaveURL('/lookup?q=example.test');
});

test('future and oversized guide records are ignored without destructive migration', async ({ page }) => {
  await page.goto('/dashboard');
  const future = JSON.stringify({
    version: 2,
    domain: 'example.test',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    visitedStages: ['lookup'],
  });
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [GUIDE_KEY, future]);
  await page.reload();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBe(future);

  const oversized = 'x'.repeat(2_049);
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [GUIDE_KEY, oversized]);
  await page.reload();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBe(oversized);
});
