import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildCaseExport, createCase, updateCase, type CaseRecord } from '../packages/cases/case-model.mts';
import { currentBrowserLocalDocument, migrateLegacyBrowserData, readBrowserLocalCollection, failNextBrowserLocalManifestWrite, failNextBrowserLocalCollectionReadAfterWrite, expectNoHorizontalOverflow, useTheme } from './helpers';
import { openCaseSection } from './console-navigation';
import { FILE_BYTES, FILE_NAME, selectOriginal, storedFiles } from './case-attachment-fixtures';
import { openDashboardSecondaryWorkspaces } from './helpers';
import { decryptInvestigationPackage, encryptInvestigationPackage } from '../packages/investigation/investigation-package-crypto.mts';
import { buildInvestigationPackage } from '../packages/investigation/investigation-package.mts';
import AxeBuilder from '@axe-core/playwright';

const BEFORE = '2026-08-20T00:00:00.000Z';
const AFTER = '2026-08-22T00:00:00.000Z';
async function seed(page: Page) {
  const current = { ...createCase({ domain: 'review.example', title: 'Independent incident', note: 'Keep the original note',
    evidence: { capturedAt: BEFORE, scanDepth: 'deep', availability: 'registered' },
  }, BEFORE), id: 'review-primary' };
  const other = { ...createCase({ domain: current.domain, title: 'Different incident' }, BEFORE), id: 'review-other' };
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [current, other] }) }, {
    clearStorage: true, destination: '/cases?case=review-primary&section=response',
  });
  const section = page.getByRole('region', { name: 'Review with another analyst', exact: true });
  await section.getByText('Share a copy or review returned entries', { exact: true }).click();
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  return { section, current: saved.records.find(item => item.value.id === current.id)!.value, other: saved.records.find(item => item.value.id === other.id)!.value };
}
function reviewed(current: CaseRecord) {
  let returned = updateCase([current], current.id, { note: 'Returned review note',
    evidencePin: { field: 'web.title', category: 'web', label: 'Page title', value: 'Example account page', source: 'Reviewer supplied capture', observedAt: null, completeness: 'partial' },
  }, AFTER).record;
  returned = updateCase([returned], returned.id, { decision: { summary: 'Check the credential claim', rationale: 'The title is insufficient evidence.', confidence: 'low', evidencePinIds: [returned.evidencePins[0]!.id] } }, AFTER).record;
  const file = buildCaseExport([returned], AFTER);
  file.cases[0]!.notes[0]!.body = 'Conflicting original note';
  file.cases[0]!.status = 'resolved';
  file.cases[0]!.title = 'Do not replace the incident title';
  return file;
}
function upload(value: unknown) { return { name: 'review-return.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) }; }

test('encrypted Case handoff includes selected originals, excludes recovery drafts and verifies returned entries', async ({ page }, testInfo) => {
  test.slow();
  const { section } = await seed(page);
  const files = await selectOriginal(page);
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true })).toBeVisible();
  const pinDetails = page.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await pinDetails.getAttribute('open') === null) await pinDetails.locator(':scope > summary').click();
  const draft = pinDetails.locator('form').first();
  await draft.getByLabel('Label', { exact: true }).fill('Recovery-only handoff canary');
  await expect(draft.getByRole('status')).toContainText('Draft saved in this workspace');
  expect((await readBrowserLocalCollection(page, 'case_drafts', { minimumRecords: 1 })).records).toHaveLength(1);
  await openCaseSection(page, 'Response');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const current = before.records.find(item => item.value.id === 'review-primary')!.value;
  const originalsBefore = await storedFiles(page);
  const handoff = section.getByRole('region', { name: 'Prepare an encrypted handoff', exact: true });
  await expect(handoff.getByRole('checkbox', { name: new RegExp(FILE_NAME.replaceAll('.', '\\.')) })).toBeChecked();
  await handoff.getByRole('button', { name: 'Check handoff contents', exact: true }).click();
  await expect(handoff.getByRole('heading', { name: 'Handoff contents checked', exact: true })).toBeFocused();
  await expect(handoff).toContainText('All referenced originals included');
  const passphrase = 'Encrypted handoff fixture phrase';
  await handoff.getByLabel('Package passphrase', { exact: true }).fill(passphrase);
  await handoff.getByLabel('Confirm package passphrase', { exact: true }).fill('Different fixture phrase');
  const download = handoff.getByRole('button', { name: 'Download encrypted Case handoff', exact: true });
  await download.click(); await expect(handoff.getByRole('alert')).toContainText('do not match');
  await handoff.getByLabel('Confirm package passphrase', { exact: true }).fill(passphrase);
  for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440]] as const) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height }); await useTheme(page, theme);
    await handoff.getByRole('heading', { name: 'Handoff contents checked', exact: true }).scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page); await expect(download).toBeVisible();
    if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`case-handoff-${theme}-${width}.png`) });
  }
  expect((await new AxeBuilder({ page }).include('.review-package').analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 720 });
  const pending = page.waitForEvent('download'); await download.click();
  const downloaded = await pending, encrypted = await readFile((await downloaded.path())!);
  expect(downloaded.suggestedFilename()).toMatch(/\.wlep$/u);
  const decoded = (await decryptInvestigationPackage(encrypted, passphrase)).review;
  expect(decoded.identityVerified).toBe(true); expect(decoded.contents.size).toBe(2);
  const copy = new TextDecoder().decode(decoded.contents.get('artifact-1')!);
  expect(JSON.parse(copy).cases).toEqual([current]); expect(copy).not.toContain('Recovery-only handoff canary');
  expect(Buffer.from(decoded.contents.get('artifact-2')!)).toEqual(FILE_BYTES);
  await expect(handoff.getByRole('status')).toContainText('read-back verification');
  await expect(handoff.getByLabel('Package passphrase', { exact: true })).toHaveValue('');
  await expect(download).toBeFocused();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await storedFiles(page)).toEqual(originalsBefore);
  const originalUrl = page.url();
  await page.goto('/dashboard'); await openDashboardSecondaryWorkspaces(page);
  const packages = page.getByRole('region', { name: 'Package and review evidence files', exact: true });
  await packages.getByLabel('Review evidence package', { exact: true }).setInputFiles({ name: 'review.wlep', mimeType: 'application/octet-stream', buffer: encrypted });
  await packages.getByLabel('Unlock package passphrase', { exact: true }).fill(passphrase);
  await packages.getByRole('button', { name: 'Unlock evidence package', exact: true }).click();
  const completeness = packages.getByRole('region', { name: 'Case handoff completeness', exact: true });
  await expect(completeness).toContainText('1 of 1 original file references have matching bytes');
  const caseDownload = page.waitForEvent('download'); await completeness.getByRole('button', { name: 'Download Case JSON', exact: true }).click();
  expect(JSON.parse(await readFile((await (await caseDownload).path())!, 'utf8')).cases).toEqual([current]);
  await page.goto(originalUrl); await section.getByText('Share a copy or review returned entries', { exact: true }).click();
  const returned = reviewed(current);
  // Unlike the selective JSON fixture, a full handoff must be an exact valid
  // Case. A closed status without a closure record is not a valid full copy.
  returned.cases[0]!.status = 'reviewing';
  const built = await buildInvestigationPackage({ workflow: 'Returned Case review', configurationDigestSha256: null, artifacts: [{ content: JSON.stringify(returned) }, { content: FILE_BYTES, mediaType: 'application/octet-stream' }] }, AFTER, '2.4.0');
  const returnBytes = await encryptInvestigationPackage(built.bytes, passphrase);
  await section.getByLabel('Returned Case package', { exact: true }).setInputFiles({ name: 'returned.wlep', mimeType: 'application/octet-stream', buffer: Buffer.from(returnBytes) });
  const password = section.getByLabel('Unlock package passphrase', { exact: true });
  await password.fill('Incorrect fixture phrase'); await section.getByRole('button', { name: 'Unlock evidence package', exact: true }).click();
  await expect(section.getByRole('status', { name: 'Case review return status' })).toContainText('could not be unlocked');
  await expect(section.getByRole('button', { name: 'Add selected review entries' })).toHaveCount(0);
  await password.fill(passphrase); await section.getByRole('button', { name: 'Unlock evidence package', exact: true }).click();
  await expect(section).toContainText('1 of 1 Case file references have matching bytes');
  await section.getByRole('checkbox', { name: 'Select note Returned review note', exact: true }).check();
  await section.getByRole('button', { name: 'Add selected review entries', exact: true }).click();
  const saved = (await readBrowserLocalCollection(page, 'cases')).records.find(item => item.value.id === current.id)!.value;
  expect(saved.notes.map(note => note.body)).toEqual(['Keep the original note', 'Returned review note']);
  expect(saved.status).toBe(current.status); expect(saved.title).toBe(current.title); expect(saved.actions).toEqual(current.actions);
  expect(saved.attachments).toEqual(current.attachments); expect(await storedFiles(page)).toEqual(originalsBefore);
  expect((await new AxeBuilder({ page }).include('.review-return').analyze()).violations).toEqual([]);
});

test('missing originals and changed selections require an explicit new handoff check', async ({ page }) => {
  const { section } = await seed(page);
  const files = await selectOriginal(page);
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { const tx = database.transaction('files', 'readwrite'); tx.objectStore('files').clear(); await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { database.close(); }
  });
  await openCaseSection(page, 'Response');
  const handoff = section.getByRole('region', { name: 'Prepare an encrypted handoff', exact: true });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  await handoff.getByRole('button', { name: 'Check handoff contents', exact: true }).click();
  await expect(handoff.getByRole('alert')).toContainText('original bytes are missing');
  await expect(handoff.getByRole('button', { name: 'Download encrypted Case handoff', exact: true })).toHaveCount(0);
  await handoff.getByRole('checkbox', { name: new RegExp(FILE_NAME.replaceAll('.', '\\.')) }).uncheck();
  await handoff.getByRole('button', { name: 'Check handoff contents', exact: true }).click();
  await expect(handoff).toContainText('Partial file selection');
  await handoff.getByRole('checkbox', { name: new RegExp(FILE_NAME.replaceAll('.', '\\.')) }).check();
  await expect(handoff.getByRole('alert')).toContainText('Case or selection changed');
  await expect(handoff.getByRole('button', { name: 'Download encrypted Case handoff', exact: true })).toBeDisabled();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});

test('full review copy and selective return preserve write failure, dependency and post-commit boundaries', async ({ page }) => {
  const { section, current, other } = await seed(page);
  let lookupRequests = 0;
  await page.route('**/api/lookup**', async route => { lookupRequests++; await route.abort(); });
  await section.getByText('Unencrypted Case-only copy', { exact: true }).click();
  const pendingDownload = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Export this Case for review', exact: true }).click();
  const download = await pendingDownload;
  const copy = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(copy.cases).toEqual([current]);
  const file = reviewed(current);
  await section.getByLabel('Returned Case file (JSON)', { exact: true }).setInputFiles(upload(file));
  await expect(section.getByRole('status', { name: 'Case review return status' })).toContainText('3 new entries and 1 conflict');
  await expect(section.getByText('Note · Conflicting content — not selectable', { exact: true })).toBeVisible();
  const decision = section.getByRole('checkbox', { name: 'Select decision Check the credential claim', exact: true });
  await decision.check();
  const apply = section.getByRole('button', { name: 'Add selected review entries', exact: true });
  await expect(apply).toBeDisabled();
  await expect(section.getByRole('alert')).toContainText('linked evidence first');
  await section.getByRole('checkbox', { name: 'Select evidence pin Page title: Example account page', exact: true }).check();
  await section.getByRole('checkbox', { name: 'Select note Returned review note', exact: true }).check();
  await openCaseSection(page, 'History');
  await openCaseSection(page, 'Response');
  await expect(decision).toBeChecked();
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await apply.click();
  await expect(apply).toBeEnabled();
  await expect(decision).toBeChecked();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 })).records.find(item => item.value.id === current.id)!.value).toEqual(current);
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await apply.click();
  await expect(section.getByRole('status', { name: 'Case review return status' })).toContainText('Selected review entries were saved.');
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('The change was saved, but Cases could not be reread.');
  await expect(section.getByRole('heading', { name: 'Review with another analyst', exact: true })).toBeFocused();
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const result = saved.records.find(item => item.value.id === current.id)!.value;
  expect(saved.records.find(item => item.value.id === other.id)!.value).toEqual(other);
  expect(result.notes.map(note => note.body)).toEqual(['Keep the original note', 'Returned review note']);
  expect(result.evidencePins[0]?.observedAt).toBeNull();
  expect(result.evidencePins[0]?.createdAt).toBe(AFTER);
  expect(result.decisions).toHaveLength(1);
  expect(result.status).toBe(current.status);
  expect(result.title).toBe(current.title);
  expect(result.evidenceHistory).toEqual(current.evidenceHistory);
  expect(result.manualTrail.at(-1)?.target).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(result.manualTrail.at(-1)?.summary).toContain('Selected record keys (sorted-json-v2): sha256:');
  await section.getByLabel('Returned Case file (JSON)', { exact: true }).setInputFiles(upload(file));
  await expect(section.getByRole('status', { name: 'Case review return status' })).toContainText('0 new entries and 1 conflict');
  expect(lookupRequests).toBe(0);
});

test('a returned file cannot target another incident or overwrite a Case changed in another tab', async ({ page }) => {
  const { section, current, other } = await seed(page);
  const input = section.getByLabel('Returned Case file (JSON)', { exact: true });
  await input.setInputFiles(upload(buildCaseExport([other], AFTER)));
  await expect(section.getByRole('status', { name: 'Case review return status' })).toContainText('Case ID and domain must match');
  await input.setInputFiles(upload(reviewed(current)));
  await section.getByRole('checkbox', { name: 'Select note Returned review note', exact: true }).check();
  const peer = await page.context().newPage();
  try {
    await peer.goto('/cases?case=review-primary');
    const title = peer.locator('.title-editor');
    await title.locator(':scope > summary').click();
    await title.getByRole('textbox', { name: 'Incident title', exact: true }).fill('Newer reviewed title');
    await title.getByRole('button', { name: 'Save title', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'Newer reviewed title', exact: true })).toBeVisible();
    await section.getByRole('button', { name: 'Add selected review entries', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('changed after the preview');
    const result = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 })).records.find(item => item.value.id === current.id)!.value;
    expect(result.title).toBe('Newer reviewed title');
    expect(result.notes).toEqual(current.notes);
    expect(result.manualTrail).toEqual(current.manualTrail);
    await expect(section.getByRole('checkbox', { name: 'Select note Returned review note', exact: true })).toBeChecked();
  } finally { await peer.close(); }
});

for (const width of [320, 390, 1024, 1280, 2560]) for (const theme of ['light', 'dark'] as const) {
  test(`review entry pagination and full comparisons remain readable at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    const { section, current } = await seed(page);
    await useTheme(page, theme);
    let returned = current;
    for (let index = 0; index < 12; index++) returned = updateCase([returned], returned.id, { note: `Review note ${index}: ${'long-evidence-identifier-'.repeat(18)}` }, AFTER).record;
    await section.getByLabel('Returned Case file (JSON)', { exact: true }).setInputFiles(upload(buildCaseExport([returned], AFTER)));
    const first = section.getByRole('checkbox', { name: /^Select note Review note 0:/u });
    await first.focus(); await first.press('Space');
    await expect(first).toBeChecked();
    await section.getByRole('button', { name: 'Next entries', exact: true }).click();
    const last = section.getByRole('checkbox', { name: /^Select note Review note 11:/u });
    await expect(last).toBeVisible();
    await last.check();
    await expect(section.getByText('12 displayed entries · 2 selected across all pages', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: 'Previous entries', exact: true }).click();
    await expect(first).toBeChecked();
    await section.getByText('Full returned entry', { exact: true }).first().click();
    await expect(section.locator('pre').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const picker = await section.getByLabel('Returned Case file (JSON)', { exact: true }).boundingBox();
    const choice = await section.locator('label.entry-heading').first().boundingBox();
    expect(picker).not.toBeNull(); expect(picker!.height).toBeGreaterThanOrEqual(44);
    expect(choice).not.toBeNull(); expect(choice!.height).toBeGreaterThanOrEqual(44);
    await section.getByRole('heading', { name: 'Review with another analyst', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`review-return-${width}-${theme}.png`) });
    await section.locator('pre').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`review-return-entry-${width}-${theme}.png`) });
  });
}
