import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { selectedPdfFixture, selectedDocxFixture, selectedHarFixture } from '../fixtures/selected-input-examples.mts';
import { expectNoHorizontalOverflow, useTheme } from './helpers';

test('document and HTTP-archive intake share offline navigation, provenance and minimised downloads', async ({ page }, testInfo) => {
  let collections = 0;
  await page.route('**/api/lookup', route => { collections++; return route.abort(); });
  await page.goto('/lookup');
  await page.getByText('Review a message, link or selected file', { exact: true }).click();
  const intake = page.locator('details.intake');
  for (const [kind, bytes, hostname] of [
    ['pdf', selectedPdfFixture(), 'document-qr.example'],
    ['docx', selectedDocxFixture(), 'docx-link.example'],
    ['har', selectedHarFixture(), 'request.example'],
  ] as const) {
    await intake.getByLabel('Input type').selectOption(kind);
    await intake.getByLabel('Select a file').setInputFiles({ name: `selected.${kind}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
    await expect(intake.getByRole('heading', { name: 'Extracted destinations' })).toBeFocused();
    await expect(intake.getByRole('button', { name: `Use ${hostname} in Lookup`, exact: true })).toBeVisible();
    if (kind === 'har') {
      await expect(intake.getByRole('region', { name: 'Recorded HTTP sequence' })).toContainText('Duration unavailable');
      await expect(intake.getByRole('region', { name: 'Recorded HTTP sequence' })).toContainText('0 ms');
    } else {
      await expect(intake.getByRole('region', { name: 'Document extraction coverage' })).toContainText('partial');
      if (kind === 'pdf') await expect(intake).toContainText('page 1');
    }
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      for (const width of [320, 390, 1024, 1280]) {
        await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
        await expectNoHorizontalOverflow(page);
        expect((await new AxeBuilder({ page }).include('.intake').analyze()).violations).toEqual([]);
        if (kind === 'har' && (width === 320 || width === 1280)) await intake.getByRole('region', { name: 'Recorded HTTP sequence' }).screenshot({ path: testInfo.outputPath(`har-${width}-${theme}.png`) });
      }
    }
    const [download] = await Promise.all([page.waitForEvent('download'), intake.getByRole('button', { name: 'Download review', exact: true }).click()]);
    const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
    const output = Buffer.concat(chunks).toString('utf8'), report = JSON.parse(output);
    expect(report.source.kind).toBe(kind); expect(output).not.toMatch(/private-value|private-body|Bearer|access_token|\/private/u);
    await intake.getByRole('button', { name: `Use ${hostname} in Lookup`, exact: true }).click();
    await expect(page.locator('#query')).toHaveValue(hostname); await expect(page.locator('#query')).toBeFocused();
    expect(collections).toBe(0);
  }
  await intake.getByLabel('Input type').selectOption('pdf');
  await intake.getByLabel('Select a file').setInputFiles({ name: 'encrypted.pdf', mimeType: 'application/pdf', buffer: Buffer.from(selectedPdfFixture(true)) });
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('region', { name: 'Document extraction coverage' })).toContainText('encrypted');
  await expect(intake.getByRole('textbox', { name: /password/iu })).toHaveCount(0);
  expect(collections).toBe(0);
});
