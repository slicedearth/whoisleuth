import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { caseRecord, openCaseResponseWorkspace, openSeededTimelineCase } from './case-test-fixtures';
import { currentActionFixture, openPacketWizardStep } from './case-response-fixtures';
import { openRetainedFiles, storedFiles } from './case-attachment-fixtures';
import { expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';
import { inspectInvestigationPackage } from '../packages/investigation/investigation-package.mts';

const original = Buffer.from('{"observation":"Exact recipient fixture bytes"}\n');
async function prepareReview(page: Page) {
  const now = '2000-01-03T00:00:00.000Z'; await page.clock.setFixedTime(now);
  const record = caseRecord({ id: 'recipient-files', domain: 'recipient-files.example', actions: [currentActionFixture({
    id: 'recipient-action', type: 'internal_review', recipient: 'Internal review desk', contactSource: 'Analyst supplied', routeObservedAt: now,
    contactLimitations: [], dueAt: null, targetState: 'ready_for_review', reference: null, followUpAt: null, outcome: null, createdAt: now, updatedAt: now,
  })] });
  await openSeededTimelineCase(page, record.domain, [record]);
  const files = await openRetainedFiles(page);
  await files.getByLabel('Choose original files', { exact: true }).setInputFiles([
    { name: 'selected.json', mimeType: 'application/json', buffer: original },
    { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"other":"not selected"}') },
  ]);
  await files.getByLabel('Source', { exact: true }).fill('Recipient fixture source');
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files.getByRole('button', { name: 'Download original selected.json', exact: true })).toBeVisible();
  const before = await readBrowserLocalCollection(page, 'cases');
  const selected = before.records[0]!.value.attachments!.find(file => file.fileName === 'selected.json')!;
  const workspace = await openCaseResponseWorkspace(page, '', 'advanced', 'Response');
  const packet = workspace.locator('details[id^="case-response-preflight-"]'); await packet.locator(':scope > summary').click();
  await packet.getByLabel('Abuse category', { exact: true }).fill('Review');
  await packet.getByLabel('Affected party', { exact: true }).fill('Example organisation');
  await packet.getByLabel('Observed at', { exact: true }).fill('2000-01-03T00:00');
  await packet.getByLabel(/Exact abusive HTTP/).fill('https://recipient-files.example/page');
  await packet.getByLabel('Observed harm', { exact: true }).fill('A source-qualified observation for manual review.');
  await openPacketWizardStep(packet, 'Review');
  const reference = packet.getByRole('group', { name: 'Optional integrity-checked capture reference', exact: true });
  await reference.getByLabel('Label', { exact: true }).fill('selected.json');
  await reference.getByLabel('Captured at', { exact: true }).fill('2000-01-03T00:00');
  await reference.getByLabel('SHA-256 digest', { exact: true }).fill(selected.digestSha256.slice(7));
  await packet.getByText('Prepare original files separately · 2 retained references', { exact: true }).click();
  const review = packet.getByRole('region', { name: 'Recipient file preparation', exact: true });
  return { packet, reference, review, before, selected };
}

async function changeStoredFile(page: Page, bytes: readonly number[], kind: 'remove' | 'corrupt') {
  await page.evaluate(async ({ bytes, kind }) => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = database.transaction('files', 'readwrite'), store = transaction.objectStore('files'), rows = store.getAll();
      let found = false;
      rows.onsuccess = () => {
        for (const row of rows.result) {
          const content = new Uint8Array(row.payload);
          if (content.length !== bytes.length || !content.every((value, index) => value === bytes[index])) continue;
          found = true;
          if (kind === 'remove') store.delete(row.key); else store.put({ ...row, payload: new Uint8Array(content.length).fill(65).buffer });
        }
      };
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
      if (!found) throw new Error('Synthetic file was not present.');
    } finally { database.close(); }
  }, { bytes: [...bytes], kind });
}

test('recipient file preparation distinguishes references from verified bytes and exports only deliberate selections', async ({ page }, testInfo) => {
  const { packet, reference, review, before, selected } = await prepareReview(page);
  const first = review.getByRole('checkbox', { name: /^selected\.json/ }), other = review.getByRole('checkbox', { name: /^other\.json/ });
  await expect(review).toContainText('1 packet capture reference without an exact retained-file match');
  await expect(first).toBeEnabled(); await expect(other).toBeEnabled();
  await expect(review.getByRole('button', { name: 'Check selected originals', exact: true })).toBeDisabled();
  await reference.getByLabel('Byte length', { exact: true }).fill(String(selected.byteLength + 1));
  await expect(review).toContainText('without an exact retained-file match');
  await reference.getByLabel('Byte length', { exact: true }).fill(String(selected.byteLength));
  await expect(review).not.toContainText('without an exact retained-file match');
  await expect(review.getByText('1 exact packet capture reference', { exact: true })).toBeVisible();
  await changeStoredFile(page, [...Buffer.from('{"other":"not selected"}')], 'remove');
  const bodies = await storedFiles(page);
  await first.check();
  await expect(review.getByRole('button', { name: 'Download private package', exact: true })).toHaveCount(0);
  await review.getByRole('button', { name: 'Check selected originals', exact: true }).click();
  await expect(review.getByRole('status', { name: 'Recipient original-file check', exact: true })).toContainText('1 reference · 1 verified · 0 missing · 0 unverified');
  await expect(review.locator('.check-context time')).toHaveAttribute('datetime', '2000-01-03T00:00:00.000Z');
  await expect(review.locator('.check-comparison')).toHaveCount(0);
  await expect(other).toHaveAccessibleName(/Not checked/u);
  await other.check();
  await expect(review.getByRole('button', { name: 'Download private package', exact: true })).toHaveCount(0);
  await page.clock.setFixedTime('2000-01-03T00:01:00.000Z');
  await review.getByRole('button', { name: 'Check all Case originals', exact: true }).click();
  await expect(review.getByRole('status', { name: 'Recipient original-file check', exact: true })).toContainText('1 verified · 1 missing · 0 unverified');
  await expect(review.locator('.check-context time')).toHaveAttribute('datetime', '2000-01-03T00:01:00.000Z');
  await expect(review.locator('.check-comparison')).toContainText('identical references rechecked: 1; changed results: 0; newly checked: 1; earlier references not rechecked: 0');
  await expect(first).toBeChecked(); await expect(other).toBeChecked();
  await expect(other).toHaveAccessibleName(/Missing bytes/u);
  await expect(review.getByRole('button', { name: 'Download private package', exact: true })).toHaveCount(0);
  await other.uncheck(); await expect(review).toContainText('1 selected · 1 not selected');
  const download = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Download private package', exact: true }).click();
  const result = await download, inspected = await inspectInvestigationPackage(await readFile((await result.path())!));
  expect(inspected.identityVerified).toBe(true); expect(inspected.entries).toHaveLength(1);
  expect(Buffer.from(inspected.contents.get('artifact-1')!)).toEqual(original);
  expect(inspected.manifest.artifacts[0]).toMatchObject({ contentDigestSha256: selected.digestSha256, source: { identity: selected.source, observedAt: selected.observedAt } });
  for (const excluded of ['recipient-files.example', 'Internal review desk', 'other.json', 'selected.json']) expect(JSON.stringify(inspected.manifest)).not.toContain(excluded);
  await expect(packet.getByRole('button', { name: 'Continue to record delivery' })).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await storedFiles(page)).toEqual(bodies);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 }); await expectNoHorizontalOverflow(page);
      const layout = await review.evaluate(element => {
        const describe = (node: Element) => { const box = node.getBoundingClientRect(); const css = getComputedStyle(node); return { tag: node.tagName, class: node.className, left: box.left, right: box.right, width: box.width, grid: css.gridTemplateColumns, minWidth: css.minWidth, overflow: css.overflowX }; };
        const ancestors = []; for (let node: Element | null = element; node; node = node.parentElement) ancestors.push(describe(node));
        return { ancestors, viewport: innerWidth };
      });
      expect(layout.ancestors[0]!.right, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
    }
    await page.setViewportSize({ width: theme === 'light' ? 320 : 1280, height: 900 });
    const check = review.getByRole('button', { name: 'Check all Case originals', exact: true });
    await check.focus(); await expect(check).toBeFocused();
    expect(await check.evaluate(element => { const box = element.getBoundingClientRect(); const navigation = document.querySelector('.case-sections')!.getBoundingClientRect(); return box.top > navigation.bottom && box.bottom < innerHeight; })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`recipient-files-${theme}.png`) });
    expect((await new AxeBuilder({ page }).include('.packet-files').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
  await changeStoredFile(page, [...original], 'corrupt');
  await page.clock.setFixedTime('2000-01-03T00:02:00.000Z');
  await review.getByRole('button', { name: 'Check selected originals', exact: true }).click();
  await expect(review.getByRole('status', { name: 'Recipient original-file check', exact: true })).toContainText('0 verified · 0 missing · 1 unverified');
  await expect(review.locator('.check-comparison')).toContainText('identical references rechecked: 1; changed results: 1; newly checked: 0; earlier references not rechecked: 1');
  await expect(review).toContainText('Check result changed: verified → unverified');
  await expect(other).toHaveAccessibleName(/Not checked/u);
  await expect(first).toHaveAccessibleName(/Unverified bytes/u);
  await expect(review.getByRole('button', { name: 'Download private package', exact: true })).toHaveCount(0);
  await reference.getByLabel('Label', { exact: true }).fill('Changed capture declaration');
  await expect(first).toHaveAccessibleName(/Not checked/u); await expect(first).not.toBeChecked();
  await expect(review.locator('.check-context, .check-comparison')).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});

async function holdOriginalRead(page: Page) {
  return page.evaluateHandle(expected => {
    const originalDigest = SubtleCrypto.prototype.digest;
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    SubtleCrypto.prototype.digest = async function(algorithm, input) {
      const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
      const matches = bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
      if (matches) { SubtleCrypto.prototype.digest = originalDigest; entered(); }
      const result = await originalDigest.call(this, algorithm, input); if (matches) await held; return result;
    };
    return { wait: () => started, release: () => { SubtleCrypto.prototype.digest = originalDigest; release(); } };
  }, [...original]);
}

test('closing recipient preparation discards a late real byte check and cannot restore selections', { tag: '@timing-sensitive' }, async ({ page }) => {
  const { packet, review, before } = await prepareReview(page);
  const gate = await holdOriginalRead(page);
  try {
    await review.getByRole('button', { name: 'Check all Case originals', exact: true }).click(); await gate.evaluate(control => control.wait());
    await openPacketWizardStep(packet, 'Prepare'); await openPacketWizardStep(packet, 'Review');
    await packet.getByText('Prepare original files separately · 2 retained references', { exact: true }).click();
    await gate.evaluate(control => control.release());
    await expect(review.getByRole('status', { name: 'Recipient original-file check', exact: true })).toContainText('has not been checked');
    await expect(review.getByRole('checkbox', { name: /^selected\.json/ })).toHaveAccessibleName(/Not checked/u);
    await review.getByRole('button', { name: 'Check all Case originals', exact: true }).click();
    await expect(review.getByRole('status', { name: 'Recipient original-file check', exact: true })).toContainText('2 verified · 0 missing · 0 unverified');
    await review.getByRole('checkbox', { name: /^selected\.json/ }).check();
    await packet.locator(':scope > summary').click(); await packet.locator(':scope > summary').click();
    await packet.getByText('Prepare original files separately · 2 retained references', { exact: true }).click();
    await expect(review.getByRole('checkbox', { name: /^selected\.json/ })).toHaveAccessibleName(/Not checked/u);
    await expect(review.getByRole('checkbox', { name: /^selected\.json/ })).not.toBeChecked();
    expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  } finally { await gate.evaluate(control => control.release()); await gate.dispose(); }
});

test('a pending separate-file export cannot survive closing its review or clear a replacement selection', { tag: '@timing-sensitive' }, async ({ page }) => {
  const { packet, review, before } = await prepareReview(page);
  const check = review.getByRole('button', { name: 'Check all Case originals', exact: true });
  const selected = review.getByRole('checkbox', { name: /^selected\.json/ });
  const download = review.getByRole('button', { name: 'Download private package', exact: true });
  await check.click(); await expect(selected).toHaveAccessibleName(/Verified bytes/u); await selected.check();
  await page.evaluate(() => {
    Reflect.set(window, 'recipientFileDownloads', 0);
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { if (this.download) Reflect.set(window, 'recipientFileDownloads', Number(Reflect.get(window, 'recipientFileDownloads')) + 1); else click.call(this); };
  });
  const gate = await holdOriginalRead(page);
  try {
    await download.click(); await gate.evaluate(control => control.wait());
    await expect(download).toBeDisabled();
    const toggle = packet.getByText('Prepare original files separately · 2 retained references', { exact: true });
    await toggle.click(); await toggle.click();
    await expect(selected).toHaveAccessibleName(/Not checked/u);
    await check.click(); await expect(selected).toHaveAccessibleName(/Verified bytes/u); await selected.check();
    await gate.evaluate(control => control.release());
    await download.click();
    await expect(review.getByRole('status').filter({ hasText: 'Prepared a private package of 1 unchanged file' })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, 'recipientFileDownloads'))).toBe(1);
    await expect(selected).toBeChecked(); await expect(download).toBeEnabled();
    expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  } finally { await gate.evaluate(control => control.release()); await gate.dispose(); }
});

test('changing candidate references cancels the pending original check and only the replacement selection becomes exportable', { tag: '@timing-sensitive' }, async ({ page }) => {
  const { review, before } = await prepareReview(page);
  const first = review.getByRole('checkbox', { name: /^selected\.json/ });
  const other = review.getByRole('checkbox', { name: /^other\.json/ });
  const check = review.getByRole('button', { name: 'Check selected originals', exact: true });
  await first.check();
  await check.click(); await expect(first).toHaveAccessibleName(/Verified bytes/u);
  const completedAt = await review.locator('.check-context time').getAttribute('datetime');
  await page.clock.setFixedTime('2000-01-03T00:01:00.000Z');
  const gate = await holdOriginalRead(page);
  try {
    await check.click(); await gate.evaluate(control => control.wait());
    await expect(review.locator('.check-context time')).toHaveAttribute('datetime', completedAt!);
    await first.uncheck(); await other.check();
    await expect(review.locator('.check-context time')).toHaveAttribute('datetime', completedAt!);
    await check.click();
    await expect(other).toHaveAccessibleName(/Verified bytes/u);
    await expect(review.locator('.check-comparison')).toContainText('identical references rechecked: 0; changed results: 0; newly checked: 1; earlier references not rechecked: 1');
    await expect(review.locator('.check-context time')).toHaveAttribute('datetime', '2000-01-03T00:01:00.000Z');
    await expect(first).toHaveAccessibleName(/Not checked/u);
    await gate.evaluate(control => control.release());
    await expect(review.locator('.check-context time')).toHaveAttribute('datetime', '2000-01-03T00:01:00.000Z');
    await expect(first).not.toBeChecked(); await expect(other).toBeChecked();
    await expect(first).toHaveAccessibleName(/Not checked/u);
    const download = page.waitForEvent('download');
    await review.getByRole('button', { name: 'Download private package', exact: true }).click();
    const result = await download, inspected = await inspectInvestigationPackage(await readFile((await result.path())!));
    expect(inspected.entries).toHaveLength(1);
    expect(Buffer.from(inspected.contents.get('artifact-1')!)).toEqual(Buffer.from('{"other":"not selected"}'));
    expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  } finally { await gate.evaluate(control => control.release()); await gate.dispose(); }
});

for (const mutation of ['remove', 'corrupt'] as const) test(`recipient export rechecks selected original bytes after they ${mutation === 'remove' ? 'disappear' : 'change'}`, async ({ page }) => {
  const { review, before } = await prepareReview(page);
  const first = review.getByRole('checkbox', { name: /^selected\.json/ });
  await first.check();
  await review.getByRole('button', { name: 'Check selected originals', exact: true }).click();
  await expect(first).toHaveAccessibleName(/Verified bytes/u);
  await changeStoredFile(page, [...original], mutation);
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  const exportButton = review.getByRole('button', { name: 'Download private package', exact: true });
  await exportButton.click();
  await expect(review.getByRole('alert')).toBeVisible();
  await expect(exportButton).toBeEnabled();
  expect(downloads).toEqual([]);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});
