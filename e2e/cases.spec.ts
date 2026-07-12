import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, runBulkScan } from './helpers';

// Every domain here is a local/invalid value (RFC 2606 .invalid, or dotless
// bad-domain-* that classifyQuery rejects with a 400). Case features are
// entirely browser-local: creating and editing a case never reaches an
// upstream service, and the shared fixture's network guard enforces that.

// ---------------------------------------------------------------------------
// E2E fixture builders
// ---------------------------------------------------------------------------

interface SnapshotOverrides {
  id?: string;
  fingerprint?: string;
  firstCapturedAt?: string;
  capturedAt?: string;
  source?: string;
  scanDepth?: 'fast' | 'deep';
  availability?: string | null;
  riskScore?: number | null;
  registrar?: string | null;
  activityStatus?: string | null;
  hasMx?: boolean | null;
  faviconMatch?: boolean | null;
  nameservers?: string[];
  pageTitle?: string | null;
}

function snapshot(overrides: SnapshotOverrides = {}) {
  const id = overrides.id ?? 'ev-abc';
  return {
    id,
    fingerprint: overrides.fingerprint ?? id,
    firstCapturedAt: overrides.firstCapturedAt ?? '2026-06-01T00:00:00.000Z',
    capturedAt: overrides.capturedAt ?? '2026-06-01T00:00:00.000Z',
    source: overrides.source ?? 'lookup',
    scanDepth: overrides.scanDepth ?? 'deep',
    availability: overrides.availability ?? 'registered',
    confidence: null,
    riskScore: overrides.riskScore ?? 40,
    opportunityScore: null,
    riskFactors: [],
    opportunityFactors: [],
    registrar: overrides.registrar ?? 'Example Registrar',
    createdDate: null,
    expiryDate: null,
    nameservers: overrides.nameservers ?? [],
    hasMx: overrides.hasMx ?? null,
    hasSpf: null,
    hasDmarc: null,
    activityStatus: overrides.activityStatus ?? null,
    websiteProbeDetail: null,
    pageTitle: overrides.pageTitle ?? null,
    faviconMatch: overrides.faviconMatch ?? null,
    faviconNearMatch: null,
    reusesOfficialAssets: null,
    hasPasswordField: null,
    phishingLanguageMatch: null,
    mutationTypes: [],
  };
}

interface CaseOverrides {
  id?: string;
  domain?: string;
  status?: string;
  disposition?: string;
  source?: string;
  evidenceHistory?: ReturnType<typeof snapshot>[];
  createdAt?: string;
  updatedAt?: string;
  notes?: Array<{ createdAt: string; body: string }>;
}

function caseRecord(overrides: CaseOverrides = {}) {
  return {
    id: overrides.id ?? 'case-1',
    domain: overrides.domain ?? 'test.invalid',
    status: overrides.status ?? 'new',
    disposition: overrides.disposition ?? 'unreviewed',
    tags: [],
    notes: overrides.notes ?? [],
    source: overrides.source ?? 'lookup',
    evidenceHistory: overrides.evidenceHistory ?? [],
    createdAt: overrides.createdAt ?? '2026-06-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
  };
}

async function openSeededTimelineCase(
  page: import('@playwright/test').Page,
  domain: string,
  records: ReturnType<typeof caseRecord>[],
) {
  await page.goto('/monitor');
  await page.getByRole('tab', { name: /Cases/ }).click();
  // Seed localStorage on the app origin.
  await page.evaluate((cases) => {
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify({ version: 2, cases }));
  }, records);
  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await page.locator('.case-head', { hasText: domain }).click();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openCasesView(page: import('@playwright/test').Page) {
  await page.goto('/monitor');
  await page.getByRole('tab', { name: /Cases/ }).click();
}

async function createCase(page: import('@playwright/test').Page, domain: string) {
  await page.locator('#new-case').fill(domain);
  await page.getByRole('button', { name: 'Open case' }).click();
  await expect(page.locator('.case-head', { hasText: domain })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('a case created from Monitor persists across a reload', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'tracked.invalid');

  await expect(page.getByRole('status')).toHaveText(/Opened a new case for tracked\.invalid/);
  const head = page.locator('.case-head', { hasText: 'tracked.invalid' });
  await expect(head.locator('.badge').first()).toHaveText('New');
  await expect(head.locator('.badge').nth(1)).toHaveText('Unreviewed');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'tracked.invalid' })).toBeVisible();
});

test('status and disposition edits persist across a reload', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'triage.invalid');

  await page.locator('.case-body .field-grid select').first().selectOption('escalated');
  await page.locator('.case-body .field-grid select').nth(1).selectOption('confirmed_abuse');

  const head = page.locator('.case-head', { hasText: 'triage.invalid' });
  await expect(head.locator('.badge').first()).toHaveText('Escalated');
  await expect(head.locator('.badge').nth(1)).toHaveText('Confirmed abuse');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  const reloaded = page.locator('.case-head', { hasText: 'triage.invalid' });
  await expect(reloaded.locator('.badge').first()).toHaveText('Escalated');
  await expect(reloaded.locator('.badge').nth(1)).toHaveText('Confirmed abuse');
});

test('a note can be added and is shown in the record', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'noted.invalid');

  await page.locator('.case-body .note-edit textarea').fill('This domain looks suspicious.');
  await page.getByRole('button', { name: 'Add note' }).click();

  await expect(page.locator('.notes p').first()).toHaveText('This domain looks suspicious.');
  await expect(page.locator('.case-domain small')).toHaveText('1 note');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await page.locator('.case-head', { hasText: 'noted.invalid' }).click();
  await expect(page.locator('.notes p').first()).toHaveText('This domain looks suspicious.');
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
    version: 2,
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

  await expect(page.getByRole('status')).toHaveText(/Imported 1 new/);
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

test('the Cases view has no horizontal overflow on a short mobile viewport', async ({ page }) => {
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
    await caseCell.getByRole('button', { name: /Case/ }).click();
    await expect(caseCell.locator('select.case-disp')).toBeVisible();
    await expect(caseCell.getByRole('link', { name: 'Open' })).toBeVisible();

    await page.goto('/monitor');
    await page.getByRole('tab', { name: /Cases/ }).click();
    await expect(page.locator('.case-head', { hasText: 'bad-domain-1.invalid' })).toBeVisible();
    await expect(page.locator('.case-head', { hasText: 'bad-domain-1.invalid' }).locator('.badge').first()).toHaveText('New');
  });
});

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

    // Click "Changed only".
    await page.locator('.timeline-controls button', { hasText: 'Changed only' }).click();

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

    // Click "Changed only".
    await page.locator('.timeline-controls button', { hasText: 'Changed only' }).click();

    // Only baseline remains.
    await expect(page.locator('.timeline-entry')).toHaveCount(1);
    await expect(page.locator('.timeline-badge.timeline-baseline')).toBeVisible();

    // The depth-incomparable explanation is visible.
    await expect(page.locator('.timeline-filter-note')).toBeVisible();
    await expect(page.locator('.timeline-filter-note')).toContainText('No reliable comparable changes matched');
    await expect(page.locator('.timeline-filter-note')).toContainText('capture depths prevent field-level comparison');
  });

  test('timeline controls reset when a different case is opened', async ({ page }) => {
    await openSeededTimelineCase(page, 'first.invalid', [
      caseRecord({ id: 'first', domain: 'first.invalid', evidenceHistory: [snapshot({ id: 'ev-first' })] }),
      caseRecord({ id: 'second', domain: 'second.invalid', evidenceHistory: [snapshot({ id: 'ev-second' })] }),
    ]);

    await page.locator('.timeline-controls button', { hasText: 'Changed only' }).click();
    await page.locator('.timeline-controls button', { hasText: 'Collapse all' }).click();
    await expect(page.locator('.timeline-list')).toHaveCount(0);

    await page.locator('.case-head', { hasText: 'second.invalid' }).click();
    await expect(page.locator('.timeline-list')).toBeVisible();
    await expect(page.locator('.timeline-controls button', { hasText: 'Changed only' })).toHaveAttribute('aria-pressed', 'false');
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
    expect(parsed.schemaVersion).toBe(1);
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
    expect(parsed.version).toBe(2);
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

    await expect(page.locator('.export-controls')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
