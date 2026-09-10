import { expect, test } from './fixtures';
import {
  currentBrowserLocalDocument, expectFocusedResultsVisible, expectNoHorizontalOverflow,
  migrateLegacyBrowserData, readBrowserLocalCollection, useTheme,
} from './helpers';
import type { WebsiteProfileSnapshot } from '../packages/workspace/website-snapshot-model.mts';

function savedProfile(index: number): WebsiteProfileSnapshot {
  const domain = `target-${String(index).padStart(2, '0')}.example`;
  return {
    id: `saved-profile-${index}`, domain, observedAt: '2026-09-01T00:00:00.000Z', savedAt: '2026-09-01T00:00:00.000Z',
    complete: true, truncated: false,
    profileProvenance: { technology: { version: 11, state: 'known' }, securityPosture: { version: 2, state: 'known' }, pageFingerprint: { version: 1, state: 'known' } },
    technologies: Array.from({ length: 10 }, (_, offset) => ({ id: `platform-${offset}`, name: `Platform ${offset}`, category: 'framework', confidence: 'high', roles: ['framework_runtime'] })),
    posture: [], sources: [{ source: 'http', state: 'success' }], dependencies: [], certificate: null,
    identity: { normalizedHtml: 'a'.repeat(64), visibleText: null, domStructure: null, formStructure: null, resourceHosts: null, trackingIdentifiers: null, faviconHash: 'b'.repeat(64) },
    identityValues: {
      resourceHosts: Array.from({ length: 30 }, (_, offset) => `asset-${offset}.example`),
      trackingIdentifiers: Array.from({ length: 10 }, (_, offset) => ({ type: 'analytics', value: `TRACK-${offset}` })),
      formActionOrigins: Array.from({ length: 10 }, (_, offset) => `https://form-${offset}.example`),
    },
  };
}

test('saved website relationships retain complete membership and reach the last result page', async ({ page }) => {
  const profiles = Array.from({ length: 60 }, (_, index) => savedProfile(index));
  await page.goto('/monitor?view=cases');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-website-snapshots-v1': currentBrowserLocalDocument('website_snapshots', { snapshots: profiles }),
  });
  const tab = page.getByRole('tab', { name: /^Relationships/u });
  await expect(tab).toBeVisible();
  await page.mouse.move(0, 0);
  const probe = await tab.evaluateHandle((button) => {
    const marks = { startedAt: 0, readyAt: 0 };
    const tasks: { start: number; duration: number }[] = [];
    let taskOverflow = false;
    const collect = (entries: readonly PerformanceEntry[]) => { for (const entry of entries) {
      if (tasks.length >= 1_000) taskOverflow = true;
      else tasks.push({ start: entry.startTime, duration: entry.duration });
    } };
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supported ? new PerformanceObserver((list) => collect(list.getEntries())) : null;
    observer?.observe({ type: 'longtask' });
    const start = () => { if (!marks.startedAt) marks.startedAt = performance.now(); };
    button.addEventListener('pointerover', start);
    const ready = new MutationObserver(() => {
      const results = document.querySelector('ol[aria-label="Saved website relationship results"]');
      const status = document.querySelector('.profile-clusters [role="status"]');
      if (marks.startedAt && results?.children.length === 20 && status?.textContent?.includes('of 1832 matching relationships')) {
        marks.readyAt = performance.now();
        ready.disconnect();
      }
    });
    ready.observe(document.body, { childList: true, subtree: true, characterData: true });
    return { finish: () => {
      collect(observer?.takeRecords() ?? []); observer?.disconnect(); ready.disconnect(); button.removeEventListener('pointerover', start);
      return { ...marks, mainThreadLongTasks: supported ? tasks.filter((task) => task.start < marks.readyAt && task.start + task.duration > marks.startedAt) : null, taskOverflow };
    } };
  });
  try {
    await tab.click();
    const workspace = page.getByRole('region', { name: 'Cross-domain website pivots' });
    const results = workspace.getByRole('list', { name: 'Saved website relationship results' });
    const pagination = workspace.getByRole('navigation', { name: 'Website relationship pages' });
    await expect(workspace.getByRole('status').first()).toHaveText('Showing 1–20 of 1832 matching relationships · similarity model 4');
    await expect(results.locator(':scope > li')).toHaveCount(20);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const measurement = await probe.evaluate((value) => value.finish());
    expect(measurement.startedAt).toBeGreaterThan(0);
    expect(measurement.readyAt).toBeGreaterThan(measurement.startedAt);
    expect(measurement.taskOverflow).toBe(false);
    const retained = await readBrowserLocalCollection(page, 'website_snapshots');
    expect(retained.records).toHaveLength(60);
    expect(retained.manifest?.serializedBytes).toBeGreaterThan(0);
    expect(retained.manifest?.serializedBytes).toBeLessThanOrEqual(512 * 1024);
    await test.info().attach('website-relationship-capacity', { body: JSON.stringify({
      ...measurement, snapshots: 60, storedBytes: retained.manifest?.serializedBytes ?? null, weightedPairs: 1770, exactPivots: 62,
      timingAcceptance: 'informational', scope: 'pointer approach through collection read and first usable relationship page', peakMemoryAvailable: false,
    }), contentType: 'application/json' });

    const pageInput = pagination.getByRole('spinbutton', { name: 'Website relationship page' });
    await pageInput.fill('93');
    await pagination.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(pagination.getByRole('status')).toHaveText('Page 1 of 92');
    await pageInput.fill('92');
    await pageInput.press('Enter');
    await expect(pagination.getByRole('status')).toHaveText('Page 92 of 92');
    await expect(results.locator(':scope > li')).toHaveCount(12);
    await expectFocusedResultsVisible(page, results);
    await expect(workspace.getByRole('status').first()).toHaveText('Showing 1821–1832 of 1832 matching relationships · similarity model 4');
    await expect(pagination.getByRole('button', { name: 'Next', exact: true })).toHaveAttribute('aria-disabled', 'true');

    await workspace.getByRole('combobox', { name: 'Relationship type' }).selectOption('technology');
    await expect(results.locator(':scope > li')).toHaveCount(10);
    await expect(workspace.getByRole('status').first()).toHaveText('Showing 1–10 of 10 matching relationships · similarity model 4');
    const cluster = results.locator(':scope > li').first();
    await expect(cluster.getByRole('link')).toHaveCount(60);
    await expect(cluster.getByRole('link', { name: 'target-59.example', exact: true })).toBeVisible();

    await workspace.getByRole('combobox', { name: 'Relationship type' }).selectOption('similarity');
    await workspace.getByRole('searchbox', { name: 'Search saved profiles' }).fill('target-59.example');
    await expect(workspace.getByRole('status').first()).toHaveText('Showing 1–20 of 59 matching relationships · similarity model 4');
    await pagination.getByRole('spinbutton', { name: 'Website relationship page' }).fill('3');
    await pagination.getByRole('spinbutton', { name: 'Website relationship page' }).press('Enter');
    await expect(results.locator(':scope > li')).toHaveCount(19);
    await expect(results.getByRole('link', { name: 'target-58.example', exact: true })).toBeVisible();
    await expectFocusedResultsVisible(page, results);
    await workspace.getByRole('searchbox', { name: 'Search saved profiles' }).fill('asset-29.example');
    await expect(workspace.getByRole('status').first()).toHaveText('Showing 1–20 of 1770 matching relationships · similarity model 4');
    await expect(page).toHaveURL('/monitor?view=relationships');
    expect(await readBrowserLocalCollection(page, 'website_snapshots')).toEqual(retained);
  } finally { await probe.evaluate((value) => value.finish()).catch(() => undefined); await probe.dispose(); }
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`saved website relationship pages remain usable at ${viewport.width} in ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await useTheme(page, theme);
      await page.goto('/monitor?view=relationships');
      await migrateLegacyBrowserData(page, {
        'whoisleuth-website-snapshots-v1': currentBrowserLocalDocument('website_snapshots', { snapshots: Array.from({ length: 8 }, (_, index) => savedProfile(index)) }),
      });
      const workspace = page.getByRole('region', { name: 'Cross-domain website pivots' });
      const results = workspace.getByRole('list', { name: 'Saved website relationship results' });
      const pagination = workspace.getByRole('navigation', { name: 'Website relationship pages' });
      await expect(results.locator(':scope > li')).toHaveCount(20);
      await expect(workspace.getByRole('status').first()).toHaveText('Showing 1–20 of 90 matching relationships · similarity model 4');
      await pagination.getByRole('button', { name: 'Next', exact: true }).focus();
      await pagination.getByRole('button', { name: 'Next', exact: true }).press('Enter');
      await expect(pagination.getByRole('status')).toHaveText('Page 2 of 5');
      await expectFocusedResultsVisible(page, results);
      await expectNoHorizontalOverflow(page);
      const counters = results.locator('.cluster-head > strong > small');
      await expect(counters).toHaveCount(20);
      const counterGeometry = await counters.evaluateAll((labels) => labels.map((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        const title = label.parentElement?.previousElementSibling?.getBoundingClientRect();
        const counter = label.getBoundingClientRect();
        return { lines: range.getClientRects().length, separate: Boolean(title && title.right <= counter.left) };
      }));
      expect(counterGeometry).toEqual(Array.from({ length: 20 }, () => ({ lines: 1, separate: true })));
      await test.info().attach(`website-relationships-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
      await pagination.getByRole('spinbutton', { name: 'Website relationship page' }).fill('5');
      await pagination.getByRole('spinbutton', { name: 'Website relationship page' }).press('Enter');
      await expect(pagination.getByRole('status')).toHaveText('Page 5 of 5');
      await expect(results.locator(':scope > li')).toHaveCount(10);
      await expectFocusedResultsVisible(page, results);
      await pagination.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await test.info().attach(`website-pagination-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
}
