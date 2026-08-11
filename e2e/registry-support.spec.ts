import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';
import { buildSourceReliabilityReport } from '../cli/source-reliability.mts';

const SOURCE_REPORT_TIME = '2026-08-05T10:00:00.000Z';

function sourceReportLookup(state: 'success' | 'error', durationMs: number) {
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt: SOURCE_REPORT_TIME, mode: 'deep',
    diagnostics: {
      rdap: { status: state },
      timing: { version: 1, sources: [{ source: 'rdap', durationMs }] },
    },
    availability: {
      version: 1, status: state, source: 'rdap', observedAt: SOURCE_REPORT_TIME,
      complete: state === 'success', truncated: false, limitations: [], durationMs,
    },
  };
}

test('the Dashboard and console navigation expose the registry-support reference', async ({ page }) => {
  await page.goto('/dashboard');

  const dashboardLink = page.getByRole('link', { name: /Check domain-ending support/ });
  await expect(dashboardLink).toHaveAttribute('href', '/registry-support');
  await expect(page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Registry support' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Reference' }).getByRole('link', { name: 'Registry support' })).toHaveAttribute('href', '/registry-support');

  await dashboardLink.click();
  await expect(page).toHaveURL('/registry-support');
  await expect(page.getByRole('heading', { name: 'Registry support', exact: true })).toBeVisible();
});

test('the registry-support catalogue filters locally and retains explicit interpretation limits', async ({ page }) => {
  const unexpectedApiRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(pathname)) {
      unexpectedApiRequests.push(pathname);
    }
  });

  await page.goto('/registry-support');

  await expect(page.getByText('Catalogue v29')).toBeVisible();
  await expect(page.locator('.summary-grid article').filter({ hasText: 'Explicit suffixes' }).locator('strong')).toHaveText('335');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(50);
  await expect(page.locator('.result-count')).toContainText('Showing 1–50 of 335 matching profiles (335 total)');
  await page.locator('#service-filter').selectOption('rdap_only');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(25);
  await expect(page.locator('.result-count')).toContainText('Showing 1–25 of 25 matching profiles (335 total)');
  await page.getByText('Review DEV profile').click();
  await expect(page.locator('.catalogue-section tbody tr').filter({ hasText: '.dev' }).locator('a[target="_blank"]')).toHaveCount(1);
  await page.locator('#service-filter').selectOption('all');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(50);
  const standards = page.getByRole('region', { name: 'Generic TLD RDAP snapshot' });
  await expect(standards).toContainText('1114 / 1114');
  await expect(standards).toContainText('12 / 14');
  await expect(standards).toContainText('.edu');
  await expect(standards).toContainText('.mil');
  await expect(standards).toContainText('.arpa');

  await page.locator('#registry-sort-direction').selectOption('desc');
  await expect(page.locator('.catalogue-section tbody tr').first().locator('td[data-label="Suffix"] > code')).toHaveText('.zw');
  await page.locator('#registry-sort-direction').selectOption('asc');

  const search = page.getByLabel('Suffix or capability');
  await search.fill('punktum domain');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(1);
  await expect(page.locator('.catalogue-section tbody tr')).toContainText('.dk');

  await search.fill('iana cc colon');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(43);
  await expect(page.locator('.catalogue-section tbody')).toContainText('.as');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.sr');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.to');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.zm');

  await search.fill('iana cc negative');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(31);
  await expect(page.locator('.catalogue-section tbody')).toContainText('.ag');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.vg');

  await search.fill('iana referral unverified');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(17);
  await expect(page.locator('.catalogue-section tbody')).toContainText('.bo');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.vi');

  await search.clear();
  await page.locator('#coverage-filter').selectOption('access_documented');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(50);
  await expect(page.locator('.result-count')).toContainText('Showing 1–50 of 118 matching profiles (335 total)');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.ao');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.ch');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.es');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.gr');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.arpa');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(50);
  await expect(page.locator('.result-count')).toContainText('Showing 51–100 of 118 matching profiles (335 total)');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.mil');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.vn');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(18);
  await expect(page.locator('.result-count')).toContainText('Showing 101–118 of 118 matching profiles (335 total)');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.zip');
  await expect(page.locator('.catalogue-section tbody')).toContainText('.zw');

  await search.fill('no matching capability');
  await expect(page.getByRole('heading', { name: 'No matching profiles' })).toBeVisible();
  await expect(page.getByText('2 refinements active')).toBeVisible();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('#coverage-filter')).toHaveValue('all');
  await expect(page.locator('#service-filter')).toHaveValue('all');
  await expect(page.locator('#registry-sort')).toHaveValue('suffix');
  await expect(page.locator('#registry-sort-direction')).toHaveValue('asc');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(50);
  await expect(page.getByText('Default view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Coverage is not live registry status.' })).toBeVisible();
  expect(unexpectedApiRequests).toEqual([]);
});

test('the source review keeps exact rates without a decorative rate strip', async ({ page }) => {
  const report = buildSourceReliabilityReport(JSON.stringify([
    sourceReportLookup('error', 900),
    sourceReportLookup('success', 200),
    sourceReportLookup('success', 220),
    sourceReportLookup('success', 240),
    sourceReportLookup('success', 260),
    sourceReportLookup('success', 280),
  ]), SOURCE_REPORT_TIME);
  await page.goto('/registry-support');
  const reportPicker = page.locator('.report-picker');
  const reportInput = reportPicker.locator('input[type="file"]');
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await reportInput.focus();
    await expect(reportInput).toBeFocused();
    await expect(reportPicker).toHaveCSS('outline-style', 'solid');
    await expect(reportPicker).toHaveCSS('outline-width', '2px');
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await reportInput.setInputFiles({
    name: 'source-report.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(report)),
  });

  const rdap = page.locator('.source-card').filter({ has: page.getByRole('heading', { name: 'Rdap' }) });
  await expect(rdap.locator('dl > div').filter({ hasText: 'Failure' })).toContainText('17%');
  await expect(rdap.locator('dl > div').filter({ hasText: 'p95 duration' })).toContainText('900 ms');
  await expect(page.locator('.rate-strip')).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 700 });
  await expect(rdap).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('profile details preserve provenance and safe external-link behavior', async ({ page }) => {
  await page.goto('/registry-support');
  await page.getByLabel('Suffix or capability').fill('uk');
  await page.getByText('Review UK profile').click();

  const row = page.locator('.catalogue-section tbody tr');
  await expect(row).toContainText('Profile ID');
  await expect(row).toContainText('fixture coverage does not prove current reachability');
  const links = row.locator('a[target="_blank"]');
  await expect(links).toHaveCount(4);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
    await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/);
  }
});

test('the local inspector explains explicit and generic suffix support without a request', async ({ page }) => {
  const unexpectedApiRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(pathname)) unexpectedApiRequests.push(pathname);
  });
  await page.goto('/registry-support');

  const input = page.getByRole('searchbox', { name: 'Domain or suffix', exact: true });
  const inspectButton = page.getByRole('button', { name: 'Inspect support' });
  await expect(inspectButton).toBeEnabled();
  await input.fill('.com');
  await inspectButton.click();
  const result = page.locator('.inspection-card');
  await expect(result).toContainText('Generic fallback');
  await expect(result).toContainText('.com');
  await expect(result).toContainText('Discovery only');
  await expect(result).toContainText('IANA bootstrap discovery');

  await input.fill('.mil');
  await inspectButton.click();
  await expect(result).toContainText('Explicit suffix profile');
  await expect(result).toContainText('Sponsored');
  await expect(result).toContainText('No service published by IANA');

  await input.fill('.gt');
  await inspectButton.click();
  const officialLookup = result.getByRole('link', { name: /Open official registry lookup/ });
  await expect(officialLookup).toHaveAttribute('href', 'https://www.gt/sitio/');
  await expect(officialLookup).toHaveAttribute('target', '_blank');
  await expect(officialLookup).toHaveAttribute('rel', /\bnoreferrer\b/);
  await expect(result).toContainText('The inspected domain is not appended to the link');

  await input.fill('portal.example.uk');
  await inspectButton.click();
  await expect(result).toContainText('Explicit suffix profile');
  await expect(result).toContainText('.uk');
  await page.getByRole('link', { name: 'Show in catalogue' }).click();
  await expect(page).toHaveURL(/#registry-catalogue$/u);
  await expect(page.getByLabel('Suffix or capability')).toHaveValue('uk');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(1);
  await expect(page.locator('.catalogue-section tbody tr')).toContainText('.uk');
  await expect(page.getByText('1 refinement active')).toBeVisible();

  await input.fill('https://example.invalid/path');
  await inspectButton.click();
  await expect(page.getByRole('heading', { name: 'Unsupported input format' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.inspection-output')).toHaveCount(0);
  await expect(input).toHaveValue('');
  expect(unexpectedApiRequests).toEqual([]);
});

test('the lookup matrix makes profile and target differences explicit without network work', async ({ page }) => {
  const unexpectedApiRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(pathname)) unexpectedApiRequests.push(pathname);
  });
  await page.goto('/registry-support');

  const matrix = page.getByRole('region', { name: 'Field-level collection matrix' });
  await expect(matrix.getByText('Matrix v1')).toBeVisible();
  await expect(matrix.locator('tbody tr')).toHaveCount(18);
  await expect(matrix.getByText('Page identity, forms and fingerprints')).toBeVisible();
  await expect(matrix.getByText('Static evidence only; referenced resources are not fetched and JavaScript is not executed.')).toBeVisible();

  await matrix.getByLabel('IP address').check();
  await expect(matrix.locator('tbody tr')).toHaveCount(2);
  await expect(matrix.getByText('IP network registration')).toBeVisible();
  await expect(matrix.getByText('Page identity, forms and fingerprints')).toHaveCount(0);

  await matrix.getByLabel('ASN').check();
  await expect(matrix.locator('tbody tr')).toHaveCount(1);
  await expect(matrix.getByText('ASN registration and lifecycle')).toBeVisible();
  expect(unexpectedApiRequests).toEqual([]);
});

test('the inspector resolves an explicit IDN suffix and remains mobile-safe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/registry-support');
  await page.getByRole('searchbox', { name: 'Domain or suffix', exact: true }).fill('example.சிங்கப்பூர்');
  await page.getByRole('button', { name: 'Inspect support' }).click();

  await expect(page.locator('.inspection-card')).toContainText('.xn--clchc0ea0b2g2a9gcd');
  await expect(page.locator('.inspection-card')).toContainText('Explicit suffix profile');
  await expectNoHorizontalOverflow(page);
});

test('the registry-support reference remains readable without horizontal overflow on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/registry-support');

  const consoleNavigation = page.locator('#console-navigation');
  const interpretation = page.locator('main .interpretation');
  await expect(consoleNavigation).toHaveCSS('position', 'fixed');
  await expect(interpretation).toHaveCSS('position', 'static');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'true');
  await expect(consoleNavigation).toHaveCSS('transform', 'none');
  await expect(page.getByRole('navigation', { name: 'Reference' }).getByRole('link', { name: 'Registry support' })).toBeVisible();
  await expect(interpretation).toHaveCSS('position', 'static');
  await expect(interpretation).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false');

  const sectionIntros = page.locator('.section-intro');
  await expect(sectionIntros.getByRole('heading')).toHaveText([
    'Generic TLD RDAP snapshot',
    'Field-level collection matrix',
    'Source reliability review',
    'Inspect a domain or suffix',
    'Implemented registry profiles',
  ]);
  await expect(sectionIntros.first()).toHaveCSS('display', 'block');
  for (const heading of await sectionIntros.getByRole('heading').all()) {
    const box = await heading.boundingBox();
    expect(box?.width).toBeGreaterThan(200);
  }

  await expect(page.getByLabel('Suffix or capability')).toBeVisible();
  await expect(page.locator('#coverage-filter')).toBeVisible();
  await expect(page.locator('#service-filter')).toBeVisible();
  await page.getByLabel('Suffix or capability').fill('vn');
  await expect(page.locator('.catalogue-section tbody tr')).toHaveCount(1);
  await expect(page.getByText('1 refinement active')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('registry reference tables reflow before laptop content columns need to scroll', async ({ page }) => {
  for (const width of [1024, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/registry-support');
    const tableFrames = page.locator('.capability-table-wrap, .catalogue-section .table-wrap');
    await expect(tableFrames).toHaveCount(2);
    expect(await tableFrames.evaluateAll((elements) => elements.every(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ))).toBe(true);
    await expectNoHorizontalOverflow(page);
  }
});
