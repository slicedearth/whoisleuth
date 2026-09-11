import { expect, test } from './fixtures';
import { openCaseMetadata, openCaseSection } from './console-navigation';
import { caseRecord, createCase, snapshot } from './case-test-fixtures';
import {
  currentBrowserLocalDocument,
  expectNoHorizontalOverflow,
  failBrowserLocalCollectionReads,
  failNextBrowserLocalCollectionReadAfterWrite,
  holdBrowserLocalTransaction,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
} from './helpers';

test('direct and legacy Cases navigation restore the same canonical selection', async ({ page }) => {
  await page.goto('/cases');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', {
      cases: [caseRecord({ id: 'direct-case', domain: 'direct-case.example' })],
    }),
  }, { destination: '/cases?case=direct-case' });
  const header = page.locator('#case-head-direct-case');
  await expect(page.getByRole('heading', { name: 'direct-case.example', exact: true })).toBeVisible();
  await expect(header).toBeFocused();
  const navigation = page.getByRole('navigation', { name: 'Console', exact: true });
  await expect(navigation.getByRole('link', { name: /^Cases/u })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('link', { name: /^Review inbox/u })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'All Cases', exact: true })).toHaveAttribute('href', '/cases');
  await page.reload();
  await expect(header).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Case sections', exact: true })).toBeVisible();
  await page.goto('/monitor?view=cases&case=direct-case');
  await expect(header).toBeFocused();
  await expect(page).toHaveURL('/cases?case=direct-case');
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await page.locator('#case-head-direct-case').click();
  await expect(page).toHaveURL('/cases?case=direct-case');
  await expect(page.getByRole('navigation', { name: 'Case sections', exact: true })).toBeVisible();
});

test('the command palette includes the direct Cases destination', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open console navigation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  await dialog.getByRole('combobox', { name: 'Search pages and tools' }).fill('Cases');
  await dialog.getByRole('option', { name: /^Cases\b/u }).click();
  await expect(page).toHaveURL('/cases');
  await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Track a domain' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No cases yet' })).toBeVisible();
});

test('missing direct Cases are explicit without selecting an unrelated record', async ({ page }) => {
  await page.goto('/cases');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', {
      cases: [caseRecord({ id: 'retained-case', domain: 'retained-case.example' })],
    }),
  }, { destination: '/cases?case=missing-case#case-response-missing-case' });
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('That Case is not available in this browser workspace.');
  await expect(page.locator('#case-head-retained-case')).toHaveAttribute('href', '/cases?case=retained-case');
  await expect(page.locator('.response-workspace')).toHaveCount(0);
});

test('direct Cases do not offer empty-state mutations when local storage is unreadable', async ({ page }) => {
  await page.goto('/cases');
  await expect(page.getByRole('textbox', { name: 'Track a domain' })).toBeVisible();
  await failBrowserLocalCollectionReads(page, 'cases');
  const navigation = page.getByRole('navigation', { name: 'Console', exact: true });
  await navigation.getByRole('link', { name: /^Bulk/u }).click();
  await expect(page).toHaveURL('/bulk');
  await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toHaveCount(0);
  await navigation.getByRole('link', { name: /^Cases/u }).click();
  await expect(page).toHaveURL('/cases');
  await expect(page.getByRole('heading', { name: 'Cases unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No cases yet' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open or create case' })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test('Case creation preserves a later domain draft and opens records hidden by filters', async ({ page }) => {
  await page.goto('/cases');
  await createCase(page, 'existing-draft.example');
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  const domain = page.getByRole('textbox', { name: 'Track a domain' });
  await domain.fill('submitted-draft.example');
  const release = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Open or create case' }).click();
    await expect(page.getByRole('button', { name: 'Open or create case' })).toBeDisabled();
    await domain.fill('later-draft.example');
  } finally {
    await release();
  }
  await expect(page.locator('.case-head', { hasText: 'submitted-draft.example' })).toBeVisible();
  await expect(domain).toHaveValue('later-draft.example');
  await expect(domain).toBeFocused();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('not-retained.example');
  await expect(page.locator('.case-head')).toHaveCount(0);
  await domain.fill('submitted-draft.example');
  await page.getByRole('button', { name: 'Open or create case' }).click();
  await expect(page.getByRole('heading', { name: 'submitted-draft.example', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search', exact: true })).toHaveValue('');
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(stored.records).toHaveLength(2);
});

test('Case note and tag saves preserve later drafts and conditional undo does not change another editor', async ({ page }) => {
  await page.goto('/cases');
  await createCase(page, 'other-editor.example');
  await createCase(page, 'submitted-editor.example');
  await openCaseSection(page, 'History');
  const note = page.getByRole('textbox', { name: 'Add note', exact: true });
  await note.fill('Submitted note');
  const releaseNote = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Adding…', exact: true })).toBeDisabled();
    await note.fill('Later note draft');
  } finally {
    await releaseNote();
  }
  await expect(page.locator('.notes')).toContainText('Submitted note');
  await expect(note).toHaveValue('Later note draft');
  await openCaseMetadata(page);
  const tags = page.getByRole('textbox', { name: /^Additional tags\b/u });
  await tags.fill('submitted-tag');
  const releaseTags = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Save tags', exact: true }).click();
    await tags.fill('later-tag-draft');
  } finally {
    await releaseTags();
  }
  const undo = page.getByRole('region', { name: 'Undo analyst change' });
  await expect(undo).toBeVisible();
  await expect(tags).toHaveValue('later-tag-draft');
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await page.locator('.case-head', { hasText: 'other-editor.example' }).click();
  await openCaseMetadata(page);
  await tags.fill('other-unsaved-draft');
  await undo.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.undo-outcome')).toContainText('Restored the previous tags');
  await expect(tags).toHaveValue('other-unsaved-draft');
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const submitted = stored.records.find(entry => entry.value.domain === 'submitted-editor.example');
  expect(submitted?.value.tags).toEqual([]);
  expect(submitted?.value.notes).toMatchObject([{ body: 'Submitted note' }]);
});

test('a committed Case note remains saved when refreshing the list fails', async ({ page }) => {
  await page.goto('/cases');
  await createCase(page, 'committed-note.example');
  await openCaseSection(page, 'History');
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Committed note');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('The change was saved, but Cases could not be reread.');
  await expect(page.locator('.notes')).toContainText('Committed note');
  await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('');
  expect((await readBrowserLocalCollection(page, 'cases')).records[0]?.value.notes).toHaveLength(1);
});

test('Case creation completing after navigation does not return to its old editor', async ({ page }) => {
  await page.goto('/cases');
  await page.getByRole('textbox', { name: 'Track a domain' }).fill('background-save.example');
  const release = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Open or create case' }).click();
    await expect(page.getByRole('button', { name: 'Open or create case' })).toBeDisabled();
    await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: /^Bulk/u }).click();
    await expect(page).toHaveURL('/bulk');
  } finally {
    await release();
  }
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(stored.records[0]?.value.domain).toBe('background-save.example');
  await expect(page).toHaveURL('/bulk');
  await expect(page.getByRole('heading', { name: 'Bulk', exact: true })).toBeVisible();
});

for (const anotherCase of [false, true]) {
  test(`a pending new Case does not replace later edits in ${anotherCase ? 'another' : 'the same'} retained Case`, async ({ page }) => {
    await page.goto('/cases');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', {
        cases: [
          caseRecord({ id: 'first-editor', domain: 'first-editor.example' }),
          caseRecord({ id: 'second-editor', domain: 'second-editor.example' }),
        ],
      }),
    }, { destination: '/cases?case=first-editor' });
    await expect(page.getByRole('heading', { name: 'first-editor.example', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    await page.getByRole('textbox', { name: 'Track a domain' }).fill('pending-creation.example');
    const release = await holdBrowserLocalTransaction(page);
    const selected = anotherCase ? 'second-editor' : 'first-editor';
    try {
      await page.getByRole('button', { name: 'Open or create case' }).click();
      await expect(page.getByRole('button', { name: 'Open or create case' })).toBeDisabled();
      await page.locator(`#case-head-${selected}`).click();
      await openCaseSection(page, 'History');
      await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Later retained-Case note');
      await openCaseMetadata(page);
      await page.getByRole('textbox', { name: /^Additional tags\b/u }).fill('later-retained-tag');
    } finally {
      await release();
    }
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('Opened a new case for pending-creation.example.');
    await expect(page.getByRole('heading', { name: `${selected}.example`, exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Additional tags\b/u })).toHaveValue('later-retained-tag');
    await expect(page.getByRole('textbox', { name: /^Additional tags\b/u })).toBeFocused();
    expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 3 })).records).toHaveLength(3);
    await expect(page).toHaveURL(`/cases?case=${selected}`);
    await openCaseSection(page, 'History');
    await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('Later retained-Case note');
  });
}

test('Cases first use and retained records remain readable across major widths and themes', async ({ page }, testInfo) => {
  test.slow();
  await page.goto('/cases');
  const viewports = [
    { width: 320, height: 700 }, { width: 390, height: 844 },
    { width: 1024, height: 768 }, { width: 1280, height: 720 },
    { width: 1920, height: 1080 }, { width: 2560, height: 1440 },
    { width: 3840, height: 2160 },
  ];
  const headingPositions = new Map<string, number>();
  for (const populated of [false, true]) {
    if (populated) {
      await migrateLegacyBrowserData(page, {
        'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', {
          cases: [caseRecord({
            id: 'case-layout', domain: 'retained-investigation.example',
            disposition: 'suspicious', evidenceHistory: [snapshot()],
            notes: [{ createdAt: '2026-06-01T00:00:00.000Z', body: 'Source limitations remain under review.' }],
          })],
        }),
      }, { destination: '/cases' });
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => localStorage.setItem('whoisleuth:theme:v1', value), theme);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const heading = page.getByRole('heading', { name: 'Cases', exact: true });
        const domain = page.getByRole('textbox', { name: 'Track a domain' });
        await expect(heading).toBeVisible();
        await expect(domain).toBeVisible();
        await expect(page.locator('input[type="file"]').first()).toBeAttached();
        await expect(page.getByRole('button', { name: /^Review calibration export/u })).toHaveCount(0);
        if (populated) {
          await expect(page.locator('#case-head-case-layout')).toBeVisible();
          await page.locator('#case-head-case-layout').click();
          await openCaseSection(page, 'History');
          await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toBeVisible();
          await page.getByRole('link', { name: 'All Cases', exact: true }).click();
        } else {
          await expect(page.getByRole('heading', { name: 'No cases yet' })).toBeVisible();
        }
        await expectNoHorizontalOverflow(page);
        await domain.focus();
        await expect(domain).toBeFocused();
        await page.evaluate(() => window.scrollTo(0, 0));
        const bounds = await heading.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThan(viewport.height / 2);
        const key = `${theme}-${viewport.width}`;
        if (populated) expect(Math.abs(bounds!.y - headingPositions.get(key)!)).toBeLessThanOrEqual(1);
        else headingPositions.set(key, bounds!.y);
        const main = await page.getByRole('main').boundingBox();
        const header = await page.getByRole('banner').boundingBox();
        expect(main).not.toBeNull();
        expect(header).not.toBeNull();
        expect(Math.abs(main!.y - header!.y - header!.height)).toBeLessThanOrEqual(1);
        const button = await page.getByRole('button', { name: 'Open or create case' }).boundingBox();
        expect(button).not.toBeNull();
        expect(button!.height).toBeGreaterThanOrEqual(44);
        const name = `cases-${populated ? 'retained' : 'empty'}-${theme}-${viewport.width}.png`;
        const screenshot = testInfo.outputPath(name);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
});
