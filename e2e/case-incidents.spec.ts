import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { caseRecord, snapshot } from './case-test-fixtures';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import {
  currentBrowserLocalDocument, expectNoHorizontalOverflow, expandLookupFamilies,
  failNextBrowserLocalCollectionReadAfterWrite, failNextBrowserLocalManifestWrite,
  migrateLegacyBrowserData, readBrowserLocalCollection, runBulkScan, selectBulkResultView, useTheme,
} from './helpers';

const DOMAIN = 'incident.example';
async function seed(page: Page, destination = '/cases', count = 2) {
  await page.goto('/cases');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [
    { ...caseRecord({ id: 'incident-first', domain: DOMAIN, evidenceHistory: [snapshot()], notes: [{ body: 'First incident only', createdAt: '2026-06-01T00:00:00.000Z' }] }), title: 'Credential page review' },
    { ...caseRecord({ id: 'incident-second', domain: DOMAIN }), title: 'Separate impersonation report' },
    { ...caseRecord({ id: 'incident-other', domain: 'different.example' }), title: 'Different domain review' },
  ].slice(0, count) }) }, { clearStorage: true, destination });
}

test('new incident creation preserves drafts on failed writes and source clocks on deliberate reuse', async ({ page }) => {
  await seed(page, '/cases', 1);
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await page.getByText('Create a separate incident Case', { exact: true }).click();
  const form = page.locator('.incident-form');
  await form.getByRole('textbox', { name: 'Domain', exact: true }).fill(DOMAIN);
  await form.getByRole('textbox', { name: 'Incident title', exact: true }).fill('Independent second review');
  await form.getByRole('combobox', { name: 'Reuse a retained observation' }).selectOption('incident-first');
  await form.getByRole('combobox', { name: 'Observation', exact: true }).selectOption({ index: 1 });
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await form.getByRole('button', { name: 'Create incident Case', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Create incident Case', exact: true })).toBeEnabled();
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).not.toBeEmpty();
  await expect(form.getByRole('textbox', { name: 'Incident title', exact: true })).toHaveValue('Independent second review');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records).toHaveLength(1);
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await form.getByRole('button', { name: 'Create incident Case', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Independent second review', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('The change was saved, but Cases could not be reread.');
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(saved.records).toHaveLength(2);
  const original = saved.records.find(item => item.value.id === 'incident-first')!.value;
  const created = saved.records.find(item => item.value.id !== 'incident-first')!.value;
  expect(original).toEqual(before.records[0]!.value);
  expect(created.domain).toBe(DOMAIN);
  expect(created.evidenceHistory).toEqual(original.evidenceHistory);
  expect(created.notes).toEqual([]);
  expect(created.decisions).toEqual([]);
  expect(page.url()).toContain(`case=${created.id}`);
});

test('Lookup respects incident selection and does not move an unsaved note to another Case', async ({ page }) => {
  await seed(page, '/lookup');
  let requests = 0;
  await page.route('**/api/lookup?*', async route => { requests += 1; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture(DOMAIN)) }); });
  await page.locator('#query').fill(DOMAIN);
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.getByRole('heading', { name: DOMAIN, exact: true })).toBeVisible();
  await expandLookupFamilies(page);
  const card = page.locator('.case-card');
  const picker = card.getByRole('combobox', { name: 'Incident Case', exact: true });
  await expect(picker).toHaveValue('');
  await expect(card.getByRole('button', { name: 'Create case', exact: true })).toHaveCount(0);
  await picker.selectOption('incident-first');
  await card.getByRole('textbox', { name: 'Add note', exact: true }).fill('Do not move this draft');
  page.once('dialog', dialog => dialog.dismiss());
  await picker.selectOption('incident-second');
  await expect(picker).toHaveValue('incident-first');
  await expect(card.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('Do not move this draft');
  page.once('dialog', dialog => dialog.accept());
  await picker.selectOption('incident-second');
  await expect(card.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('');
  await card.getByRole('button', { name: `Refresh retained Case evidence for ${DOMAIN}`, exact: true }).click();
  await expect(card.getByRole('status').filter({ hasText: 'Refreshed the retained Case evidence' })).toBeVisible();
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(saved.records.find(item => item.value.id === 'incident-first')!.value.notes).toHaveLength(1);
  expect(saved.records.find(item => item.value.id === 'incident-second')!.value.notes).toHaveLength(0);
  expect(saved.records.find(item => item.value.id === 'incident-second')!.value.evidenceHistory).toHaveLength(1);
  expect(requests).toBe(1);
});

test('Bulk shares deliberate incident selection between list and focused review without mixing dispositions', async ({ page }) => {
  await seed(page, '/bulk');
  await page.route('**/api/lookup?*', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    availability: { applicable: true, domain: DOMAIN, state: 'registered', confidence: 'high' },
    diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
  }) }));
  await runBulkScan(page, [DOMAIN]);
  await selectBulkResultView(page, 'List');
  const row = page.locator('.results-table tbody tr');
  const picker = row.getByRole('combobox', { name: 'Incident Case', exact: true });
  await expect(picker).toHaveValue('');
  await expect(row.getByRole('button', { name: /Create case/u })).toHaveCount(0);
  await picker.selectOption('incident-second');
  await selectBulkResultView(page, 'Review');
  const cockpit = page.getByRole('region', { name: 'Review one result' });
  await expect(cockpit.getByRole('combobox', { name: 'Incident Case', exact: true })).toHaveValue('incident-second');
  await cockpit.getByRole('combobox', { name: 'Case disposition', exact: true }).selectOption('suspicious');
  await expect(cockpit).toContainText('Marked');
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(saved.records.find(item => item.value.id === 'incident-first')!.value.disposition).toBe('unreviewed');
  expect(saved.records.find(item => item.value.id === 'incident-second')!.value.disposition).toBe('suspicious');
});

test('Lookup links select the intended incident, retain it through a recheck and do not select it for another domain', async ({ page }) => {
  await seed(page, `/lookup?q=${DOMAIN}&case=incident-first`, 3);
  const original = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 3 })).records.find(item => item.value.id === 'incident-first')!.value;
  const requests: string[] = [];
  await page.route('**/api/lookup?*', async route => {
    const domain = new URL(route.request().url()).searchParams.get('q')!;
    requests.push(domain);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture(domain)) });
  });
  await expect(page.locator('#query')).toHaveValue(DOMAIN);
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.getByRole('heading', { name: DOMAIN, exact: true })).toBeVisible();
  await expandLookupFamilies(page);
  const card = page.locator('.case-card');
  await expect(card.getByRole('combobox', { name: 'Incident Case', exact: true })).toHaveValue('incident-first');
  await card.getByRole('combobox', { name: 'Incident Case', exact: true }).selectOption('incident-second');
  await card.getByRole('button', { name: 'Recheck and refresh Case', exact: true }).click();
  await expect(card.getByRole('combobox', { name: 'Incident Case', exact: true })).toHaveValue('incident-second');
  await expect(card).toContainText('Refreshed the retained Case evidence');
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 3 });
  expect(stored.records.find(item => item.value.id === 'incident-second')!.value.evidenceHistory).toHaveLength(1);
  expect(stored.records.find(item => item.value.id === 'incident-first')!.value).toEqual(original);
  await page.locator('#query').fill('different.example');
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'different.example', exact: true })).toBeVisible();
  await expandLookupFamilies(page);
  await expect(card).toContainText('Different domain review');
  await expect(card.getByRole('link', { name: 'Open Case', exact: true })).toHaveAttribute('href', /case=incident-other/u);
  expect(requests).toEqual([DOMAIN, DOMAIN, 'different.example']);
});

test('incident title drafts survive failed writes and require review after another tab changes the title', async ({ page }) => {
  await seed(page, '/cases?case=incident-first');
  async function titleEditor(target: Page) {
    const editor = target.locator('.title-editor');
    await expect(editor).toBeVisible();
    if (await editor.getAttribute('open') === null) await editor.locator(':scope > summary').click();
    return editor;
  }
  let editor = await titleEditor(page);
  await editor.getByRole('textbox', { name: 'Incident title', exact: true }).fill('Retained unfinished title');
  await expect(editor.locator('[data-recovery-status="saved"]')).toBeVisible();
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await editor.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Save title', exact: true })).toBeEnabled();
  await expect(editor.getByRole('textbox', { name: 'Incident title', exact: true })).toHaveValue('Retained unfinished title');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 })).records.find(item => item.value.id === 'incident-first')!.value.title).toBe('Credential page review');
  const other = await page.context().newPage();
  try {
    await other.goto('/cases?case=incident-first');
    const otherEditor = await titleEditor(other);
    await otherEditor.getByRole('textbox', { name: 'Incident title', exact: true }).fill('Title reviewed in another tab');
    await otherEditor.getByRole('button', { name: 'Save title', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Title reviewed in another tab', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Save title', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('title changed after this draft');
    await page.reload(); editor = await titleEditor(page);
    await editor.getByText('1 saved draft for this form', { exact: true }).click();
    await editor.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(editor).toContainText('Current title: Title reviewed in another tab');
    await expect(editor.getByRole('button', { name: 'Save title', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: 'Use current title as review baseline', exact: true }).click();
    await editor.getByRole('button', { name: 'Save title', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Retained unfinished title', exact: true })).toBeVisible();
    await expect(editor.getByRole('textbox', { name: 'Incident title', exact: true })).toBeFocused();
    const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
    expect(saved.records.find(item => item.value.id === 'incident-second')!.value.title).toBe('Separate impersonation report');
    expect((await readBrowserLocalCollection(page, 'case_drafts')).records).toHaveLength(0);
  } finally { await other.close(); }
});

test('campaign membership shows every incident without presenting Case counts as domain counts', async ({ page }) => {
  await seed(page, '/monitor?view=campaigns');
  await page.locator('#new-campaign').fill('Independent incident group');
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await page.getByRole('combobox', { name: 'Add a retained domain', exact: true }).selectOption(DOMAIN);
  await page.getByRole('button', { name: 'Add domain', exact: true }).click();
  await expect(page.locator('.campaign-head')).toContainText('1 domain');
  await expect(page.getByRole('region', { name: 'Campaign review cues' })).toContainText('2 linked Cases · 1 member domain');
  const members = page.locator('.members');
  await expect(members.getByRole('button', { name: /Credential page review/u })).toHaveCount(1);
  await expect(members.getByRole('button', { name: /Separate impersonation report/u })).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
  await members.getByRole('button', { name: /Separate impersonation report/u }).click();
  await expect(page).toHaveURL(/\/cases\?case=incident-second/u);
  await expect(page.getByRole('heading', { name: 'Separate impersonation report', exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`incident forms and identities remain readable across viewports in ${theme}`, async ({ page }, testInfo) => {
    await seed(page);
    await useTheme(page, theme);
    await page.getByText('Create a separate incident Case', { exact: true }).click();
    await page.locator('.incident-form').getByRole('textbox', { name: 'Domain', exact: true }).fill(DOMAIN);
    await page.locator('.incident-form').getByRole('textbox', { name: 'Incident title', exact: true }).fill('Long incident title '.repeat(16));
    for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 2560, height: 1440 }]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      await page.locator('.incident-form').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`incident-${theme}-${viewport.width}.png`) });
    }
  });
}
