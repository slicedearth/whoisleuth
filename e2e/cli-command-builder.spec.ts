import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, useTheme } from './helpers';

test('command builder uses literal arguments, shared constraints and accessible local drafts', async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) requests.push(path);
  });
  await page.goto('/cli#command-lookup');
  await page.getByText('Build this command', { exact: true }).click();
  const builder = page.getByRole('region', { name: 'Build lookup command' });
  const target = builder.getByRole('textbox').first();
  await target.fill('portal.example.test');
  await builder.getByText('Choose options', { exact: true }).click();
  await builder.getByRole('checkbox', { name: '--plan', exact: true }).check();
  await builder.getByRole('checkbox', { name: '--fast', exact: true }).check();
  await expect(builder.locator('.copyable-command code')).toContainText("'portal.example.test'");
  await builder.getByRole('checkbox', { name: '--deep', exact: true }).check();
  await expect(builder.getByRole('status')).toContainText('mutually exclusive');
  await expect(builder.getByRole('button', { name: 'Copy Prepared lookup command' })).toHaveCount(0);
  await builder.getByRole('checkbox', { name: '--deep', exact: true }).uncheck();
  await target.fill("literal';$(never-run)");
  await expect(builder.locator('.copyable-command code')).toContainText("'literal'\"'\"';$(never-run)'");
  await builder.getByLabel('Shell', { exact: true }).selectOption('powershell');
  await expect(builder.locator('.copyable-command code')).toContainText("& whoisleuth 'lookup'");
  await expect(builder.locator('.copyable-command code')).toContainText("'literal'';$(never-run)'");
  await builder.getByText('Choose options', { exact: true }).click();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('.command-builder').analyze()).violations).toEqual([]);
      if (width === 320 || width === 1280) await builder.screenshot({ path: testInfo.outputPath(`builder-${theme}-${width}.png`) });
    }
  }
  await expect(page).toHaveURL('/cli#command-lookup');
  expect(requests).toEqual([]);
  await page.reload();
  await page.getByText('Build this command', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Build lookup command' }).getByRole('textbox').first()).toHaveValue('');
});

test('Lookup CLI bridge omits unselected URL details and cannot submit a browser collection', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/lookup') requests.push(request.url());
  });
  await page.goto('/lookup');
  await page.locator('#query').fill('https://portal.example.test/private-path?private-query=yes#private-fragment');
  await page.getByText('Continue in the CLI', { exact: true }).click();
  const builder = page.getByRole('region', { name: 'Build lookup command' });
  await expect(builder.locator('.copyable-command code')).toContainText("'--plan'");
  await expect(builder.locator('.copyable-command code')).toContainText("'portal.example.test'");
  await expect(builder.locator('.copyable-command code')).not.toContainText('private-');
  const target = builder.getByRole('textbox').first();
  expect(await target.evaluate(element => (element as HTMLInputElement).form)).toBeNull();
  await target.fill('edited.example.test');
  await target.press('Enter');
  await expect(builder.locator('.copyable-command code')).toContainText("'edited.example.test'");
  await expect(page.locator('#query')).toHaveValue('https://portal.example.test/private-path?private-query=yes#private-fragment');
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeEnabled();
  expect(requests).toEqual([]);
});
