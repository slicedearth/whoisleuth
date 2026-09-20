import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { DEFAULT_DATABASE, directoryRows, indicator, namedDatabase, openArchive, openManager, SELECTION } from './browser-workspace-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, useTheme } from './helpers';
import { downloadEncryptedWorkspaceArchive } from './workspace-backup';
import { createCase } from '../packages/cases/case-model.mts';
import { buildWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { decryptWorkspaceArchive, encryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';
import { createCase as createCaseThroughForm, openCaseResponseWorkspace } from './case-test-fixtures';
import { openCaseSection, openInboxReview } from './console-navigation';
import { FILE_BYTES, FILE_NAME, openRetainedFiles, selectOriginal, storedFiles } from './case-attachment-fixtures';

const WORKSPACE_PASSWORD = '<synthetic workspace fixture>';
const BACKUP_PASSWORD = '<separate archive fixture>';
const DOMAIN = 'private-investigation.example';
const NOTE = 'This retained observation belongs only to the protected fixture.';
const NOW = '2026-09-01T00:00:00.000Z';

test('saved inbox positions protect review drafts and stay outside encrypted portable backups', async ({ page }) => {
  await page.clock.setFixedTime('2026-09-13T10:00:00.000Z');
  await page.goto('/dashboard');
  const row = await createEncrypted(page, 'Encrypted review position'); await unlock(page, row.name);
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await createCaseThroughForm(page, 'private-review.example');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Review inbox', exact: true }).click();
  let item = page.locator('.review-inbox .items > li').first();
  await openInboxReview(item); await item.locator('details.lifecycle-controls > summary').click();
  await item.getByLabel('Rationale', { exact: true }).fill('This unfinished review must remain in the encrypted working workspace.');
  let position = page.locator('.review-session'); await position.locator('summary').click();
  await position.getByRole('button', { name: 'Save current position', exact: true }).click();
  await expect(position.getByRole('status')).toContainText('Review position saved');
  const raw = await storedBytes(page, namedDatabase(row.id));
  expect(raw.manifests.find(manifest => manifest.collection === 'review_session')).toMatchObject({ codec: 'aes-gcm-hmac-v1', recordCount: 1 });
  expect(JSON.stringify(raw)).not.toContain('This unfinished review');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  const backup = await downloadEncryptedWorkspaceArchive(page, BACKUP_PASSWORD);
  const decrypted = await decryptWorkspaceArchive(JSON.parse(backup.content), BACKUP_PASSWORD);
  expect(JSON.stringify(decrypted)).not.toContain('This unfinished review');
  expect(JSON.stringify(decrypted)).not.toContain('review_session');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Review inbox', exact: true }).click();
  await expect(page).toHaveURL(/\/monitor(?:\?|$)/u);
  await expect(page.locator('.review-session')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await expect(page.locator('.review-session')).toHaveCount(0);
  await unlock(page, row.name);
  position = page.locator('.review-session'); await position.locator('summary').click();
  await position.getByRole('button', { name: 'Resume saved review', exact: true }).click();
  item = page.locator('.review-inbox .items > li').first();
  await item.locator('details.lifecycle-controls > summary').click();
  await expect(item.getByLabel('Rationale', { exact: true })).toHaveValue('This unfinished review must remain in the encrypted working workspace.');
});

test('retained original bytes use the encrypted workspace keys and remain unavailable while locked', async ({ page }) => {
  await page.goto('/dashboard');
  const row = await createEncrypted(page, 'Protected original files'); await unlock(page, row.name);
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await createCaseThroughForm(page, 'encrypted-file.example');
  let files = await selectOriginal(page);
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true })).toBeVisible();
  const persisted = await storedFiles(page, namedDatabase(row.id));
  expect(persisted).toHaveLength(1);
  expect(persisted[0]!.codec).toBe('aes-gcm-hmac-v1');
  expect(persisted[0]!.bytes).toHaveLength(FILE_BYTES.length + 28);
  expect(persisted[0]!.bytes).not.toEqual([...FILE_BYTES]);
  expect(persisted[0]!.lookupKey).not.toContain('sha256:');
  for (const secret of [FILE_NAME, 'A deliberately retained original', 'encrypted-file.example']) {
    expect(JSON.stringify(await storedBytes(page, namedDatabase(row.id)))).not.toContain(secret);
    expect(Buffer.from(persisted[0]!.bytes).toString('utf8')).not.toContain(secret);
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true })).toHaveCount(0);
  expect(await storedFiles(page, namedDatabase(row.id))).toEqual(persisted);
  await unlock(page, row.name); files = await openRetainedFiles(page);
  await files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true }).click();
  await expect(files.locator('pre')).toContainText('A deliberately retained original');
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('pre')).toHaveCount(0);
  expect(await storedFiles(page, namedDatabase(row.id))).toEqual(persisted);
});

async function createEncrypted(page: Page, name: string) {
  const panel = await openManager(page);
  await panel.getByLabel('New workspace name', { exact: true }).fill(name);
  await panel.getByRole('checkbox', { name: 'Encrypt saved workspace records', exact: true }).check();
  await panel.getByLabel('New workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByLabel('Repeat workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  const row = (await directoryRows(page)).find(item => item.name === name);
  expect(row).toBeDefined();
  await panel.getByRole('button', { name: `Open workspace ${name}`, exact: true }).click();
  await Promise.all([page.waitForEvent('load'), panel.getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
  await expect(page.getByRole('heading', { name: `Unlock ${name}`, exact: true })).toBeVisible();
  return row!;
}

async function unlock(page: Page, name: string) {
  await page.getByLabel('Workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(indicator(page)).toHaveText(name);
}

async function storedBytes(page: Page, databaseName: string) {
  return page.evaluate(async name => {
    const opened = indexedDB.open(name);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    try {
      const tx = db.transaction(['records', 'manifests']);
      const records = tx.objectStore('records').getAll();
      const manifests = tx.objectStore('manifests').getAll();
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      return { records: records.result as { payload: string; lookupKey: string; codec: string }[], manifests: manifests.result as { codec: string; collection: string; recordCount: number; revision: number }[], session: { ...sessionStorage }, local: { ...localStorage } };
    } finally { db.close(); }
  }, databaseName);
}

async function recoveryPinForm(page: Page) {
  await openCaseResponseWorkspace(page); await openCaseSection(page, 'Evidence');
  const form = page.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await form.getAttribute('open') === null) await form.locator(':scope > summary').click();
  return form;
}

async function replacementForm(page: Page, name: string) {
  const manager = await openManager(page), copy = manager.locator('.workspace-copy');
  await copy.locator(':scope > summary').click();
  await copy.getByLabel('Replacement workspace name', { exact: true }).fill(name);
  await copy.getByLabel('Replacement passphrase', { exact: true }).fill(BACKUP_PASSWORD);
  await copy.getByLabel('Confirm replacement passphrase', { exact: true }).fill(BACKUP_PASSWORD);
  return copy;
}

for (const encryptedSource of [false, true]) {
  test(`workspace lifecycle copies ${encryptedSource ? 'encrypted' : 'unencrypted'} saved work and originals without changing the source`, async ({ page }, testInfo) => {
    test.slow(); // Complete copy, key separation, recovery and responsive presentation.
    await page.goto('/dashboard');
    const source = encryptedSource ? await createEncrypted(page, 'Source protected workspace') : null;
    if (source) await unlock(page, source.name);
    await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
    await createCaseThroughForm(page, 'replacement-source.example');
    const selectedCaseUrl = page.url();
    let originals = await selectOriginal(page);
    await originals.getByRole('button', { name: 'Retain selected files', exact: true }).click();
    await expect(originals.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true })).toBeVisible();
    let draft = await recoveryPinForm(page);
    await draft.getByLabel('Label', { exact: true }).fill('Retain this unfinished private draft');
    await draft.getByLabel('Fact', { exact: true }).fill('This unsubmitted fact must survive the encrypted replacement.');
    await expect(draft.getByRole('status')).toContainText('Draft saved in this workspace');
    await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
    const sourceDatabase = source ? namedDatabase(source.id) : DEFAULT_DATABASE;
    const before = await storedBytes(page, sourceDatabase), sourceFiles = await storedFiles(page, sourceDatabase);
    const copy = await replacementForm(page, 'Verified encrypted replacement');
    if (encryptedSource) {
      for (const theme of ['light', 'dark'] as const) {
        await useTheme(page, theme);
        for (const width of [320, 390, 1024, 1280, 1920, 2560, 3840]) {
          await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
          await copy.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
          const controls = copy.locator('input,button'); expect(await controls.count()).toBeGreaterThan(0);
          expect(await controls.evaluateAll(elements => elements.every(element => {
            const box = element.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= innerWidth + 1;
          }))).toBe(true);
          await copy.screenshot({ path: testInfo.outputPath(`replacement-${theme}-${width}.png`) });
        }
        expect((await new AxeBuilder({ page }).include('.workspace-copy').analyze()).violations).toEqual([]);
      }
    }
    const start = copy.getByRole('button', { name: 'Create and verify encrypted copy', exact: true });
    await start.focus(); await page.keyboard.press('Enter');
    await expect(copy.getByRole('status')).toContainText('Encrypted copy verified');
    await expect(copy.getByRole('status')).toBeFocused();
    await expect(copy.locator('.copy-result')).toContainText('1 of 1 originals verified · 0 missing');
    const replacement = (await directoryRows(page)).find(item => item.name === 'Verified encrypted replacement');
    expect(replacement).toBeDefined();
    expect(await page.evaluate(id => navigator.locks.request(`whoisleuth-workspace:whoisleuth-workspace-${id}-v1`, { mode: 'shared', ifAvailable: true }, lock => Boolean(lock)), replacement!.id)).toBe(false);
    const stored = await storedBytes(page, namedDatabase(replacement!.id)), files = await storedFiles(page, namedDatabase(replacement!.id));
    expect(stored.records.length).toBeGreaterThan(0); expect(stored.records.every(item => item.codec === 'aes-gcm-hmac-v1')).toBe(true);
    expect(stored.manifests.find(item => item.collection === 'case_drafts')?.recordCount).toBeGreaterThan(0);
    for (const value of ['replacement-source.example', 'Retain this unfinished', FILE_NAME, WORKSPACE_PASSWORD, BACKUP_PASSWORD]) expect(JSON.stringify(stored)).not.toContain(value);
    expect(files).toHaveLength(1); expect(files[0]!.codec).toBe('aes-gcm-hmac-v1'); expect(files[0]!.bytes).not.toEqual([...FILE_BYTES]);
    const after = await storedBytes(page, sourceDatabase);
    expect(after.records).toEqual(before.records); expect(after.manifests).toEqual(before.manifests); expect(await storedFiles(page, sourceDatabase)).toEqual(sourceFiles);
    await copy.getByRole('button', { name: 'Finish verification and keep copy', exact: true }).click();
    await expect(copy.getByRole('status')).toContainText('The original remains available');
    const manager = await openManager(page);
    await manager.getByRole('button', { name: `Open workspace ${replacement!.name}`, exact: true }).click();
    await Promise.all([page.waitForEvent('load'), manager.getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
    await page.getByLabel('Workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
    await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('incorrect or');
    await page.getByLabel('Workspace passphrase', { exact: true }).fill(BACKUP_PASSWORD);
    await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(indicator(page)).toHaveText(replacement!.name);
    // Same-origin navigation retains the selected workspace; a direct document
    // navigation deliberately requires its passphrase again.
    await page.goto(selectedCaseUrl);
    await page.getByLabel('Workspace passphrase', { exact: true }).fill(BACKUP_PASSWORD);
    await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    originals = await openRetainedFiles(page);
    await originals.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true }).click();
    await expect(originals.locator('pre')).toContainText('A deliberately retained original');
    draft = await recoveryPinForm(page);
    await draft.getByText('1 saved draft for this form', { exact: true }).click();
    await draft.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(draft.getByLabel('Fact', { exact: true })).toHaveValue('This unsubmitted fact must survive the encrypted replacement.');
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });
}

for (const relock of ['manual', 'idle'] as const) test(`workspace lifecycle keeps the active key usable after cancellation and completes a later ${relock} lock`, { tag: '@cross-browser-critical' }, async ({ page }) => {
  await page.goto('/dashboard'); const row = await createEncrypted(page, 'Cancellable lock'); await unlock(page, row.name);
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await createCaseThroughForm(page, 'cancel-lock.example'); const form = await recoveryPinForm(page), url = page.url();
  await failNextBrowserLocalManifestWrite(page, 'case_drafts');
  await form.getByLabel('Label', { exact: true }).fill('Keep this draft after cancelling lock');
  await expect(form.getByRole('status')).toContainText('could not be saved for recovery');
  let cancelled = false;
  page.once('dialog', async dialog => { expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); cancelled = true; });
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect.poll(() => cancelled).toBe(true); await expect(page).toHaveURL(url);
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('Keep this draft after cancelling lock');
  await form.getByRole('button', { name: 'Retry recovery save', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Draft saved in this workspace');
  if (relock === 'idle') {
    await page.clock.install();
    await page.getByRole('combobox', { name: 'Auto-lock', exact: true }).selectOption('5');
    await page.clock.fastForward(300_000);
  } else await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await unlock(page, row.name); const restored = await recoveryPinForm(page);
  await restored.getByText('1 saved draft for this form', { exact: true }).click();
  await restored.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(restored.getByLabel('Label', { exact: true })).toHaveValue('Keep this draft after cancelling lock');
});

test('workspace lifecycle idle lock is opt-in, responds to activity and persists only its tab-local interval', async ({ page }) => {
  await page.goto('/dashboard'); const row = await createEncrypted(page, 'Idle lock fixture'); await unlock(page, row.name);
  const choice = page.getByRole('combobox', { name: 'Auto-lock', exact: true }); await expect(choice).toHaveValue('0');
  await page.clock.install(); await choice.selectOption('5');
  await page.clock.fastForward(240_000); await page.keyboard.press('Shift');
  await page.clock.fastForward(240_000); await expect(indicator(page)).toHaveText(row.name);
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await unlock(page, row.name); await expect(choice).toHaveValue('5');
  const preferences = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.includes('idle-lock')));
  expect(preferences).toHaveLength(1); expect(preferences[0]![1]).toBe('5');
  await choice.selectOption('0');
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.includes('idle-lock')))).toEqual([]);
  await page.clock.fastForward(600_000); await expect(indicator(page)).toHaveText(row.name);
});

test('workspace lifecycle preserves an incomplete destination after its metadata write is refused', async ({ page }) => {
  await page.goto('/cases'); await createCaseThroughForm(page, 'copy-quota.example');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  const before = await storedBytes(page, DEFAULT_DATABASE), copy = await replacementForm(page, 'Incomplete replacement');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put; let pending = true;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (pending && this.name === 'manifests' && value && typeof value === 'object'
        && Reflect.get(value, 'collection') === 'cases' && Reflect.get(value, 'recordCount') > 0
        && this.transaction.db.name.startsWith('whoisleuth-workspace-')) {
        pending = false; throw new DOMException('Synthetic copy quota failure', 'QuotaExceededError');
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await copy.getByRole('button', { name: 'Create and verify encrypted copy', exact: true }).click();
  await expect(copy.getByRole('alert')).toContainText('write outcome is unconfirmed');
  await expect(copy.getByRole('alert')).toBeFocused();
  await expect(copy.getByRole('button', { name: 'Create and verify encrypted copy', exact: true })).toHaveCount(0);
  const created = (await directoryRows(page)).find(item => item.name === 'Incomplete replacement'); expect(created).toBeDefined();
  await copy.getByRole('button', { name: 'Verify encrypted copy', exact: true }).click();
  await expect(copy.getByRole('status')).toContainText('not fully verified');
  await copy.getByRole('button', { name: 'Copy missing originals', exact: true }).click();
  await expect(copy.getByRole('alert')).toContainText('Destination records do not match');
  const after = await storedBytes(page, DEFAULT_DATABASE); expect(after.records).toEqual(before.records); expect(after.manifests).toEqual(before.manifests);
  await copy.getByRole('button', { name: 'Finish verification and keep copy', exact: true }).click();
  expect((await directoryRows(page)).some(item => item.id === created!.id)).toBe(true);
});

test('unfinished Case forms use the encrypted workspace and remain outside its portable backup', async ({ page }) => {
  await page.goto('/dashboard');
  const row = await createEncrypted(page, 'Encrypted draft fixture'); await unlock(page, row.name);
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await createCaseThroughForm(page, 'encrypted-draft.example');
  await openCaseResponseWorkspace(page); await openCaseSection(page, 'Evidence');
  let details = page.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  await details.getByLabel('Label', { exact: true }).fill('Protected unfinished fixture');
  await details.getByLabel('Fact', { exact: true }).fill('This recovery-only sentence must not enter a backup.');
  await expect(details.getByRole('status')).toContainText('Draft saved in this workspace');
  expect(JSON.stringify(await storedBytes(page, namedDatabase(row.id)))).not.toContain('recovery-only sentence');
  await page.reload(); await unlock(page, row.name);
  await openCaseResponseWorkspace(page); await openCaseSection(page, 'Evidence');
  details = page.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  await details.getByText('1 saved draft for this form', { exact: true }).click();
  await details.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(details.getByLabel('Fact', { exact: true })).toHaveValue('This recovery-only sentence must not enter a backup.');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  const { content } = await downloadEncryptedWorkspaceArchive(page, BACKUP_PASSWORD);
  expect(JSON.stringify(await decryptWorkspaceArchive(JSON.parse(content), BACKUP_PASSWORD))).not.toContain('recovery-only sentence');
});

test('encrypted workspace stays locked across reloads and supports a separately encrypted backup round trip', { tag: ['@cross-browser-critical', '@timing-sensitive'] }, async ({ page, context }) => {
  const unexpected: string[] = [];
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) unexpected.push(path); });
  await page.goto('/dashboard');
  const row = await createEncrypted(page, 'Protected investigation');
  await expect(page.locator('#main-content')).toHaveCount(0);
  await page.getByLabel('Workspace passphrase', { exact: true }).fill('incorrect synthetic passphrase');
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect or');
  await expect(page.getByLabel('Workspace passphrase', { exact: true })).toHaveValue('');
  await expect(page.locator('#main-content')).toHaveCount(0);
  await unlock(page, row.name);
  const record = createCase({ domain: DOMAIN }, NOW);
  record.notes = [{ id: 'fixture-note', createdAt: NOW, body: NOTE }];
  const archive = await buildWorkspaceArchive({ cases: [record] }, { generatedAt: NOW });
  const encrypted = await encryptWorkspaceArchive(archive, BACKUP_PASSWORD);
  const panel = await openArchive(page, true);
  await panel.getByLabel('Review backup file', { exact: true }).setInputFiles({ name: 'protected-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(encrypted)) });
  await panel.getByLabel('Backup passphrase', { exact: true }).fill(BACKUP_PASSWORD);
  await panel.getByRole('button', { name: 'Unlock and review', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
  await panel.getByRole('button', { name: 'Add selected data', exact: true }).click();
  await expect(panel.locator('.status')).toContainText('Added backup data');
  const bytes = await storedBytes(page, namedDatabase(row.id));
  expect(bytes.records.length).toBeGreaterThan(0);
  expect(bytes.records.every(item => item.codec === 'aes-gcm-hmac-v1')).toBe(true);
  expect(bytes.manifests.every(item => item.codec === 'aes-gcm-hmac-v1')).toBe(true);
  for (const sensitive of [DOMAIN, NOTE, WORKSPACE_PASSWORD, BACKUP_PASSWORD, record.id]) expect(JSON.stringify(bytes)).not.toContain(sensitive);

  await page.reload();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(DOMAIN);
  expect((await storedBytes(page, namedDatabase(row.id))).records).toEqual(bytes.records);
  await unlock(page, row.name);
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await expect(page.getByText(DOMAIN, { exact: true }).first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  const { content: output } = await downloadEncryptedWorkspaceArchive(page, BACKUP_PASSWORD);
  expect(output).not.toContain(DOMAIN);
  const restored = await decryptWorkspaceArchive(JSON.parse(output), BACKUP_PASSWORD);
  expect(JSON.stringify(await readWorkspaceArchive(restored))).toContain(NOTE);

  const peer = await context.newPage();
  try {
    await peer.addInitScript(({ key, id }) => sessionStorage.setItem(key, id), { key: SELECTION, id: row.id });
    await peer.goto('/dashboard');
    await expect(peer.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
    await expect(peer.locator('body')).not.toContainText(DOMAIN);
  } finally { await peer.close(); }

  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(DOMAIN);
  await unlock(page, row.name);
  await expect(page.getByRole('link', { name: 'Privacy (opens in a new tab)', exact: true })).toHaveAttribute('target', '_blank');
  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/privacy$/u);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(DOMAIN);
  expect(unexpected).toEqual([]);
});

test('missing encrypted collection manifests never create replacement empty data', async ({ page }) => {
  await page.goto('/dashboard');
  const row = await createEncrypted(page, 'Missing-manifest fixture');
  await unlock(page, row.name);
  await page.evaluate(async name => {
    const request = indexedDB.open(name);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = db.transaction('manifests', 'readwrite');
      transaction.objectStore('manifests').delete('cases');
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    } finally { db.close(); }
  }, namedDatabase(row.id));
  await page.reload();
  await page.getByLabel('Workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-error')).toContainText('No empty collections were created');
  await expect(page.locator('#main-content')).toHaveCount(0);
  const records = await storedBytes(page, namedDatabase(row.id));
  expect(records.manifests.every(item => item.codec === 'aes-gcm-hmac-v1')).toBe(true);
  expect(records.manifests.length).toBeGreaterThan(0);
  expect(JSON.stringify(records)).not.toContain('"collection":"cases"');
});

for (const condition of ['empty', 'retained-record', 'retained-file', 'other-missing'] as const) {
  test(`explicit saved-view storage creation preserves an encrypted workspace with ${condition}`, async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    const row = await createEncrypted(page, `Additional storage ${condition}`);
    await unlock(page, row.name);
    await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
    await createCaseThroughForm(page, 'retained-upgrade.example');
    if (condition === 'empty') await useTheme(page, 'system');
    if (condition === 'retained-record') {
      await page.getByRole('link', { name: 'All Cases', exact: true }).click();
      const panel = page.locator('details.saved-views');
      await panel.locator(':scope > summary').click();
      await panel.getByRole('textbox', { name: 'View name', exact: true }).fill('Existing private view');
      await panel.getByRole('button', { name: 'Save as new view', exact: true }).click();
      await expect(panel.getByRole('status')).toContainText('Saved the view');
    }
    await page.evaluate(async ({ name, condition }) => {
      const opened = indexedDB.open(name);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
      try {
        const tx = db.transaction(['manifests', 'files'], 'readwrite');
        tx.objectStore('manifests').delete('case_views');
        if (condition === 'other-missing') tx.objectStore('manifests').delete('cases');
        if (condition === 'retained-file') tx.objectStore('files').put({ key: ['case_views', 'unclaimed-file'], collection: 'case_views', lookupKey: 'unclaimed-file', codec: 'aes-gcm-hmac-v1', payload: new Uint8Array([1, 2, 3]).buffer });
        await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      } finally { db.close(); }
    }, { name: namedDatabase(row.id), condition });
    const snapshot = async () => {
      const { records, manifests } = await storedBytes(page, namedDatabase(row.id));
      return { records, manifests };
    };
    const before = await snapshot();
    const filesBefore = await storedFiles(page, namedDatabase(row.id));
    const directoryBefore = await directoryRows(page);
    await page.reload();
    await page.getByLabel('Workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
    await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browser-local data unavailable', exact: true })).toBeVisible();
    await expect(page.locator('#main-content')).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
    const upgrade = page.locator('.storage-upgrade');
    await upgrade.locator(':scope > summary').click();
    const create = upgrade.getByRole('button', { name: 'Create saved-view storage', exact: true });
    if (condition === 'empty') {
      for (const width of [320, 390, 1024, 1280, 2560]) for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await create.focus();
        await expect(create).toBeFocused();
        await expectNoHorizontalOverflow(page);
        const bounds = await create.evaluate(element => {
          const control = element.getBoundingClientRect();
          const parent = element.closest('.workspace-error')!.getBoundingClientRect();
          return { left: control.left - parent.left, right: control.right - parent.left, width: parent.width, height: control.height };
        });
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.width);
        if (width < 500) expect(bounds.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: testInfo.outputPath(`saved-view-storage-${theme}-${width}.png`) });
      }
      expect((await new AxeBuilder({ page }).include('.workspace-error').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    page.once('dialog', dialog => dialog.dismiss());
    await create.click();
    expect(await snapshot()).toEqual(before);
    if (condition === 'empty') {
      await failNextBrowserLocalManifestWrite(page, 'case_views');
      page.once('dialog', dialog => dialog.accept()); await create.click();
      await expect(page.locator('.workspace-error')).toContainText(/quota|storage|write/iu);
      expect(await snapshot()).toEqual(before);
      // Retry reads normally; it must not inherit the earlier creation approval.
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(page.locator('.workspace-error')).toContainText('No empty collections were created');
      await upgrade.locator(':scope > summary').click();
    }
    page.once('dialog', dialog => dialog.accept()); await create.click();
    if (condition === 'empty') {
      await expect(indicator(page)).toHaveText(row.name);
      await expect(page.locator('#main-content')).toBeFocused();
      const after = await snapshot();
      expect(after.records).toEqual(before.records);
      expect(after.manifests.filter(item => item.collection !== 'case_views')).toEqual(before.manifests);
      expect(after.manifests.find(item => item.collection === 'case_views')).toMatchObject({ codec: 'aes-gcm-hmac-v1', recordCount: 0, revision: 1 });
    } else {
      await expect(page.getByRole('heading', { name: 'Browser-local data unavailable', exact: true })).toBeFocused();
      await expect(page.locator('.workspace-error')).toContainText(condition === 'other-missing' ? 'No empty collections were created' : 'still has retained records or files');
      expect(await snapshot()).toEqual(before);
    }
    expect(await storedFiles(page, namedDatabase(row.id))).toEqual(filesBefore);
    expect(await directoryRows(page)).toEqual(directoryBefore);
  });
}

for (const failure of ['directory', 'initialisation'] as const) test(`a refused encrypted ${failure} write removes only its newly prepared empty database`, async ({ page }) => {
  await page.goto('/dashboard');
  const panel = await openManager(page);
  const before = await page.evaluate(() => indexedDB.databases());
  await page.evaluate(failure => {
    const method = failure === 'directory' ? 'add' : 'put';
    const write = IDBObjectStore.prototype[method];
    let fail = true;
    IDBObjectStore.prototype[method] = function (value: unknown, key?: IDBValidKey) {
      const selected = failure === 'directory' ? this.name === 'workspaces' : this.transaction.db.name.startsWith('whoisleuth-workspace-') && this.name === 'manifests';
      if (selected && fail) { fail = false; throw new DOMException('Workspace quota fixture', 'QuotaExceededError'); }
      return key === undefined ? write.call(this, value) : write.call(this, value, key);
    };
  }, failure);
  await panel.getByLabel('New workspace name', { exact: true }).fill('Uncommitted protected workspace');
  await panel.getByRole('checkbox', { name: 'Encrypt saved workspace records', exact: true }).check();
  await panel.getByLabel('New workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByLabel('Repeat workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText(failure === 'directory' ? 'Workspace quota fixture' : 'Could not save browser-local data');
  await expect(panel.getByLabel('New workspace name', { exact: true })).toHaveValue('Uncommitted protected workspace');
  await expect(panel.getByLabel('New workspace passphrase', { exact: true })).toHaveValue('');
  expect(await directoryRows(page)).toEqual([]);
  expect((await page.evaluate(() => indexedDB.databases())).map(row => row.name).sort()).toEqual(before.map(row => row.name).sort());
  await panel.getByRole('button', { name: 'Refresh workspace directory', exact: true }).click();
  await panel.getByLabel('New workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByLabel('Repeat workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  expect((await directoryRows(page)).length).toBe(1);
});

test('workspace creation and unlock are usable at supported widths in both themes', async ({ page }, testInfo) => {
  await page.goto('/dashboard');
  const panel = await openManager(page);
  await panel.getByRole('checkbox', { name: 'Encrypt saved workspace records', exact: true }).check();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      await expect(panel.getByLabel('New workspace passphrase', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  }
  const row = await createEncrypted(page, 'A deliberately long protected investigation workspace name');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [1280, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
      await expectNoHorizontalOverflow(page);
      await expect(page.getByLabel('Workspace passphrase', { exact: true })).toBeVisible();
      if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`unlock-${theme}-${width}.png`) });
    }
    expect((await new AxeBuilder({ page }).include('.workspace-unlock').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  await page.getByLabel('Workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(indicator(page)).toHaveText(row.name);
});
