import { expect, test } from './fixtures';
import { normalizeCapabilities } from '../frontend/src/lib/capabilities';

test('capability normalization bounds concurrency controls and accepts older version-1 reports', () => {
  const legacy = normalizeCapabilities({
    version: 1,
    runtime: 'express',
    authoritative: true,
    features: [{ id: 'lookup', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] }],
  });
  expect(legacy?.controls).toBeNull();

  const bounded = normalizeCapabilities({
    version: 1,
    runtime: 'netlify',
    authoritative: true,
    features: [],
    controls: {
      concurrency: {
        mode: 'in_memory',
        scope: 'serverless_instance',
        distributed: false,
        classes: [
          { id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 },
          { id: 'registry_light', sessionLimit: 1, runtimeLimit: 2 },
          { id: 'oversized', sessionLimit: 1, runtimeLimit: 1001 },
          { id: 'reversed', sessionLimit: 4, runtimeLimit: 2 },
        ],
      },
    },
  });
  expect(bounded?.controls?.concurrency.classes).toEqual([
    { id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 },
  ]);
});

test('malformed or unsupported capability reports degrade conservatively', async ({ page }) => {
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: 99, authoritative: true, features: [{ id: 'lookup', status: 'supported' }] }),
  }));
  await page.goto('/');
  await expect(page.getByText('Backend unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Investigate domains. Protect brands.' })).toBeVisible();
});

test('the serverless runtime label fits the desktop session row without truncation', async ({ page }) => {
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: 1, runtime: 'netlify', authoritative: true, features: [] }),
  }));
  await page.goto('/');

  const backendStatus = page.getByText('Backend · Netlify', { exact: true });
  await expect(backendStatus).toBeVisible();
  await expect(backendStatus).toHaveCSS('white-space', 'nowrap');
  await expect(backendStatus).toHaveCSS('text-overflow', 'clip');
  expect(await backendStatus.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    await backendStatus.evaluate((element) => element.clientWidth + 1),
  );
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCSS('white-space', 'nowrap');
  await expect(page.getByRole('link', { name: 'Privacy' })).toHaveCount(1);
});
