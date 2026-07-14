import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

test('completes the public synthetic workflow without API or production-store access', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });

  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Follow a finding from discovery to case export.' })).toBeVisible();
  await expect(page.getByText('Synthetic fixtures · No live findings')).toBeVisible();
  await expect(page.locator('form.login')).toHaveCount(0);

  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Load synthetic candidates' }).click();
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeVisible();
  await page.getByRole('button', { name: 'Open synthetic case' }).click();
  await page.getByLabel('Status').selectOption('reviewing');
  await page.getByLabel('Analyst note').fill('Fixture reviewed for demonstration.');

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage.local).toEqual([]);
  expect(storage.session).toEqual(['whoisleuth:synthetic-demo:v1']);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export synthetic JSON' }).click();
  const download = await downloadPromise;
  const body = await (await download.createReadStream()).toArray();
  const payload = JSON.parse(Buffer.concat(body).toString('utf-8'));
  expect(download.suggestedFilename()).toBe('whoisleuth-synthetic-demo-case.json');
  expect(payload).toMatchObject({ schema: 'whoisleuth.synthetic-demo-case', version: 1, synthetic: true, case: { domain: 'northstar-login.example', status: 'reviewing', note: 'Fixture reviewed for demonstration.' } });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Document northstar-login.example' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByRole('heading', { name: 'Define the protected brand' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
  expect(apiRequests).toEqual([]);
});

test('keeps the public demo usable without mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Load synthetic candidates' }).click();
  await expect(page.getByRole('button', { name: 'Inspect northstar-login.example' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
