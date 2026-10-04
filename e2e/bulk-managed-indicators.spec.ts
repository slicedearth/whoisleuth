import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { expectNoHorizontalOverflow, openBulkWorkspaceTools, readBrowserLocalCollection, useTheme } from './helpers';
import { captureDownloads } from './bulk-analysis-fixtures';
import { buildManagedIndicatorRevision, parseManagedIndicatorJson, readManagedIndicatorSet, serializeManagedIndicatorSet } from '../packages/interchange/managed-indicator-set.mts';
import { MAX_MANAGED_INDICATOR_SET_BYTES } from '../packages/contracts/analyst-interchange.mts';

test('near-limit indicator files survive browser renewal, download and reimport unchanged', async ({ page }) => {
  const now = '2026-10-04T00:00:00.000Z';
  const rows = Array.from({ length: 1_000 }, (_, index) => ({ domain: `entry-${index}.example.test`, availability: 'registered', risk: 85,
    analystDisposition: 'suspicious', profileContext: { sourceState: 'ready' } }));
  const baseline = (await buildManagedIndicatorRevision({ name: 'Large retained set', basis: 'é'.repeat(930),
    expiresAt: '2026-11-04T00:00:00.000Z', rows, selectedDomains: rows.map(row => row.domain) }, now)).manifest;
  expect(Buffer.byteLength(JSON.stringify(baseline, null, 2))).toBeGreaterThan(MAX_MANAGED_INDICATOR_SET_BYTES);
  await page.clock.setFixedTime(new Date('2026-10-05T00:00:00.000Z'));
  await page.goto('/bulk');
  await openBulkWorkspaceTools(page, 'indicators');
  const section = page.getByRole('region', { name: 'Indicator revisions', exact: true });
  await section.getByLabel('Preview a retained revision').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(serializeManagedIndicatorSet(baseline)) });
  await expect(section.getByLabel('Imported indicator revision preview')).toContainText('Retained identities: 1000');
  await section.getByRole('button', { name: 'Use this revision as baseline' }).click();
  const form = section.getByRole('form', { name: 'Prepare indicator revision' });
  await form.getByLabel(`Renew ${baseline.entries[0]!.domain}`, { exact: true }).check();
  await form.getByLabel(`Withdraw ${baseline.entries[1]!.domain}`, { exact: true }).check();
  await form.getByLabel('Review basis', { exact: true }).fill('Reviewed "quoted" evidence \\ again');
  await form.getByLabel('Expiry for additions and renewals (UTC)', { exact: true }).fill('2026-12-04T00:00:00.000Z');
  await form.getByRole('button', { name: 'Prepare revision preview' }).click();
  const preview = section.getByRole('region', { name: 'Prepared indicator revision' });
  const [download] = await captureDownloads(page, () => preview.getByRole('button', { name: 'Download revision manifest', exact: true }).click(), 1);
  const bytes = await readFile((await download!.path())!);
  expect(bytes.byteLength).toBeLessThanOrEqual(MAX_MANAGED_INDICATOR_SET_BYTES);
  const reopened = await readManagedIndicatorSet(parseManagedIndicatorJson(bytes.toString('utf8')));
  expect(reopened.entries.map(entry => entry.id)).toEqual(baseline.entries.map(entry => entry.id));
  expect(reopened.entries[0]!.expiresAt).toBe('2026-12-04T00:00:00.000Z');
  expect(reopened.entries[1]!.withdrawal?.reason).toBe('Reviewed "quoted" evidence \\ again');
  expect(reopened.entries.slice(2)).toEqual(baseline.entries.slice(2));
  await section.getByLabel('Preview a retained revision').setInputFiles({ name: 'downloaded.json', mimeType: 'application/json', buffer: bytes });
  await expect(section.getByLabel('Imported indicator revision preview')).toContainText('Large retained set · revision 2');
  await expect(section.getByLabel('Imported indicator revision preview')).toContainText('Retained identities: 1000');
});

async function openRetainedIndicators(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(new Date('2026-11-01T01:00:00.000Z'));
  await page.goto('/bulk');
  await openBulkWorkspaceTools(page, 'indicators');
  const section = page.getByRole('region', { name: 'Indicator revisions', exact: true });
  await expect(section).toBeVisible();
  await section.getByLabel('Preview a retained revision').setInputFiles('test/fixtures/extracted-domain-lifecycle/managed-indicator-set-v1.json');
  await expect(section.getByLabel('Imported indicator revision preview')).toContainText('expired');
  await expect(section).not.toContainText('Baseline revision 1');
  await section.getByRole('button', { name: 'Use this revision as baseline' }).click();
  await expect(section).toContainText('Baseline revision 1');
  return section;
}

test('retained indicators require an explicit reviewed withdrawal and preserve native identities without storage or collection', async ({ page }, info) => {
  const section = await openRetainedIndicators(page);
  const before = await readBrowserLocalCollection(page, 'cases');
  const form = section.getByRole('form', { name: 'Prepare indicator revision' });
  await form.getByLabel('Withdraw candidate.example.test', { exact: true }).check();
  await form.getByLabel('Review basis', { exact: true }).fill('The reviewed attribution was corrected.');
  const prepare = form.getByRole('button', { name: 'Prepare revision preview' });
  await prepare.click();
  const preview = section.getByRole('region', { name: 'Prepared indicator revision' });
  await expect(preview).toContainText('candidate.example.test · withdrawn');
  await expect(prepare).toBeFocused();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440], [3840, 2160]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('.managed-indicators').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .options({ rules: { 'target-size': { enabled: true } } }).analyze()).violations).toEqual([]);
      if (captureVisualEvidenceEnabled()) { await section.screenshot({ path: info.outputPath(`indicators-${theme}-${width}.png`) }); }
      if ((theme === 'light' && width === 1280) || (theme === 'dark' && width === 390)) {
        await section.getByRole('heading', { name: 'Indicator revisions', exact: true }).scrollIntoViewIfNeeded();
        if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: info.outputPath(`indicator-viewport-${theme}-${width}.png`) }); }
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const documents: Record<string, any> = {};
  for (const [format, name] of [['manifest', 'Download revision manifest'], ['stix', 'Download STIX'], ['misp', 'Download MISP JSON']] as const) {
    const [download] = await captureDownloads(page, () => preview.getByRole('button', { name, exact: true }).click(), 1);
    documents[format!] = JSON.parse(await readFile((await download!.path())!, 'utf8'));
  }
  const manifest = documents.manifest;
  expect(manifest).toMatchObject({ revision: 2, previous: { revisionId: '00000000-0000-4000-8000-000000000003' } });
  expect(manifest.entries[0]).toMatchObject({ domain: 'candidate.example.test', observation: { observedAt: null }, withdrawal: { reason: 'The reviewed attribution was corrected.' } });
  expect(documents.stix.objects.find((item: { type: string }) => item.type === 'indicator')).toMatchObject({ id: `indicator--${manifest.entries[0].id}`, revoked: true });
  expect(documents.misp.Event.Attribute[0]).toMatchObject({ uuid: manifest.entries[0].id, deleted: true, to_ids: false });
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(before.records);
  await section.getByLabel('Preview a retained revision').setInputFiles({ name: 'changed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...manifest, version: 999 })) });
  await expect(section.getByRole('status')).toContainText('Unsupported managed indicator');
  await expect(section).toContainText('Baseline revision 1');
  await expect(form.getByLabel('Review basis', { exact: true })).toHaveValue('The reviewed attribution was corrected.');
});

test('editing during indicator preparation cannot reinstate a stale downloadable revision', async ({ page }) => {
  const section = await openRetainedIndicators(page);
  const form = section.getByRole('form', { name: 'Prepare indicator revision' });
  await form.getByLabel('Withdraw candidate.example.test', { exact: true }).check();
  await form.getByLabel('Review basis', { exact: true }).fill('Initial basis');
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    (window as unknown as { releaseIndicatorDigest: () => void }).releaseIndicatorDigest = () => { crypto.subtle.digest = digest; release(); };
    crypto.subtle.digest = async (algorithm, data) => { await gate; return digest(algorithm, data); };
  });
  await form.getByRole('button', { name: 'Prepare revision preview' }).click();
  await expect(form.getByRole('button', { name: 'Prepare revision preview' })).toBeDisabled();
  await form.getByLabel('Review basis', { exact: true }).fill('Revised basis');
  await page.evaluate(() => (window as unknown as { releaseIndicatorDigest: () => void }).releaseIndicatorDigest());
  await expect(section.getByRole('status')).toContainText('Inputs changed while preparing');
  await expect(section.getByRole('region', { name: 'Prepared indicator revision' })).toHaveCount(0);
  await form.getByRole('button', { name: 'Prepare revision preview' }).click();
  await expect(section.getByRole('region', { name: 'Prepared indicator revision' })).toContainText('withdrawn');
});
