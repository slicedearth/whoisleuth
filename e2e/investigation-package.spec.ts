import { expect, test } from './fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, openDashboardSecondaryWorkspaces, readBrowserLocalCollection, useTheme } from './helpers';
import { buildInvestigationPackage, inspectInvestigationPackage } from '../packages/investigation/investigation-package.mts';
import { buildWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { createCase } from '../packages/cases/case-model.mts';
import { unzipSync, zipSync } from 'fflate';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeInvestigationFolder } from '../cli/investigation-folder.mts';
import { MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES } from '../packages/investigation/investigation-manifest.mts';
import { captureReviewFixture } from '../test/capture-review-fixture.mts';
import { expectedIconPixels } from '../test/favicon-image-fixtures.mts';
import { productionChunkPath } from './production-build';

const NOW = '2026-09-11T00:00:00.000Z';
const makePackage = (artifacts: Parameters<typeof buildInvestigationPackage>[0]['artifacts']) => buildInvestigationPackage({ workflow: 'Evidence review', configurationDigestSha256: null, artifacts }, NOW, '2.3.1');

async function openPackages(page: import('@playwright/test').Page) {
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [createCase({ domain: 'existing.example' }, NOW)] }) }, { clearStorage: true, destination: '/dashboard' });
  await openDashboardSecondaryWorkspaces(page);
  return page.getByRole('region', { name: 'Package and review evidence files' });
}
const asFile = (bytes: Uint8Array) => ({ name: 'evidence.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });

test('idle search indexing cannot displace a pressed package disclosure', async ({ page }, testInfo) => {
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.route(`**${productionChunkPath('src/lib/workers/investigation-search.worker.ts')}`, async route => {
    held = true; await released; await route.fallback();
  });
  try {
    const panel = await openPackages(page);
    await expect.poll(() => held).toBe(true);
    const summary = panel.locator('.create-package > summary');
    await summary.scrollIntoViewIfNeeded();
    const bounds = await summary.boundingBox();
    if (!bounds) throw new Error('The package disclosure is absent.');
    const scroll = await page.evaluate(() => window.scrollY);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    release();
    await expect(page.locator('.investigation-search .index-count')).toHaveText('2 searchable items');
    await expect(page.locator('.recent-work .result-list > li')).toHaveCount(2);
    expect(await summary.boundingBox()).toEqual(bounds);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await page.mouse.up();
    await expect(panel.getByLabel('Package purpose', { exact: true })).toBeVisible();
    const recent = page.locator('.recent-work > summary');
    await recent.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('list', { name: 'Recent local investigation work' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.recent-work')).not.toHaveAttribute('open');
    const search = page.getByRole('region', { name: 'Search saved work', exact: true });
    for (const width of [320, 390, 1024, 1280, 2560]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await useTheme(page, theme);
      await search.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await expect(search.getByRole('searchbox')).toBeVisible();
      await search.screenshot({ path: testInfo.outputPath(`idle-search-${width}-${theme}.png`) });
    }
  } finally { release(); await page.mouse.up(); }
});

test('an explicitly selected local folder uses the ZIP review without importing or ignoring unlisted files', async ({ page }, testInfo) => {
  const panel = await openPackages(page), before = await readBrowserLocalCollection(page, 'cases');
  const target = testInfo.outputPath('selected-evidence');
  await mkdir(dirname(target), { recursive: true });
  await writeInvestigationFolder(target, { workflow: 'Selected files', configurationDigestSha256: null, artifacts: [
    { content: '{"source":"retained exactly"}\n', source: { identity: 'Independent declaration', observedAt: null } },
  ] }, NOW, '2.4.0');
  const input = panel.getByLabel('Review evidence folder', { exact: true });
  await input.setInputFiles(target);
  const heading = panel.getByRole('heading', { name: 'Evidence folder review', exact: true });
  await expect(heading).toBeFocused();
  await expect(panel).toContainText('Every file matches its manifest');
  await panel.getByRole('button', { name: 'View artifact-1', exact: true }).click();
  await expect(panel.locator('pre')).toContainText('retained exactly');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await panel.getByRole('button', { name: 'Close package review', exact: true }).click();
  await expect(input).toBeFocused();
  await writeFile(`${target}/unexpected.txt`, 'not selected evidence');
  await input.setInputFiles(target);
  await expect(panel.getByRole('alert')).toContainText('unexpected entry path');
  await expect(heading).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});

test('folder export uses direct activation and read-back verification, with a ZIP fallback when access is unavailable', async ({ page }) => {
  const panel = await openPackages(page), before = await readBrowserLocalCollection(page, 'cases');
  await panel.locator('.create-package > summary').click();
  await panel.getByLabel('Choose evidence files', { exact: true }).setInputFiles({ name: 'selected.png', mimeType: 'image/png', buffer: Buffer.from([0, 255, 128, 1]) });
  const native = await page.evaluate(() => typeof Reflect.get(window, 'showDirectoryPicker') === 'function');
  const write = panel.getByRole('button', { name: 'Write new evidence folder', exact: true });
  if (!native) {
    await expect(write).toHaveCount(0);
    await expect(panel).toContainText('extract the downloaded ZIP');
    await expect(panel.getByRole('button', { name: 'Download private package', exact: true })).toBeEnabled();
  } else {
    const parentName = await page.evaluate(async () => {
      const name = `evidence-export-fixture-${crypto.randomUUID()}`;
      const parent = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
      Object.defineProperty(window, 'folderPickerProbe', { configurable: true, value: { calls: 0, active: false, mode: '' } });
      Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async (options: { mode: string }) => {
        const probe = Reflect.get(window, 'folderPickerProbe'); probe.calls++; probe.active = navigator.userActivation.isActive; probe.mode = options.mode;
        return parent;
      } });
      return name;
    });
    try {
      await write.focus(); await page.keyboard.press('Enter');
      await expect(panel.getByRole('status')).toContainText('verified 1 file by reading it back');
      await expect(write).toBeFocused();
      const result = await page.evaluate(async name => {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        const children: FileSystemHandle[] = []; for await (const entry of root.values()) children.push(entry);
        if (children.length !== 1 || children[0]!.kind !== 'directory') throw new Error('Expected exactly one output child.');
        const child = children[0] as FileSystemDirectoryHandle;
        const manifest = JSON.parse(await (await (await child.getFileHandle('manifest.json')).getFile()).text());
        const file = await (await (await child.getDirectoryHandle('artifacts')).getFileHandle('artifact-1')).getFile();
        return { bytes: [...new Uint8Array(await file.arrayBuffer())], manifest, probe: Reflect.get(window, 'folderPickerProbe') };
      }, parentName);
      expect(result.bytes).toEqual([0, 255, 128, 1]); expect(result.manifest.artifacts[0].source.observedAt).toBeNull();
      expect(result.probe).toEqual({ calls: 1, active: true, mode: 'readwrite' });
    } finally { await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), parentName); }
  }
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});

test('inline package review exposes all JSON text and actual PNG pixels without executing file content', async ({ page }, testInfo) => {
  const panel = await openPackages(page);
  const before = await readBrowserLocalCollection(page, 'cases');
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  const { manifestBytes, screenshot, dom } = captureReviewFixture();
  const hostileText = JSON.stringify({ html: '<script>window.sourceExecuted=true</script><a href="https://external.invalid/">External link</a>',
    text: 'x'.repeat(70_000), final: 'Last content remains reachable' });
  const built = await makePackage([
    { content: hostileText }, { content: screenshot, mediaType: 'image/png' },
    { content: manifestBytes, mediaType: 'application/json' }, { content: dom, mediaType: 'application/json' },
    { content: new TextEncoder().encode('<svg><script>window.sourceExecuted=true</script></svg>'), mediaType: 'application/octet-stream' },
  ]);
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(asFile(built.bytes));
  await expect(panel.getByRole('region', { name: 'Capture attachment checks', exact: true })).toContainText('bytes match artifact-2');
  await expect(panel.getByRole('region', { name: 'Capture attachment checks', exact: true })).toContainText('bytes match artifact-4');
  const textTrigger = panel.getByRole('button', { name: 'View artifact-1', exact: true });
  await textTrigger.focus(); await page.keyboard.press('Enter');
  const textReview = panel.getByRole('region', { name: 'Inline review of artifact-1', exact: true });
  await expect(textReview).toBeFocused();
  await expect(textReview.locator('pre')).toContainText('<script>window.sourceExecuted=true</script>');
  await expect(textReview.locator('script, a')).toHaveCount(0);
  const scroller = textReview.getByRole('region', { name: 'artifact-1 text', exact: true });
  await scroller.focus(); await page.keyboard.press('PageDown');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await textReview.getByRole('button', { name: 'Next text part' }).click();
  await textReview.getByRole('button', { name: 'Next text part' }).click();
  await expect(textReview.locator('pre')).toContainText('Last content remains reachable');
  await expect(textReview.getByRole('button', { name: 'Next text part' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Close inline review artifact-1', exact: true }).click();
  await expect(textTrigger).toBeFocused();
  await panel.getByRole('button', { name: 'View artifact-2', exact: true }).click();
  const image = panel.getByRole('img', { name: 'Selected screenshot artifact-2, 32 by 32 pixels', exact: true });
  await expect(image).toBeVisible();
  expect(await image.locator('canvas').evaluate(element => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 32, 32).data)))
    .toEqual(expectedIconPixels());
  await expect(panel.getByRole('button', { name: 'View artifact-5', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'sourceExecuted'))).toBeUndefined();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await image.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`package-review-${theme}-${width}.png`) });
    }
  }
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(requests).toEqual([]);
  await panel.getByRole('button', { name: 'Close package review', exact: true }).click();
  await expect(image).toHaveCount(0);
});

test('oversized decoded images are rejected before native decoding while verified bytes remain downloadable', async ({ page }) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap;
    let calls = 0;
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => { calls++; return Reflect.apply(decode, window, args); }) as typeof createImageBitmap;
    Object.defineProperty(window, 'imageDecodeCount', { get: () => calls });
  });
  const panel = await openPackages(page);
  const { screenshot } = captureReviewFixture();
  const large = Buffer.from(screenshot); large.writeUInt32BE(100_000, 16);
  const built = await makePackage([{ content: large, mediaType: 'image/png' }]);
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(asFile(built.bytes));
  await panel.getByRole('button', { name: 'View artifact-1', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('The original file is unchanged.');
  expect(await page.evaluate(() => Reflect.get(window, 'imageDecodeCount'))).toBe(0);
  await expect(panel.getByRole('img')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Download artifact-1', exact: true })).toBeEnabled();
});

test('selected JSON and opaque files round-trip without requests, redaction or automatic retention', async ({ page }) => {
  const panel = await openPackages(page);
  const before = await readBrowserLocalCollection(page, 'cases');
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
  await panel.getByText('Create a package from files', { exact: true }).click();
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  await panel.getByLabel('Choose evidence files', { exact: true }).setInputFiles([
    { name: 'evidence.json', mimeType: 'application/json', buffer: Buffer.from('{"selected":"retained exactly"}\n') },
    { name: 'capture.png', mimeType: 'image/png', buffer: bytes },
  ]);
  await panel.getByLabel('Declared source for capture.png, selection 2', { exact: true }).fill('Analyst-supplied capture');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download private package' }).click();
  const downloaded = await downloadPromise;
  const archive = Buffer.concat(await (await downloaded.createReadStream()).toArray());
  const inspected = await inspectInvestigationPackage(archive);
  expect(inspected.identityVerified).toBe(true);
  expect(inspected.contents.get('artifact-2')).toEqual(new Uint8Array(bytes));
  expect(new TextDecoder().decode(inspected.contents.get('artifact-1'))).toBe('{"selected":"retained exactly"}\n');
  expect(inspected.manifest).not.toHaveProperty('filenames');
  expect(JSON.stringify(inspected.manifest)).not.toMatch(/evidence\.json|capture\.png|retained exactly/u);
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(asFile(archive));
  await expect(panel.getByRole('heading', { name: 'Evidence package review' })).toBeFocused();
  await expect(panel.getByText('Every file matches its manifest')).toBeVisible();
  await expect(panel.getByText('Analyst-supplied capture', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'View artifact-1', exact: true })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'View artifact-2', exact: true })).toBeEnabled();
  await expect(panel.getByRole('region', { name: /Inline review/u })).toHaveCount(0);
  const restoredPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download artifact-2', exact: true }).click();
  const restored = await restoredPromise;
  expect(restored.suggestedFilename()).toBe('artifact-2.bin');
  expect(Buffer.concat(await (await restored.createReadStream()).toArray())).toEqual(bytes);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(requests).toEqual([]);
  await panel.getByRole('button', { name: 'Close package review' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('heading', { name: 'Evidence package review' })).toHaveCount(0);
  await expect(panel.getByLabel('Review evidence package', { exact: true })).toBeFocused();
});

test('duplicate filenames retain separate accessible source fields and removal controls', async ({ page }) => {
  const panel = await openPackages(page);
  await panel.getByText('Create a package from files', { exact: true }).click();
  await panel.getByLabel('Choose evidence files', { exact: true }).setInputFiles([
    { name: 'evidence.json', mimeType: 'application/json', buffer: Buffer.from('{"copy":1}') },
    { name: 'evidence.json', mimeType: 'application/json', buffer: Buffer.from('{"copy":2}') },
  ]);
  await panel.getByLabel('Declared source for evidence.json, selection 1', { exact: true }).fill('First capture');
  const retained = panel.getByLabel('Declared source for evidence.json, selection 2', { exact: true });
  await retained.fill('Second capture');
  await panel.getByRole('button', { name: 'Remove evidence.json, selection 1', exact: true }).click();
  await expect(retained).toHaveValue('Second capture');
  await expect(panel.getByLabel('Declared source for evidence.json, selection 1', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Remove evidence.json, selection 2', exact: true })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Remove evidence.json, selection 2', exact: true })).toBeFocused();
});

for (const firstUse of [false, true]) test(`workspace package review preserves drafts across ${firstUse ? 'first-use' : 'returning'} workspace import`, async ({ page }) => {
  if (firstUse) {
    await migrateLegacyBrowserData(page, {}, { clearStorage: true, destination: '/dashboard' });
    await page.getByRole('button', { name: /Import existing work/u }).click();
  } else await openPackages(page);
  const panel = page.getByRole('region', { name: 'Package and review evidence files' });
  await panel.getByText('Create a package from files', { exact: true }).click();
  await panel.getByLabel('Package purpose', { exact: true }).fill('Unfinished handoff draft');
  await panel.getByLabel('Choose evidence files', { exact: true }).setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  const before = await readBrowserLocalCollection(page, 'cases');
  const incoming = createCase({ domain: 'imported.example' }, NOW);
  const workspace = await buildWorkspaceArchive({ cases: [incoming] }, { generatedAt: NOW });
  const built = await makePackage([{ content: JSON.stringify(workspace) }]);
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(asFile(built.bytes));
  await expect(panel.getByRole('button', { name: 'Review workspace artifact-1' })).toBeVisible();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await panel.getByRole('button', { name: 'Review workspace artifact-1' }).click();
  await expect(page.getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
  await expect(page.getByRole('heading', { name: firstUse ? 'Import a workspace' : 'Back up or move saved work', exact: true })).toBeFocused();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await page.getByRole('button', { name: 'Add selected data', exact: true }).click();
  const expectedDomains = firstUse ? ['imported.example'] : ['existing.example', 'imported.example'];
  const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: expectedDomains.length, minimumRevision: before.manifest.revision + 1 });
  expect(after.records.map(record => record.value.domain).sort()).toEqual(expectedDomains);
  await expect(page.locator('.workspace-archive .status')).toContainText('Added backup data');
  await expect(page.locator('.workspace-archive .status')).toBeFocused();
  await expect(panel.getByRole('heading', { name: 'Evidence package review' })).toBeVisible();
  await expect(panel.getByLabel('Package purpose', { exact: true })).toHaveValue('Unfinished handoff draft');
  await expect(panel.getByLabel('Declared source for draft.json, selection 1', { exact: true })).toBeVisible();
});

test('every entry is reachable and failed identities never expose a download or workspace action', async ({ page }) => {
  const panel = await openPackages(page);
  const built = await makePackage(Array.from({ length: 10 }, (_, index) => ({ content: new Uint8Array([index]), source: { identity: `Source ${index + 1}`, observedAt: null } })));
  const files = unzipSync(built.bytes);
  files['artifacts/artifact-10'] = new Uint8Array([99]);
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(asFile(zipSync(files)));
  await expect(panel.getByText('Some files were rejected')).toBeVisible();
  await expect(panel.locator('.review-entries > li')).toHaveCount(8);
  await panel.getByRole('button', { name: 'Next entries' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('heading', { name: 'artifact-10', exact: true })).toBeVisible();
  await expect(panel.locator('.review-entries > li')).toHaveCount(2);
  const rejected = panel.locator('.review-entries > li').filter({ has: page.getByRole('heading', { name: 'artifact-10', exact: true }) });
  await expect(rejected.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(rejected.getByRole('button')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Previous entries' }).click();
  await expect(panel.getByRole('heading', { name: 'artifact-1', exact: true })).toBeVisible();
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.alloc(32, 1) });
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Evidence package review' })).toHaveCount(0);
});

test('cancelling or leaving a held package worker cannot reveal an old selection', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    const terminate = Worker.prototype.terminate;
    const held = new Set<Worker>();
    let stopped = 0;
    Worker.prototype.postMessage = function (message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
      const value = message as { kind?: unknown; input?: { file?: unknown } } | null;
      if (value?.kind === 'inspect' && value.input?.file instanceof Blob) { held.add(this); return; }
      return Reflect.apply(original, this, options === undefined ? [message] : [message, options]);
    };
    Worker.prototype.terminate = function () { if (held.delete(this)) stopped++; return terminate.call(this); };
    Object.defineProperty(window, '__packageWorkerProbe', { value: { snapshot: () => ({ held: held.size, stopped }) } });
  });
  const panel = await openPackages(page);
  const built = await makePackage([{ content: '{}' }]);
  const probe = () => page.evaluate(() => (window as unknown as { __packageWorkerProbe: { snapshot(): { held: number; stopped: number } } }).__packageWorkerProbe.snapshot());
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(asFile(built.bytes));
  await expect.poll(probe).toEqual({ held: 1, stopped: 0 });
  await expect(panel.getByRole('heading', { name: 'Evidence package review' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Cancel package processing' }).click();
  await expect.poll(probe).toEqual({ held: 0, stopped: 1 });
  await expect(panel.getByLabel('Review evidence package', { exact: true })).toBeFocused();
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(asFile(built.bytes));
  await expect.poll(probe).toEqual({ held: 1, stopped: 1 });
  await page.locator('a[href="/lookup"]:visible').first().click();
  await expect(page).toHaveURL('/lookup');
  await expect.poll(probe).toEqual({ held: 0, stopped: 2 });
});

test('package composition and review retain usable controls at supported widths in both themes', async ({ page }, testInfo) => {
  const panel = await openPackages(page);
  const built = await makePackage([{ content: '{}', source: { identity: 'Source '.repeat(30), observedAt: null } }, { content: new Uint8Array([0, 255]), mediaType: 'image/png' }]);
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(asFile(built.bytes));
  await expect(panel.getByRole('heading', { name: 'Evidence package review' })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      const heading = panel.getByRole('heading', { name: 'Evidence package review' });
      await heading.focus();
      await expect(heading).toBeFocused();
      await expectNoHorizontalOverflow(page);
      const control = panel.getByRole('button', { name: 'Download artifact-2', exact: true });
      await control.focus();
      await expect(control).toBeInViewport();
      await testInfo.attach(`package-review-${theme}-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
      const create = panel.getByText('Create a package from files', { exact: true });
      await create.click();
      await panel.getByLabel('Choose evidence files', { exact: true }).setInputFiles({ name: 'selected-long-evidence-filename.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
      const source = panel.getByLabel(/^Declared source for selected-long-evidence-filename\.json, selection \d+$/u);
      await panel.getByLabel('Choose evidence files', { exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(source).toBeFocused();
      await expect(source).toBeInViewport();
      await source.fill('Selected source');
      await expect(source).toBeInViewport();
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`package-create-${theme}-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await panel.getByRole('button', { name: /^Remove selected-long-evidence-filename\.json, selection \d+$/u }).click();
      await create.click();
    }
  }
});

test('the complete package payload remains usable through the browser worker without losing any file bytes', async ({ page, browserName }, testInfo) => {
  test.slow();
  const panel = await openPackages(page);
  const sourcePath = testInfo.outputPath('capacity.bin');
  const packagePath = testInfo.outputPath('capacity.zip');
  const source = new Uint8Array(MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES);
  source[0] = 255; source[source.length - 1] = 127;
  await writeFile(sourcePath, source, { flag: 'wx' });
  try {
    await panel.getByText('Create a package from files', { exact: true }).click();
    await panel.getByLabel('Choose evidence files', { exact: true }).setInputFiles(sourcePath);
    const memory = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
    const before = memory ? await memory.send('Runtime.getHeapUsage') : null;
    const probe = await page.evaluateHandle(() => {
      const startedAt = performance.now();
      let frames = 0;
      let animation = 0;
      const next = () => { frames++; animation = requestAnimationFrame(next); };
      animation = requestAnimationFrame(next);
      const tasks: number[] = [];
      const observer = PerformanceObserver.supportedEntryTypes.includes('longtask') ? new PerformanceObserver(list => { for (const item of list.getEntries()) tasks.push(item.duration); }) : null;
      observer?.observe({ type: 'longtask' });
      return { finish: () => {
        cancelAnimationFrame(animation);
        for (const item of observer?.takeRecords() ?? []) tasks.push(item.duration);
        observer?.disconnect();
        return { elapsedMs: performance.now() - startedAt, animationFrames: frames, mainThreadLongTasks: observer ? tasks : null };
      } };
    });
    try {
      const downloadPromise = page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Download private package' }).click();
      const download = await downloadPromise;
      await download.saveAs(packagePath);
      await expect(panel.getByRole('status')).toContainText('Prepared a private package of 1 unchanged file for download');
      await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles(packagePath);
      await expect(panel.getByText('Every file matches its manifest')).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Download artifact-1', exact: true })).toBeEnabled();
      const restoredPromise = page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Download artifact-1', exact: true }).click();
      const restored = await restoredPromise;
      const restoredBytes = Buffer.concat(await (await restored.createReadStream()).toArray());
      expect(restoredBytes.equals(Buffer.from(source))).toBe(true);
      const result = await probe.evaluate(value => value.finish());
      const after = memory ? await memory.send('Runtime.getHeapUsage') : null;
      await testInfo.attach('package-capacity-measurement', { body: JSON.stringify({
        ...result, bytes: source.byteLength, browserName, heapBeforeBytes: before?.usedSize ?? null, heapAfterBytes: after?.usedSize ?? null,
        scope: 'one production browser build, main JavaScript isolate snapshots, not peak or worker/process memory',
        memoryAvailability: memory ? 'Chromium protocol snapshots' : 'unavailable in this engine',
        timingAcceptance: 'informational; includes browser, download and test-host work',
      }), contentType: 'application/json' });
      expect(result.animationFrames).toBeGreaterThan(0);
      await expectNoHorizontalOverflow(page);
    } finally { await probe.evaluate(value => value.finish()); await probe.dispose(); await memory?.detach(); }
  } finally { await rm(sourcePath, { force: true }); await rm(packagePath, { force: true }); }
});
