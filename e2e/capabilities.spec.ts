import { expect, test } from './fixtures';

test('malformed or unsupported capability reports degrade conservatively', async ({ page }) => {
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: 99, authoritative: true, features: [{ id: 'lookup', status: 'supported' }] }),
  }));
  await page.goto('/');
  await expect(page.getByText('Capability status unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Investigate domains. Protect brands.' })).toBeVisible();
});
