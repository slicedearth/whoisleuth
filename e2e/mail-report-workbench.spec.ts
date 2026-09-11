import { expect, test } from './fixtures';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expectFocusedResultsVisible, expectNoHorizontalOverflow, failNextBrowserLocalCollectionReadAfterWrite, migrateLegacyBrowserData, openBrandProfileList, openBrandWorkbench, readBrowserLocalCollection, useTheme } from './helpers';
import { productionChunkPath } from './production-build';

const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
const ACTIVE_KEY = 'whois-rdap-active-brand-profile-v1';

const DMARC_XML = `<?xml version="1.0"?>
<feedback>
  <report_metadata><org_name>Example Reporter</org_name><report_id>report-1</report_id><date_range><begin>1785801600</begin><end>1785888000</end></date_range></report_metadata>
  <policy_published><domain>example.test</domain></policy_published>
  <record><row><source_ip>192.0.2.10</source_ip><count>12</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf></policy_evaluated></row><identifiers><header_from>example.test</header_from></identifiers></record>
  <record><row><source_ip>198.51.100.7</source_ip><count>3</count><policy_evaluated><disposition>reject</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row><identifiers><header_from>outside.example</header_from></identifiers></record>
</feedback>`;

const TLS_REPORT = JSON.stringify({
  'organization-name': 'Example Reporter',
  'report-id': 'tls-1',
  'date-range': {
    'start-datetime': '2026-08-03T00:00:00Z',
    'end-datetime': '2026-08-04T00:00:00Z',
  },
  policies: [{
    policy: {
      'policy-type': 'sts',
      'policy-domain': 'example.test',
      'mx-host': ['mx1.example.test'],
    },
    summary: {
      'total-successful-session-count': 20,
      'total-failure-session-count': 4,
    },
    'failure-details': [{ 'result-type': 'certificate-expired', 'failed-session-count': 4 }],
  }],
});

test('reviews aggregate mail reports locally, exports them deliberately, and clears them on reload', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, { [PROFILES_KEY]: null, [ACTIVE_KEY]: null });
  await page.getByRole('button', { name: 'New profile' }).click();
  await page.getByLabel('Brand name').fill('Example Brand');
  await page.getByLabel('Official domains').fill('example.test');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await openBrandWorkbench(page, 'mail');

  const workbench = page.getByRole('region', { name: 'DMARC and SMTP TLS reports' });
  await expect(workbench).toBeVisible();
  const compressed = gzipSync(Buffer.from(DMARC_XML));
  for (const offsets of [[8], [4], [8, 4]]) {
    const corrupt = Buffer.from(compressed);
    for (const offset of offsets) corrupt[corrupt.length - offset]! ^= 1;
    await workbench.getByLabel('Choose reports').setInputFiles({
      name: 'corrupt.xml.gz', mimeType: 'application/gzip', buffer: corrupt,
    });
    await expect(workbench.getByRole('status')).toHaveText('The gzip mail report could not be safely decompressed.');
    await expect(workbench.getByRole('button', { name: 'Export review' })).toBeDisabled();
    await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toHaveCount(0);
  }
  await workbench.getByLabel('Choose reports').setInputFiles([
    { name: 'aggregate.xml.gz', mimeType: 'application/gzip', buffer: compressed },
    { name: 'tls.json', mimeType: 'application/json', buffer: Buffer.from(TLS_REPORT) },
  ]);

  await expect(workbench.getByRole('status')).toContainText('Loaded 2 reports locally');
  const summary = workbench.getByRole('group', { name: 'Imported mail report summary' });
  await expect(summary).toContainText('15');
  await expect(summary).toContainText('Messages in retained rows');
  await expect(summary).toContainText('4');
  await expect(summary).toContainText('TLS failures');

  await workbench.getByText('DMARC', { exact: true }).click();
  await expect(workbench.getByText('192.0.2.10', { exact: true })).toBeVisible();
  await workbench.getByText('TLS-RPT', { exact: true }).click();
  await workbench.getByText('1 failure type from 1 inspected detail', { exact: true }).click();
  await expect(workbench.getByText(/Failures: certificate-expired \(4\)/u)).toBeVisible();

  const download = page.waitForEvent('download');
  await workbench.getByRole('button', { name: 'Export review' }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toBe('example-brand-mail-report-review.json');

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.reload();
  await openBrandWorkbench(page, 'mail');
  await expect(page.getByRole('region', { name: 'DMARC and SMTP TLS reports' }).getByText('Choose one or more aggregate report files to begin a transient review.')).toBeVisible();
});

test('does not publish an in-flight mail review under a different active profile', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, { [PROFILES_KEY]: null, [ACTIVE_KEY]: null });
  for (const [name, domain] of [['Profile A', 'a.example'], ['Profile B', 'b.example']] as const) {
    await page.getByRole('button', { name: 'New profile' }).click();
    await page.getByLabel('Brand name').fill(name);
    await page.getByLabel('Official domains').fill(domain);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText(`Saved "${name}"`);
  }
  await page.getByRole('radio', { name: 'Set Profile A active' }).check();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Set "Profile A" active.');
  await expect(page.getByRole('radio', { name: 'Set Profile A active' })).toBeChecked();
  await openBrandWorkbench(page, 'mail');

  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let hold = true;
    File.prototype.arrayBuffer = function arrayBuffer() {
      if (!hold) return original.call(this);
      hold = false;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        Reflect.set(window, '__releaseMailReportRead', async () => {
          await original.call(this).then(resolve, reject);
        });
      });
    };
  });
  let workbench = page.getByRole('region', { name: 'DMARC and SMTP TLS reports' });
  await workbench.getByLabel('Choose reports').setInputFiles({
    name: 'profile-a.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(DMARC_XML),
  });
  await expect(workbench.getByText('Reading…', { exact: true })).toBeVisible();
  await openBrandProfileList(page);
  await page.getByRole('radio', { name: 'Set Profile B active' }).check();
  workbench = page.getByRole('region', { name: 'DMARC and SMTP TLS reports' });
  await expect(workbench.getByText('Choose one or more aggregate report files to begin a transient review.')).toBeVisible();
  await expect(workbench).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(async () => {
    const release = Reflect.get(window, '__releaseMailReportRead');
    if (typeof release !== 'function') throw new Error('The mail-report read gate was not installed.');
    await release();
  });
  await expect(workbench).toHaveAttribute('aria-busy', 'false');
  await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toHaveCount(0);
  await expect(workbench.getByRole('status')).toHaveCount(0);
  await expect(workbench.getByRole('button', { name: 'Export review' })).toBeDisabled();
});

async function emptyMailWorkbench(page: Page) {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, { [PROFILES_KEY]: null, [ACTIVE_KEY]: null });
  await page.getByRole('button', { name: 'New profile' }).click();
  await page.getByLabel('Brand name').fill('Example Brand');
  await page.getByLabel('Official domains').fill('example.test');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await openBrandWorkbench(page, 'mail');
  return page.getByRole('region', { name: 'DMARC and SMTP TLS reports' });
}

function dmarcRows(count: number): Buffer {
  return gzipSync(Buffer.from('<feedback><report_metadata><org_name>Example Reporter</org_name><report_id>many-rows</report_id></report_metadata><policy_published><domain>example.test</domain></policy_published>'
    + Array.from({ length: count }, (_, i) => `<record><row><source_ip>192.0.2.${i % 254 + 1}</source_ip><count>1</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf></policy_evaluated></row><identifiers><header_from>sender-${i}.example</header_from></identifiers></record>`).join('') + '</feedback>'));
}

function tlsPolicies(count: number): Buffer {
  const source = JSON.parse(TLS_REPORT);
  return Buffer.from(JSON.stringify({ ...source, 'report-id': 'many-policies', policies: Array.from({ length: count }, (_, i) => ({
    ...source.policies[0], policy: { ...source.policies[0].policy, 'policy-domain': `policy-${i}.example` },
  })) }));
}

test('mail review retains fifty thousand rows, reaches the last row and exports every admitted record', async ({ page }) => {
  const workbench = await emptyMailWorkbench(page);
  const input = workbench.getByLabel('Choose reports');
  const probe = await input.evaluateHandle((element) => {
    const marks = { startedAt: 0, readyAt: 0 };
    const tasks: { start: number; duration: number }[] = [];
    let overflow = false;
    const collect = (entries: readonly PerformanceEntry[]) => { for (const entry of entries) {
      if (tasks.length === 1000) overflow = true; else tasks.push({ start: entry.startTime, duration: entry.duration });
    } };
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supported ? new PerformanceObserver((list) => collect(list.getEntries())) : null;
    observer?.observe({ type: 'longtask' });
    const start = () => { marks.startedAt = performance.now(); };
    element.addEventListener('change', start);
    const ready = new MutationObserver(() => {
      const workbench = document.querySelector('.mail-workbench');
      if (marks.startedAt && workbench?.getAttribute('aria-busy') === 'false' && workbench.querySelector('[aria-label="Imported mail report summary"]')) {
        marks.readyAt = performance.now(); ready.disconnect();
      }
    });
    ready.observe(document.body, { attributes: true, childList: true, subtree: true });
    return { finish() {
      collect(observer?.takeRecords() ?? []); observer?.disconnect(); ready.disconnect(); element.removeEventListener('change', start);
      return { ...marks, longTasks: supported ? tasks.filter(task => task.start < marks.readyAt && task.start + task.duration > marks.startedAt) : null, overflow };
    } };
  });
  try {
    await input.setInputFiles({ name: 'many.xml.gz', mimeType: 'application/gzip', buffer: dmarcRows(50_000) });
    await expect(workbench).toHaveAttribute('aria-busy', 'false');
    await expect(workbench.getByRole('status').first()).toContainText('Loaded 1 report locally');
    const measurement = await probe.evaluate(value => value.finish());
    expect(measurement.startedAt).toBeGreaterThan(0); expect(measurement.readyAt).toBeGreaterThan(measurement.startedAt); expect(measurement.overflow).toBe(false);
    await test.info().attach('mail-capacity', { body: JSON.stringify({ ...measurement, rows: 50_000, scope: 'file selection through worker parsing and usable review summary', timingAcceptance: 'informational', peakMemoryAvailable: false }), contentType: 'application/json' });
    await workbench.getByText('DMARC', { exact: true }).click();
    const pages = workbench.getByRole('navigation', { name: 'DMARC report 1 pages' });
    const results = workbench.getByRole('group', { name: 'DMARC report 1 results' });
    await expect(results.locator('tbody tr')).toHaveCount(50);
    await pages.getByRole('spinbutton', { name: 'DMARC report 1 page' }).fill('1000');
    await pages.getByRole('spinbutton', { name: 'DMARC report 1 page' }).press('Enter');
    await expect(pages.getByRole('status')).toHaveText('Page 1000 of 1000');
    await expect(results.getByText('sender-49999.example', { exact: true })).toBeVisible();
    await expectFocusedResultsVisible(page, results, results.locator('tbody tr').first());
    await workbench.getByRole('searchbox', { name: 'Search DMARC report 1' }).fill('sender-49999.example');
    await expect(results.locator('tbody tr')).toHaveCount(1);
    await expect(pages).toHaveCount(0);
    const pending = page.waitForEvent('download');
    await workbench.getByRole('button', { name: 'Export review' }).click();
    const path = await (await pending).path();
    expect(path).not.toBeNull();
    const exported = JSON.parse(readFileSync(path!, 'utf8'));
    expect(exported.version).toBe(2);
    expect(exported.reports[0].records).toHaveLength(50_000);
    expect(exported.reports[0].recordCoverage).toEqual({ supplied: 50_000, inspected: 50_000, retained: 50_000, rejected: 0 });
    expect(exported.reports[0].records[49_999].headerFrom).toBe('sender-49999.example');
    await workbench.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toHaveCount(0);
  } finally { await probe.evaluate(value => value.finish()).catch(() => undefined); await probe.dispose(); }
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`mail report pages remain usable at ${viewport.width} in ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport); await useTheme(page, theme);
      const workbench = await emptyMailWorkbench(page);
      await workbench.getByLabel('Choose reports').setInputFiles([
        { name: 'rows.xml.gz', mimeType: 'application/gzip', buffer: dmarcRows(61) },
        { name: 'policies.json', mimeType: 'application/json', buffer: tlsPolicies(61) },
      ]);
      await expect(workbench.getByRole('status').first()).toContainText('Loaded 2 reports locally');
      for (const [kind, id] of [['DMARC', 'report 1'], ['TLS-RPT', 'report 2']] as const) {
        const disclosure = workbench.locator('details').filter({ has: page.getByText(kind, { exact: true }) }).first();
        await disclosure.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
        const pages = disclosure.getByRole('navigation', { name: `${kind} ${id} pages` });
        const results = disclosure.getByRole('group', { name: `${kind} ${id} results` });
        await pages.getByRole('button', { name: 'Next', exact: true }).focus(); await page.keyboard.press('Enter');
        await expect(pages.getByRole('status')).toHaveText('Page 2 of 2');
        await expect(results.locator(kind === 'DMARC' ? 'tbody tr' : '.policy-grid > article')).toHaveCount(11);
        await expectFocusedResultsVisible(page, results, results.locator(kind === 'DMARC' ? 'tbody tr' : '.policy-grid > article').first()); await expectNoHorizontalOverflow(page);
        await test.info().attach(`mail-${kind.toLowerCase()}-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
        await pages.scrollIntoViewIfNeeded();
        await test.info().attach(`mail-pages-${kind.toLowerCase()}-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
        await disclosure.locator(':scope > summary').click();
      }
    });
  }
}

test('mail worker failure preserves the existing review and permits a deliberate retry', async ({ page }) => {
  const workbench = await emptyMailWorkbench(page);
  const file = { name: 'one.xml', mimeType: 'application/xml', buffer: Buffer.from(DMARC_XML) };
  await workbench.getByLabel('Choose reports').setInputFiles(file);
  await expect(workbench.getByRole('status').first()).toContainText('Loaded 1 report locally');
  const route = `**${productionChunkPath('src/lib/workers/mail-report.worker.ts')}`;
  await page.route(route, value => value.abort('failed'));
  await workbench.getByLabel('Choose reports').setInputFiles(file);
  await expect(workbench.getByRole('status').first()).toContainText('worker is unavailable');
  await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export review' })).toBeEnabled();
  await page.unroute(route);
  await workbench.getByLabel('Choose reports').setInputFiles(file);
  await expect(workbench.getByRole('status').first()).toContainText('Ignored 1 duplicate source');
});

test('changed profile scope withholds the old mail export until worker reconciliation completes', async ({ page }) => {
  const workbench = await emptyMailWorkbench(page);
  await workbench.getByLabel('Choose reports').setInputFiles({ name: 'one.xml', mimeType: 'application/xml', buffer: Buffer.from(DMARC_XML) });
  await expect(workbench.getByRole('status').first()).toContainText('Loaded 1 report locally');
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  let held = 0;
  const workerPath = productionChunkPath('src/lib/workers/mail-report.worker.ts');
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).pathname === workerPath) { held += 1; await released; }
    await route.fallback();
  });
  try {
    await openBrandProfileList(page);
    await page.getByRole('button', { name: /^Edit/u }).click();
    await page.getByLabel('Official domains').fill('other.example');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect.poll(() => held).toBe(1);
    await expect(workbench.getByRole('status').first()).toContainText('Reconciling the retained reports');
    await expect(workbench.getByRole('button', { name: 'Export review' })).toBeDisabled();
    await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toHaveCount(0);
    release();
    await expect(workbench.getByRole('status').first()).toContainText('Reconciled the retained reports');
    await expect(workbench.getByRole('button', { name: 'Export review' })).toBeEnabled();
    await expect(workbench.locator('.scope-warning')).toHaveText('Outside active profile: example.test');
  } finally { release(); }
});

test('mail reports survive tool navigation and failed profile refresh without repeating the committed write', async ({ page }) => {
  const workbench = await emptyMailWorkbench(page);
  await workbench.getByLabel('Choose reports').setInputFiles({ name: 'one.xml', mimeType: 'application/xml', buffer: Buffer.from(DMARC_XML) });
  await expect(workbench.getByRole('status').first()).toContainText('Loaded 1 report locally');
  await openBrandWorkbench(page, 'attestations');
  const retainedWorkbench = page.getByRole('region', { name: 'DMARC and SMTP TLS reports', includeHidden: true });
  await expect(retainedWorkbench).toHaveCount(1);
  await expect(retainedWorkbench).toBeHidden();
  await openBrandWorkbench(page, 'mail');
  await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toContainText('15');
  await openBrandProfileList(page);
  await page.getByRole('button', { name: /^Edit/u }).click();
  await page.getByLabel('Official domains').fill('other.example');
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'brand_profiles');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('was committed, but Brand Profiles could not be reread');
  await expect(workbench.getByRole('button', { name: 'Export review' })).toBeDisabled();
  await expect(workbench.getByLabel('Choose reports')).toBeDisabled();
  await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toHaveCount(0);
  await expect(workbench.getByRole('status').first()).toContainText('Review paused');
  const committed = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  await page.getByRole('button', { name: 'Refresh saved profiles', exact: true }).click();
  await expect(workbench.getByRole('status').first()).toContainText('Reconciled the retained reports');
  await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toContainText('15');
  await expect(workbench.locator('.scope-warning')).toHaveText('Outside active profile: example.test');
  await expect(workbench.getByRole('button', { name: 'Export review' })).toBeEnabled();
  const refreshed = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(refreshed.manifest.revision).toBe(committed.manifest.revision);
  expect(refreshed.records).toEqual(committed.records);
});
