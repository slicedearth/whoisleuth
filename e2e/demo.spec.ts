import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

test('completes the public synthetic workflow without investigation requests or production-store access', async ({ page }) => {
  const apiRequestPaths: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) apiRequestPaths.push(pathname);
  });

  await page.goto('/demo');
  await expect(page.locator('.demo-footer').getByRole('link', { name: 'Sign in to investigate' })).toHaveAttribute('href', '/login');
  await expect(page.locator('.demo-footer').getByRole('link', { name: 'Open console' })).toHaveCount(0);
  await expect(page.getByText('Synthetic console', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Use the investigation workflow without touching a live target.' })).toBeVisible();
  await expect(page.getByText('Synthetic fixtures · No live findings')).toBeVisible();
  await expect(page.locator('form.login')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Northstar Outfitters' })).toBeVisible();
  await expect(page.getByText(/northstar\.example · Complete/)).toBeVisible();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Load synthetic candidates' }).click();
  await page.getByRole('button', { name: 'Load related domains' }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
  await page.getByRole('button', { name: 'All candidates · 3' }).click();
  await page.getByRole('button', { name: 'High priority · 1' }).click();
  await expect(page.locator('.candidate')).toHaveCount(1);
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DNS intelligence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'HTTP intelligence' })).toBeVisible();
  await expect(page.getByText('security.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Passive security posture' })).toBeVisible();
  for (const selector of ['.dns-card', '.http-card', '.security-posture-card', '.tls-card']) {
    const card = page.locator(selector);
    await expect(card).not.toHaveAttribute('open', '');
    await expect(card.locator(':scope > summary .evidence-status')).toHaveText('Success');
  }
  const technology = page.locator('.technology-card');
  await expect(technology).not.toHaveAttribute('open', '');
  await expect(technology.getByRole('heading', { name: 'Technology indicators' })).toBeVisible();
  await expect(technology.getByText('3 matched indicators · Expand for evidence and limitations', { exact: true })).toBeVisible();
  await expect(technology.getByRole('heading', { name: 'Example Commerce' })).toBeHidden();
  await technology.locator(':scope > summary').click();
  await expect(technology.getByRole('heading', { name: 'Example Commerce' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TLS and certificate intelligence' })).toBeVisible();
  const network = page.locator('.network-context');
  await expect(network).not.toHaveAttribute('open', '');
  await expect(network.getByRole('heading', { name: 'Observed network context' })).toBeVisible();
  await expect(network.locator(':scope > summary .evidence-status')).toHaveText('Success');
  await expect(network.getByText('203.0.113.44', { exact: true })).toBeHidden();
  await network.locator(':scope > summary').click();
  await expect(network.getByText('203.0.113.44', { exact: true })).toBeVisible();
  const registrySources = page.locator('.sources > details');
  await expect(registrySources).toHaveCount(2);
  await expect(registrySources.nth(0)).not.toHaveAttribute('open', '');
  await expect(registrySources.nth(1)).not.toHaveAttribute('open', '');
  await expect(registrySources.nth(0).getByText('RDAP structured data')).toBeVisible();
  await expect(registrySources.nth(1).getByText('WHOIS structured data')).toBeVisible();
  await page.getByRole('button', { name: 'Open synthetic case in Monitor' }).click();
  await page.getByLabel('Status').selectOption('reviewing');
  await expect(page.getByRole('status')).toHaveText('Synthetic case updated.');
  await page.getByLabel('Analyst note').fill('Fixture reviewed for demonstration.');
  await expect(page.getByRole('status')).toHaveText('Synthetic case updated.');
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await expect(page.locator('.timeline-entry')).toHaveCount(2);
  await expect(page.getByText(/First observed/)).toBeVisible();
  await page.getByRole('button', { name: 'Material changes only' }).click();
  await expect(page.locator('.timeline-entry')).toHaveCount(2);

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage.local).toEqual([]);
  expect(storage.session).toEqual(['whoisleuth:synthetic-demo:v1']);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export synthetic case report' }).click();
  const download = await downloadPromise;
  const body = await (await download.createReadStream()).toArray();
  const payload = JSON.parse(Buffer.concat(body).toString('utf-8'));
  expect(download.suggestedFilename()).toBe('whoisleuth-synthetic-demo-case.json');
  expect(payload).toMatchObject({ schema: 'whoisleuth.synthetic-demo-case', version: 3, synthetic: true, case: { domain: 'northstar-login.example', status: 'monitoring', note: 'Fixture reviewed for demonstration.' } });
  expect(payload.timeline).toHaveLength(2);
  expect(payload.evidence.registry.source).toBe('Registry RDAP fixture');
  expect(payload.evidence.securityTxt.state).toBe('present');
  expect(payload.evidence.observedNetwork.address).toBe('203.0.113.44');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Document and revisit northstar-login.example' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
  expect(apiRequestPaths).toEqual(['/api/session', '/api/session']);
});

test('keeps the public demo usable without mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Load synthetic candidates' }).click();
  await expect(page.getByRole('button', { name: 'Inspect northstar-login.example' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'TLS and certificate intelligence' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Open synthetic case in Monitor' }).click();
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await expect(page.locator('.timeline-entry')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
});

test('recovers safely from malformed and future tab state', async ({ page }) => {
  await page.goto('/demo');
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', '{malformed'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Stored demo progress was invalid or unsupported and has been reset.');
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', JSON.stringify({ version: 99, profileReady: true })));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Progress updated in memory');
});

test('supports keyboard progression and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo');
  const start = page.getByRole('button', { name: 'Begin with Brands' });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Define the protected identity' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});
