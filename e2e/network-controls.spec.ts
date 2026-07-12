import { expect, test } from './fixtures';

test.use({ allowExpectedLookup429Noise: true });

test('a concurrency circuit response degrades Lookup with a retryable message', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 429,
    contentType: 'application/json',
    headers: { 'Retry-After': '1' },
    body: JSON.stringify({
      error: 'This session already has the maximum number of network operations in progress. Please retry shortly.',
      errorCode: 'NETWORK_CONCURRENCY_LIMITED',
      operationClass: 'registry_deep',
      limitScope: 'session',
    }),
  }));

  await page.goto('/lookup');
  await page.getByLabel('Domain, IP address, ASN, or domain list').fill('example.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('alert')).toHaveText(/maximum number of network operations.*retry shortly/i);
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeEnabled();
});

test('the capability endpoint reports honest in-memory concurrency scope', async ({ request }) => {
  const response = await request.get('/api/capabilities');
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.controls).toEqual({
    concurrency: {
      mode: 'in_memory',
      scope: 'process',
      distributed: false,
      classes: expect.arrayContaining([
        expect.objectContaining({ id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 }),
        expect.objectContaining({ id: 'registry_deep', sessionLimit: 4, runtimeLimit: 12 }),
      ]),
    },
  });
});
