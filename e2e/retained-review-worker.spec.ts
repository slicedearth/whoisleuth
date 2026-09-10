import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection } from './helpers';
import { productionChunkPath } from './production-build';
import { createCase, serializeCaseStore } from '../packages/cases/case-model.mts';
import { createRelationshipObservation } from '../packages/workspace/relationship-observation-model.mts';
import { normalizeBulkSessionStore, serializeBulkSessionStore } from '../packages/workspace/bulk-session-model.mts';
import { richBulkSessionStore } from '../test/bulk-session-fixture.mts';

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
        if (options?.name !== 'retained-evidence-review') return;
        const operation = { createdAt: performance.now(), kind: '', postedAt: 0, postReturnedAt: 0, repliedAt: 0, terminatedAt: 0, usableAt: 0, animationFrames: 0 };
        operations.push(operation);
        let frame = 0;
        const next = () => { operation.animationFrames += 1; frame = requestAnimationFrame(next); };
        frame = requestAnimationFrame(next);
        this.addEventListener('message', () => { operation.repliedAt = performance.now(); cancelAnimationFrame(frame); });
        const post = this.postMessage.bind(this);
        this.postMessage = (message: unknown, options?: StructuredSerializeOptions | Transferable[]) => {
          operation.kind = message && typeof message === 'object' && 'kind' in message ? String(message.kind) : '';
          operation.postedAt = performance.now();
          if (Array.isArray(options)) post(message, options); else post(message, options);
          operation.postReturnedAt = performance.now();
        };
        const terminate = this.terminate.bind(this);
        this.terminate = () => { operation.terminatedAt = performance.now(); cancelAnimationFrame(frame); terminate(); };
      }
    };
    return {
      read: () => ({ operations }),
      finish: () => {
        recordUsable(); rendering.disconnect(); collect(observer?.takeRecords() ?? []); observer?.disconnect(); window.Worker = NativeWorker;
        return { startedAt, finishedAt: performance.now(), operations, mainThreadLongTasks: supported ? tasks : null, overflow };
      },
    };
  });
}

test('held preparation is not an empty result and switching views cancels it without accepting late evidence', async ({ page }) => {
  await seed(page);
  const probe = await workerProbe(page);
  const held = await holdNextWorker(page);
  try {
    await page.getByRole('tab', { name: /^Timeline/u }).click();
    await expect.poll(held.count).toBe(1);
    await expect(page.getByRole('status').filter({ hasText: 'Preparing the timeline locally' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Timeline/u }).locator('span')).toHaveAttribute('aria-label', 'count loading');
    await page.getByRole('tab', { name: /^Inbox/u }).click();
    await expect(page.getByRole('region', { name: 'Evidence gaps', exact: true })).toContainText('2 evidence gaps to review');
    await expect.poll(async () => (await probe.evaluate((value) => value.read())).operations[0]?.terminatedAt ?? 0).toBeGreaterThan(0);
    held.release();
    await page.getByRole('tab', { name: /^Watchlists/u }).click();
    await expect(page.getByRole('tab', { name: /^Watchlists/u })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Investigation timeline', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Timeline/u }).click();
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
  await page.getByRole('tab', { name: /^Timeline/u }).click();
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
    await page.getByRole('tab', { name: /^Timeline/u }).click();
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
    await page.getByRole('tab', { name: /^Timeline/u }).click();
    const timeline = page.getByRole('region', { name: 'Investigation timeline', exact: true });
    await expect(timeline).toContainText('3 retained events');
    await page.getByRole('tab', { name: /^Watchlists/u }).click();
    await expect(page.getByRole('tab', { name: /^Watchlists/u })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /^Timeline/u }).click();
    await expect(timeline).toContainText('3 retained events');
    expect((await probe.evaluate((value) => value.read())).operations).toHaveLength(1);
    await page.getByRole('tab', { name: /^Relationships/u }).click();
    const retained = page.getByRole('region', { name: 'Retained relationship observations', exact: true });
    await expect(retained).toContainText('1 retained');
    page.once('dialog', (dialog) => dialog.accept());
    await retained.getByRole('button', { name: 'Delete retained observation', exact: true }).click();
    await expect(retained.getByRole('heading', { name: 'No retained relationship observations', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Timeline/u }).locator('span')).toHaveAttribute('aria-label', 'count loading');
    const held = await holdNextWorker(page);
    try {
      await page.getByRole('tab', { name: /^Timeline/u }).click();
      await expect.poll(held.count).toBe(1);
      await expect(timeline).toHaveCount(0);
      held.release();
      await expect(timeline).toContainText('2 retained events');
      expect((await probe.evaluate((value) => value.read())).operations).toHaveLength(2);
    } finally { await held.dispose(); }
  } finally { await probe.evaluate((value) => value.finish()); await probe.dispose(); }
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
    await page.getByRole('tab', { name: kind === 'timeline' ? /^Timeline/u : /^Inbox/u }).click();
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
    expect(measurements.mainThreadLongTasks?.every((task) => task.start + task.duration >= measurements.startedAt) ?? true).toBe(true);
    expect(measurements.overflow).toBe(false);
    await testInfo.attach(`retained-${kind}-capacity-measurement`, { body: JSON.stringify({ ...measurements,
      caseBytes: Buffer.byteLength(JSON.stringify(cases)), bulkBytes: Buffer.byteLength(bulkBytes), cases: 75, pins: 3_000, bulkRows: 2_200,
      timingAcceptance: 'informational', scope: 'first activation includes collection reads, snapshots, transfer, worker preparation and visible controls; refresh reuses the current immutable inputs',
      peakMemoryAvailable: false,
    }), contentType: 'application/json' });
  } finally { await probe.evaluate((value) => value.finish()).catch(() => undefined); await probe.dispose(); }
});
