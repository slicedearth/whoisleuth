import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildCaseExport, createCase, updateCase, type CaseRecord } from '../packages/cases/case-model.mts';
import { currentBrowserLocalDocument, migrateLegacyBrowserData, readBrowserLocalCollection, failNextBrowserLocalManifestWrite, failNextBrowserLocalCollectionReadAfterWrite, expectNoHorizontalOverflow, useTheme } from './helpers';
import { openCaseSection } from './console-navigation';

const BEFORE = '2026-08-20T00:00:00.000Z';
const AFTER = '2026-08-22T00:00:00.000Z';
async function seed(page: Page) {
  const current = { ...createCase({ domain: 'review.example', title: 'Independent incident', note: 'Keep the original note',
    evidence: { capturedAt: BEFORE, scanDepth: 'deep', availability: 'registered' },
  }, BEFORE), id: 'review-primary' };
  const other = { ...createCase({ domain: current.domain, title: 'Different incident' }, BEFORE), id: 'review-other' };
  await page.goto('/cases');
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

test('full review copy and selective return preserve write failure, dependency and post-commit boundaries', async ({ page }) => {
  const { section, current, other } = await seed(page);
  let lookupRequests = 0;
  await page.route('**/api/lookup**', async route => { lookupRequests++; await route.abort(); });
  const pendingDownload = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Export this Case for review', exact: true }).click();
  const download = await pendingDownload;
  const copy = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(copy.cases).toEqual([current]);
  const file = reviewed(current);
  await section.getByLabel('Returned Case file (JSON)', { exact: true }).setInputFiles(upload(file));
  await expect(section.getByRole('status')).toContainText('3 new entries and 1 conflict');
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
  await expect(section.getByRole('status')).toContainText('Selected review entries were saved.');
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
  await expect(section.getByRole('status')).toContainText('0 new entries and 1 conflict');
  expect(lookupRequests).toBe(0);
});

test('a returned file cannot target another incident or overwrite a Case changed in another tab', async ({ page }) => {
  const { section, current, other } = await seed(page);
  const input = section.getByLabel('Returned Case file (JSON)', { exact: true });
  await input.setInputFiles(upload(buildCaseExport([other], AFTER)));
  await expect(section.getByRole('status')).toContainText('Case ID and domain must match');
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
