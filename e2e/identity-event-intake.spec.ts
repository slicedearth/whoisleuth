import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { test, expect, isLookupEndpointUrl } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { identityEventExample, identityEventScope } from '../fixtures/identity-event-examples.mts';
import { expectNoHorizontalOverflow, useTheme, readBrowserLocalCollection } from './helpers';
import { openSeededTimelineCase, caseRecord } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION } from '../packages/cases/case-record-contracts.mts';

test('identity preview compares only explicit scope and retains the minimised report through the Case owner', async ({ page }, testInfo) => {
  let collections = 0;
  await page.route(url => isLookupEndpointUrl(url.href), route => { collections++; return route.abort(); });
  await openSeededTimelineCase(page, 'incident.example', [caseRecord({ domain: 'incident.example' })], CASE_SCHEMA_VERSION);
  await page.getByText('Review a message, link or selected file', { exact: true }).click();
  const intake = page.locator('details.intake');
  await intake.getByLabel('Input type').selectOption('identity');
  await intake.getByLabel('Select a file').setInputFiles({ name: 'events.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(identityEventExample())) });
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Identity event review', exact: true })).toBeFocused();
  const events = intake.getByRole('region', { name: 'Selected identity events' });
  await expect(events).toContainText('Actor 2'); await expect(events).toContainText('unknown');
  await expect(intake.getByLabel(/Also retain the private original/u)).not.toBeChecked();
  await events.getByText('Compare an application and time window', { exact: true }).click();
  const scope = identityEventScope();
  await events.getByLabel('Application ID', { exact: true }).fill(scope.applicationId);
  await events.getByLabel('Resource tenant ID (optional)').fill(scope.tenantId);
  await events.getByLabel('Actor in this file (optional)').fill(scope.actorLabel);
  await events.getByLabel('From (ISO time with timezone)').fill(scope.startedAt);
  await events.getByLabel('Until (ISO time with timezone)').fill(scope.endedAt);
  await events.getByRole('button', { name: 'Compare supplied fields' }).focus(); await page.keyboard.press('Enter');
  await expect(events.getByRole('status')).toContainText('Exact scoped matches: 1');
  await events.getByLabel('Until (ISO time with timezone)').fill('2026-01-01T00:04:00Z');
  await expect(events.getByRole('status')).toHaveCount(0);
  await events.getByRole('button', { name: 'Compare supplied fields' }).click();
  await expect(events.getByRole('status')).toContainText('Exact scoped matches: 0');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('.identity-evidence').analyze()).violations).toEqual([]);
      if (width === 320 || width === 1280) if (captureVisualEvidenceEnabled()) { await events.screenshot({ path: testInfo.outputPath(`identity-${width}-${theme}.png`) }); }
    }
  }
  const [download] = await Promise.all([page.waitForEvent('download'), intake.getByRole('button', { name: 'Download review', exact: true }).click()]);
  const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  const output = Buffer.concat(chunks).toString('utf8');
  expect(JSON.parse(output).identityEventReview.comparison.scope.endedAt).toBe('2026-01-01T00:04:00.000Z');
  expect(output).not.toMatch(/private-|192\.0\.2|userPrincipalName|token/iu);
  await intake.getByRole('button', { name: 'Save review in Case' }).click();
  await expect(intake.locator('.status')).toHaveText('Saved the review in this Case.');
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 2 });
  expect(JSON.stringify(stored.records)).toContain('Selected identity-event review');
  expect(JSON.stringify(stored.records)).not.toContain('private-user');
  expect(stored.records[0]!.value.evidencePins[0]).toMatchObject({ observedAt: null, completeness: 'inconclusive' });
  expect(collections).toBe(0);
});
