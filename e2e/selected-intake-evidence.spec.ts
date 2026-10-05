import { test, expect, isLookupEndpointUrl } from './fixtures';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { openSeededTimelineCase } from './case-test-fixtures';
import { openRetainedFiles } from './case-attachment-fixtures';
import { readBrowserLocalCollection, expectNoHorizontalOverflow, useTheme } from './helpers';
import AxeBuilder from '@axe-core/playwright';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { createHash } from 'node:crypto';

test('selected plaintext phones and supplied destination pairs retain only applied private observations', async ({ page }, testInfo) => {
  let requests = 0;
  await page.route(url => isLookupEndpointUrl(url.href), route => { requests++; return route.abort(); });
  const record = createCase({ domain: 'example.test' }, '2026-01-02T03:04:05.000Z');
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  const initialUrl = page.url();
  await page.getByText('Review a message, link or selected file', { exact: true }).click();
  const intake = page.locator('details.intake');
  const source = '\uFEFF🧭 Support: +1 202 555 0107.\nOther: +1 202 555 0108.\nUnsupported: +1 202\u202e555 0109.\nPRIVATE-SURROUNDING';
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
  await expect(selected).toContainText(`Source span [${source.indexOf('+')}, ${source.indexOf('.')})`);
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
  expect(report.selectedEvidence.phones[0].occurrences).toEqual([{ original: '+1 202 555 0107', start: source.indexOf('+'), end: source.indexOf('.') }]);
  expect(report.selectedEvidence.sourceDigestSha256).toBe(`sha256:${createHash('sha256').update(source).digest('hex')}`);
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

test('phone declarations support mixed provenance, keep exact occurrences and reset transient overrides', async ({ page }, testInfo) => {
  const record = createCase({ domain: 'example.test' }, '2026-01-02T03:04:05.000Z');
  const other = createCase({ domain: 'other.example' }, '2026-01-02T03:04:05.000Z');
  await openSeededTimelineCase(page, record.domain, [record, other], CASE_SCHEMA_VERSION);
  await page.getByText('Review a message, link or selected file', { exact: true }).click();
  const intake = page.locator('details.intake');
  const source = 'Support: +1 202 555 0107.\nCopied contact: +1 (202) 555-0107.\nSupport: +1 202 555 0107.';
  await intake.getByLabel('Text to review').fill(source);
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('status')).toContainText('transient phone candidates: 3');
  await intake.getByText('Select phone candidates or compare supplied destinations', { exact: true }).click();
  const selected = intake.locator('.selected-evidence');
  for (const id of [1, 2, 3]) await selected.getByLabel(`Select phone candidate ${id}`, { exact: true }).check();
  await selected.getByLabel('Phone source label', { exact: true }).fill('Supplied support excerpt');
  await selected.getByRole('combobox', { name: 'Declared phone role', exact: true }).selectOption('advertised_support_contact');
  await selected.getByText('Declaration for candidate 2', { exact: true }).click();
  await selected.getByLabel('Use a different declaration for candidate 2').check();
  await selected.getByLabel('Candidate 2 source label', { exact: true }).fill('Separate supplied image transcription');
  await selected.getByRole('combobox', { name: 'Candidate 2 text basis', exact: true }).selectOption('manual_transcription');
  await selected.getByRole('combobox', { name: 'Candidate 2 phone role', exact: true }).selectOption('sender_or_caller_id_claim');
  await selected.getByLabel('Candidate 2 observation time (ISO with timezone)', { exact: true }).fill('2026-09-01T12:00:00');
  const apply = selected.getByRole('button', { name: 'Apply selected contact and destination evidence', exact: true });
  await apply.click();
  await expect(selected.getByRole('alert')).toHaveText('Declared observation time requires an explicit timezone.');
  await expect(intake.getByRole('button', { name: 'Download review', exact: true })).toBeDisabled();
  await expect(intake.getByRole('button', { name: 'Save review in Case', exact: true })).toBeDisabled();
  await selected.getByLabel('Candidate 2 observation time (ISO with timezone)', { exact: true }).fill('2026-09-01T12:00:00+10:00');
  await apply.click();
  await expect(selected.getByRole('heading', { name: 'Applied selected evidence', exact: true })).toBeFocused();
  const downloadReview = async () => {
    const waiting = page.waitForEvent('download');
    await intake.getByRole('button', { name: 'Download review', exact: true }).click();
    return JSON.parse(Buffer.concat(await (await (await waiting).createReadStream())!.toArray()).toString('utf8'));
  };
  const report = await downloadReview();
  expect(report.selectedEvidence.phones).toHaveLength(2);
  const [shared, distinct] = report.selectedEvidence.phones;
  expect(shared.canonical).toBe('+12025550107');
  expect(shared.occurrences).toHaveLength(2);
  expect(shared.declaration).toMatchObject({ sourceLabel: 'Supplied support excerpt', basis: 'unknown', role: 'advertised_support_contact', observedAt: null, countryCallingCode: null });
  expect(distinct.occurrences).toHaveLength(1);
  expect(distinct.canonical).toBe(shared.canonical);
  expect(distinct.declaration).toMatchObject({ sourceLabel: 'Separate supplied image transcription', basis: 'manual_transcription', role: 'sender_or_caller_id_claim', observedAt: '2026-09-01T02:00:00.000Z', countryCallingCode: null });
  for (const phone of report.selectedEvidence.phones) for (const occurrence of phone.occurrences)
    expect(source.slice(occurrence.start, occurrence.end)).toBe(occurrence.original);
  const declaration = selected.getByText('Declaration for candidate 2', { exact: true }).locator('..');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await declaration.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await declaration.screenshot({ path: testInfo.outputPath(`phone-declaration-${theme}-${width}.png`) });
    }
    expect((await new AxeBuilder({ page }).include('.selected-evidence').analyze()).violations).toEqual([]);
  }
  // Disabling an override restores the common declaration without losing spans.
  await selected.getByLabel('Use a different declaration for candidate 2').uncheck();
  await expect(intake.getByRole('button', { name: 'Download review', exact: true })).toBeDisabled();
  await apply.click();
  const regrouped = await downloadReview();
  expect(regrouped.selectedEvidence.phones).toHaveLength(1);
  expect(regrouped.selectedEvidence.phones[0].occurrences).toHaveLength(3);
  await selected.getByRole('button', { name: 'Clear selected evidence', exact: true }).click();
  expect((await downloadReview()).selectedEvidence).toBeUndefined();
  await selected.getByLabel('Select phone candidate 2', { exact: true }).check();
  await expect(selected.getByLabel('Phone source label', { exact: true })).toHaveValue('');
  await selected.getByText('Declaration for candidate 2', { exact: true }).click();
  await expect(selected.getByLabel('Use a different declaration for candidate 2')).not.toBeChecked();
  await selected.getByLabel('Use a different declaration for candidate 2').check();
  await selected.getByLabel('Candidate 2 source label', { exact: true }).fill('Occurrence-only declaration');
  // An unused default must not prevent applying a complete occurrence override.
  await apply.click();
  expect((await downloadReview()).selectedEvidence.phones[0].declaration.sourceLabel).toBe('Occurrence-only declaration');
  await intake.getByLabel('Text to review').fill('New input: +1 202 555 0108.');
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('status')).toContainText('transient phone candidates: 1');
  await selected.locator(':scope > summary').click();
  await selected.getByLabel('Select phone candidate 1', { exact: true }).check();
  await expect(selected.getByLabel('Phone source label', { exact: true })).toHaveValue('');
  await selected.getByText('Declaration for candidate 1', { exact: true }).click();
  await selected.getByLabel('Use a different declaration for candidate 1').check();
  await selected.getByLabel('Candidate 1 source label', { exact: true }).fill('Unsaved declaration for this Case only');
  await expect(intake.getByRole('button', { name: 'Download review', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await page.locator('.case-head', { hasText: other.domain }).click();
  await page.getByRole('navigation', { name: 'Case sections' }).getByRole('link', { name: 'Evidence', exact: true }).click();
  await page.getByText('Review a message, link or selected file', { exact: true }).click();
  await expect(intake.getByLabel('Text to review')).toHaveValue('');
  await expect(intake.getByRole('heading', { name: 'Applied selected evidence', exact: true })).toHaveCount(0);
});
