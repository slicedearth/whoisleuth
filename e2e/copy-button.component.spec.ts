import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, useTheme } from './helpers';

// Exercise the shared leaf in its real production consumer, including prop
// changes. No development-only route, component compiler or alternate runtime.
test('shared copy control announces exact values and preserves keyboard focus', async ({ page }) => {
  let copied = '';
  await page.exposeFunction('recordFixtureCopy', (value: string) => { copied = value; });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: (value: string) => (window as unknown as { recordFixtureCopy(value: string): Promise<void> }).recordFixtureCopy(value),
  } }));
  await page.goto('/cli');
  const command = page.locator('.start-steps .copyable-command').first();
  const button = command.getByRole('button', { name: 'Copy run-once help command', exact: true });
  const expected = await command.locator('code').textContent();
  expect(expected).toBeTruthy();
  await button.focus(); await button.press('Enter');
  await expect.poll(() => copied).toBe(expected);
  await expect(button).toHaveText('Copied');
  await expect(button).toBeFocused();
  await expect(command.locator('[aria-live="polite"]')).toHaveText('Copy run-once help command: copied.');
});

test('shared copy failure retains selectable text across layouts and themes', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async () => { throw new Error('Private clipboard failure'); },
  } }));
  await page.goto('/cli');
  const command = page.locator('.start-steps .copyable-command').first();
  const value = await command.locator('code').textContent();
  await command.getByRole('button', { name: 'Copy run-once help command', exact: true }).click();
  await expect(command.locator('.copy-fallback')).toHaveText(value!);
  await expect(command.locator('[aria-live="polite"]')).toHaveText('Clipboard unavailable. Select the value below to copy it.');
  await expect(command).not.toContainText('Private clipboard failure');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560, 3840]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
      await expect(command.locator('.copy-control button')).toBeVisible();
    }
    expect((await new AxeBuilder({ page }).include('.start-steps').analyze()).violations).toEqual([]);
  }
});

test('shared copy control rejects stale completion after its value changes', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise<void>(resolve => { Object.assign(window, { completeFixtureCopy: resolve }); }),
  } }));
  await page.goto('/cli#command-lookup');
  await page.getByText('Build this command', { exact: true }).click();
  const builder = page.getByRole('region', { name: 'Build lookup command' });
  const target = builder.getByRole('textbox').first();
  await target.fill('first.example');
  const button = builder.getByRole('button', { name: 'Copy Prepared lookup command', exact: true });
  await button.click();
  await target.fill('second.example');
  await expect(builder.locator('.copyable-command code')).toContainText('second.example');
  await page.evaluate(() => (window as unknown as { completeFixtureCopy(): void }).completeFixtureCopy());
  await expect(button).toHaveText('Copy');
  await expect(builder.locator('[aria-live="polite"]')).toBeEmpty();
});
