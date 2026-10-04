import { test, expect, isLookupEndpointUrl } from './fixtures';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { openSeededTimelineCase } from './case-test-fixtures';
import { openRetainedFiles } from './case-attachment-fixtures';
import { readBrowserLocalCollection, expectNoHorizontalOverflow, useTheme } from './helpers';
import AxeBuilder from '@axe-core/playwright';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';

test('selected plaintext phones and supplied destination pairs retain only applied private observations', async ({ page }, testInfo) => {
  let requests = 0;
  await page.route(url => isLookupEndpointUrl(url.href), route => { requests++; return route.abort(); });
  const record = createCase({ domain: 'example.test' }, '2026-01-02T03:04:05.000Z');
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  const initialUrl = page.url();
  await page.getByText('Review a message, link or selected file', { exact: true }).click();
  const intake = page.locator('details.intake');
  const source = '\uFEFF🧭 Support: +1 202 555 0107\nOther: +1 202 555 0108\nUnsupported: +1 202\u202e555 0109\nPRIVATE-SURROUNDING';
  await intake.getByLabel('Text to review').fill(source);
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('status')).toContainText('transient phone candidates: 3');
  const downloadReport = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), intake.getByRole('button', { name: 'Download review', exact: true }).click()]);
    const chunks: Buffer[] = [];
    for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  };
  const unselected = await downloadReport();
  expect(unselected).not.toMatch(/202 555|1202555|PRIVATE-SURROUNDING/);
  expect(JSON.parse(unselected).selectedEvidence).toBeUndefined();
  await intake.getByText('Select phone candidates or compare supplied destinations', { exact: true }).click();
  const selected = intake.locator('.selected-evidence');
  await expect(selected).toContainText(`Source span [${source.indexOf('+')}, ${source.indexOf('\n')})`);
  await expect(selected).toContainText('\\u{202e}');
  await expect(selected.locator('ol')).not.toContainText('\u202e');
  await expect(selected.getByLabel('Select phone candidate 3', { exact: true })).toBeDisabled();
  await selected.getByLabel('Select phone candidate 1', { exact: true }).check();
  await selected.getByLabel('Select phone candidate 2', { exact: true }).check();
  await selected.getByLabel('Select phone candidate 2', { exact: true }).uncheck();
  await expect(intake.getByRole('button', { name: 'Download review', exact: true })).toBeDisabled();
  await selected.getByLabel('Phone source label', { exact: true }).fill('Selected support snippet');
  await selected.getByRole('combobox', { name: 'Phone text basis', exact: true }).selectOption('manual_transcription');
  await selected.getByRole('combobox', { name: 'Declared phone role', exact: true }).selectOption('advertised_support_contact');
  await selected.getByLabel('Include a manually supplied destination pair', { exact: true }).check();
  await selected.getByLabel('Displayed or claimed destination', { exact: true }).fill('store.example.test');
  await selected.getByLabel('Displayed evidence source label', { exact: true }).fill('Supplied advert');
  await selected.getByLabel('Separately supplied destination', { exact: true }).fill('https://store.example.test.attacker.invalid/private-path?key=PRIVATE-URL');
  await selected.getByLabel('Destination evidence source label', { exact: true }).fill('Supplied redirect record');
  await selected.getByRole('combobox', { name: 'Destination evidence role', exact: true }).selectOption('supplied_redirect');
  await selected.getByRole('button', { name: 'Apply selected contact and destination evidence', exact: true }).click();
  await expect(selected.getByRole('heading', { name: 'Applied selected evidence', exact: true })).toBeFocused();
  await expect(selected.getByRole('region', { name: 'Applied selected evidence', exact: true })).toContainText('different host');
  const report = JSON.parse(await downloadReport());
  expect(page.url()).toBe(initialUrl);
  expect(report.selectedEvidence.phones).toHaveLength(1);
  expect(report.selectedEvidence.phones[0].occurrences).toEqual([{ original: '+1 202 555 0107', start: source.indexOf('+'), end: source.indexOf('\n') }]);
  expect(report.selectedEvidence.phones[0].declaration.observedAt).toBeNull();
  expect(report.selectedEvidence.destinationPair.destinationDeclaration.role).toBe('supplied_redirect');
  expect(JSON.stringify(report)).not.toMatch(/0108|0109|PRIVATE-SURROUNDING|private-path|PRIVATE-URL/);
  await selected.getByLabel('Declared country calling prefix', { exact: true }).fill('+61');
  await expect(intake.getByRole('button', { name: 'Save review in Case', exact: true })).toBeDisabled();
  await selected.getByRole('button', { name: 'Apply selected contact and destination evidence', exact: true }).click();
  await expect(selected.getByRole('region', { name: 'Applied selected evidence', exact: true })).toContainText('country context conflict');
  await selected.getByLabel('Declared country calling prefix', { exact: true }).fill('');
  await selected.getByRole('button', { name: 'Apply selected contact and destination evidence', exact: true }).click();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(selected).toBeVisible(); await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await selected.getByRole('heading', { name: 'Applied selected evidence', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`selected-intake-${theme}-${width}.png`) });
      }
    }
    expect((await new AxeBuilder({ page }).include('.selected-evidence').analyze()).violations).toEqual([]);
  }
  await intake.getByRole('button', { name: 'Save review in Case', exact: true }).click();
  await expect(intake.getByRole('status')).toContainText('Saved the review in this Case.');
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 2 });
  expect(saved.records[0]!.value.attachments).toHaveLength(1);
  expect(JSON.stringify(saved.records)).not.toMatch(/202 555|1202555|PRIVATE-URL|attacker\.invalid/);
  await page.reload();
  const files = await openRetainedFiles(page);
  await files.getByRole('button', { name: 'Preview message-review.json', exact: true }).click();
  await expect(files.locator('pre')).toContainText('advertised_support_contact');
  await expect(files.locator('pre')).toContainText('supplied_redirect');
  const [retainedDownload] = await Promise.all([page.waitForEvent('download'), files.getByRole('button', { name: 'Download original message-review.json', exact: true }).click()]);
  const retainedChunks: Buffer[] = [];
  for await (const chunk of (await retainedDownload.createReadStream())!) retainedChunks.push(Buffer.from(chunk));
  const retained = Buffer.concat(retainedChunks).toString('utf8');
  expect(JSON.parse(retained)).toEqual(report);
  expect(retained).not.toMatch(/0108|0109|PRIVATE-SURROUNDING|PRIVATE-URL/);
  expect(new URL(page.url()).pathname).toBe(new URL(initialUrl).pathname);
  expect(requests).toBe(0);
});
