import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildCaseExport } from '../packages/cases/case-storage-model.mts';
import { buildCaseResponsePacket } from '../packages/cases/case-response-packet.mts';
import { holdPacketFileDigest } from './held-packet-digest';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import type { CaseRecord } from '../packages/cases/case-model.mts';
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

test('selected Case exports compare read-only with exact records, replacement and disposal', async ({ page }, testInfo) => {
  const { section, current } = await seed(page);
  let lookupRequests = 0;
  await page.route('**/api/lookup**', async route => { lookupRequests++; await route.abort(); });
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  let baseline = current;
  for (let index = 0; index < 12; index++) baseline = updateCase([baseline], baseline.id, { note: `Baseline note ${index}` }, AFTER).record;
  const left = buildCaseExport([baseline], AFTER), right = structuredClone(left);
  right.cases[0]!.notes = right.cases[0]!.notes.slice(1).map((note, index) => ({ ...note, body: `Comparison note ${index}` }));
  right.cases[0]!.notes.push({ id: 'comparison-only-note', body: 'Deliberately selected new note', createdAt: AFTER });
  const disclosure = section.getByText('Compare Case exports or response packets', { exact: true });
  await disclosure.click();
  const comparison = section.getByRole('region', { name: 'Read-only Case export comparison', exact: true });
  const status = comparison.getByRole('status', { name: 'Case export comparison status', exact: true });
  const first = comparison.getByLabel('Baseline export (JSON)', { exact: true });
  const second = comparison.getByLabel('Comparison export (JSON)', { exact: true });
  await expect(status).toContainText('Comparison unavailable');
  await second.setInputFiles(upload(right));
  await expect(status).toContainText('Comparison unavailable');
  await first.setInputFiles(upload(left));
  await expect(status).toContainText('12 changed · 1 only in comparison · 1 only in baseline');
  await expect(comparison.getByRole('button', { name: /Save|Import|Add|Download/u })).toHaveCount(0);
  await expect(comparison.getByText('Only in baseline export', { exact: true })).toBeVisible();
  const inspect = comparison.getByRole('button', { name: `Inspect values for Notes ${baseline.notes[0]!.id}`, exact: true });
  await inspect.focus(); await inspect.press('Enter');
  const values = comparison.getByRole('region', { name: 'Selected comparison values', exact: true });
  await expect(values.getByRole('heading', { level: 4 })).toBeFocused();
  await expect(values.getByRole('region', { name: 'Baseline export text', exact: true })).toContainText('Keep the original note');
  await expect(values.getByText('Not present in this selected copy.', { exact: true })).toBeVisible();
  await comparison.getByRole('button', { name: 'Next differences', exact: true }).click();
  await expect(values).toHaveCount(0);
  await comparison.getByRole('button', { name: 'Inspect values for Notes comparison-only-note', exact: true }).click();
  await expect(values.getByRole('region', { name: 'Comparison export text', exact: true })).toContainText('Deliberately selected new note');
  for (const [width, height] of [[320, 700], [1280, 720]] as const) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height }); await useTheme(page, theme);
    await values.getByRole('heading', { level: 4 }).scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.handoff-comparison').analyze()).violations).toEqual([]);
    if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`handoff-comparison-${theme}-${width}.png`) });
  }
  await second.setInputFiles(upload(left));
  await expect(status).toContainText('0 changed · 0 only in comparison · 0 only in baseline');
  await expect(values).toHaveCount(0);
  await comparison.getByRole('button', { name: 'Clear comparison', exact: true }).click();
  await expect(status).toContainText('Comparison unavailable');
  await expect(comparison.locator('code')).toHaveCount(0);

  // A deliberately held native file read must not repopulate a cleared view.
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    let release!: () => void, finished!: () => void;
    const held = new Promise<void>(resolve => release = resolve);
    const completed = new Promise<void>(resolve => finished = resolve);
    (window as unknown as { releaseHandoffRead: () => Promise<void> }).releaseHandoffRead = async () => {
      Blob.prototype.arrayBuffer = original; release(); await completed;
      // Drain continuations from the now-completed read, not a timing delay.
      await Promise.resolve(); await Promise.resolve();
    };
    Blob.prototype.arrayBuffer = async function() {
      if (this instanceof File && this.name === 'held-comparison.json') {
        await held;
        try { return await original.call(this); } finally { finished(); }
      }
      return original.call(this);
    };
  });
  await first.setInputFiles({ ...upload({ ...left, version: 0 }), name: 'held-comparison.json' });
  await expect(comparison.getByText('Reading baseline export…', { exact: true })).toBeVisible();
  await comparison.getByRole('button', { name: 'Clear comparison', exact: true }).click();
  await first.setInputFiles(upload(right));
  await second.setInputFiles(upload(right));
  await expect(status).toContainText('0 changed · 0 only in comparison · 0 only in baseline');
  await page.evaluate(() => (window as unknown as { releaseHandoffRead: () => Promise<void> }).releaseHandoffRead());
  await expect(status).toContainText('0 changed · 0 only in comparison · 0 only in baseline');
  await expect(comparison.getByRole('alert')).toHaveCount(0);
  await disclosure.click();
  await expect(comparison).toHaveCount(0);
  await disclosure.click();
  await expect(status).toContainText('Comparison unavailable');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(saved);
  expect(lookupRequests).toBe(0);
});

test('selected response packets require full admission and retain read-only scope through delayed hashing', async ({ page }, testInfo) => {
  const { section, current } = await seed(page);
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  let lookupRequests = 0;
  await page.route('**/api/lookup**', async route => { lookupRequests++; await route.abort(); });
  let record = updateCase([current], current.id, { incidentTarget: 'https://review.example/first',
    evidencePin: { label: 'Original selected observation', value: 'A synthetic page observation', source: 'Fixture capture', observedAt: BEFORE, completeness: 'complete' },
  }, AFTER).record;
  const firstTarget = record.workflowMetadata!.incidentTargets[0]!;
  record = updateCase([record], record.id, { action: { type: 'internal_review', recipient: 'Initial review desk', contactSource: 'Fixture route',
    routeObservedAt: AFTER, responseObjects: [{ kind: 'page', identifier: firstTarget.url, incidentTargetId: firstTarget.id }],
  } }, AFTER).record;
  const actionId = record.actions[0]!.id, originalPin = record.evidencePins[0]!.id;
  const input = { profile: 'internal_soc', actionId, category: 'Synthetic observation review', affectedParty: 'Example service',
    abusiveUrls: ['https://review.example/first'], observedHarm: 'A supplied fictional observation needs review.', observedAt: BEFORE };
  const left = (await buildCaseResponsePacket(record, { ...input, selectedEvidencePinIds: [originalPin] }, AFTER)).json;
  record = updateCase([record], record.id, { incidentTarget: 'https://review.example/second',
    evidencePin: { label: 'Later selected observation', value: 'A second synthetic page observation', source: 'Fixture capture', observedAt: AFTER,
      completeness: 'partial', limitations: ['Only the selected page was observed.'] },
  }, AFTER).record;
  const secondTarget = record.workflowMetadata!.incidentTargets.find(target => target.url.endsWith('/second'))!;
  record = updateCase([record], record.id, { actionUpdate: { id: actionId, recipient: 'Later review desk',
    responseObjects: [{ kind: 'page', identifier: secondTarget.url, incidentTargetId: secondTarget.id }],
  } }, AFTER).record;
  const right = (await buildCaseResponsePacket(record, { ...input, selectedEvidencePinIds: record.evidencePins.filter(pin => pin.id !== originalPin).map(pin => pin.id) }, AFTER)).json;
  const disclosure = section.getByText('Compare Case exports or response packets', { exact: true });
  await disclosure.click();
  const comparison = section.getByRole('region', { name: 'Read-only Case export comparison', exact: true });
  const status = comparison.getByRole('status', { name: 'Case export comparison status', exact: true });
  const first = comparison.getByLabel('Baseline export (JSON)', { exact: true }), second = comparison.getByLabel('Comparison export (JSON)', { exact: true });
  await first.setInputFiles(upload(left));
  await expect(status).toContainText('Comparison unavailable');
  await expect(comparison.getByText(/Response packet schema/u)).toHaveCount(1);
  await second.setInputFiles(upload(right));
  await expect(status).toContainText('1 only in comparison · 1 only in baseline');
  await expect(comparison.getByRole('button', { name: /Save|Import|Add|Download/u })).toHaveCount(0);
  const inspect = comparison.getByRole('button', { name: `Inspect values for Escalation History ${actionId}`, exact: true });
  await inspect.focus(); await inspect.press('Enter');
  const values = comparison.getByRole('region', { name: 'Selected comparison values', exact: true });
  await expect(values.getByRole('heading', { level: 4 })).toBeFocused();
  await expect(values.getByRole('region', { name: 'Baseline export text', exact: true })).toContainText('Initial review desk');
  await expect(values.getByRole('region', { name: 'Comparison export text', exact: true })).toContainText('Later review desk');
  await expect(values.getByRole('region', { name: 'Comparison export text', exact: true })).toContainText('https://review.example/second');
  for (const [width, height] of [[320, 700], [1280, 720]] as const) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height }); await useTheme(page, theme);
    await values.getByRole('heading', { level: 4 }).scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.handoff-comparison').analyze()).violations).toEqual([]);
    if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`packet-comparison-${theme}-${width}.png`) });
  }
  await second.setInputFiles(upload(buildCaseExport([record], AFTER)));
  await expect(comparison.getByRole('alert')).toContainText('not one of each');
  await expect(status).toContainText('Comparison unavailable');
  const { integrity, ...unsigned } = { ...right, authorisation: { ...right.authorisation, reviewedInputDigestSha256: 'f'.repeat(64) } };
  const invalid = { ...unsigned, integrity: { ...integrity, digestSha256: createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex') } };
  await second.setInputFiles(upload(invalid));
  await expect(comparison.getByRole('alert')).toContainText('reviewed-input digest');
  await expect(status).toContainText('Comparison unavailable');
  const unrelated = JSON.parse(await readFile(path.join(__dirname, '../test/fixtures/case-lifecycle/case-response-packet-v13.json'), 'utf8'));
  await second.setInputFiles(upload(unrelated));
  await expect(comparison.getByRole('alert')).toContainText('exact Case ID and domain');
  await comparison.getByRole('button', { name: 'Clear comparison', exact: true }).click();

  // Hold only the final raw-file digest, after semantic and packet integrity
  // validation. Clearing/replacement must invalidate its eventual completion.
  for (const disposal of ['clear', 'close'] as const) {
    await comparison.getByRole('button', { name: 'Clear comparison', exact: true }).click();
    await holdPacketFileDigest(page);
    await first.setInputFiles(upload(left));
    await expect.poll(() => page.evaluate(() => (window as unknown as { packetDigestHeld: boolean }).packetDigestHeld)).toBe(true);
    await expect(comparison.getByText('Reading baseline export…', { exact: true })).toBeVisible();
    await expect(comparison.getByText(/Response packet schema/u)).toHaveCount(0);
    if (disposal === 'close') {
      await disclosure.click(); await expect(comparison).toHaveCount(0); await disclosure.click();
    } else await comparison.getByRole('button', { name: 'Clear comparison', exact: true }).click();
    await first.setInputFiles(upload(right)); await second.setInputFiles(upload(right));
    await expect(status).toContainText('0 changed · 0 only in comparison · 0 only in baseline');
    await page.evaluate(() => (window as unknown as { releasePacketDigest: () => Promise<void> }).releasePacketDigest());
    await expect(status).toContainText('0 changed · 0 only in comparison · 0 only in baseline');
    await expect(comparison.getByRole('alert')).toHaveCount(0);
  }
  await disclosure.click(); await expect(comparison).toHaveCount(0);
  await disclosure.click(); await expect(status).toContainText('Comparison unavailable');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(saved);
  expect(lookupRequests).toBe(0);
});

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
  const checks = handoff.getByRole('definition');
  await expect(checks).toHaveCount(5);
  await expect(handoff).toContainText('1 selected file body is available. 0 retained references have no selected bytes.');
  await expect(handoff).toContainText('Selected originals match their retained SHA-256 digests and byte counts.');
  await expect(handoff).toContainText('The recipient’s version has not been checked.');
  await expect(handoff).toContainText('a digest match does not authenticate their source');
  await expect(handoff).toContainText('Not checked. Downloading does not establish delivery, passphrase access or complete recovery.');
  await handoff.getByText('Recipient verification steps', { exact: true }).click();
  await expect(handoff).toContainText('check the case and original-file matches, not only whether the file opens');
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
    if (width === 320 || width === 1280) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`case-handoff-${theme}-${width}.png`) }); }
  }
  expect((await new AxeBuilder({ page }).include('.review-package').analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 720 });
  const pending = page.waitForEvent('download'); await download.click();
  const downloaded = await pending, encrypted = await readFile((await downloaded.path())!);
  expect(downloaded.suggestedFilename()).toMatch(/\.wlep$/u);
  const decoded = (await decryptInvestigationPackage(encrypted, passphrase)).review;
  expect(decoded.identityVerified).toBe(true); expect(decoded.contents.size).toBe(2);
  const copy = new TextDecoder().decode(decoded.contents.get('artifact-1')!);
  await expect(handoff).toContainText(`Case JSON v${JSON.parse(copy).version} is accepted by this build.`);
  await expect(handoff).toContainText(`investigation manifest v${decoded.manifest.version}`);
  expect(JSON.parse(copy).cases).toEqual([current]); expect(copy).not.toContain('Recovery-only handoff canary');
  expect(Buffer.from(decoded.contents.get('artifact-2')!)).toEqual(FILE_BYTES);
  await expect(handoff.getByRole('status')).toContainText('read-back verification');
  await expect(handoff.getByLabel('Package passphrase', { exact: true })).toHaveValue('');
  await expect(download).toBeFocused();
  await expect(handoff).toContainText('Not checked. Downloading does not establish delivery, passphrase access or complete recovery.');
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
  const openTemporary = completeness.getByRole('button', { name: 'Open temporary Case review', exact: true });
  await openTemporary.click();
  const temporary = page.getByRole('dialog', { name: 'Temporary Case review', exact: true });
  await expect(temporary).toBeVisible();
  await expect(temporary).toContainText(current.title!);
  await expect(temporary.getByRole('region', { name: 'Packaged original files' })).toContainText(FILE_NAME);
  await expect(temporary.getByRole('button', { name: /Save|Import|Submit|Collect/u })).toHaveCount(0);
  for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark'] as const) {
      await temporary.getByRole('button', { name: 'Return to package', exact: true }).click();
      await useTheme(page, theme);
      await openTemporary.click();
      await expect(temporary).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([]);
      if (width === 320 || width === 1280) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`temporary-review-${theme}-${width}.png`) }); }
    }
  }
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await storedFiles(page)).toEqual(originalsBefore);
  await temporary.getByRole('button', { name: 'Return to package', exact: true }).click();
  await expect(temporary).not.toBeVisible();
  await expect(openTemporary).toBeFocused();
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
  await expect(section.getByRole('status', { name: 'Case review return status' })).toContainText('Selected review entries were saved.');
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
  await expect(handoff).toContainText('0 selected file bodies are available. 1 retained reference has no selected bytes.');
  await expect(handoff).toContainText('No original bytes selected; no original digests checked.');
  await handoff.getByRole('checkbox', { name: new RegExp(FILE_NAME.replaceAll('.', '\\.')) }).check();
  await expect(handoff.getByRole('alert')).toHaveText('The case or selection changed. Check the contents again before downloading.');
  await expect(handoff.locator('.handoff-checks')).toHaveCount(0);
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
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('The change was saved, but cases could not be reread.');
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
    if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`review-return-${width}-${theme}.png`) }); }
    await section.locator('pre').first().scrollIntoViewIfNeeded();
    if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`review-return-entry-${width}-${theme}.png`) }); }
  });
}
