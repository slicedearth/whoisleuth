import { expect, test } from './fixtures';
import { TEST_SITE_PASSWORD } from './constants';
import { protectedDestinations } from '../frontend/src/lib/workspaces';

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
  await expect(page.getByRole('heading', { name: 'Understand a domain. Before you act.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try the synthetic demo' })).toBeVisible();
  await expect(page.locator('.public-header').getByRole('link', { name: 'Privacy' })).toHaveCount(0);
  await expect(page.locator('.public-footer').getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(page.locator('.public-footer').getByRole('link', { name: 'Source and licence' })).toHaveAttribute('href', 'https://github.com/slicedearth/whoisleuth');
  await expect(page.getByText('See the workflow', { exact: true })).toHaveCount(0);
  await expect.poll(() => publicSessionRequests).toBe(1);
  await expect(page.getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  const publicNavigation = page.getByRole('navigation', { name: 'Public navigation' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(publicNavigation).toHaveCSS('display', 'flex');
  await expect(publicNavigation).toHaveCSS('flex-wrap', 'nowrap');
  await expect(page.locator('.public-brand .brand-copy')).toBeVisible();
  await expect(publicNavigation.getByRole('link', { name: 'Overview' })).not.toBeVisible();
  const anonymousConsoleLinkBox = await publicNavigation.getByRole('link', { name: 'Open console' }).boundingBox();
  expect(anonymousConsoleLinkBox).not.toBeNull();
  expect(anonymousConsoleLinkBox!.x + anonymousConsoleLinkBox!.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/lookup');
  await expect(page).toHaveURL(/\/login\?next=%2Flookup$/u);

  const loginForm = page.locator('form.login');
  await expect(loginForm).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continue to WHOISleuth.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Console sign-in' })).toBeVisible();
  await expect(page.getByText('Protected console', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Source and licence' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Public overview' })).toHaveCount(0);
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

  const dashboardLink = page.getByRole('link', { name: 'WHOISleuth Dashboard' });
  await expect(dashboardLink).toBeVisible();
  await expect(dashboardLink).toHaveAttribute('href', '/dashboard');
  await dashboardLink.click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View public homepage' }).click();
  await expect(page.getByRole('heading', { name: 'Understand a domain. Before you act.' })).toBeVisible();
  await expect(publicNavigation.getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.locator('.hero-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);
  await page.goto('/demo');
  await expect(page.locator('.demo-footer').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.locator('.demo-footer').getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);
  await page.goto('/guide');
  await expect(page.locator('.guide-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.locator('.closing-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);
  await page.goto('/');
  const publicSignOutButton = page.getByRole('button', { name: 'Sign out' });
  await expect(publicSignOutButton).toBeVisible();
  await expect(publicSignOutButton).toHaveCSS('white-space', 'nowrap');
  for (const viewportWidth of [390, 320]) {
    await page.setViewportSize({ width: viewportWidth, height: 844 });
    await expect(publicNavigation).toHaveCSS('display', 'flex');
    await expect(publicNavigation).toHaveCSS('flex-wrap', 'nowrap');
    const demoBox = await publicNavigation.getByRole('link', { name: 'Demo' }).boundingBox();
    const themeButton = publicNavigation.getByRole('button', { name: /^Colour theme,/ });
    const themeBox = await themeButton.boundingBox();
    const consoleBox = await publicNavigation.getByRole('link', { name: 'Open console' }).boundingBox();
    const signOutBox = await publicSignOutButton.boundingBox();
    expect(demoBox).not.toBeNull();
    expect(themeBox).not.toBeNull();
    expect(consoleBox).not.toBeNull();
    expect(signOutBox).not.toBeNull();
    await expect(themeButton.locator('.theme-trigger-label')).toHaveText('Theme');
    await expect(themeButton.locator('.theme-trigger-label')).toBeVisible();
    const menuTops = [demoBox!.y, themeBox!.y, consoleBox!.y, signOutBox!.y];
    const menuBottoms = [demoBox!.y + demoBox!.height, themeBox!.y + themeBox!.height, consoleBox!.y + consoleBox!.height, signOutBox!.y + signOutBox!.height];
    expect(Math.max(...menuTops)).toBeLessThan(Math.min(...menuBottoms));
    expect(signOutBox!.x).toBeGreaterThanOrEqual(0);
    expect(signOutBox!.x + signOutBox!.width).toBeLessThanOrEqual(viewportWidth);
    expect(await page.locator('html').evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
  }
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

test('the Dashboard and every protected destination require sign-in and unsafe return targets are ignored', async ({ page }) => {
  for (const { href: path } of protectedDestinations) {
    await page.goto(path);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    await expect(page.locator('form.login')).toBeVisible();
  }

  await page.goto('/login?next=https%3A%2F%2Foutside.invalid%2Fcapture');
  await page.getByLabel('Password').fill(TEST_SITE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});
