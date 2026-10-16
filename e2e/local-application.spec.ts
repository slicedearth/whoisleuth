import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { test, expect, openLocalApplication } from './local-application-fixtures';
import { createCase, openCasesView, openCaseResponseWorkspace } from './case-test-fixtures';
import { selectOriginal, openRetainedFiles, FILE_BYTES, FILE_NAME } from './case-attachment-fixtures';
import { downloadWorkspaceArchive, downloadEncryptedWorkspaceArchive, reviewWorkspaceBackup, workspaceArchiveRegion } from './workspace-backup';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { consoleWorkspaceIdentity } from './console-navigation';
import { caseStoreAtCapacity } from '../test/workspace-backup-capacity-fixture.mts';
import { serializeCaseStore } from '../packages/cases/case-storage-model.mts';
import { normalizeCaseStore } from '../packages/cases/case-migration-model.mts';
import { MAX_CASE_STORE_BYTES } from '../packages/contracts/case-portability.mts';
import { MAX_SELECTED_FILE_TOTAL_BYTES } from '../packages/contracts/selected-file-limits.mts';

async function pinForm(page: import('@playwright/test').Page) {
  const workspace = await openCaseResponseWorkspace(page);
  const details = workspace.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  return details.locator('form').first();
}

for (const entry of ['fresh launch', 'already-open login fragment'] as const) {
test(`${entry} clears its token and history before one delayed local session exchange`, async ({ page, localApplication }) => {
  let exchanges = 0;
  let scrubbedBeforeExchange = false;
  let received!: () => void, release!: () => void;
  const requested = new Promise<void>(resolve => { received = resolve; });
  const permitted = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/local-session', async route => {
    exchanges++;
    const location = new URL(page.url());
    scrubbedBeforeExchange = location.pathname === '/login' && location.hash === '';
    received();
    await permitted;
    await route.continue();
  });
  try {
    if (entry === 'fresh launch') await page.goto(localApplication.instance.launchUrl);
    else {
      await page.goto(`${localApplication.instance.origin}/login?next=https%3A%2F%2Foutside.invalid%2F`);
      await expect(page.getByRole('heading', { name: 'Open local workspace', exact: true })).toBeVisible();
      await expect(page.getByRole('status')).toHaveCount(0);
      await page.evaluate(hash => { location.hash = hash; }, new URL(localApplication.instance.launchUrl).hash);
    }
    await requested;
    expect(scrubbedBeforeExchange).toBe(true);
    const token = new URL(localApplication.instance.launchUrl).hash.slice(1);
    expect(await page.evaluate(value => !JSON.stringify(history.state).includes(value), token)).toBe(true);
    expect(exchanges).toBe(1);
    release();
    await expect(page).toHaveURL(`${localApplication.instance.origin}/dashboard`);
    await expect(consoleWorkspaceIdentity(page)).toHaveText('Filesystem workspace');
    expect(exchanges).toBe(1);
  } finally { release(); }
});
}

test('an unconfirmed filesystem recovery write keeps the form and blocks repeat writes until review', async ({ page, localApplication }) => {
  await openLocalApplication(page, localApplication);
  await openCasesView(page); await createCase(page, 'uncertain-recovery.example');
  let form = await pinForm(page);
  let commits = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/local-workspace/commit') commits++; });
  await page.route('**/api/local-workspace/commit', async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    // The real transaction commits, but neither response can prove its digest.
    // A successful HTTP status alone is deliberately insufficient.
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  }, { times: 1 });
  await page.route('**/api/local-workspace/receipt/*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await form.getByLabel('Label', { exact: true }).fill('Committed recovery copy');
  await expect(form.getByRole('status')).toContainText('The write may have succeeded');
  await expect(form.getByRole('button', { name: 'Retry recovery save', exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Discard this draft', exact: true })).toBeDisabled();
  await page.clock.install();
  await form.getByLabel('Fact', { exact: true }).fill('Later text remains only in this form');
  await page.clock.fastForward(1000);
  await form.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('The write may have succeeded');
  await expect(form.getByLabel('Fact', { exact: true })).toHaveValue('Later text remains only in this form');
  expect(commits).toBe(1);
  await page.unroute('**/api/local-workspace/receipt/*');
  page.once('dialog', dialog => dialog.accept());
  await form.getByRole('button', { name: 'Reload and review saved records', exact: true }).click();
  form = await pinForm(page);
  await form.getByText('1 saved draft for this form', { exact: true }).click();
  await form.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('Committed recovery copy');
  await expect(form.getByLabel('Fact', { exact: true })).toHaveValue('');
  expect(commits).toBe(1);
});

test('a filesystem Case tag batch commits once and blocks replay after an unknown acknowledgement', async ({ page, localApplication }) => {
  await openLocalApplication(page, localApplication);
  for (const domain of ['first-tags.example', 'second-tags.example']) { await openCasesView(page); await createCase(page, domain); }
  await openCasesView(page); await page.getByText('Organise Case tags', { exact: true }).click();
  const panel = page.getByRole('region', { name: 'Case batch tagging', exact: true });
  const selection = page.getByRole('checkbox', { name: /^Select Case .+ for tag changes$/u });
  await expect(selection).toHaveCount(2); await selection.nth(0).check(); await selection.nth(1).check();
  await panel.getByLabel('Batch tags', { exact: true }).fill('Review later');
  const prepare = panel.getByRole('button', { name: 'Preview exact tag changes', exact: true }); await prepare.click();
  let commits = 0;
  await page.route('**/api/local-workspace/commit', async route => {
    commits++; const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  }, { times: 1 });
  await page.route('**/api/local-workspace/receipt/*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await panel.getByRole('button', { name: 'Apply reviewed tag changes', exact: true }).click();
  await expect(panel.getByRole('status', { name: 'Case tag batch status', exact: true })).toContainText('write outcome is unknown');
  await expect(prepare).toBeDisabled(); await expect(panel.getByRole('button', { name: 'Discard tag draft and selection' })).toBeDisabled();
  await expect(panel.getByLabel('Batch tags', { exact: true })).toHaveValue('Review later'); expect(commits).toBe(1);
  await page.unroute('**/api/local-workspace/receipt/*'); page.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Reload saved Cases', exact: true }).click();
  const list = page.getByRole('region', { name: 'Saved Cases', exact: true });
  await expect(list.getByText('Review later', { exact: true })).toHaveCount(2); expect(commits).toBe(1);
});

test('filesystem records, original files and recovery drafts survive restart and browser-data removal', async ({ page, context, localApplication }) => {
  test.slow();
  await openLocalApplication(page, localApplication);
  await openCasesView(page); await createCase(page, 'filesystem.example');
  const selected = page.url();
  let files = await selectOriginal(page);
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files).toContainText(FILE_NAME);
  let form = await pinForm(page);
  await form.getByLabel('Label', { exact: true }).fill('Unsubmitted local observation');
  await form.getByLabel('Fact', { exact: true }).fill('Recovery text is not submitted evidence.');
  await expect(form.getByRole('status')).toContainText('Draft saved in this workspace');
  await page.goto('/dashboard');
  const backup = await downloadWorkspaceArchive(page);
  expect(backup.content).toContain('filesystem.example');
  expect(backup.content).not.toContain('Recovery text is not submitted evidence.');
  expect(backup.content).not.toContain(localApplication.instance.directory);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await context.clearCookies();
  await localApplication.restart();
  await openLocalApplication(page, localApplication);
  await page.goto(selected); form = await pinForm(page);
  await form.getByText('1 saved draft for this form', { exact: true }).click();
  await form.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(form.getByLabel('Fact', { exact: true })).toHaveValue('Recovery text is not submitted evidence.');
  await form.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await expect(form.getByLabel('Fact', { exact: true })).toHaveValue('');
  files = await openRetainedFiles(page);
  const pending = page.waitForEvent('download');
  await files.getByRole('button', { name: `Download original ${FILE_NAME}`, exact: true }).click();
  expect(Buffer.concat(await (await (await pending).createReadStream()).toArray())).toEqual(FILE_BYTES);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test('encrypted portable backups restore into a fresh filesystem workspace without browser recovery controls', async ({ page, localApplication }) => {
  test.slow();
  await openLocalApplication(page, localApplication);
  await openCasesView(page); await createCase(page, 'restored-filesystem.example');
  await page.goto('/dashboard');
  const password = '<synthetic filesystem backup passphrase>';
  const backup = await downloadEncryptedWorkspaceArchive(page, password);
  expect(backup.content).not.toContain('restored-filesystem.example');
  const previousId = await page.locator('meta[name="whoisleuth-local-workspace"]').getAttribute('content');
  await localApplication.restart(true);
  await openLocalApplication(page, localApplication);
  expect(await page.locator('meta[name="whoisleuth-local-workspace"]').getAttribute('content')).not.toBe(previousId);
  await reviewWorkspaceBackup(page, { name: 'encrypted-workspace.json', mimeType: 'application/json', buffer: Buffer.from(backup.content) });
  const archive = workspaceArchiveRegion(page);
  await archive.getByLabel('Backup passphrase', { exact: true }).fill(password);
  await archive.getByRole('button', { name: 'Unlock and review', exact: true }).click();
  await expect(archive.getByText('Rehearse filesystem recovery', { exact: true })).toBeVisible();
  await expect(archive.getByRole('button', { name: 'Create rehearsal and restore', exact: true })).toHaveCount(0);
  await archive.getByRole('button', { name: 'Add selected data', exact: true }).click();
  await expect(archive.locator(':scope > [role=status]')).toContainText('1 new, 0 existing matches, 0 skipped');
  await openCasesView(page);
  await expect(page.getByText('restored-filesystem.example', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`local session and filesystem workspace use the shared layout in ${theme}`, async ({ page, localApplication }, testInfo) => {
    test.slow();
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Open local workspace', exact: true })).toBeVisible();
    await useTheme(page, theme);
    const viewports = [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1024, height: 768 },
      { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport); await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`local-login-${theme}-${viewport.width}.png`) }); }
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await openLocalApplication(page, localApplication);
    await page.locator('#workspaces > summary').click();
    const workspace = page.getByRole('region', { name: 'Filesystem workspace', exact: true });
    await expect(workspace).toContainText('Offline — network collection disabled');
    await expect(workspace.locator('dl > div').filter({ has: page.getByText('Workspace format at launch', { exact: true }) }).locator('dd')).toHaveText('1');
    await expect(workspace.locator('dl > div').filter({ has: page.getByText('Lock observation', { exact: true }) }).locator('dd')).toHaveText('Unavailable');
    await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toHaveCount(0);
    const operations: string[] = [];
    const observe = (request: import('@playwright/test').Request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/local-workspace/')) operations.push(pathname);
    };
    page.on('request', observe);
    const copied: string[] = [];
    await page.exposeFunction('recordLocalExampleCopy', (value: string) => { copied.push(value); });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (value: string) =>
        (window as unknown as { recordLocalExampleCopy(value: string): Promise<void> }).recordLocalExampleCopy(value) } });
    });
    const guide = workspace.getByText('Use another filesystem workspace', { exact: true }).and(workspace.locator('summary'));
    await guide.focus(); await guide.press('Enter');
    const commands = workspace.locator('.restart-guidance .copyable-command code');
    await expect(commands).toHaveCount(2);
    const examples = await commands.allTextContents();
    expect(examples.every(value => value.includes('./review-workspace') && value.includes('--offline'))).toBe(true);
    expect(examples[0]).not.toContain('--init'); expect(examples[1]).toContain('--init');
    expect(examples.join('\n')).not.toContain(localApplication.instance.directory);
    expect(examples.join('\n')).not.toContain(localApplication.instance.launchUrl);
    await workspace.getByRole('button', { name: 'Copy existing filesystem workspace command', exact: true }).click();
    await expect.poll(() => copied).toEqual([examples[0]]);
    await expect(workspace.getByRole('button', { name: 'Copied existing filesystem workspace command', exact: true })).toBeFocused();
    expect(operations).toEqual([]); page.off('request', observe);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport); await expectNoHorizontalOverflow(page);
      await page.locator('#workspaces > summary').focus();
      await page.locator('#workspaces').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
      const header = await page.locator('.shell > header').boundingBox();
      const heading = await workspace.getByRole('heading', { name: 'Filesystem workspace', exact: true }).boundingBox();
      expect(header).not.toBeNull(); expect(heading).not.toBeNull();
      expect(heading!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`local-workspace-${theme}-${viewport.width}.png`) }); }
      if (captureVisualEvidenceEnabled() && (viewport.width === 320 || viewport.width === 1280)) await workspace.locator('.restart-guidance').screenshot({ path: testInfo.outputPath(`local-restart-guide-${theme}-${viewport.width}.png`) });
      if (viewport.width === 320 || viewport.width === 1280) expect((await new AxeBuilder({ page }).include('.local-workspace').analyze()).violations).toEqual([]);
    }
    const link = workspace.getByRole('link', { name: 'Local application setup and recovery', exact: true });
    await link.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Console with a filesystem workspace', exact: true })).toBeInViewport();
  });
}

test('temporary restart references stay private, nonexecuting and clear with the workspace panel', async ({ page, localApplication }, testInfo) => {
  await openLocalApplication(page, localApplication);
  await page.locator('#workspaces > summary').click();
  const workspace = page.getByRole('region', { name: 'Filesystem workspace', exact: true });
  await expect(workspace).toContainText(localApplication.instance.directory);
  const shortlist = workspace.locator('.temporary-workspace-shortlist');
  await shortlist.locator(':scope > summary').focus(); await shortlist.locator(':scope > summary').press('Enter');
  const enabled = shortlist.getByRole('checkbox', { name: 'Use temporary folder references', exact: true });
  await expect(enabled).not.toBeChecked();
  const operations: string[] = [];
  const observe = (request: import('@playwright/test').Request) => { if (new URL(request.url()).pathname.startsWith('/api/local-workspace/')) operations.push(new URL(request.url()).pathname); };
  page.on('request', observe);
  await enabled.check();
  await shortlist.getByRole('button', { name: 'Add displayed launch folder', exact: true }).click();
  await shortlist.getByRole('textbox', { name: 'Reference label', exact: true }).fill('Separate review');
  await shortlist.getByRole('textbox', { name: 'Supplied folder reference', exact: true }).fill('./operator-selected review');
  await shortlist.getByRole('button', { name: 'Add supplied reference', exact: true }).click();
  await expect(shortlist.locator('ol > li')).toHaveCount(2);
  const declared = shortlist.locator('ol > li').first();
  await expect(declared).toContainText('Format/version: Not checked · Lock observation: Unavailable');
  await expect(shortlist.locator('ol > li').last()).toContainText('Format/version: 1 (validated at launch) · Lock observation: Unavailable');
  await expect(declared.locator('code')).not.toBeVisible();
  await declared.getByText('Reveal supplied path', { exact: true }).click();
  await expect(declared.locator('code')).toHaveText('./operator-selected review');
  const removeReference = declared.getByRole('button', { name: /^Remove from shortlist/u });
  await expect(removeReference).toHaveAccessibleName('Remove from shortlist — Separate review');
  await expect(removeReference).not.toHaveAccessibleName(/operator-selected/u);
  await page.emulateMedia({ media: 'print' }); await expect(shortlist).not.toBeVisible(); await page.emulateMedia({ media: null });
  await removeReference.click();
  await expect(shortlist.getByRole('heading', { name: 'Restart references in this page', exact: true })).toBeFocused();
  await expect(shortlist.locator('ol > li')).toHaveCount(1);
  await shortlist.getByRole('button', { name: 'Clear shortlist', exact: true }).click();
  await expect(shortlist.locator('ol > li')).toHaveCount(0);
  await shortlist.getByRole('button', { name: 'Add displayed launch folder', exact: true }).click();
  await enabled.uncheck(); await enabled.check(); await expect(shortlist.locator('ol > li')).toHaveCount(0);
  await shortlist.getByRole('button', { name: 'Add displayed launch folder', exact: true }).click();
  await shortlist.getByRole('textbox', { name: 'Supplied folder reference', exact: true }).fill('./unfinished');
  await page.locator('#workspaces > summary').click(); await page.locator('#workspaces > summary').click();
  await expect(enabled).not.toBeChecked(); await enabled.check();
  await expect(shortlist.locator('ol > li')).toHaveCount(0);
  await expect(shortlist.getByRole('textbox', { name: 'Supplied folder reference', exact: true })).toHaveValue('');
  await shortlist.getByRole('button', { name: 'Add displayed launch folder', exact: true }).click();
  const longPath = `./${'segment/'.repeat(480)}selected`;
  for (let index = 1; index <= 4; index++) {
    await shortlist.getByRole('textbox', { name: 'Reference label', exact: true }).fill(index === 4 ? `Long ${'reference'.repeat(10)}` : `Review ${index}`);
    await shortlist.getByRole('textbox', { name: 'Supplied folder reference', exact: true }).fill(index === 4 ? longPath : `./review-${index}`);
    await shortlist.getByRole('button', { name: 'Add supplied reference', exact: true }).click();
  }
  await expect(shortlist.locator('ol > li')).toHaveCount(5);
  await shortlist.locator('ol > li').first().getByText('Reveal supplied path', { exact: true }).click();
  await expect(shortlist.locator('ol > li').first().locator('code')).toHaveText(longPath);
  for (const theme of ['light', 'dark'] as const) for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
    await shortlist.locator(':scope > summary').scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.temporary-workspace-shortlist').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`temporary-workspace-${theme}-${width}.png`) });
  }
  expect(operations).toEqual([]); page.off('request', observe);
  expect(await page.evaluate(() => (window as unknown as { __unexpectedBrowserDatabaseCalls: number }).__unexpectedBrowserDatabaseCalls)).toBe(0);
  await shortlist.locator(':scope > summary').click(); await shortlist.locator(':scope > summary').click();
  await expect(enabled).not.toBeChecked(); await enabled.check(); await expect(shortlist.locator('ol > li')).toHaveCount(0);
  await shortlist.getByRole('button', { name: 'Add displayed launch folder', exact: true }).click();
  await page.goto(`${localApplication.instance.origin}/lookup`); await page.goBack();
  if (!(await page.locator('#workspaces').evaluate(element => (element as HTMLDetailsElement).open))) await page.locator('#workspaces > summary').click();
  if (!(await shortlist.evaluate(element => (element as HTMLDetailsElement).open))) await shortlist.locator(':scope > summary').click();
  await expect(enabled).not.toBeChecked();
  await enabled.check(); await expect(shortlist.locator('ol > li')).toHaveCount(0);
  await shortlist.getByRole('button', { name: 'Add displayed launch folder', exact: true }).click();
  await localApplication.restart(true); await openLocalApplication(page, localApplication);
  await page.locator('#workspaces > summary').click(); await shortlist.locator(':scope > summary').click();
  await expect(enabled).not.toBeChecked(); await enabled.check(); await expect(shortlist.locator('ol > li')).toHaveCount(0);
});

test('a maximum Case collection and retained file reach the filesystem Console without pruning', async ({ page, localApplication }, testInfo) => {
  test.slow();
  await openLocalApplication(page, localApplication);
  await page.goto('/cli');
  const { cases } = caseStoreAtCapacity();
  const bytes = Buffer.alloc(MAX_SELECTED_FILE_TOTAL_BYTES, 83);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const record = cases[0]!;
  record.attachments = [{ id: 'maximum-original', fileName: 'maximum-original.bin', mediaType: 'application/octet-stream',
    source: null, observedAt: null, retainedAt: record.updatedAt, byteLength: bytes.byteLength, digestSha256: `sha256:${digest}` }];
  const extra = Buffer.byteLength(serializeCaseStore(cases)) - MAX_CASE_STORE_BYTES;
  expect(extra).toBeGreaterThan(0);
  const note = cases.flatMap(item => item.notes).find(item => item.body.length > extra)!;
  expect(note).toBeDefined(); note.body = note.body.slice(0, -extra);
  expect(normalizeCaseStore(JSON.parse(serializeCaseStore(cases))).cases).toEqual(cases);
  expect(Buffer.byteLength(serializeCaseStore(cases))).toBe(MAX_CASE_STORE_BYTES);
  // Independently populate a valid on-disk fixture. Driver tests separately
  // exercise maximum writes; this test measures actual browser admission.
  const database = new DatabaseSync(path.join(localApplication.instance.directory, 'workspace.sqlite'));
  try {
    const manifest = JSON.parse(String(database.prepare('SELECT manifest FROM collections WHERE id=?').get('cases')!.manifest));
    const rows = cases.map((item, ordinal) => {
      const payload = JSON.stringify({ id: item.id, value: item });
      return [item.id, ordinal, 'json-v1', payload, Buffer.byteLength(payload)];
    });
    manifest.revision++; manifest.recordCount = cases.length; manifest.serializedBytes = MAX_CASE_STORE_BYTES;
    manifest.digest = createHash('sha256').update(JSON.stringify(rows)).digest('base64url'); manifest.source = 'application';
    database.exec('BEGIN IMMEDIATE');
    database.prepare('DELETE FROM records WHERE collection=?').run('cases');
    database.prepare('UPDATE collections SET manifest=? WHERE id=?').run(JSON.stringify(manifest), 'cases');
    const insert = database.prepare('INSERT INTO records(collection,key,ordinal,payload,bytes) VALUES(?,?,?,?,?)');
    for (const row of rows) insert.run('cases', String(row[0]), Number(row[1]), String(row[3]), Number(row[4]));
    database.prepare('INSERT INTO files(key,content) VALUES(?,?)').run(`sha256:${digest}`, bytes);
    database.exec('COMMIT');
  } finally { database.close(); }
  await page.goto(`/cases?case=${record.id}`);
  await expect(page.getByRole('heading', { name: record.domain, exact: true })).toBeVisible({ timeout: 30_000 });
  const browserElapsedAtVerifiedRender = await page.evaluate(() => performance.now());
  const files = await openRetainedFiles(page);
  await expect(files).toContainText('maximum-original.bin');
  const pending = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download original maximum-original.bin', exact: true }).click();
  const downloaded = Buffer.concat(await (await (await pending).createReadStream()).toArray());
  expect(downloaded.byteLength).toBe(MAX_SELECTED_FILE_TOTAL_BYTES);
  expect(createHash('sha256').update(downloaded).digest('hex')).toBe(digest);
  await testInfo.attach('filesystem-maximum-observation', { contentType: 'application/json', body: JSON.stringify({
    cases: cases.length, caseBytes: MAX_CASE_STORE_BYTES, retainedFileBytes: downloaded.byteLength,
    browserElapsedAtVerifiedRender, interpretation: 'Browser elapsed time at the host assertion, not a universal performance threshold or peak-memory measurement.',
  }) });
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});
