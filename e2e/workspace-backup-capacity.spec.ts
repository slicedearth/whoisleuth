import { readFile, rm, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { expect, test } from './fixtures';
import {
  currentBrandProfileBrowserStore, currentBrowserLocalDocument, expectNoHorizontalOverflow,
  migrateLegacyBrowserData, openDashboardSecondaryWorkspaces, readBrowserLocalCollection, useTheme,
} from './helpers';
import { downloadEncryptedWorkspaceArchive, downloadWorkspaceArchive, reviewWorkspaceBackup, workspaceArchiveStatus } from './workspace-backup';
import { beginBrowserInteractionReadiness, readBrowserInteractionReadiness } from './performance-sampling';
import { buildWorkspaceArchive, type WorkspaceArchiveDocument } from '../packages/workspace/workspace-archive.mts';
import { combinedWorkspaceAtCapacity } from '../test/workspace-backup-capacity-fixture.mts';
import { MAX_WORKSPACE_ARCHIVE_BYTES } from '../packages/contracts/case-portability.mts';
import { MAX_DOMAIN_CONTROL_MANIFEST_BYTES } from '../packages/contracts/domain-control-manifest.mts';
import type { BrowserLocalCollectionManifest, BrowserLocalStoredRecord } from '../frontend/src/lib/browser-local-data';

const NOW = '2026-09-09T00:00:00.000Z';

test('workspace export captures one collection snapshot before an interleaved writer', async ({ page }) => {
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [{
      id: 'snapshot-case', domain: 'snapshot.example', status: 'new', disposition: 'unreviewed',
      source: 'manual', tags: ['before'], createdAt: NOW, updatedAt: NOW,
    }] }),
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([{
      id: 'snapshot-profile', name: 'Before profile', createdAt: NOW, updatedAt: NOW,
    }]),
  }, { clearStorage: true, destination: '/dashboard' });
  await openDashboardSecondaryWorkspaces(page);
  const probe = await page.evaluateHandle(async () => {
    const opening = indexedDB.open('whoisleuth-browser-data-v1');
    const peer = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const original = IDBDatabase.prototype.transaction;
    const transaction = original.call(peer, ['records', 'manifests'], 'readonly');
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
    });
    const request = <T,>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
    });
    const rows = await Promise.all(['cases', 'brand_profiles'].map(async (id) => ({
      id,
      manifest: await request<BrowserLocalCollectionManifest>(transaction.objectStore('manifests').get(id)),
      records: await request<BrowserLocalStoredRecord[]>(transaction.objectStore('records').index('collection').getAll(id)),
    })));
    await done;
    for (const row of rows) {
      if (row.records.length !== 1) throw new Error('The interleaving fixture requires one stored record per collection.');
      const record = row.records[0]!;
      const value = JSON.parse(record.payload);
      if (row.id === 'cases') value.value.tags = ['after!'];
      else value.value.name = 'After! profile';
      const payload = JSON.stringify(value);
      if (new TextEncoder().encode(payload).length !== record.payloadBytes) throw new Error('The fixture edit must preserve byte length.');
      row.records = [{ ...record, payload }];
      const content = JSON.stringify(row.records.map((entry) => [entry.lookupKey, entry.ordinal, entry.codec, entry.payload, entry.payloadBytes]));
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)));
      row.manifest = { ...row.manifest, source: 'application', revision: row.manifest.revision + 1,
        digest: btoa(String.fromCharCode(...digest)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '') };
    }
    let armed = false;
    let fired = false;
    let completed = false;
    let failed = false;
    let reads = 0;
    const arm = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.unencrypted-download')) armed = true;
    };
    document.addEventListener('click', arm, true);
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const transaction = original.call(this, stores, mode, options);
      const names = typeof stores === 'string' ? [stores] : Array.from(stores);
      if (armed && this.name === peer.name && (mode === 'readonly' || mode === undefined) && names.includes('records')) {
        reads += 1;
        if (!fired) {
          fired = true;
          const write = original.call(peer, ['records', 'manifests'], 'readwrite');
          for (const row of rows) {
            for (const record of row.records) write.objectStore('records').put(record);
            write.objectStore('manifests').put(row.manifest);
          }
          write.oncomplete = () => { completed = true; };
          write.onabort = () => { failed = true; };
        }
      }
      return transaction;
    };
    return { result: () => ({ fired, completed, failed, reads }), close: () => {
      IDBDatabase.prototype.transaction = original; document.removeEventListener('click', arm, true); peer.close();
    } };
  });
  try {
    const { content } = await downloadWorkspaceArchive(page);
    const archive = JSON.parse(content) as WorkspaceArchiveDocument;
    expect(archive.sections.cases.cases[0]?.tags).toEqual(['before']);
    expect(archive.sections.brandProfiles.profiles[0]?.name).toBe('Before profile');
    await expect.poll(() => probe.evaluate((value) => value.result())).toEqual({ fired: true, completed: true, failed: false, reads: 1 });
    await probe.evaluate((value) => value.close());
    const changedCases = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 2 });
    const changedProfiles = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1, minimumRevision: 2 });
    expect(changedCases.records[0]?.value.tags).toEqual(['after!']);
    expect(changedProfiles.records[0]?.value.name).toBe('After! profile');
  } finally {
    await probe.evaluate((value) => value.close());
    await probe.dispose();
  }
});

test('combined full-capacity stores export and restore through native backup files', async ({ page }) => {
  test.slow();
  const source = combinedWorkspaceAtCapacity();
  const archive = await buildWorkspaceArchive(source, { generatedAt: NOW });
  const sourcePath = test.info().outputPath('capacity-workspace.json');
  const encryptedPath = test.info().outputPath('capacity-encrypted.json');
  await writeFile(sourcePath, JSON.stringify(archive), { flag: 'wx' });
  try {
    await page.goto('/dashboard');
    await reviewWorkspaceBackup(page, sourcePath);
    const preview = page.locator('.workspace-archive .preview');
    await expect(preview.getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
    await expect(preview.locator('li').filter({ hasText: '500 in archive' })).toHaveCount(1);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark'] as const) {
        await useTheme(page, theme);
        const heading = preview.getByRole('heading', { name: 'Choose saved data to add' });
        await heading.evaluate((element) => window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - 96), behavior: 'instant' }));
        await expect(heading).toBeVisible();
        await expect(preview.getByRole('button', { name: 'Add selected data' })).toBeEnabled();
        await expectNoHorizontalOverflow(page);
        await test.info().attach(`backup-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
      }
    }
    await preview.getByRole('button', { name: 'Add selected data' }).click();
    await expect(workspaceArchiveStatus(page)).toContainText(`Added backup data from ${archive.manifest.sectionCount} sections`);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openDashboardSecondaryWorkspaces(page);
    await beginBrowserInteractionReadiness(page, {
      start: { event: 'click', selector: '.unencrypted-download' },
      targets: [
        { selector: '.workspace-archive > [role="status"]', exactText: `Prepared an unencrypted workspace backup with ${archive.manifest.sectionCount} verified data sections. Check the downloaded file.` },
        { selector: '.unencrypted-download', requireEnabled: true },
      ],
    });
    const memory = await page.context().newCDPSession(page);
    const before = await memory.send('Runtime.getHeapUsage');
    const plain = await downloadWorkspaceArchive(page);
    const readiness = await readBrowserInteractionReadiness(page);
    const after = await memory.send('Runtime.getHeapUsage');
    await memory.detach();
    const output = JSON.parse(plain.content) as WorkspaceArchiveDocument;
    expect(Buffer.byteLength(plain.content)).toBeGreaterThan(12 * 1024 * 1024);
    expect(Buffer.byteLength(plain.content)).toBeLessThan(MAX_WORKSPACE_ARCHIVE_BYTES);
    expect(isDeepStrictEqual(output.sections.cases.cases, source.cases)).toBe(true);
    expect(isDeepStrictEqual(output.sections.brandProfiles.profiles, source.brandProfiles)).toBe(true);
    expect(output.sections.bulkSessions.sessions[0]?.results).toHaveLength(2_000);
    expect(isDeepStrictEqual(output.sections.bulkSessions.sessions[0]?.results,
      archive.sections.bulkSessions.sessions[0]!.results.map((row) => ({ ...row, hasActiveBrandProfile: null })))).toBe(true);
    await test.info().attach('backup-capacity-measurement', { body: JSON.stringify({
      ...readiness, bytes: Buffer.byteLength(plain.content), heapBeforeBytes: before.usedSize, heapAfterBytes: after.usedSize,
      memoryScope: 'sampled main JavaScript isolate, not peak or whole-process memory', timingAcceptance: 'informational',
    }), contentType: 'application/json' });
    const passphrase = 'synthetic browser capacity backup phrase';
    const encrypted = await downloadEncryptedWorkspaceArchive(page, passphrase);
    expect(Buffer.byteLength(encrypted.content)).toBeGreaterThan(MAX_DOMAIN_CONTROL_MANIFEST_BYTES);
    await writeFile(encryptedPath, encrypted.content, { flag: 'wx' });
    await migrateLegacyBrowserData(page, {}, { clearStorage: true, destination: '/dashboard' });
    await reviewWorkspaceBackup(page, encryptedPath);
    await expect(workspaceArchiveStatus(page)).toContainText('Encrypted backup selected');
    await page.getByLabel('Backup passphrase').fill(passphrase);
    await page.getByRole('button', { name: 'Unlock and review' }).click();
    await expect(page.locator('.preview').getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
    await page.locator('.preview').getByRole('button', { name: 'Add selected data' }).click();
    await expect(workspaceArchiveStatus(page)).toContainText(`Added backup data from ${archive.manifest.sectionCount} sections`);
    const restored = JSON.parse((await downloadWorkspaceArchive(page)).content) as WorkspaceArchiveDocument;
    expect(isDeepStrictEqual(restored.sections.cases.cases, output.sections.cases.cases)).toBe(true);
    expect(isDeepStrictEqual(restored.sections.brandProfiles.profiles, output.sections.brandProfiles.profiles)).toBe(true);
    expect(isDeepStrictEqual(restored.sections.bulkSessions.sessions, output.sections.bulkSessions.sessions)).toBe(true);
    await expect(page.getByLabel('Backup passphrase')).toHaveCount(0);
    expect(await readFile(sourcePath, 'utf8')).toBe(JSON.stringify(archive));
  } finally {
    await rm(sourcePath, { force: true });
    await rm(encryptedPath, { force: true });
  }
});
