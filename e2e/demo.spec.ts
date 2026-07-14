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
  await expect(page.getByRole('status')).toHaveText('Synthetic case updated.');
  await page.getByLabel('Analyst note').fill('Fixture reviewed for demonstration.');
  await expect(page.getByRole('status')).toHaveText('Synthetic case updated.');

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

test('recovers safely from malformed and future tab state', async ({ page }) => {
  await page.goto('/demo');
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', '{malformed'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Define the protected brand' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Stored demo progress was invalid or unsupported and has been reset.');
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', JSON.stringify({ version: 99, profileReady: true })));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Define the protected brand' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Stored demo progress was invalid or unsupported and has been reset.');
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
});

test('keeps progressing in memory when tab storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === 'whoisleuth:synthetic-demo:v1') throw new DOMException('Storage disabled', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await expect(page.getByRole('heading', { name: 'Generate candidate coverage' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Progress updated in memory');
});

test('supports keyboard progression and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo');
  const start = page.getByRole('button', { name: 'Use synthetic profile' });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Generate candidate coverage' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});
