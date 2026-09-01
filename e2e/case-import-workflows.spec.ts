import { createHash } from 'node:crypto';
import { gzipSync, zipSync } from 'fflate';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, runBulkScan } from './helpers';
import { createCase, openCaseResponseWorkspace, openCasesView } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import { EXTERNAL_FINDINGS_VERSION } from '../packages/interchange/external-findings-import.mts';
import { caseWorkspaceActionStatus } from './case-response-fixtures';

// Bounded external evidence imports, Case management and Bulk handoff coverage.

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
  const block = Buffer.from([
    'HTTP/1.1 200 OK',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<!doctype html><html><head><title>Reviewed archive page</title></head><body>private body</body></html>',
  ].join('\r\n'));
  const digest = createHash('sha256').update(block).digest('hex');
  const headers = Buffer.from([
    'WARC/1.1',
    'WARC-Type: response',
    'WARC-Date: 2026-07-28T01:00:00.000Z',
    'WARC-Record-ID: <urn:uuid:e2e-response>',
    'WARC-Target-URI: https://archive-review.invalid/private?token=secret',
    `WARC-Block-Digest: sha256:${digest}`,
    'Content-Type: application/http; msgtype=response',
    `Content-Length: ${block.byteLength}`,
    '',
    '',
  ].join('\r\n'));
  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'reviewed-evidence.warc',
    mimeType: 'application/warc',
    buffer: Buffer.concat([headers, block, Buffer.from('\r\n\r\n')]),
  });
  await expect(externalImport.getByRole('heading', { name: 'Portable WARC evidence' })).toBeVisible();
  await expect(externalImport).toContainText('Reviewed archive page');
  await expect(externalImport).not.toContainText('private body');
  await expect(externalImport).not.toContainText('token=secret');
  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'Imported 1 finding into 1 new and 0 existing case.' })).toBeVisible();
  await expect(page.locator('#monitor-view-panel')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.locator('.case-head', { hasText: 'archive-review.invalid' })).toBeVisible();
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
  const manifest = Buffer.from(JSON.stringify({
    profile: 'data-package',
    wacz_version: '1.1.1',
    resources: [{
      name: 'capture.warc.gz',
      path: 'archive/capture.warc.gz',
      hash: `sha256:${createHash('sha256').update(compressedWarc).digest('hex')}`,
      bytes: compressedWarc.byteLength,
    }],
  }));
  const wacz = zipSync({
    'archive/capture.warc.gz': [compressedWarc, { level: 0 }],
    'datapackage.json': manifest,
    'datapackage-digest.json': Buffer.from(JSON.stringify({
      path: 'datapackage.json',
      hash: `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
    })),
  });
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
