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

  await page.goto('/');

  const loginForm = page.locator('form.login');
  await expect(loginForm).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to WHOISleuth' })).toBeVisible();
  const passwordField = page.getByLabel('Password');
  const signInButton = page.getByRole('button', { name: 'Sign in' });
  await expect(signInButton).toBeDisabled();

  await passwordField.fill(TEST_SITE_PASSWORD);
  await expect(signInButton).toBeEnabled();
  await signInButton.click();

  await expect(page.locator('.shell')).toBeVisible();
  await expect(loginForm).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Investigate domains. Protect brands.' })).toBeVisible();
  const backendStatus = page.getByText('Backend · Express', { exact: true });
  await expect(backendStatus).toBeVisible();
  await expect(backendStatus).toHaveCSS('white-space', 'nowrap');

  const signOutButton = page.getByRole('button', { name: 'Sign out' });
  await expect(signOutButton).toBeVisible();
  await signOutButton.click();

  await expect(loginForm).toBeVisible();
  await expect(page.locator('.shell')).not.toBeVisible();

  // The password only ever reaches the masked <input type="password">; the
  // page's own text/console output must never echo it back.
  const pageText = await page.locator('body').innerText();
  expect(pageText).not.toContain(TEST_SITE_PASSWORD);
  expect(consoleTexts.join('\n')).not.toContain(TEST_SITE_PASSWORD);
});
