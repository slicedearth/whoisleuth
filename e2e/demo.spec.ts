import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

test('completes the public synthetic workflow without investigation requests or production-store access', async ({ page }) => {
  test.slow();
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
  await expect(page.locator('.demo-stage-summary')).toContainText('Stage 1 of 6');
  await expect(page.getByRole('button', { name: /Dashboard.*Current/ })).toHaveAttribute('aria-current', 'step');
  const upcomingStage = page.getByRole('button', { name: /Monitor.*Upcoming/ });
  await expect(upcomingStage).toBeDisabled();
  await expect(upcomingStage).toHaveCSS('opacity', '1');

  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.locator('.demo-stage-summary')).toContainText('Stage 2 of 6');
  await expect(page.getByRole('button', { name: /Dashboard.*Completed/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Brands.*Current/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('heading', { name: 'Northstar Outfitters' })).toBeVisible();
  await expect(page.getByText(/northstar\.example · Complete/)).toBeVisible();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Load synthetic candidates' }).click();
  await page.getByRole('button', { name: 'Load related domains' }).click();
  await expect(page.locator('.relationship-glyph svg')).toHaveAttribute('data-icon', 'nameserver');
  await expect(page.getByRole('img', { name: /Shared evidence relationships/u })).toBeVisible();
  await expect(page.locator('.candidate')).toHaveCount(2);
  await page.getByRole('button', { name: 'All candidates · 3' }).click();
  await page.getByRole('button', { name: 'High priority · 1' }).click();
  await expect(page.locator('.candidate')).toHaveCount(1);
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic evidence topology' })).toBeVisible();
  const structuredIdentityNodeTitle = page.locator(
    '.source-node[data-source-id="structured-identity"] .source-title-copy',
  );
  await expect(structuredIdentityNodeTitle).toHaveClass(/wrapped/);
  await expect(structuredIdentityNodeTitle).toHaveText('Structured identity');
  expect(await structuredIdentityNodeTitle.evaluate((copy) => {
    const text = copy.firstElementChild;
    return Boolean(
      text
      && text.scrollWidth <= text.clientWidth
      && text.scrollHeight <= text.clientHeight
    );
  })).toBe(true);
  await expect(page.getByRole('heading', { name: 'Observed lifecycle' })).toBeVisible();
  await expect(page.locator('.registry-shape')).not.toHaveCount(0);
  await expect(page.locator('.certificate-shape')).not.toHaveCount(0);
  await expect(page.locator('.observation-shape')).not.toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Overlapping collection timing for 4 source branches' })).toBeVisible();
  const agreementPlot = page.getByRole('img', { name: 'Registration agreement plot with 3 fields' });
  await expect(agreementPlot).toBeVisible();
  await expect(agreementPlot.locator('.agreement-track')).toHaveCount(3);
  await expect(agreementPlot.locator('.agreement-marker')).toHaveCount(6);
  await expect(agreementPlot.locator('.matrix-cell')).toHaveCount(0);
  await expect(page.locator('a[href="#demo-evidence-registry"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DNS intelligence' })).toBeVisible();
  await page.locator('.dns-card > summary').click();
  await expect(page.locator('.dns-card').getByText('ns1.shared-example.invalid · serial 2026072701', { exact: true })).toBeVisible();
  await expect(page.locator('.dns-card').getByText(/Service priority 1 → owner · ALPN h2, h3 · port 443/)).toBeVisible();
  await page.locator('.dns-card > summary').click();
  await expect(page.getByRole('heading', { name: 'HTTP intelligence' })).toBeVisible();
  await expect(page.getByText('security.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Passive security posture' })).toBeVisible();
  const structuredIdentity = page.locator('.structured-card');
  await expect(structuredIdentity.getByRole('heading', { name: 'Structured identity metadata' })).toBeVisible();
  await expect(structuredIdentity).not.toHaveAttribute('open', '');
  const credentialSurface = page.locator('.credential-card');
  await expect(credentialSurface.getByRole('heading', { name: 'Credential collection surface' })).toBeVisible();
  await expect(credentialSurface).not.toHaveAttribute('open', '');
  await credentialSurface.locator(':scope > summary').click();
  await expect(credentialSurface.getByText('Classified inputs', { exact: true })).toBeVisible();
  await expect(credentialSurface.getByText(/does not retain field names or content/i)).toBeVisible();
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
  await expect(technology.getByRole('heading', { name: 'Observed browser libraries' })).toBeVisible();
  await expect(technology.getByRole('heading', { name: 'Example UI Library 1.2.3' })).toBeVisible();
  await expect(technology.getByText(/fixed synthetic component and advisory context/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TLS and certificate intelligence' })).toBeVisible();
  const tls = page.locator('.tls-card');
  await tls.locator(':scope > summary').click();
  await expect(tls.getByRole('region', { name: 'Validity and chain' })).toBeVisible();
  const network = page.locator('.network-context');
  await expect(network).not.toHaveAttribute('open', '');
  await expect(network.getByRole('heading', { name: 'Observed network context' })).toBeVisible();
  await expect(network.locator(':scope > summary .evidence-status')).toHaveText('Success');
  await expect(network.getByText('203.0.113.44', { exact: true })).toBeHidden();
  await network.locator(':scope > summary').click();
  await expect(network.getByText('203.0.113.44', { exact: true })).toBeVisible();
  const registrySources = page.locator('.sources > details');
  const authorityTrace = page.getByRole('region', { name: 'Registration authority trace' });
  await expect(authorityTrace).toContainText('Registry RDAP');
  await expect(authorityTrace).toContainText('primary publication for domain existence');
  await expect(authorityTrace).toContainText('Registrar RDAP');
  await expect(authorityTrace).toContainText('It cannot decide domain existence');
  await expect(registrySources).toHaveCount(2);
  await expect(registrySources.nth(0)).not.toHaveAttribute('open', '');
  await expect(registrySources.nth(1)).not.toHaveAttribute('open', '');
  await expect(registrySources.nth(0).getByText('RDAP structured data')).toBeVisible();
  await expect(registrySources.nth(1).getByText('WHOIS structured data')).toBeVisible();
  const registryInterpretation = page.locator('.registry-insights');
  await expect(registryInterpretation).not.toHaveAttribute('open', '');
  await expect(registryInterpretation.getByText('Registry interpretation · Registered')).toBeVisible();
  await registryInterpretation.locator(':scope > summary').click();
  await expect(registryInterpretation.getByText('RDAP: redacted · WHOIS: redacted')).toBeVisible();
  await expect(registryInterpretation.getByText('clientTransferProhibited')).toBeVisible();
  const rdapCapabilities = registryInterpretation.locator('.rdap-capabilities');
  await expect(rdapCapabilities.getByText('RDAP capability declarations · 2')).toBeVisible();
  await rdapCapabilities.locator(':scope > summary').click();
  await expect(rdapCapabilities.getByText('Machine-readable response redaction markers.')).toBeVisible();
  await expect(rdapCapabilities.getByText(/Reverse search: not advertised/)).toBeVisible();
  await page.getByRole('button', { name: 'Open synthetic case in Monitor' }).click();
  await expect(page.getByRole('heading', { name: 'Watchlist activity' })).toBeVisible();
  await expect(page.locator('#watchlist-activity .activity-summary')).toContainText(/1\s*retained checks/);
  await page.getByLabel('Status').selectOption('reviewing');
  await expect(page.getByRole('status')).toHaveText('Synthetic case updated.');
  await page.getByLabel('Analyst note').fill('Fixture reviewed for demonstration.');
  await expect(page.getByRole('status')).toHaveText('Synthetic case updated.');
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await expect(page.locator('#watchlist-activity .activity-summary')).toContainText(/2\s*retained checks/);
  await expect(page.getByRole('img', { name: 'Observed domain timeline with 2 checks and 2 evidence categories' })).toBeVisible();
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
  expect(payload).toMatchObject({ schema: 'whoisleuth.synthetic-demo-case', version: 5, synthetic: true, case: { domain: 'northstar-login.example', status: 'monitoring', note: 'Fixture reviewed for demonstration.' } });
  expect(payload.timeline).toHaveLength(2);
  expect(payload.evidence.registry.source).toBe('Registry RDAP fixture');
  expect(payload.evidence.securityTxt.state).toBe('present');
  expect(payload.evidence.credentialSurface.categories.password).toBe(1);
  expect(payload.evidence.structuredIdentity.entities[0].name).toBe('Northstar account service');
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
  const stagePositions = await page.locator('.demo-steps button').evaluateAll((buttons) => buttons.slice(0, 3).map((button) => {
    const rect = button.getBoundingClientRect();
    return { top: rect.top, left: rect.left };
  }));
  const [firstStage, secondStage, thirdStage] = stagePositions;
  if (!firstStage || !secondStage || !thirdStage) throw new Error('The demo did not render its first three stages.');
  expect(Math.abs(firstStage.top - secondStage.top)).toBeLessThanOrEqual(1);
  expect(secondStage.left).toBeGreaterThan(firstStage.left);
  expect(thirdStage.top).toBeGreaterThan(firstStage.top);
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Load synthetic candidates' }).click();
  await page.getByRole('button', { name: 'Load related domains' }).click();
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(page.locator('.map-frame')).toBeHidden();
  await expect(page.locator('.map-mobile')).toBeVisible();
  expect(await page.locator('.map-mobile').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.locator('.map-mobile li span').evaluateAll((elements) => elements.every((element) => (
    getComputedStyle(element).whiteSpace === 'normal'
      && element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1
      && !element.textContent?.includes('…')
  )))).toBe(true);
  await expect(page.getByRole('button', { name: 'Inspect northstar-login.example' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'TLS and certificate intelligence' })).toBeVisible();
  await page.getByText('Why the risk score is 78', { exact: true }).click();
  await expect(page.locator('.factor-chart')).toBeHidden();
  await expect(page.locator('.score-details details[open] li')).not.toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.matrix-frame')).toBeHidden();
  const mobileAgreement = page.getByRole('group', { name: 'Registration agreement for 3 fields' });
  await expect(mobileAgreement).toBeVisible();
  await expect(mobileAgreement.locator('article')).toHaveCount(3);
  await expect(mobileAgreement.locator('li')).toHaveCount(6);
  await expect(page.locator('.matrix-legend')).toContainText('Source conflict');
  await expect(page.locator('.matrix-legend')).toContainText('Source-only value');
  await expect(page.locator('.matrix-legend')).toContainText('Incomplete / redacted');
  await expect(page.locator('.matrix-legend').getByText('Different', { exact: true })).toHaveCount(0);
  await page.getByText('Synthetic RDAP and WHOIS fields are equivalent', { exact: true }).click();
  const comparisonTable = page.locator('.comparison .table-wrap');
  expect(await comparisonTable.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const tls = page.locator('.tls-card');
  await tls.locator(':scope > summary').click();
  await expect(tls.locator('.validity-chart')).toBeHidden();
  await expect(tls.locator('.validity-mobile')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Open synthetic case in Monitor' }).click();
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await expect(page.locator('.timeline-entry')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
});

test('recovers safely from malformed and future tab state', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
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
