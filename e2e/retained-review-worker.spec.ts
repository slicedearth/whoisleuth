import { openCaseSection, openConsoleView } from './console-navigation';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, failBrowserLocalCollectionReads, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { productionChunkPath } from './production-build';
import { createCase, serializeCaseStore } from '../packages/cases/case-model.mts';
import { createRelationshipObservation } from '../packages/workspace/relationship-observation-model.mts';
import { normalizeBulkSessionStore, serializeBulkSessionStore } from '../packages/workspace/bulk-session-model.mts';
import { richBulkSessionStore } from '../test/bulk-session-fixture.mts';
import { buildAnalystReviewInbox } from '../frontend/src/lib/analysis/analyst-review-inbox.ts';
import { emptyAnalystReviewStateStore, setAnalystReviewDecision } from '../packages/monitoring/analyst-review-state.mts';

const NOW = '2026-09-10T00:00:00.000Z';
function caseStore(count = 2, pins = 1) {
  return JSON.parse(serializeCaseStore(Array.from({ length: count }, (_, index) => {
    const record = createCase({ domain: `retained-${String(index).padStart(2, '0')}.example`, evidencePin: {
      label: 'Undated source fact', value: 'Retained value', source: 'whois',
      observedAt: null, sourceState: 'partial', completeness: 'partial',
    } }, NOW);
    record.evidencePins = Array.from({ length: pins }, (_, pin) => ({ ...record.evidencePins[0]!, id: `pin-${index}-${pin}` }));
    return record;
  })));
}

async function seed(page: Page, entries = {}, fixedClock = true) {
  if (fixedClock) await page.clock.setFixedTime(NOW);
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': caseStore(), ...entries,
  }, { clearStorage: true, destination: '/monitor?view=watchlists' });
  await expect(page.getByRole('tab', { name: /^Watchlists/u })).toHaveAttribute('aria-selected', 'true');
}

test('review history links exact retained decisions and missing associations without collecting or changing saved evidence', async ({ page }, testInfo) => {
  const record = createCase({ domain: 'review-history.example' }, NOW);
  const subject = buildAnalystReviewInbox({ cases: [record] }, NOW).items[0]!;
  expect(subject).toBeTruthy();
  let state = emptyAnalystReviewStateStore();
  for (let index = 0; index < 3; index += 1) state = setAnalystReviewDecision(state, subject, {
    disposition: index === 1 ? 'suppressed' : 'open',
    rationale: `Decision ${index}: ${'retained-rationale-'.repeat(48)}`,
    reviewedAt: new Date(Date.parse(NOW) - (3 - index) * 60_000).toISOString(),
    expiresAt: index === 1 ? '2026-09-11T00:00:00.000Z' : null,
    caseIds: [record.id, 'missing-review-case'],
  });
  await seed(page, {
    'whois-rdap-cases-v1': JSON.parse(serializeCaseStore([record])),
    'whoisleuth-analyst-review-state-v1': currentBrowserLocalDocument('analyst_review_state', { records: state.records }),
  });
  let apiRequests = 0;
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/session' || pathname === '/api/capabilities') { await route.fallback(); return; }
    apiRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const before = await readBrowserLocalCollection(page, 'analyst_review_state', { minimumRecords: 1 });
  const casesBefore = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await openConsoleView(page, 'timeline');
  const timeline = page.getByRole('region', { name: 'Investigation timeline', exact: true });
  await expect(timeline).toContainText('3 retained events');
  await timeline.getByRole('combobox', { name: 'Case', exact: true }).selectOption('missing-review-case');
  await expect(timeline.locator('.timeline-list article')).toHaveCount(3);
  const latest = timeline.locator('.timeline-list article').filter({ has: page.getByRole('heading', { name: 'Latest case review: open', exact: true }) });
  await expect(latest).toBeVisible();
  await expect(latest).toContainText('Analyst decision');
  await expect(latest.getByText('Local activity', { exact: true })).toBeVisible();
  await expect(latest.locator('dt').filter({ hasText: /^(Observed|Freshness)$/u })).toHaveCount(0);
  await latest.getByText('Currently associated Cases (2)', { exact: true }).click();
  await expect(latest.getByRole('link', { name: 'review-history.example', exact: true })).toHaveAttribute('href', `/monitor?view=cases&case=${record.id}`);
  await expect(latest).toContainText('missing-review-case (unavailable)');
  await expect(latest.getByRole('link', { name: /missing-review-case/u })).toHaveCount(0);
  const reviewHref = await latest.getByRole('link', { name: 'Open review history', exact: true }).getAttribute('href');
  expect(new URL(reviewHref!, 'https://example.test').searchParams.get('review')).toBe(subject.subjectKey);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[1280, 720], [1024, 768], [390, 844], [320, 700]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      await timeline.getByRole('combobox', { name: 'Case', exact: true }).focus();
      const action = latest.getByRole('link', { name: 'Open review history', exact: true });
      await action.focus();
      await expect(action).toBeFocused();
      await expect(action).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath(`timeline-${theme}-${width}.png`) });
      await latest.screenshot({ path: testInfo.outputPath(`timeline-card-${theme}-${width}.png`) });
    }
  }
  await latest.getByRole('link', { name: 'Open review history', exact: true }).press('Enter');
  const inbox = page.getByRole('region', { name: 'Review inbox', exact: true });
  await expect(inbox).toContainText('Showing the selected review and its retained history.');
  const selected = inbox.locator('.items > li');
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText('Needs action: The analyst retained this item as open.');
  await selected.locator('details.lifecycle-controls > summary').press('Enter');
  await selected.getByText('Earlier decisions (2)', { exact: true }).press('Enter');
  const history = selected.locator('.decision-history li');
  await expect(history).toHaveCount(2);
  await expect(history.nth(0)).toContainText(state.records[0]!.history[0]!.rationale);
  await expect(history.nth(1)).toContainText(state.records[0]!.history[1]!.rationale);
  await expect(history.nth(0)).toContainText('Expiry:');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[1280, 720], [1024, 768], [390, 844], [320, 700]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      await selected.locator('details.lifecycle-controls > summary').focus();
      const historySummary = selected.getByText('Earlier decisions (2)', { exact: true });
      await historySummary.focus();
      await expect(historySummary).toBeFocused();
      await expect(historySummary).toBeInViewport({ ratio: 1 });
      const [itemBounds, historyBounds] = await Promise.all([selected.boundingBox(), selected.locator('.decision-history').boundingBox()]);
      expect(itemBounds).not.toBeNull();
      expect(historyBounds).not.toBeNull();
      expect(historyBounds!.width).toBeGreaterThan(itemBounds!.width - 80);
      await page.screenshot({ path: testInfo.outputPath(`history-${theme}-${width}.png`) });
    }
  }
  expect((await readBrowserLocalCollection(page, 'analyst_review_state', { minimumRecords: 1 })).records).toEqual(before.records);
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records).toEqual(casesBefore.records);
  await page.goto('/monitor?view=inbox&review=missing-review');
  await expect(inbox).toContainText('The selected review is unavailable in the admitted inbox.');
  await expect(inbox.locator('.items > li')).toHaveCount(0);
  await inbox.getByRole('link', { name: 'Show all review items', exact: true }).press('Enter');
  await expect(inbox.locator('.items > li')).not.toHaveCount(0);
  await openConsoleView(page, 'timeline');
  expect(new URL(page.url()).searchParams.has('review')).toBe(false);
  expect(apiRequests).toBe(0);
});

test('a pending review read stays loading after the other timeline collections are ready', async ({ page }) => {
  const record = createCase({ domain: 'pending-review.example' }, NOW);
  const subject = buildAnalystReviewInbox({ cases: [record] }, NOW).items[0]!;
  const rationale = 'A held local review verification remains pending.';
  const state = setAnalystReviewDecision(emptyAnalystReviewStateStore(), subject, {
    disposition: 'open', rationale, reviewedAt: NOW,
  });
  await seed(page, {
    'whois-rdap-cases-v1': JSON.parse(serializeCaseStore([record])),
    'whoisleuth-analyst-review-state-v1': currentBrowserLocalDocument('analyst_review_state', { records: state.records }),
  });
  // Hold only this record's integrity verification, after migration. Native
  // database transactions and every other collection continue normally.
  const gate = await page.evaluateHandle((marker) => {
    const original = crypto.subtle.digest;
    let held = false;
    let release = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    crypto.subtle.digest = async function digest(algorithm, data) {
      const result = await original.call(this, algorithm, data);
      if (new TextDecoder().decode(data).includes(marker)) { held = true; await pending; }
      return result;
    };
    return { get held() { return held; }, release, restore() { release(); crypto.subtle.digest = original; } };
  }, rationale);
  try {
    await openConsoleView(page, 'relationships');
    await expect(page.getByRole('tab', { name: /^Relationships/u }).locator('span')).not.toHaveAttribute('aria-label', /count (loading|unavailable)/u);
    await openConsoleView(page, 'inbox');
    await expect.poll(() => gate.evaluate((control) => control.held)).toBe(true);
    const gaps = page.getByRole('region', { name: 'Evidence gaps', exact: true });
    await expect(gaps).toBeVisible();
    await expect(gaps).toHaveAttribute('aria-busy', 'false');
    await openConsoleView(page, 'timeline');
    await expect(page.getByRole('heading', { name: 'Loading saved work', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toHaveCount(0);
    await gate.evaluate((control) => control.release());
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toContainText('1 retained event');
  } finally {
    await gate.evaluate((control) => control.restore());
    await gate.dispose();
  }
});

test('an unreadable review collection cannot produce an apparently complete activity timeline', async ({ page }) => {
  await seed(page);
  await failBrowserLocalCollectionReads(page, 'analyst_review_state');
  await openConsoleView(page, 'timeline');
  await expect(page.getByRole('tab', { name: /^Timeline/u }).locator('span')).toHaveAttribute('aria-label', 'count unavailable');
  await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toHaveCount(0);
});

async function holdNextWorker(page: Page) {
  const pattern = `**${productionChunkPath('src/lib/workers/retained-review.worker.ts')}`;
  let release = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  let held = 0;
  await page.route(pattern, async (route) => {
    held += 1;
    if (held === 1) await released;
    await route.fallback();
  });
  return { release, count: () => held, dispose: async () => { release(); if (!page.isClosed()) await page.unroute(pattern); } };
}

async function workerProbe(page: Page) {
  return page.evaluateHandle(() => {
    const NativeWorker = window.Worker;
    const startedAt = performance.now();
    const operations: { createdAt: number; kind: string; postedAt: number; postReturnedAt: number; repliedAt: number; terminatedAt: number; usableAt: number; animationFrames: number }[] = [];
    const verificationOperations: typeof operations = [];
    const tasks: { start: number; duration: number }[] = [];
    let overflow = false;
    const collect = (entries: readonly PerformanceEntry[]) => { for (const entry of entries) {
      if (tasks.length >= 1_000) overflow = true;
      else tasks.push({ start: entry.startTime, duration: entry.duration });
    } };
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supported ? new PerformanceObserver((list) => collect(list.getEntries())) : null;
    observer?.observe({ type: 'longtask' });
    function recordUsable() {
      for (const operation of operations) {
        if (!operation.repliedAt || operation.usableAt) continue;
        const view = operation.kind === 'timeline' ? '.timeline-workspace' : '.evidence-debt';
        const input = document.querySelector<HTMLInputElement>(`.retained-preparation[aria-busy="false"] ${view} input`);
        if (input && !input.disabled && input.getClientRects().length) operation.usableAt = performance.now();
      }
    }
    const rendering = new MutationObserver(recordUsable);
    rendering.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const verification = options?.name === 'browser-local-data-verification';
        if (!verification && options?.name !== 'retained-evidence-review') return;
        const operation = { createdAt: performance.now(), kind: '', postedAt: 0, postReturnedAt: 0, repliedAt: 0, terminatedAt: 0, usableAt: 0, animationFrames: 0 };
        (verification ? verificationOperations : operations).push(operation);
        let frame = 0;
        const next = () => { operation.animationFrames += 1; frame = requestAnimationFrame(next); };
        frame = requestAnimationFrame(next);
        this.addEventListener('message', () => { operation.repliedAt = performance.now(); cancelAnimationFrame(frame); });
        const post = this.postMessage.bind(this);
        this.postMessage = (message: unknown, options?: StructuredSerializeOptions | Transferable[]) => {
          operation.kind = verification ? 'verification' : message && typeof message === 'object' && 'kind' in message ? String(message.kind) : '';
          operation.postedAt = performance.now();
          if (Array.isArray(options)) post(message, options); else post(message, options);
          operation.postReturnedAt = performance.now();
        };
        const terminate = this.terminate.bind(this);
        this.terminate = () => { operation.terminatedAt = performance.now(); cancelAnimationFrame(frame); terminate(); };
      }
    };
    return {
      read: () => ({ operations, verificationOperations }),
      finish: () => {
        recordUsable(); rendering.disconnect(); collect(observer?.takeRecords() ?? []); observer?.disconnect(); window.Worker = NativeWorker;
        return { startedAt, finishedAt: performance.now(), operations, verificationOperations, mainThreadLongTasks: supported ? tasks : null, overflow };
      },
    };
  });
}

test('held preparation is not an empty result and switching views cancels it without accepting late evidence', async ({ page }) => {
  await seed(page);
  const probe = await workerProbe(page);
  const held = await holdNextWorker(page);
  try {
    await openConsoleView(page, 'timeline');
    await expect.poll(held.count).toBe(1);
    await expect(page.getByRole('status').filter({ hasText: 'Preparing the timeline locally' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Timeline/u }).locator('span')).toHaveAttribute('aria-label', 'count loading');
    await openConsoleView(page, 'inbox');
    await expect(page.getByRole('region', { name: 'Evidence gaps', exact: true })).toContainText('2 evidence gaps to review');
    await expect.poll(async () => (await probe.evaluate((value) => value.read())).operations[0]?.terminatedAt ?? 0).toBeGreaterThan(0);
    held.release();
    await openConsoleView(page, 'watchlists');
    await expect(page.getByRole('tab', { name: /^Watchlists/u })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toHaveCount(0);
    await openConsoleView(page, 'timeline');
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toContainText('2 retained events');
    const operations = (await probe.evaluate((value) => value.read())).operations;
    expect(operations.map((operation) => operation.kind)).toEqual(['timeline', 'debt', 'timeline']);
    expect(operations[0]?.repliedAt).toBe(0);
  } finally { await held.dispose(); await probe.evaluate((value) => value.finish()); await probe.dispose(); }
});

test('failed preparation allows deliberate retry and refresh preserves filters, results and focus', async ({ page }) => {
  await seed(page);
  const pattern = `**${productionChunkPath('src/lib/workers/retained-review.worker.ts')}`;
  await page.route(pattern, (route) => route.abort('failed'));
  await openConsoleView(page, 'timeline');
  await expect(page.getByRole('status').filter({ hasText: 'retained review worker is unavailable' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^Timeline/u }).locator('span')).toHaveAttribute('aria-label', 'count unavailable');
  await page.unroute(pattern);
  await page.getByRole('button', { name: 'Retry timeline', exact: true }).press('Enter');
  const timeline = page.getByRole('region', { name: 'Investigation timeline', exact: true });
  await expect(timeline).toContainText('2 retained events');
  const search = timeline.getByRole('searchbox', { name: 'Entity', exact: true });
  await search.fill('retained-01');
  await expect(timeline.locator('.timeline-list article')).toHaveCount(1);
  const held = await holdNextWorker(page);
  try {
    await page.getByRole('button', { name: 'Refresh timeline', exact: true }).press('Enter');
    await expect.poll(held.count).toBe(1);
    await expect(page.getByRole('button', { name: 'Refresh timeline', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Refresh timeline', exact: true })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'previous review remains visible' })).toBeVisible();
    await search.focus();
    held.release();
    await expect(page.getByRole('button', { name: 'Refresh timeline', exact: true })).toBeEnabled();
    await expect(search).toHaveValue('retained-01');
    await expect(search).toBeFocused();
    await expect(timeline.locator('.timeline-list article')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  } finally { await held.dispose(); }
});

test('leaving Monitor cancels the active worker without a late route update', async ({ page }) => {
  await seed(page);
  const probe = await workerProbe(page);
  const held = await holdNextWorker(page);
  try {
    await openConsoleView(page, 'timeline');
    await expect.poll(held.count).toBe(1);
    await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: /^Dashboard(?:\s|$)/u }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect.poll(async () => (await probe.evaluate((value) => value.read())).operations[0]?.terminatedAt ?? 0).toBeGreaterThan(0);
    held.release();
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toHaveCount(0);
    expect((await probe.evaluate((value) => value.read())).operations[0]?.repliedAt).toBe(0);
  } finally { await held.dispose(); await probe.evaluate((value) => value.finish()); await probe.dispose(); }
});

test('unchanged views reuse preparation and deleting a retained record invalidates that cached evidence', async ({ page }) => {
  await seed(page, { 'whoisleuth-relationship-observations-v1': currentBrowserLocalDocument('relationship_observations', {
    observations: [createRelationshipObservation({ type: 'ip_address', value: '192.0.2.10', domains: ['retained-00.example', 'retained-01.example'] }, { retainedAt: NOW })],
  }) });
  const probe = await workerProbe(page);
  try {
    await openConsoleView(page, 'timeline');
    const timeline = page.getByRole('region', { name: 'Investigation timeline', exact: true });
    await expect(timeline).toContainText('3 retained events');
    await openConsoleView(page, 'watchlists');
    await expect(page.getByRole('tab', { name: /^Watchlists/u })).toHaveAttribute('aria-selected', 'true');
    await openConsoleView(page, 'timeline');
    await expect(timeline).toContainText('3 retained events');
    expect((await probe.evaluate((value) => value.read())).operations).toHaveLength(1);
    await openConsoleView(page, 'relationships');
    const retained = page.getByRole('region', { name: 'Retained relationship observations', exact: true });
    await expect(retained).toContainText('1 retained');
    page.once('dialog', (dialog) => dialog.accept());
    await retained.getByRole('button', { name: 'Delete retained observation', exact: true }).click();
    await expect(retained.getByRole('heading', { name: 'No retained relationship observations', exact: true })).toBeVisible();
    const held = await holdNextWorker(page);
    try {
      await openConsoleView(page, 'timeline');
      await expect(page.getByRole('tab', { name: /^Timeline/u }).locator('span')).toHaveAttribute('aria-label', 'count loading');
      await expect.poll(held.count).toBe(1);
      await expect(timeline).toHaveCount(0);
      held.release();
      await expect(timeline).toContainText('2 retained events');
      expect((await probe.evaluate((value) => value.read())).operations.filter(operation => operation.kind === 'timeline')).toHaveLength(2);
    } finally { await held.dispose(); }
  } finally { await probe.evaluate((value) => value.finish()); await probe.dispose(); }
});

test('a committed Case edit replaces retained review inputs without losing its draft result or worker portability', async ({ page }) => {
  await seed(page);
  const probe = await workerProbe(page);
  try {
    await openConsoleView(page, 'timeline');
    const timeline = page.getByRole('region', { name: 'Investigation timeline', exact: true });
    await expect(timeline).toContainText('2 retained events');
    await openConsoleView(page, 'cases');
    const head = page.locator('.case-head', { hasText: 'retained-01.example' });
    await head.click();
    await openCaseSection(page, 'History');
    await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Retained review note.');
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(page.locator('.notes')).toContainText('Retained review note.');
    await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('');
    const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
    expect(stored.records.find((record) => record.value.domain === 'retained-01.example')?.value.notes).toHaveLength(1);
    await openConsoleView(page, 'timeline');
    await expect(timeline).toContainText('2 retained events');
    const operations = (await probe.evaluate((value) => value.read())).operations;
    expect(operations).toHaveLength(2);
    expect(operations.every((operation) => operation.kind === 'timeline' && operation.repliedAt > 0)).toBe(true);
    await expectNoHorizontalOverflow(page);
  } finally { await probe.evaluate((value) => value.finish()); await probe.dispose(); }
});

test('small retained collections preserve usable review and note workflows with observed worker overhead', async ({ page }, testInfo) => {
  await seed(page, {}, false);
  const probe = await workerProbe(page);
  try {
    await openConsoleView(page, 'timeline');
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toContainText('2 retained events');
    await openConsoleView(page, 'cases');
    await page.locator('.case-head', { hasText: 'retained-01.example' }).click();
    await openCaseSection(page, 'History');
    await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Small workspace note.');
    const noteStartedAt = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(page.locator('.notes')).toContainText('Small workspace note.');
    await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('');
    const noteVisibleAt = await page.evaluate(() => performance.now());
    const measurement = await probe.evaluate((value) => value.finish());
    expect(measurement.verificationOperations).toHaveLength(0);
    await testInfo.attach('retained-small-workspace-measurement', { body: JSON.stringify({
      ...measurement, noteStartedAt, noteVisibleAt, cases: 2, timingAcceptance: 'informational', peakMemoryAvailable: false,
    }), contentType: 'application/json' });
  } finally { await probe.evaluate((value) => value.finish()).catch(() => undefined); await probe.dispose(); }
});

for (const kind of ['timeline', 'debt'] as const) test(`complete ${kind} preparation runs outside the UI thread at admitted capacity`, async ({ page }, testInfo) => {
  const cases = caseStore(75, 40);
  const bulk = normalizeBulkSessionStore(richBulkSessionStore(1_100));
  for (const row of bulk.sessions[0]!.results) row.sourceCoverage = [{ source: 'dns', state: 'partial', observedAt: NOW }];
  const second = structuredClone(bulk.sessions[0]!);
  second.id = 'second-session';
  second.results.forEach((row) => { row.domain = `other-${row.domain}`; });
  second.domains = second.results.map((row) => row.domain);
  bulk.sessions.push(second);
  const bulkBytes = serializeBulkSessionStore(bulk);
  await seed(page, { 'whois-rdap-cases-v1': cases, 'whoisleuth-bulk-sessions-v1': JSON.parse(bulkBytes) }, false);
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 75 });
  expect(stored.records.reduce((count, record) => count + record.value.evidencePins.length, 0)).toBe(3_000);
  const probe = await workerProbe(page);
  try {
    await openConsoleView(page, kind === 'timeline' ? 'timeline' : 'inbox');
    const region = page.getByRole('region', { name: kind === 'timeline' ? 'Investigation timeline' : 'Evidence gaps', exact: true });
    await expect(region).toContainText(kind === 'timeline' ? '3002 retained events' : '5200 evidence gaps to review');
    const refresh = page.getByRole('button', { name: kind === 'timeline' ? 'Refresh timeline' : 'Refresh evidence gaps', exact: true });
    for (let sample = 1; sample < 3; sample += 1) {
      await refresh.press('Enter');
      await expect(refresh).toBeEnabled();
      await expect.poll(async () => (await probe.evaluate((value) => value.read())).operations.filter((operation) => operation.repliedAt > 0).length).toBe(sample + 1);
    }
    const measurements = await probe.evaluate((value) => value.finish());
    expect(measurements.operations).toHaveLength(3);
    expect(measurements.operations.every((operation) => operation.kind === kind
      && operation.repliedAt > operation.postReturnedAt && operation.postReturnedAt >= operation.postedAt
      && operation.terminatedAt >= operation.repliedAt && operation.usableAt >= operation.repliedAt)).toBe(true);
    expect(measurements.verificationOperations.length).toBeGreaterThan(0);
    expect(measurements.verificationOperations.every((operation) => operation.kind === 'verification'
      && operation.repliedAt >= operation.postReturnedAt && operation.postReturnedAt >= operation.postedAt
      && operation.terminatedAt >= operation.repliedAt)).toBe(true);
    expect(measurements.mainThreadLongTasks?.every((task) => task.start + task.duration >= measurements.startedAt) ?? true).toBe(true);
    expect(measurements.overflow).toBe(false);
    await testInfo.attach(`retained-${kind}-capacity-measurement`, { body: JSON.stringify({ ...measurements,
      caseBytes: Buffer.byteLength(JSON.stringify(cases)), bulkBytes: Buffer.byteLength(bulkBytes), cases: 75, pins: 3_000, bulkRows: 2_200,
      timingAcceptance: 'informational', scope: 'first activation includes collection reads, snapshots, transfer, worker preparation and visible controls; refresh reuses the current immutable inputs',
      peakMemoryAvailable: false,
    }), contentType: 'application/json' });
  } finally { await probe.evaluate((value) => value.finish()).catch(() => undefined); await probe.dispose(); }
});
