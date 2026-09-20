import { expect, test } from './fixtures';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';

test('selected URL collection is deliberate and retains scope without its path or query in a Case', async ({ page }, testInfo) => {
  const hostname = 'portal.example.test';
  const selected = `https://${hostname}/selected/path?item=private-example,one;two#local-fragment`;
  const requests: string[] = [];
  await page.route('**/api/lookup?*', async (route) => {
    const request = route.request();
    requests.push(request.method());
    expect(new URL(request.url()).searchParams.get('q')).toBe(hostname);
    expect(request.url()).not.toContain('private-example');
    const fixture = sectionedLookupFixture('example.test');
    Object.assign(fixture, { query: hostname, inputHostname: hostname, isSubdomain: true });
    Object.assign(fixture.availability, { observationHostname: hostname, deepScanComplete: true });
    if (request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ url: selected.split('#')[0] });
      Object.assign(fixture.availability, { webObservationMode: 'selected_url' });
      Object.assign(fixture.availability.http, { requestUrl: `https://${hostname}/selected/path`,
        finalUrl: `https://${hostname}/selected/path`, redirectCount: 0, redirects: [],
        attempts: [{ url: `https://${hostname}/selected/path`, queryOmitted: true, outcome: 'response', httpStatus: 200, error: null }] });
    } else expect(request.postData()).toBeNull();
    await route.fulfill({ json: fixture });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill(selected);
  const selection = page.getByRole('checkbox', { name: /^Collect the selected URL instead of the homepage/u });
  await expect(selection).toBeVisible();
  await expect(selection).toBeDisabled();
  await page.getByRole('radio', { name: /Deep/u }).check();
  await expect(selection).not.toBeChecked();
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.locator('.result-head')).toContainText(hostname);
  await expect(page.getByRole('button', { name: 'Run lookup', exact: true })).toBeEnabled();
  await selection.check();
  await page.locator('#query').fill(`${selected}-changed`);
  await expect(selection).not.toBeChecked();
  await page.locator('#query').fill(selected);
  await selection.check();
  await page.getByRole('radio', { name: /Fast/u }).check();
  await expect(selection).not.toBeChecked();
  await page.getByRole('radio', { name: /Deep/u }).check();
  await selection.focus();
  await page.keyboard.press('Space');
  await expect(selection).toBeChecked();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await selection.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`selected-url-form-${theme}-${width}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.locator('.result-head')).toContainText('Web evidence concerns the selected URL, not a homepage check.');
  await page.getByRole('button', { name: 'Expand Web and DNS evidence', exact: true }).click();
  const http = page.locator('.source-checkpoint', { has: page.locator('summary', { hasText: 'Pin HTTP facts to Case' }) });
  await http.locator('summary').click();
  await http.getByRole('button', { name: 'Save lookup to Case', exact: true }).click();
  await http.getByRole('checkbox', { name: /^HTTP response status /u }).check();
  await http.getByRole('button', { name: 'Save 1 checkpoint fact', exact: true }).click();
  await expect(http.getByRole('status')).toContainText('Saved 1 analyst-selected checkpoint fact');
  const saved = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(saved.evidenceHistory).toEqual([expect.objectContaining({ observationHostname: hostname, webObservationMode: 'selected_url' })]);
  expect(saved.evidencePins).toEqual([expect.objectContaining({ field: 'http.response_status', webObservationMode: 'selected_url' })]);
  expect(JSON.stringify(saved)).not.toMatch(/selected\/path|private-example|local-fragment/u);
  expect(requests).toEqual(['GET', 'POST']);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.result-head').scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`selected-url-result-${theme}-${width}.png`) });
    }
  }
});

test('subdomain evidence keeps its collection identity through display, Case storage and selected pins', async ({ page }, testInfo) => {
  const domain = 'example.test';
  const hostname = `portal.${domain}`;
  const fixture = sectionedLookupFixture(domain);
  Object.assign(fixture, { query: hostname, inputHostname: hostname, isSubdomain: true });
  Object.assign(fixture.availability, { observationHostname: hostname, deepScanComplete: true });
  Object.assign(fixture.availability.dns, { observedAt: '2026-07-13T01:00:00.000Z' });
  let requests = 0;
  await page.route('**/api/lookup?*', async route => {
    requests += 1;
    expect(new URL(route.request().url()).searchParams.get('q')).toBe(hostname);
    await route.fulfill({ json: fixture });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill(hostname);
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  const header = page.locator('.result-head');
  await expect(header.getByRole('heading', { name: hostname, exact: true })).toBeVisible();
  await expect(header).toContainText(`Registration: example.test. DNS, TLS and web observation target: ${hostname}.`);
  await page.getByRole('button', { name: 'Expand Web and DNS evidence', exact: true }).click();
  await expect(page.locator('#evidence-dns')).toContainText(`Point-in-time resolver evidence for ${hostname}.`);
  const dns = page.locator('.source-checkpoint', { has: page.locator('summary', { hasText: 'Pin DNS facts to Case' }) });
  await dns.locator('summary').click();
  await dns.getByRole('button', { name: 'Save lookup to Case', exact: true }).click();
  await dns.getByRole('checkbox', { name: /^Nameservers /u }).check();
  await dns.getByRole('button', { name: 'Save 1 checkpoint fact', exact: true }).click();
  await expect(dns.getByRole('status')).toContainText('Saved 1 analyst-selected checkpoint fact');
  const saved = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(saved.domain).toBe('example.test');
  expect(saved.evidenceHistory).toEqual([expect.objectContaining({ inputHostname: hostname, observationHostname: hostname })]);
  expect(saved.evidencePins).toEqual([expect.objectContaining({ observationHostname: hostname, field: 'dns.nameservers' })]);
  expect(requests).toBe(1);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await header.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`hostname-${theme}-${width}.png`) });
    }
  }
});

test('pins source-local facts through the Case writer and preserves selections after a failed write', async ({ page }, testInfo) => {
  const domain = 'source-checkpoint.invalid';
  const observedAt = '2026-07-13T01:00:00.000Z';
  const fixture = sectionedLookupFixture(domain);
  Object.assign(fixture.availability.dns, { observedAt });
  let requests = 0;
  await page.route('**/api/lookup?*', async route => {
    requests += 1;
    await route.fulfill({ json: fixture });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Web and DNS evidence', exact: true }).click();
  const dns = page.locator('.source-checkpoint', { has: page.locator('summary', { hasText: 'Pin DNS facts to Case' }) });
  await dns.locator('summary').click();
  await dns.getByRole('button', { name: 'Save lookup to Case', exact: true }).click();
  const nameservers = dns.getByRole('checkbox', { name: /^Nameservers /u });
  await expect(nameservers).toBeFocused();
  await expect(nameservers).toHaveAccessibleName(/DNS · partial · partial/u);
  await expect(dns.getByRole('checkbox', { name: /acquisition transition/u })).toHaveCount(0);
  const before = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  await nameservers.check();
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await dns.getByRole('button', { name: 'Save 1 checkpoint fact', exact: true }).click();
  await expect(dns.getByRole('status')).toContainText(/quota|storage/iu);
  await expect(nameservers).toBeChecked();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.evidencePins).toEqual([]);
  await dns.getByRole('button', { name: 'Save 1 checkpoint fact', exact: true }).click();
  await expect(dns.getByRole('status')).toContainText('Saved 1 analyst-selected checkpoint fact');
  await expect(nameservers).not.toBeChecked();
  const saved = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(saved.evidencePins).toEqual([expect.objectContaining({
    field: 'dns.nameservers', source: 'DNS', observedAt, completeness: 'partial', value: `ns1.${domain}`,
  })]);
  expect(saved.evidenceHistory).toEqual(before.evidenceHistory);
  expect(requests).toBe(1);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await dns.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`source-checkpoint-${theme}-${width}.png`) });
    }
  }
});

test('source pinning rejects undated evidence and does not carry a selection into another observation', async ({ page }) => {
  let dated = true;
  await page.route('**/api/lookup?*', async route => {
    const fixture = sectionedLookupFixture('dated-selection.invalid');
    if (dated) Object.assign(fixture.availability.dns, { observedAt: '2026-07-13T01:00:00.000Z' });
    await route.fulfill({ json: fixture });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill('dated-selection.invalid');
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Web and DNS evidence', exact: true }).click();
  const dns = page.locator('.source-checkpoint', { has: page.locator('summary', { hasText: 'Pin DNS facts to Case' }) });
  await dns.locator('summary').click();
  await dns.getByRole('button', { name: 'Save lookup to Case', exact: true }).click();
  const nameservers = dns.getByRole('checkbox', { name: /^Nameservers /u });
  await nameservers.check();
  dated = false;
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run lookup', exact: true })).toBeEnabled();
  // The existing result-anchor owner reopens the family named by the URL.
  await expect(page.getByRole('button', { name: 'Collapse Web and DNS evidence', exact: true })).toBeVisible();
  await expect(dns).not.toHaveAttribute('open');
  await dns.locator('summary').click();
  await expect(nameservers).toBeDisabled();
  await expect(nameservers).not.toBeChecked();
  await expect(nameservers).toHaveAccessibleName(/Observation time unavailable/u);
  await expect(dns.getByRole('button', { name: /Save.*checkpoint facts/u })).toBeDisabled();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.evidencePins).toEqual([]);
});
