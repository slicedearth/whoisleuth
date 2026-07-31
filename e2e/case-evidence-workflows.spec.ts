import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection, requiredValue, runBulkScan } from './helpers';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';

// Every domain here is a local/invalid value (RFC 2606 .invalid, or dotless
// bad-domain-* that classifyQuery rejects with a 400). Case features are
// entirely browser-local: creating and editing a case never reaches an
// upstream service, and the shared fixture's network guard enforces that.

import { caseRecord, openSeededTimelineCase, snapshot } from './case-test-fixtures';


test.describe('evidence timeline', () => {
  test('a case with no evidence shows the empty state', async ({ page }) => {
    await openSeededTimelineCase(page, 'no-evidence.invalid', [
      caseRecord({ id: 'empty-ev', domain: 'no-evidence.invalid', evidenceHistory: [] }),
    ]);

    await expect(page.locator('.timeline-empty')).toBeVisible();
    await expect(page.locator('.timeline-empty')).toHaveText(/No evidence captured yet/);
    await expect(page.locator('.timeline-list')).toHaveCount(0);
    await expect(page.locator('.timeline-controls button')).toHaveCount(0);
  });

  test('a single snapshot shows as a baseline with no changes', async ({ page }) => {
    await openSeededTimelineCase(page, 'baseline.invalid', [
      caseRecord({
        id: 'single-snap',
        domain: 'baseline.invalid',
        source: 'lookup',
        evidenceHistory: [
          snapshot({ id: 'ev-abc', fingerprint: 'abc', nameservers: ['ns1.example.com'], hasMx: true, activityStatus: 'active', pageTitle: 'Example Site' }),
        ],
      }),
    ]);

    await expect(page.locator('.timeline-header small')).toHaveText('1 snapshot');
    await expect(page.locator('.timeline-badge.timeline-baseline')).toBeVisible();
    await expect(page.locator('.timeline-badge.timeline-changed')).toHaveCount(0);
    await expect(page.locator('.timeline-changes')).toHaveCount(0);
  });

  test('multiple snapshots display newest-first with changes', async ({ page }) => {
    await openSeededTimelineCase(page, 'multi.invalid', [
      caseRecord({
        id: 'multi-snap',
        domain: 'multi.invalid',
        status: 'reviewing',
        disposition: 'suspicious',
        source: 'lookup',
        evidenceHistory: [
          snapshot({
            id: 'ev-older', fingerprint: 'older',
            firstCapturedAt: '2026-05-01T00:00:00.000Z', capturedAt: '2026-05-01T00:00:00.000Z',
            availability: 'available', riskScore: 20, registrar: 'Old Registrar', hasMx: false,
          }),
          snapshot({
            id: 'ev-newer', fingerprint: 'newer',
            firstCapturedAt: '2026-06-01T00:00:00.000Z', capturedAt: '2026-06-01T00:00:00.000Z',
            source: 'bulk', availability: 'registered', riskScore: 85, registrar: 'New Registrar',
            hasMx: true, activityStatus: 'active', pageTitle: 'New Site', nameservers: ['ns1.new.example'],
          }),
        ],
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    ]);

    await expect(page.locator('.timeline-header small')).toHaveText('2 snapshots');
    const entries = page.locator('.timeline-entry');
    await expect(entries).toHaveCount(2);

    const firstEntry = entries.first();
    await expect(firstEntry.locator('.timeline-index')).toHaveText('#1');
    await expect(firstEntry.locator('.timeline-badge.timeline-changed')).toBeVisible();
    const firstChanges = firstEntry.locator('.timeline-change');
    await expect(firstChanges.first()).toBeVisible();
    await expect(firstEntry.locator('.timeline-change strong').filter({ hasText: 'Risk score' })).toBeVisible();
  });

  test('compact HTTP evidence renders without retaining a URL path or header values', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSeededTimelineCase(page, 'http-summary.invalid', [
      caseRecord({
        id: 'http-summary', domain: 'http-summary.invalid',
        evidenceHistory: [snapshot({
          id: 'ev-http', fingerprint: 'http-summary',
          httpSummaryVersion: 1,
          httpEvidenceStatus: 'success',
          httpFinalOrigin: 'https://login.http-summary.invalid/private/path?token=secret',
          httpResponseStatus: 200,
          httpTransportSecurity: 'https',
          httpRedirectCount: 2,
          httpCrossOriginRedirect: true,
          httpHttpsDowngrade: false,
          httpContentType: 'text/html; charset=utf-8',
          httpSecurityHeaders: ['hsts', 'content-security-policy'],
        })],
      }),
    ]);

    await page.locator('.timeline-toggle').click();
    const group = page.locator('.timeline-group', { hasText: 'HTTP' });
    await expect(group).toContainText('https://login.http-summary.invalid');
    await expect(group).toContainText('Content Security Policy, HSTS');
    await expect(group).not.toContainText('/private/path');
    await expect(group).not.toContainText('token=secret');
    await expectNoHorizontalOverflow(page);
  });

  test('repeated identical evidence shows first/last observed', async ({ page }) => {
    await openSeededTimelineCase(page, 'repeat.invalid', [
      caseRecord({
        id: 'repeat-ev',
        domain: 'repeat.invalid',
        source: 'lookup',
        evidenceHistory: [
          snapshot({
            id: 'ev-same', fingerprint: 'same-material',
            firstCapturedAt: '2026-05-01T00:00:00.000Z', capturedAt: '2026-07-01T00:00:00.000Z',
            riskScore: 50, registrar: 'StableReg', hasMx: false,
          }),
        ],
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ]);

    await expect(page.locator('.timeline-header small')).toHaveText('1 snapshot');
    await expect(page.locator('.timeline-entry time').first()).toContainText('Last observed');
    await expect(page.locator('.timeline-badge.timeline-repeat')).toBeVisible();
    await expect(page.locator('.timeline-badge.timeline-repeat')).toContainText('First observed');
  });

  test('changed-only retains the baseline and reliable changes', async ({ page }) => {
    await openSeededTimelineCase(page, 'changed.invalid', [
      caseRecord({
        id: 'changed-only',
        domain: 'changed.invalid',
        source: 'lookup',
        evidenceHistory: [
          snapshot({
            id: 'ev-base', fingerprint: 'base',
            firstCapturedAt: '2026-05-01T00:00:00.000Z', capturedAt: '2026-05-01T00:00:00.000Z',
            riskScore: 40, registrar: 'StableReg',
          }),
          snapshot({
            id: 'ev-changed', fingerprint: 'changed',
            firstCapturedAt: '2026-07-01T00:00:00.000Z', capturedAt: '2026-07-01T00:00:00.000Z',
            riskScore: 90, registrar: 'StableReg',
          }),
        ],
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ]);

    // Both the baseline and the reliable material change are visible.
    await expect(page.locator('.timeline-entry')).toHaveCount(2);

    // Click "Material changes only".
    await page.locator('.timeline-controls button', { hasText: 'Material changes only' }).click();

    // Filtering retains both entries because one is the baseline and the other
    // has a reliable field-level change.
    await expect(page.locator('.timeline-entry')).toHaveCount(2);
    await expect(page.locator('.timeline-badge.timeline-baseline')).toBeVisible();
    await expect(page.locator('.timeline-badge.timeline-changed')).toBeVisible();
  });

  test('deep→fast incomparable shows depth warning and changed-only reduces to baseline', async ({ page }) => {
    // Baseline deep snapshot with deep-only evidence (faviconMatch, risk score, etc.).
    // Later fast snapshot differs only by scan depth / unevaluated deep fields.
    // No favicon removal or cross-depth risk change should appear.
    // Changed-only should reduce visible count to 1 (baseline only) with the
    // depth-incomparable explanation.
    await openSeededTimelineCase(page, 'deepfast.invalid', [
      caseRecord({
        id: 'deep-fast',
        domain: 'deepfast.invalid',
        source: 'lookup',
        evidenceHistory: [
          snapshot({
            id: 'ev-deep', fingerprint: 'deep-baseline',
            firstCapturedAt: '2026-05-01T00:00:00.000Z', capturedAt: '2026-05-01T00:00:00.000Z',
            scanDepth: 'deep', availability: 'registered', riskScore: 40,
            activityStatus: 'active', hasMx: true, faviconMatch: true,
          }),
          snapshot({
            id: 'ev-fast', fingerprint: 'fast-incomp',
            firstCapturedAt: '2026-06-01T00:00:00.000Z', capturedAt: '2026-06-01T00:00:00.000Z',
            scanDepth: 'fast', availability: 'registered', riskScore: 40,
            // deep-only fields are null in a fast capture (unevaluated).
            activityStatus: null, hasMx: null, faviconMatch: null,
          }),
        ],
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    ]);

    // Both entries visible before filtering.
    await expect(page.locator('.timeline-entry')).toHaveCount(2);

    // The later (fast) entry should show "Depth prevents comparison".
    const fastEntry = page.locator('.timeline-entry').first();
    await expect(fastEntry.locator('.timeline-badge.timeline-incomparable')).toBeVisible();
    await expect(fastEntry.locator('.timeline-incomparable-note')).toBeVisible();

    // No favicon removal change displayed.
    await expect(fastEntry.locator('.timeline-change strong').filter({ hasText: /favicon/i })).toHaveCount(0);
    // No risk change displayed.
    await expect(fastEntry.locator('.timeline-change strong').filter({ hasText: /Risk score/i })).toHaveCount(0);

    // Click "Material changes only".
    await page.locator('.timeline-controls button', { hasText: 'Material changes only' }).click();

    // Only baseline remains.
    await expect(page.locator('.timeline-entry')).toHaveCount(1);
    await expect(page.locator('.timeline-badge.timeline-baseline')).toBeVisible();

    // The depth-incomparable explanation is visible.
    await expect(page.locator('.timeline-filter-note')).toBeVisible();
    await expect(page.locator('.timeline-filter-note')).toContainText('No reliable comparable changes matched');
    await expect(page.locator('.timeline-filter-note')).toContainText('scan depth or risk model prevents field-level comparison');
  });

  test('risk model changes stay readable without creating a false score change', async ({ page }) => {
    await openSeededTimelineCase(page, 'model-version.invalid', [
      caseRecord({
        id: 'model-version', domain: 'model-version.invalid',
        evidenceHistory: [
          snapshot({
            id: 'legacy-risk', fingerprint: 'legacy-risk', capturedAt: '2026-05-01T00:00:00.000Z',
            riskModelVersion: null, riskScore: 95, registrar: 'Old Registrar',
          }),
          snapshot({
            id: 'current-risk', fingerprint: 'current-risk', capturedAt: '2026-06-01T00:00:00.000Z',
            riskModelVersion: 1, riskScore: 42, registrar: 'New Registrar',
          }),
        ],
      }),
    ]);

    const current = page.locator('.timeline-entry').first();
    await expect(current.locator('.timeline-badge.timeline-incomparable')).toContainText('Risk models differ');
    await expect(current.locator('.timeline-incomparable-note')).toContainText('numeric difference is not treated as a domain change');
    await expect(current.locator('.timeline-change strong').filter({ hasText: 'Risk score' })).toHaveCount(0);
    await expect(current.locator('.timeline-change strong').filter({ hasText: 'Registrar' })).toBeVisible();
  });

  test('timeline controls reset when a different case is opened', async ({ page }) => {
    await openSeededTimelineCase(page, 'first.invalid', [
      caseRecord({ id: 'first', domain: 'first.invalid', evidenceHistory: [snapshot({ id: 'ev-first' })] }),
      caseRecord({ id: 'second', domain: 'second.invalid', evidenceHistory: [snapshot({ id: 'ev-second' })] }),
    ]);

    await page.locator('.timeline-controls button', { hasText: 'Material changes only' }).click();
    await page.locator('.timeline-controls button', { hasText: 'Collapse all' }).click();
    await expect(page.locator('.timeline-list')).toHaveCount(0);

    await page.locator('.case-head', { hasText: 'second.invalid' }).click();
    await expect(page.locator('.timeline-list')).toBeVisible();
    await expect(page.locator('.timeline-controls button', { hasText: 'Material changes only' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.timeline-controls button', { hasText: 'Collapse all' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('keyboard-accessible disclosure controls work', async ({ page }) => {
    await openSeededTimelineCase(page, 'a11y.invalid', [
      caseRecord({
        id: 'a11y',
        domain: 'a11y.invalid',
        source: 'lookup',
        evidenceHistory: [
          snapshot({ id: 'ev-a', fingerprint: 'a', riskScore: 30 }),
          snapshot({ id: 'ev-b', fingerprint: 'b', firstCapturedAt: '2026-07-01T00:00:00.000Z', capturedAt: '2026-07-01T00:00:00.000Z', riskScore: 70 }),
        ],
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ]);

    // Expand/collapse toggle has accessible name via aria-expanded.
    const toggle = page.locator('.timeline-toggle').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Detail region is revealed.
    await expect(page.locator('.timeline-detail').first()).toBeVisible();

    // Collapse-all button works.
    await page.locator('.timeline-controls button', { hasText: 'Collapse all' }).click();
    await expect(page.locator('.timeline-list')).toHaveCount(0);
    // Expand-all restores.
    await page.locator('.timeline-controls button', { hasText: 'Expand all' }).click();
    await expect(page.locator('.timeline-list')).toBeVisible();
  });

  test('no horizontal overflow at 390px with long values', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await openSeededTimelineCase(page, 'overflow.invalid', [
      caseRecord({
        id: 'overflow',
        domain: 'overflow.invalid',
        source: 'lookup',
        evidenceHistory: [
          snapshot({
            id: 'ev-long', fingerprint: 'long',
            registrar: 'A Very Long Registrar Name That Should Not Cause Overflow Ltd.',
            nameservers: ['ns1.very-long-nameserver-name.example.com', 'ns2.another-long-nameserver.example.org'],
            pageTitle: 'This is an extremely long page title that should wrap gracefully without causing horizontal overflow in the timeline detail view',
          }),
        ],
      }),
    ]);

    // Expand the snapshot detail.
    await page.locator('.timeline-toggle').first().click();
    await expect(page.locator('.timeline-detail').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('cross-case comparison', () => {
  test('shows bounded relationships from latest stored evidence and opens a related case', async ({ page }) => {
    const http = {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://shared-landing.invalid',
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 1,
    } as const;
    await openSeededTimelineCase(page, 'primary.invalid', [
      caseRecord({
        id: 'primary', domain: 'primary.invalid',
        evidenceHistory: [snapshot({ id: 'primary-ev', nameservers: ['ns2.shared.invalid', 'ns1.shared.invalid'], ...http })],
      }),
      caseRecord({
        id: 'dns-related', domain: 'dns-related.invalid',
        evidenceHistory: [snapshot({ id: 'dns-ev', nameservers: ['NS1.SHARED.INVALID.', 'NS2.SHARED.INVALID.'] })],
      }),
      caseRecord({
        id: 'web-related', domain: 'web-related.invalid',
        evidenceHistory: [snapshot({ id: 'web-ev', nameservers: ['ns.other.invalid'], ...http })],
      }),
    ]);

    const region = page.getByRole('region', { name: 'Related cases for primary.invalid' });
    await expect(region).toContainText('2 observed relationships');
    await expect(region.getByText('Shared nameserver set', { exact: true })).toBeVisible();
    await expect(region.getByText('Shared final website origin', { exact: true })).toBeVisible();
    await expect(region).toContainText('not ownership or maliciousness conclusions');

    await region.getByRole('button', { name: 'Open dns-related.invalid' }).click();
    await expect(page.locator('.case-head', { hasText: 'dns-related.invalid' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('does not render a relationship section when no other case matches', async ({ page }) => {
    await openSeededTimelineCase(page, 'standalone.invalid', [
      caseRecord({
        id: 'standalone', domain: 'standalone.invalid',
        evidenceHistory: [snapshot({ id: 'standalone-ev', nameservers: ['ns.unique.invalid'] })],
      }),
    ]);
    await expect(page.getByRole('region', { name: 'Related cases for standalone.invalid' })).toHaveCount(0);
  });

  test('relationship cards remain usable without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    const records = ['mobile-a.invalid', 'mobile-b.invalid'].map((domain, index) => caseRecord({
      id: `mobile-${index}`,
      domain,
      evidenceHistory: [snapshot({
        id: `mobile-ev-${index}`,
        nameservers: ['an-extremely-long-but-valid-nameserver-label-for-overflow.invalid'],
      })],
    }));
    await openSeededTimelineCase(page, 'mobile-a.invalid', records);
    await expect(page.getByRole('region', { name: 'Related cases for mobile-a.invalid' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('case report export', () => {
  test('export JSON for a case with correct filename and content', async ({ page }) => {
    await openSeededTimelineCase(page, 'export-json.invalid', [
      caseRecord({
        id: 'export-json',
        domain: 'export-json.invalid',
        source: 'lookup',
        evidenceHistory: [
          snapshot({
            id: 'ev-1', fingerprint: 'fp1', capturedAt: '2026-06-01T00:00:00.000Z',
            riskScore: 20, availability: 'registered', registrar: 'TestReg',
          }),
          snapshot({
            id: 'ev-2', fingerprint: 'fp2', firstCapturedAt: '2026-07-01T00:00:00.000Z',
            capturedAt: '2026-07-01T00:00:00.000Z', riskScore: 85,
            availability: 'registered', registrar: 'TestReg',
          }),
        ],
      }),
    ]);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.export-controls').getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^whoisleuth-case-export-json\.invalid-.*\.json$/);
    expect(download.suggestedFilename()).not.toContain('/');

    const body = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(body).toString('utf-8');
    const parsed = JSON.parse(text);

    expect(parsed.schema).toBe('whoisleuth.case-report');
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.case.domain).toBe('export-json.invalid');
    expect(parsed.case.notesIncluded).toBe(false);
    expect(parsed.evidenceTimeline.length).toBe(2);
    expect(parsed.evidenceTimeline[1].changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'riskScore', before: 20, after: 85 })]),
    );
  });

  test('export Markdown for a case with correct filename and content', async ({ page }) => {
    await openSeededTimelineCase(page, 'export-md.invalid', [
      caseRecord({
        id: 'export-md',
        domain: 'export-md.invalid',
        source: 'lookup',
        evidenceHistory: [
          snapshot({ id: 'ev-1', fingerprint: 'fp1', riskScore: 40 }),
        ],
      }),
    ]);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Markdown' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^whoisleuth-case-export-md\.invalid-.*\.md$/);

    const body = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(body).toString('utf-8');

    expect(text).toContain('# Case Report: export-md.invalid');
    expect(text).toContain('## Evidence Timeline');
    expect(text).toContain('## Limitations & Provenance');
  });

  test('notes absent by default in export', async ({ page }) => {
    await openSeededTimelineCase(page, 'no-notes.invalid', [
      caseRecord({
        id: 'no-notes',
        domain: 'no-notes.invalid',
        notes: [{ createdAt: '2026-06-01T00:00:00.000Z', body: 'Secret note.' }],
        source: 'lookup',
        evidenceHistory: [snapshot({ id: 'ev-1', fingerprint: 'fp1' })],
      }),
    ]);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.export-controls').getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;

    const body = await (await download.createReadStream()).toArray();
    const parsed = JSON.parse(Buffer.concat(body).toString('utf-8'));

    expect(parsed.case.notesIncluded).toBe(false);
    expect('notes' in parsed.case).toBe(false);
  });

  test('notes included after explicit opt-in', async ({ page }) => {
    await openSeededTimelineCase(page, 'with-notes.invalid', [
      caseRecord({
        id: 'with-notes',
        domain: 'with-notes.invalid',
        notes: [{ createdAt: '2026-06-01T00:00:00.000Z', body: 'Investigation detail.' }],
        source: 'lookup',
        evidenceHistory: [snapshot({ id: 'ev-1', fingerprint: 'fp1' })],
      }),
    ]);

    // Check the "Include analyst notes" checkbox.
    await page.locator('.export-notes input[type="checkbox"]').check();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.export-controls').getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;

    const body = await (await download.createReadStream()).toArray();
    const parsed = JSON.parse(Buffer.concat(body).toString('utf-8'));

    expect(parsed.case.notesIncluded).toBe(true);
    expect(parsed.case.notes.length).toBe(1);
    expect(parsed.case.notes[0].body).toBe('Investigation detail.');
  });

  test('note opt-in resets when switching cases', async ({ page }) => {
    await openSeededTimelineCase(page, 'first-export.invalid', [
      caseRecord({ id: 'first-export', domain: 'first-export.invalid' }),
      caseRecord({ id: 'second-export', domain: 'second-export.invalid' }),
    ]);

    await page.locator('.export-notes input[type="checkbox"]').check();
    await page.locator('.case-head', { hasText: 'second-export.invalid' }).click();

    await expect(page.locator('.export-notes input[type="checkbox"]')).not.toBeChecked();
  });

  test('whole-store backup remains available and distinct', async ({ page }) => {
    await openSeededTimelineCase(page, 'backup-test.invalid', [
      caseRecord({
        id: 'backup-test',
        domain: 'backup-test.invalid',
        source: 'lookup',
        evidenceHistory: [snapshot({ id: 'ev-1', fingerprint: 'fp1' })],
      }),
    ]);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.case-toolbar .top-actions button', { hasText: 'Export JSON' }).click();
    const download = await downloadPromise;
    const body = await (await download.createReadStream()).toArray();
    const parsed = JSON.parse(Buffer.concat(body).toString('utf-8'));

    expect(download.suggestedFilename()).toMatch(/^whoisleuth-cases-.*\.json$/);
    expect(parsed.version).toBe(CASE_SCHEMA_VERSION);
    expect(parsed.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'backup-test.invalid' }),
    ]));
    expect(parsed.schema).toBeUndefined();
  });

  test('mobile controls remain usable without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await openSeededTimelineCase(page, 'mobile-export.invalid', [
      caseRecord({
        id: 'mobile-export',
        domain: 'mobile-export.invalid',
        source: 'lookup',
        evidenceHistory: [snapshot({ id: 'ev-1', fingerprint: 'fp1' })],
      }),
    ]);

    const controls = page.locator('.export-controls');
    const checkbox = controls.locator('input[type="checkbox"]');
    await expect(controls).toBeVisible();
    const checkboxBox = await boundingBox(checkbox);
    expect(checkboxBox.width).toBeLessThanOrEqual(20);
    expect(checkboxBox.height).toBeLessThanOrEqual(20);
    await expect(controls.getByText('Notes may contain sensitive information.')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
