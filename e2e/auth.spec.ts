import { expect, test } from './fixtures';
import { TEST_SITE_PASSWORD } from './constants';

// This spec starts with no session, overriding the project's default
// authenticated storageState - it's the one place the login *form* itself
// is driven end-to-end. Every other spec reuses the session auth.setup.ts
// already created via the API. fixtures.ts's automatic guard covers request
// origin and console errors/warnings for every test in this file already.
test.use({ storageState: { cookies: [], origins: [] } });

test('signs in through the login form and back out again', async ({ page }) => {
  // A local, all-levels console capture just for the password-leak check
  // below - separate from (and in addition to) the shared fixture's
  // error/warning-only guard, which wouldn't catch a plain console.log leak.
  const consoleTexts: string[] = [];
  page.on('console', (message) => consoleTexts.push(message.text()));

  let publicSessionRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/session') publicSessionRequests += 1;
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Investigate domains\./ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore synthetic demo' })).toBeVisible();
  await expect(page.locator('.public-header').getByRole('link', { name: 'Privacy' })).toHaveCount(0);
  await expect(page.locator('.public-footer').getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(page.getByText('See the workflow', { exact: true })).toHaveCount(0);
  await expect.poll(() => publicSessionRequests).toBe(1);
  await expect(page.getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

  await page.goto('/lookup');
  await expect(page).toHaveURL(/\/login\?next=%2Flookup$/u);

  const loginForm = page.locator('form.login');
  await expect(loginForm).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continue to WHOISleuth.' })).toBeVisible();
  const passwordField = page.getByLabel('Password');
  const signInButton = page.getByRole('button', { name: 'Sign in' });
  await expect(signInButton).toBeDisabled();

  await passwordField.fill(TEST_SITE_PASSWORD);
  await expect(signInButton).toBeEnabled();
  await signInButton.click();

  await expect(page.locator('.shell')).toBeVisible();
  await expect(loginForm).not.toBeVisible();
  await expect(page).toHaveURL('/lookup');
  await expect(page.getByRole('heading', { name: 'Lookup' })).toBeVisible();
  const backendStatus = page.getByText('Backend · Express', { exact: true });
  await expect(backendStatus).toBeVisible();
  await expect(backendStatus).toHaveCSS('white-space', 'nowrap');
  await expect(backendStatus).toHaveCSS('text-overflow', 'clip');
  expect(await backendStatus.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    await backendStatus.evaluate((element) => element.clientWidth + 1),
  );

  const signOutButton = page.getByRole('button', { name: 'Sign out' });
  await expect(signOutButton).toBeVisible();
  await expect(signOutButton).toHaveCSS('white-space', 'nowrap');
  await expect(page.getByRole('link', { name: 'Privacy' })).toHaveCount(1);

  const dashboardLink = page.getByRole('link', { name: 'WHOISleuth dashboard' });
  await expect(dashboardLink).toBeVisible();
  await expect(dashboardLink).toHaveAttribute('href', '/dashboard');
  await dashboardLink.click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Investigation dashboard' })).toBeVisible();
  await page.getByRole('link', { name: 'View public homepage' }).click();
  await expect(page.getByRole('heading', { name: /Investigate domains\./ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  const publicSignOutButton = page.getByRole('button', { name: 'Sign out' });
  await expect(publicSignOutButton).toBeVisible();
  await expect(publicSignOutButton).toHaveCSS('white-space', 'nowrap');
  await page.setViewportSize({ width: 390, height: 844 });
  const signOutBox = await publicSignOutButton.boundingBox();
  expect(signOutBox).not.toBeNull();
  expect(signOutBox!.x).toBeGreaterThanOrEqual(0);
  expect(signOutBox!.x + signOutBox!.width).toBeLessThanOrEqual(390);
  expect(await page.locator('html').evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(390);
  await publicSignOutButton.click();

  await expect(page).toHaveURL('/login');
  await expect(loginForm).toBeVisible();
  await expect(page.locator('.shell')).not.toBeVisible();

  // The password only ever reaches the masked <input type="password">; the
  // page's own text/console output must never echo it back.
  const pageText = await page.locator('body').innerText();
  expect(pageText).not.toContain(TEST_SITE_PASSWORD);
  expect(consoleTexts.join('\n')).not.toContain(TEST_SITE_PASSWORD);
});

test('the dashboard and all investigation workspaces require sign-in and unsafe return targets are ignored', async ({ page }) => {
  for (const path of ['/dashboard', '/lookup', '/discover', '/bulk', '/monitor', '/brands', '/registry-support']) {
    await page.goto(path);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    await expect(page.locator('form.login')).toBeVisible();
  }

  await page.goto('/login?next=https%3A%2F%2Foutside.invalid%2Fcapture');
  await page.getByLabel('Password').fill(TEST_SITE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Investigation dashboard' })).toBeVisible();
});
