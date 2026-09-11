import { expect, test } from './fixtures';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';

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
