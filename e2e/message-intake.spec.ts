import { test, expect } from './fixtures';
import { openSeededTimelineCase, caseRecord } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/cases/case-record-contracts.mts';

test('local message review exposes destination mismatch and fills Lookup without collecting', async ({ page }, testInfo) => {
  let lookups = 0;
  await page.route('**/api/lookup', route => { lookups++; return route.abort(); });
  await page.goto('/lookup');
  await page.getByText('Review a message, link or QR image', { exact: true }).click();
  const intake = page.locator('details.intake');
  await intake.getByLabel('Input type').selectOption('email');
  await intake.getByLabel('Select a file').setInputFiles({ name: 'selected.eml', mimeType: 'message/rfc822', buffer: Buffer.from('From: private@brand.example\r\nContent-Type: text/html\r\n\r\n<a href="https://destination.test/private?token=private-value">https://brand.example</a>') });
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Extracted destinations' })).toBeFocused();
  await expect(intake.getByText('different from the link destination', { exact: false })).toBeVisible();
  await intake.getByRole('button', { name: 'Use destination.test in Lookup', exact: true }).click();
  await expect(page.locator('#query')).toHaveValue('destination.test');
  await expect(page.locator('#query')).toBeFocused();
  expect(lookups).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), intake.getByRole('button', { name: 'Download minimised review' }).click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const output = Buffer.concat(chunks).toString('utf8');
  expect(output).toContain('destination.test');
  expect(output).not.toContain('private-value');
  expect(output).not.toContain('private@');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(intake.getByRole('button', { name: 'Use destination.test in Lookup', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (width === 390 || width === 1280) await intake.screenshot({ path: testInfo.outputPath(`intake-${width}-${theme}.png`) });
    }
  }
  expect(lookups).toBe(0);
});

test('Case intake retains a minimised review by default and records reported identity actions separately', async ({ page }) => {
  await openSeededTimelineCase(page, 'incident.example', [caseRecord({ domain: 'incident.example' })], CASE_SCHEMA_VERSION);
  await page.getByText('Review a message, link or QR image', { exact: true }).click();
  const intake = page.locator('details.intake');
  await intake.getByLabel('Text to review').fill('https://destination.test/private?token=private-value');
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Extracted destinations' })).toBeVisible();
  await expect(intake.getByLabel(/Also retain the private original/u)).not.toBeChecked();
  await intake.getByRole('button', { name: 'Save review in Case' }).click();
  await expect(intake.getByRole('status')).toHaveText('Saved the review in this Case.');
  const snapshot = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 2 });
  expect(JSON.stringify(snapshot.records)).toContain('Analyst-selected message review');
  expect(JSON.stringify(snapshot.records)).not.toContain('private-value');
  await openCaseSection(page, 'Response');
  await page.getByText('Account and device recovery', { exact: true }).click();
  await page.getByLabel('Granted application consent', { exact: true }).check();
  await expect(page.getByText('Review application grants and tokens', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record reported actions in Case' }).click();
  await expect(page.getByText('Reported actions recorded. Recovery actions and follow-ups are recorded below.', { exact: true })).toBeVisible();
  const updated = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 3 });
  expect(JSON.stringify(updated.records)).toContain('Reported identity actions: Granted application consent');
  expect(JSON.stringify(updated.records)).toContain('not independently verified account telemetry');
});
