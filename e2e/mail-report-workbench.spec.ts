import { expect, test } from './fixtures';
import { migrateLegacyBrowserData, openBrandWorkbench } from './helpers';

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
  await workbench.getByLabel('Choose reports').setInputFiles([
    { name: 'aggregate.xml', mimeType: 'application/xml', buffer: Buffer.from(DMARC_XML) },
    { name: 'tls.json', mimeType: 'application/json', buffer: Buffer.from(TLS_REPORT) },
  ]);

  await expect(workbench.getByRole('status')).toContainText('Loaded 2 reports locally');
  const summary = workbench.getByRole('group', { name: 'Imported mail report summary' });
  await expect(summary).toContainText('15');
  await expect(summary).toContainText('Messages observed');
  await expect(summary).toContainText('4');
  await expect(summary).toContainText('TLS failures');

  await workbench.getByText('DMARC', { exact: true }).click();
  await expect(workbench.getByText('192.0.2.10', { exact: true })).toBeVisible();
  await workbench.getByText('TLS-RPT', { exact: true }).click();
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
        Reflect.set(window, '__releaseMailReportRead', () => {
          void original.call(this).then(resolve, reject);
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
  await page.getByRole('radio', { name: 'Set Profile B active' }).check();
  workbench = page.getByRole('region', { name: 'DMARC and SMTP TLS reports' });
  await expect(workbench.getByText('Choose one or more aggregate report files to begin a transient review.')).toBeVisible();
  await page.evaluate(() => {
    const release = Reflect.get(window, '__releaseMailReportRead');
    if (typeof release !== 'function') throw new Error('The mail-report read gate was not installed.');
    release();
  });
  await expect(workbench.getByRole('group', { name: 'Imported mail report summary' })).toHaveCount(0);
  await expect(workbench.getByRole('status')).toHaveCount(0);
  await expect(workbench.getByRole('button', { name: 'Export review' })).toBeDisabled();
});
