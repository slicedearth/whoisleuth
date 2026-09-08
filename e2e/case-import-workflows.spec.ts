import { createHash } from 'node:crypto';
import { gzipSync, zipSync } from 'fflate';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalCollectionReadAfterWrite, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, runBulkScan, useTheme } from './helpers';
import { createCase, openCaseResponseWorkspace, openCasesView } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import { EXTERNAL_FINDINGS_VERSION } from '../packages/interchange/external-findings-import.mts';
import { caseWorkspaceActionStatus } from './case-response-fixtures';

// Bounded external evidence imports, Case management and Bulk handoff coverage.

function pagedFindingFile(count = 100, longFields = false) {
  return {
    name: 'bounded-review.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schema: 'whoisleuth.external-findings', schemaVersion: EXTERNAL_FINDINGS_VERSION,
      source: { name: longFields ? 'S'.repeat(80) : 'Paged source review', reference: longFields ? 'r'.repeat(500) : 'Local fixture' },
      findings: Array.from({ length: count }, (_, index) => ({
        domain: `review-${Math.floor(index / 5)}.invalid`, category: 'page', evidenceClass: 'provider_report',
        summary: longFields ? `${index + 1}: ${'v'.repeat(880)}` : `Independent observation ${index + 1}`,
        observedAt: '2026-08-01T00:00:00.000Z', completeness: 'partial',
        limitations: longFields ? Array.from({ length: 8 }, (_, number) => `Supplied qualification ${number + 1}`) : ['Not independently collected.'],
        reference: longFields ? `${'x'.repeat(480)}-${index + 1}` : `finding-${index + 1}`,
      })),
    })),
  };
}

test('every accepted finding is reachable and the final deselection stays empty across pages', async ({ page }) => {
  await openCasesView(page);
  const importer = page.locator('details').filter({ has: page.getByText('Import bounded external findings', { exact: true }) });
  await importer.getByText('Import bounded external findings', { exact: true }).click();
  const fileInput = importer.locator('input[type="file"]');
  await fileInput.setInputFiles(pagedFindingFile());
  const review = importer.getByRole('region', { name: 'Validated import review' });
  await expect(review).toContainText('100 findings · 20 domains');
  const navigation = review.getByRole('navigation', { name: 'Import preview pages' });
  const encountered: string[] = [];
  await review.getByRole('button', { name: 'Clear selection' }).click();
  for (let index = 0; index < 10; index += 1) {
    await expect(navigation).toContainText(`Page ${index + 1} of 10`);
    const checkboxes = review.getByRole('checkbox');
    await expect(checkboxes).toHaveCount(10);
    encountered.push(...await checkboxes.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? '')));
    if (index < 9) {
      await navigation.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(navigation.getByRole('button', { name: 'Next', exact: true })).toBeFocused();
    }
  }
  expect(encountered).toEqual(Array.from({ length: 100 }, (_, index) => `Include finding ${index + 1}: review-${Math.floor(index / 5)}.invalid`));
  await expect(review).toContainText('0 of 100 findings selected');
  await expect(review.getByRole('button', { name: 'Import into cases', exact: true })).toBeDisabled();
  const last = review.getByRole('checkbox', { name: 'Include finding 100: review-19.invalid', exact: true });
  await last.check();
  await last.uncheck();
  await expect(review).toContainText('0 of 100 findings selected');
  await navigation.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(review).toContainText('0 of 100 findings selected');
  await expect(review.getByRole('checkbox')).toHaveCount(10);
  await expect(review.locator('input[type="checkbox"]:checked')).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Next', exact: true }).click();
  await last.check();
  await review.getByRole('button', { name: 'Import into cases', exact: true }).click();
  await expect(page.locator('.case-head')).toHaveCount(1);
  await expect(page.locator('.case-head')).toContainText('review-19.invalid');
  await expect(fileInput).toBeFocused();
  await page.locator('.case-head').click();
  const response = await openCaseResponseWorkspace(page);
  await expect(response).toContainText('Independent observation 100');
  await expect(response).not.toContainText('Independent observation 99');
});

test('new files and cancellation reset review selection without writing Cases', async ({ page }) => {
  await openCasesView(page);
  const importer = page.locator('details').filter({ has: page.getByText('Import bounded external findings', { exact: true }) });
  await importer.getByText('Import bounded external findings', { exact: true }).click();
  const fileInput = importer.locator('input[type="file"]');
  await fileInput.setInputFiles(pagedFindingFile());
  const review = importer.getByRole('region', { name: 'Validated import review' });
  await review.getByRole('button', { name: 'Clear selection' }).click();
  await review.getByRole('navigation', { name: 'Import preview pages' }).getByRole('button', { name: 'Next' }).click();
  await fileInput.setInputFiles(pagedFindingFile(1));
  await expect(review).toContainText('1 of 1 finding selected');
  await expect(review.getByRole('checkbox', { name: 'Include finding 1: review-0.invalid' })).toBeChecked();
  await expect(review.getByRole('navigation', { name: 'Import preview pages' })).toHaveCount(0);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(fileInput).toBeFocused();
  await expect(page.locator('.case-head')).toHaveCount(0);
});

for (const outcome of ['write-failure', 'refresh-failure'] as const) {
  test(`import selection preserves the correct retry boundary after ${outcome}`, async ({ page }) => {
    await openCasesView(page);
    await createCase(page, 'review-2.invalid');
    const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
    const importer = page.locator('details').filter({ has: page.getByText('Import bounded external findings', { exact: true }) });
    await importer.getByText('Import bounded external findings', { exact: true }).click();
    await importer.locator('input[type="file"]').setInputFiles(pagedFindingFile(12));
    const review = importer.getByRole('region', { name: 'Validated import review' });
    await review.getByRole('button', { name: 'Clear selection' }).click();
    const navigation = review.getByRole('navigation', { name: 'Import preview pages' });
    await navigation.getByRole('button', { name: 'Next', exact: true }).click();
    const selected = review.getByRole('checkbox', { name: 'Include finding 12: review-2.invalid', exact: true });
    await selected.check();
    if (outcome === 'write-failure') await failNextBrowserLocalManifestWrite(page, 'cases');
    else await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
    const submit = review.getByRole('button', { name: 'Import into cases', exact: true });
    await submit.click();
    if (outcome === 'write-failure') {
      await expect(caseWorkspaceActionStatus(page)).toContainText('out of storage space');
      await expect(review).toContainText('1 of 12 findings selected');
      await expect(navigation).toContainText('Page 2 of 2');
      await expect(selected).toBeChecked();
      await expect(submit).toBeFocused();
      expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).manifest.revision).toBe(before.manifest.revision);
      await submit.click();
    } else {
      await expect(caseWorkspaceActionStatus(page)).toContainText('The import was saved, but Cases could not be reread');
    }
    await expect(review).toHaveCount(0);
    const committed = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: before.manifest.revision + 1 });
    expect(committed.manifest.revision).toBe(before.manifest.revision + 1);
    expect(committed.records).toHaveLength(1);
    expect(committed.records[0]!.value.evidencePins).toHaveLength(1);
    expect(committed.records[0]!.value.sightings).toHaveLength(1);
    await expect(page.locator('.case-head')).toContainText('review-2.invalid');
  });
}

for (const width of [320, 390, 1024, 1280, 1920, 3840]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`retained import fields remain readable and keyboard-scrollable at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await useTheme(page, theme);
      await openCasesView(page);
      const importer = page.locator('details').filter({ has: page.getByText('Import bounded external findings', { exact: true }) });
      await importer.getByText('Import bounded external findings', { exact: true }).click();
      await importer.locator('input[type="file"]').setInputFiles(pagedFindingFile(100, true));
      const review = importer.getByRole('region', { name: 'Validated import review' });
      await expect(review).toContainText('100 findings · 20 domains');
      await expect(review.getByText(/Shortened Case fields:/)).toHaveCount(10);
      const summary = review.getByText('Retained fields for finding 1', { exact: true });
      await summary.focus();
      await page.keyboard.press('Enter');
      const region = review.getByRole('region', { name: 'Retained Case fields for finding 1', exact: true });
      await expect(region).toBeVisible();
      const retained = JSON.parse(await region.innerText()) as { evidencePin: { value: string; source: string; truncated: boolean; limitations: string[] }; sighting: { observedAt: string; state: string } };
      expect(retained.evidencePin.value).toHaveLength(1_000);
      expect(retained.evidencePin.source).toHaveLength(80);
      expect(retained.evidencePin.truncated).toBe(true);
      expect(retained.evidencePin.limitations).toHaveLength(8);
      expect(retained.evidencePin.limitations.some((value) => value.includes('4 supplied limitations were omitted'))).toBe(true);
      expect(retained.sighting).toMatchObject({ observedAt: '2026-08-01T00:00:00.000Z', state: 'reported_by_provider' });
      await page.keyboard.press('Tab');
      await expect(region).toBeFocused();
      expect(await region.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await page.keyboard.press('PageDown');
      await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`import-review-${width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
}

test('external findings require a validated preview before creating local evidence pins', async ({ page }) => {
  await openCasesView(page);
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  const payload = JSON.stringify({
    schema: 'whoisleuth.external-findings',
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: 'Local analyst export', reference: 'offline review' },
    findings: [{
      domain: 'external-review.invalid',
      category: 'page',
      evidenceClass: 'provider_report',
      summary: 'A credential form was reported in a retained external observation.',
      observedAt: '2026-07-28T01:00:00.000Z',
      completeness: 'partial',
      limitations: ['Rendered behavior was not retained.'],
      reference: 'finding-17',
    }],
  });
  const file = { name: 'external-findings.json', mimeType: 'application/json', buffer: Buffer.from(payload) };

  await externalImport.locator('input[type="file"]').setInputFiles(file);
  await expect(externalImport.getByRole('heading', { name: 'Local analyst export' })).toBeVisible();
  await expect(externalImport).toContainText('1 finding · 1 domain');
  await expect(externalImport).toContainText('page · provider report · partial');
  await expect(page.locator('.case-head', { hasText: 'external-review.invalid' })).toHaveCount(0);

  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(page.locator('.case-head', { hasText: 'external-review.invalid' })).toBeVisible();
  await page.locator('.case-head', { hasText: 'external-review.invalid' }).click();
  const externalWorkspace=await openCaseResponseWorkspace(page);
  await expect(externalWorkspace).toContainText('External page finding');
  await expect(externalWorkspace).toContainText('Provider report: Local analyst export');
  await expect(externalWorkspace).toContainText('reported by provider · website');
  await expect(externalWorkspace).toContainText('WHOISleuth did not collect or independently verify this provider finding');

  await externalImport.locator('input[type="file"]').setInputFiles(file);
  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'skipped 1 duplicate' })).toBeVisible();
  await expect(externalWorkspace).toContainText('1 pin · 1 sighting · 0 decisions');
});

test('external findings serialize file parsing before exposing import actions', async ({ page }) => {
  await openCasesView(page);
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  await page.evaluate(() => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    let holdNextRead = true;
    File.prototype.arrayBuffer = function arrayBuffer() {
      if (!holdNextRead) return originalArrayBuffer.call(this);
      holdNextRead = false;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        Reflect.set(window, '__releaseExternalFileRead', () => {
          void originalArrayBuffer.call(this).then(resolve, reject);
        });
      });
    };
  });
  const payload = JSON.stringify({
    schema: 'whoisleuth.external-findings',
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: 'Serialized local review', reference: 'offline fixture' },
    findings: [{
      domain: 'serialized-review.invalid',
      category: 'page',
      evidenceClass: 'provider_report',
      summary: 'A bounded retained observation.',
      observedAt: '2026-07-28T01:00:00.000Z',
      completeness: 'partial',
      limitations: ['Rendered behavior was not retained.'],
      reference: 'serialized-17',
    }],
  });

  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'serialized-findings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(payload),
  });
  await expect(externalImport).toHaveAttribute('aria-busy', 'true');
  await expect(externalImport.locator('input[type="file"]')).toBeDisabled();
  await expect(externalImport.getByText('Reading selected file…', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const release = Reflect.get(window, '__releaseExternalFileRead');
    if (typeof release !== 'function') throw new Error('The external-file read gate was not installed.');
    release();
  });

  await expect(externalImport).toHaveAttribute('aria-busy', 'false');
  await expect(externalImport.getByRole('heading', { name: 'Serialized local review' })).toBeVisible();
  await expect(externalImport.getByRole('button', { name: 'Import into cases' })).toBeEnabled();
});

test('portable WARC evidence is normalized locally before deliberate case import', async ({ page }) => {
  await openCasesView(page);
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  const prefix = [
    'HTTP/1.1 200 OK',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<!doctype html><html><head><title>Reviewed archive page</title></head><body>private body',
  ].join('\r\n');
  const suffix = '</body></html>';
  const recordBytes = 1_048_576;
  const block = Buffer.from(prefix + 'x'.repeat(recordBytes - Buffer.byteLength(prefix + suffix)) + suffix);
  expect(block.byteLength).toBe(recordBytes);
  function archiveFor(response: Buffer): Buffer {
    const headers = Buffer.from([
      'WARC/1.1',
      'WARC-Type: response',
      'WARC-Date: 2026-07-28T01:00:00.000Z',
      'WARC-Record-ID: <urn:uuid:e2e-response>',
      'WARC-Target-URI: https://archive-review.invalid/private?token=secret',
      `WARC-Block-Digest: sha256:${createHash('sha256').update(response).digest('hex')}`,
      'Content-Type: application/http; msgtype=response',
      `Content-Length: ${response.byteLength}`,
      '',
      '',
    ].join('\r\n'));
    return Buffer.concat([headers, response, Buffer.from('\r\n\r\n')]);
  }
  const malformedPrefix = 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n';
  const malformed = Buffer.from((malformedPrefix + '<title '.repeat(150_000)).slice(0, recordBytes));
  expect(malformed.byteLength).toBe(recordBytes);
  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'unfinished-title.warc', mimeType: 'application/warc', buffer: archiveFor(malformed),
  });
  await expect(externalImport.getByRole('heading', { name: 'Portable WARC evidence' })).toBeVisible();
  await expect(externalImport).toHaveAttribute('aria-busy', 'false');
  await expect(externalImport).toContainText('HTTP status 200');
  await expect(externalImport).not.toContainText('Observed title');
  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'reviewed-evidence.warc',
    mimeType: 'application/warc',
    buffer: archiveFor(block),
  });
  await expect(externalImport.getByRole('heading', { name: 'Portable WARC evidence' })).toBeVisible();
  await expect(externalImport).toContainText('Reviewed archive page');
  await expect(externalImport).not.toContainText('private body');
  await expect(externalImport).not.toContainText('token=secret');
  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'Imported 1 finding into 1 new and 0 existing case.' })).toBeVisible();
  await expect(page.locator('#monitor-view-panel')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.locator('.case-head', { hasText: 'archive-review.invalid' })).toBeVisible();
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(JSON.stringify(stored.records)).not.toContain('private body');
  expect(JSON.stringify(stored.records)).not.toContain('token=secret');
});

test('portable WACZ evidence verifies package fixity before using the WARC privacy filter', async ({ page }) => {
  await openCasesView(page);
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  const block = Buffer.from([
    'HTTP/1.1 200 OK',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<!doctype html><html><head><title>Reviewed packaged page</title></head><body>discarded package body</body></html>',
  ].join('\r\n'));
  const recordDigest = createHash('sha256').update(block).digest('hex');
  const headers = Buffer.from([
    'WARC/1.1',
    'WARC-Type: response',
    'WARC-Date: 2026-07-28T01:00:00.000Z',
    'WARC-Record-ID: <urn:uuid:wacz-e2e-response>',
    'WARC-Target-URI: https://package-review.invalid/private?token=secret',
    `WARC-Block-Digest: sha256:${recordDigest}`,
    'Content-Type: application/http; msgtype=response',
    `Content-Length: ${block.byteLength}`,
    '',
    '',
  ].join('\r\n'));
  const compressedWarc = gzipSync(Buffer.concat([headers, block, Buffer.from('\r\n\r\n')]));
  function packageWarc(bytes: Uint8Array) {
    const manifest = Buffer.from(JSON.stringify({
      profile: 'data-package', wacz_version: '1.1.1',
      resources: [{
        name: 'capture.warc.gz', path: 'archive/capture.warc.gz',
        hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        bytes: bytes.byteLength,
      }],
    }));
    return zipSync({
      'archive/capture.warc.gz': [bytes, { level: 0 }],
      'datapackage.json': manifest,
      'datapackage-digest.json': Buffer.from(JSON.stringify({
        path: 'datapackage.json',
        hash: `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
      })),
    });
  }
  for (const offsets of [[8], [4], [8, 4]]) {
    const corrupt = compressedWarc.slice();
    for (const offset of offsets) corrupt[corrupt.length - offset]! ^= 1;
    // The outer manifest digests and ZIP CRCs are valid. Only GZIP is corrupt.
    await externalImport.locator('input[type="file"]').setInputFiles({
      name: 'corrupt-evidence.wacz', mimeType: 'application/wacz', buffer: Buffer.from(packageWarc(corrupt)),
    });
    await expect(caseWorkspaceActionStatus(page)).toContainText('A compressed WACZ WARC resource could not be safely decompressed.');
    await expect(externalImport.locator('input[type="file"]')).toBeEnabled();
    await expect(externalImport.getByRole('button', { name: 'Import into cases' })).toHaveCount(0);
    await expect(page.locator('.case-head', { hasText: 'package-review.invalid' })).toHaveCount(0);
  }
  const wacz = packageWarc(compressedWarc);
  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'reviewed-evidence.wacz',
    mimeType: 'application/wacz',
    buffer: Buffer.from(wacz),
  });
  await expect(externalImport.getByRole('heading', { name: 'Portable WACZ evidence' })).toBeVisible();
  await expect(externalImport).toContainText('Reviewed packaged page');
  await expect(externalImport).not.toContainText('discarded package body');
  await expect(externalImport).not.toContainText('token=secret');
  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(page.locator('.case-head', { hasText: 'package-review.invalid' })).toBeVisible();
});

test('STIX claims require an existing selected case and remain separate from collected evidence', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'intelligence-case.invalid');
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  const payload = JSON.stringify({
    type: 'bundle',
    id: 'bundle--00000000-0000-4000-8000-000000000101',
    objects: [
      {
        type: 'identity',
        spec_version: '2.1',
        id: 'identity--00000000-0000-4000-8000-000000000102',
        name: 'External review source',
      },
      {
        type: 'indicator',
        spec_version: '2.1',
        id: 'indicator--00000000-0000-4000-8000-000000000103',
        created_by_ref: 'identity--00000000-0000-4000-8000-000000000102',
        pattern_type: 'stix',
        pattern: "[domain-name:value = 'reported.invalid']",
        valid_from: '2026-07-28T01:00:00.000Z',
        labels: ['analyst-review'],
        confidence: 60,
      },
    ],
  });
  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'external-review.stix.json',
    mimeType: 'application/stix+json',
    buffer: Buffer.from(payload),
  });

  await expect(externalImport.getByRole('heading', { name: /bundle--/ })).toBeVisible();
  await expect(externalImport).toContainText('1 accepted');
  await expect(externalImport.getByRole('button', { name: 'Merge assertions into case' })).toBeDisabled();
  await externalImport.getByLabel('Merge into existing case').selectOption({ label: 'intelligence-case.invalid' });
  await externalImport.getByRole('button', { name: 'Merge assertions into case' }).click();
  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'Merged 1 external assertion' })).toBeVisible();

  const caseHead = page.locator('.case-head', { hasText: 'intelligence-case.invalid' });
  if (await caseHead.getAttribute('aria-expanded') !== 'true') await caseHead.click();
  const response = await openCaseResponseWorkspace(page);
  await expect(response).toContainText('0 pins · 0 sightings · 0 decisions · 1 assertion');
  await response.getByText('Structure facts, hypotheses, unknowns, and next steps', { exact: true }).click();
  await expect(response).toContainText('external import · open');
  await expect(response).toContainText('External review source');
  await expect(response).toContainText('File SHA-256');
  await expect(response).toContainText('WHOISleuth did not collect or independently verify this claim');
});

test('deleting a case removes it after confirmation', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'delete-me.invalid');

  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('.case-actions .danger').click();

  await expect(page.locator('.case-head', { hasText: 'delete-me.invalid' })).toHaveCount(0);
});

test('a case file imports and merges through the Cases toolbar', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'local.invalid');

  const importPayload = {
    version: CASE_SCHEMA_VERSION,
    exportedAt: '2026-07-01T00:00:00.000Z',
    cases: [
      {
        id: 'imported-1',
        domain: 'imported.invalid',
        status: 'reviewing',
        disposition: 'suspicious',
        tags: ['phishing'],
        notes: [],
        source: 'lookup',
        evidenceHistory: [],
        createdAt: '2026-06-15T00:00:00.000Z',
        updatedAt: '2026-06-15T00:00:00.000Z',
      },
    ],
  };

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('.case-toolbar label', { hasText: 'Import JSON' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'cases.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importPayload)),
  });

  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'Imported 1 new' })).toBeVisible();
  await expect(page.locator('.case-head', { hasText: 'local.invalid' })).toBeVisible();
  await expect(page.locator('.case-head', { hasText: 'imported.invalid' })).toBeVisible();
});

test('filtering by status narrows the visible cases', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'filter-a.invalid');
  await createCase(page, 'filter-b.invalid');

  // Escalate one.
  await page.locator('.case-head', { hasText: 'filter-a.invalid' }).click();
  await page.locator('.case-body .field-grid select').first().selectOption('escalated');

  await page.locator('.case-filters select').first().selectOption('escalated');
  await expect(page.locator('.case-head', { hasText: 'filter-a.invalid' })).toBeVisible();
  await expect(page.locator('.case-head', { hasText: 'filter-b.invalid' })).toHaveCount(0);
});

test('the Cases view has no horizontal overflow on a short mobile viewport', {
  tag: ['@analyst-journey', '@journey-reviewed-response-decision'],
}, async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await openCasesView(page);
  await createCase(page, 'mobile.invalid');
  await page.locator('.case-body .note-edit textarea').fill('A fairly long note that should wrap rather than push the layout wider than the viewport.');
  await expectNoHorizontalOverflow(page);
});

test('the Lookup query prefills from the q parameter for case navigation', async ({ page }) => {
  await page.goto('/lookup?q=lookmeup.invalid');
  await expect(page.locator('#query')).toHaveValue('lookmeup.invalid');
});

test.describe('cases from Bulk', () => {
  test.use({ allowExpectedBulkLookup400Noise: true });

  const bulkDomains = ['bad-domain-1.invalid', 'bad-domain-2.invalid'];

  test('a case opened from a Bulk row appears in Monitor and marks the row', async ({ page }) => {
    await page.route('**/api/lookup**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Rejected in test', errorCode: 'INVALID_QUERY' }),
      }),
    );

    await page.goto('/bulk');
    await runBulkScan(page, bulkDomains);

    const caseCell = page.locator('td[data-label="Case"]').first();
    await caseCell.getByRole('button', { name: /Create case/ }).click();
    await expect(caseCell.locator('select.case-disp')).toBeVisible();
    await expect(caseCell.getByRole('link', { name: 'Open' })).toBeVisible();

    await page.goto('/monitor');
    await page.getByRole('tab', { name: /Cases/ }).click();
    await expect(page.locator('.case-head', { hasText: 'bad-domain-1.invalid' })).toBeVisible();
    await expect(page.locator('.case-head', { hasText: 'bad-domain-1.invalid' }).locator('.badge').first()).toHaveText('New');
  });
});
