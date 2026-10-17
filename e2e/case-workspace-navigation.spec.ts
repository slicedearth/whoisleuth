import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import { openCaseMetadata, openCaseSection } from './console-navigation';
import { caseRecord, snapshot } from './case-test-fixtures';
import { productionChunkPath } from './production-build';
import { createCase as createCaseRecord } from '../packages/cases/case-record-operations.mts';
import AxeBuilder from '@axe-core/playwright';
import { THEME_STORAGE_KEY } from '../frontend/src/lib/theme.ts';
import { currentBrowserLocalDocument, expectFocusedResultsVisible, expectNoHorizontalOverflow, failNextBrowserLocalCollectionReadAfterWrite, failNextBrowserLocalManifestWrite, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';

async function seedCases(page: import('@playwright/test').Page, destination = '/cases') {
  await page.goto('/cases');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [
      caseRecord({ id: 'workspace-first', domain: 'first-work.example', evidenceHistory: [snapshot()] }),
      caseRecord({ id: 'workspace-second', domain: 'second-work.example' }),
    ] }),
  }, { destination });
}

test('temporary Caseboard keeps authored reasoning local, protects cancelled exits and preserves exact references', async ({ page }, testInfo) => {
  const collectionRequests: string[] = [];
  page.on('request', request => { const path = new URL(request.url()).pathname; if (/^\/api\/(lookup|dns|whois|rdap|scan|collect)/u.test(path)) collectionRequests.push(path); });
  const at = '2026-10-01T00:00:00.000Z';
  const record = createCaseRecord({ domain: 'board.example', note: 'Retained source note',
    evidencePin: { label: 'Retained page observation', field: 'http.status', value: '200', category: 'http', source: 'Separate fixture', observedAt: at, completeness: 'complete' } }, at);
  record.assertions = [{ id: 'board-assertion', kind: 'hypothesis', statement: 'An existing analyst question', rationale: 'Retained reasoning', state: 'open',
    evidencePinIds: [record.evidencePins[0]!.id], createdAt: at, updatedAt: at }];
  const other = createCaseRecord({ domain: 'other-board.example' }, at);
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [record, other] }) }, { clearStorage: true, destination: `/cases?case=${record.id}` });
  await expect(page.getByRole('heading', { name: 'board.example', exact: true })).toBeVisible();
  await openCaseSection(page, 'Summary');
  const disclosure = page.locator('.temporary-caseboard');
  await disclosure.locator(':scope > summary').click();
  const board = page.getByRole('region', { name: 'Arrange this Case review', exact: true });
  await expect(board).toBeVisible();
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const draftsBefore = await readBrowserLocalCollection(page, 'case_drafts');
  const preferences = () => page.evaluate(theme => ({ local: Object.entries(localStorage).filter(([key]) => key !== theme).sort(), session: Object.entries(sessionStorage).sort() }), THEME_STORAGE_KEY);
  const preferencesBefore = await preferences();
  for (const name of [/^Pin 1:/u,/^Assertion 1:/u,/^Note 1:/u]) {
    const chooser = board.getByRole('combobox', { name: 'Retained reference', exact: true });
    const value = await chooser.locator('option').filter({ hasText: name }).getAttribute('value');
    if (value === null) throw new Error('Expected the current retained source choice.');
    await chooser.selectOption(value);
    await board.getByRole('button', { name: 'Add reference card', exact: true }).click();
  }
  const cards = board.getByRole('list', { name: 'Temporary ordered cards', exact: true }).getByRole('listitem');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Separate fixture');
  await expect(cards.nth(1)).toContainText('An existing analyst question');
  await expect(cards.nth(2)).toContainText('Retained source note');
  for (const type of ['question','hypothesis','note']) {
    await board.getByRole('combobox', { name: 'Temporary card type', exact: true }).selectOption(type);
    await board.getByRole('textbox', { name: 'Temporary card text', exact: true }).fill(`Unpublished board ${type}`);
    await board.getByRole('button', { name: 'Add temporary card', exact: true }).click();
  }
  await expect(cards).toHaveCount(6);
  await board.getByRole('combobox', { name: 'From card', exact: true }).selectOption({ label: 'Card 4 · question' });
  await board.getByRole('combobox', { name: 'To card', exact: true }).selectOption({ label: 'Card 1 · reference' });
  for (const kind of ['supports','contradicts','investigate_next','analyst_grouping']) {
    await board.getByRole('combobox', { name: 'Authored relationship', exact: true }).selectOption(kind);
    await board.getByRole('textbox', { name: 'Relationship reasoning', exact: true }).fill(`Unpublished ${kind} reasoning`);
    await board.getByRole('button', { name: 'Add authored relationship', exact: true }).click();
  }
  const links = board.getByRole('list', { name: 'Temporary analyst-declared relationships', exact: true }).getByRole('listitem');
  await expect(links).toHaveCount(4);
  const earlier = board.getByRole('button', { name: 'Move temporary card 6 earlier', exact: true });
  await earlier.focus(); await earlier.press('Enter');
  await expect(cards.nth(4)).toContainText('Unpublished board note');
  await expect(board.getByRole('button', { name: 'Move temporary card 5 earlier', exact: true })).toBeFocused();
  await board.getByRole('button', { name: 'Move temporary card 1 later', exact: true }).click();
  await expect(board.getByRole('button', { name: 'Move temporary card 2 later', exact: true })).toBeFocused();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await readBrowserLocalCollection(page, 'case_drafts')).toEqual(draftsBefore);
  expect(await preferences()).toEqual(preferencesBefore);
  await openCaseSection(page, 'Evidence'); await openCaseSection(page, 'Summary');
  await expect(cards).toHaveCount(6);
  await openCaseMetadata(page); await page.getByRole('textbox', { name: /^Additional tags/u }).fill('board-context');
  await page.getByRole('button', { name: 'Save tags', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('Updated tags');
  await expect(cards.nth(4)).toContainText('Unpublished board note');
  const unfinished = board.getByRole('textbox', { name: 'Temporary card text', exact: true });
  await unfinished.fill('Unfinished temporary card');
  await expect(unfinished).toBeFocused();
  let allowDiscard = false; const prompts: string[] = [];
  page.on('dialog', async dialog => { prompts.push(dialog.message()); await (allowDiscard ? dialog.accept() : dialog.dismiss()); });
  await disclosure.locator(':scope > summary').click();
  await expect(disclosure).toHaveAttribute('open', ''); await expect(cards).toHaveCount(6);
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await expect(board).toBeVisible(); await expect(cards).toHaveCount(6);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(board).toBeVisible(); await expect(cards).toHaveCount(6);
  await expect(board.getByRole('textbox', { name: 'Temporary card text', exact: true })).toHaveValue('Unfinished temporary card');
  expect(prompts.length).toBeGreaterThanOrEqual(3);
  const dismissUndo = page.getByRole('button', { name: 'Dismiss undo', exact: true });
  if (await dismissUndo.isVisible()) await dismissUndo.click();
  for (const width of [320, 1280]) for (const theme of ['light','dark'] as const) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
    for (const control of await board.getByRole('button').all()) {
      if (!await control.isEnabled()) continue;
      await control.focus(); await expect(control).toBeFocused();
      await expect.poll(async () => {
        const target = await control.boundingBox(), navigation = await page.getByRole('navigation', { name: 'Case sections', exact: true }).boundingBox();
        const viewport = page.viewportSize();
        if (!target || !navigation || !viewport) throw new Error('Expected current focused control, navigation and viewport geometry.');
        // CSS geometry may differ by a fractional pixel from the viewport intersection.
        return target.y >= navigation.y + navigation.height - 1 && target.y + target.height <= viewport.height + 1
          && target.x >= -1 && target.x + target.width <= viewport.width + 1;
      }).toBe(true);
    }
    const heading = board.getByRole('heading', { name: 'Arrange this Case review', exact: true });
    await heading.focus(); await expectFocusedResultsVisible(page, heading, heading);
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.temporary-caseboard').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    if (captureVisualEvidenceEnabled()) await board.screenshot({ path: testInfo.outputPath(`temporary-board-${width}-${theme}.png`) });
  }
  await page.emulateMedia({ media: 'print' }); await expect(disclosure).toBeHidden(); await page.emulateMedia({ media: 'screen' });
  await openCaseSection(page, 'Response');
  const download = page.waitForEvent('download'); await page.locator('.export-controls').getByRole('button', { name: 'Export report JSON', exact: true }).click();
  const file = await download; const exported = Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8');
  expect(exported).not.toContain('Unpublished board'); expect(exported).not.toContain('Unpublished supports reasoning'); expect(exported).not.toContain('Unfinished temporary card');
  expect(await readBrowserLocalCollection(page, 'case_drafts')).toEqual(draftsBefore);
  allowDiscard = true;
  await openCaseSection(page, 'Summary');
  await board.getByRole('button', { name: 'Clear temporary board', exact: true }).click();
  await expect(cards).toHaveCount(0); await expect(disclosure.locator(':scope > summary')).toBeFocused();
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await page.locator(`#case-head-${other.id}`).click(); await openCaseSection(page, 'Summary');
  await disclosure.locator(':scope > summary').click(); await expect(cards).toHaveCount(0);
  expect(collectionRequests).toEqual([]);
});

for (const kind of ['note', 'tags'] as const) {
  test(`ordinary Case ${kind} drafts protect exits, survive failed saves and clear only after save or discard`, async ({ page }) => {
    await page.setViewportSize(kind === 'note' ? { width: 390, height: 844 } : { width: 1280, height: 720 });
    await seedCases(page, '/cases?case=workspace-first');
    await useTheme(page, kind === 'note' ? 'light' : 'dark');
    const edit = async () => { if (kind === 'note') await openCaseSection(page, 'History'); else await openCaseMetadata(page); };
    await edit();
    const input = page.getByRole('textbox', { name: kind === 'note' ? 'Add note' : /^Additional tags/u, exact: kind === 'note' });
    const submit = page.getByRole('button', { name: kind === 'note' ? 'Add note' : 'Save tags', exact: true });
    const draft = kind === 'note' ? 'Exact unsaved note.\nSecond line.' : 'first-tag, second-tag';
    const prompts: string[] = [];
    let discard = false;
    page.on('dialog', async dialog => { prompts.push(dialog.message()); await (discard ? dialog.accept() : dialog.dismiss()); });
    await input.fill(draft);
    await openCaseSection(page, 'Evidence');
    await edit();
    expect(prompts).toEqual([]);
    await expect(input).toHaveValue(draft);
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    await expect.poll(() => prompts.length).toBe(1);
    await expect(input).toHaveValue(draft);
    await page.getByRole('link', { name: 'Review follow-up', exact: true }).click();
    await expect.poll(() => prompts.length).toBe(2);
    await expect(input).toHaveValue(draft);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => prompts.length).toBe(3);
    await expect(input).toHaveValue(draft);
    await failNextBrowserLocalManifestWrite(page, 'cases');
    await submit.click();
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText(/could not save/iu);
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    await expect.poll(() => prompts.length).toBe(4);
    await expect(input).toHaveValue(draft);
    await submit.click();
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText(kind === 'note' ? 'Added a note' : 'Updated tags');
    await expect(input).toHaveValue(kind === 'note' ? '' : draft);
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    await expect(page).toHaveURL('/cases');
    expect(prompts).toHaveLength(4);
    await page.locator('#case-head-workspace-first').click();
    await edit(); await input.fill('Deliberately discarded draft');
    discard = true;
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    await expect(page).toHaveURL('/cases');
    expect(prompts).toHaveLength(5);
    await page.locator('#case-head-workspace-second').click();
    await edit(); await expect(input).toHaveValue('');
    await expectNoHorizontalOverflow(page);
  });
}

test('saving equivalent tag spacing acknowledges a no-op without changing storage or warning on exit', async ({ page }) => {
  await page.goto('/cases');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [{
      ...caseRecord({ id: 'equivalent-tags', domain: 'tag-spacing.example' }), tags: ['first', 'second'],
    }] }),
  }, { destination: '/cases?case=equivalent-tags' });
  const prompts: string[] = [];
  page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  for (const draft of ['first,second', ' first , second ', 'first,\nsecond']) {
    await openCaseMetadata(page);
    const tags = page.getByRole('textbox', { name: /^Additional tags/u });
    await tags.fill(draft);
    await page.getByRole('button', { name: 'Save tags', exact: true }).click();
    await expect(tags).toHaveValue('first, second');
    expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).toEqual(before);
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    await expect(page).toHaveURL('/cases');
    expect(prompts).toEqual([]);
    await page.locator('#case-head-equivalent-tags').click();
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/u);
  expect(prompts).toEqual([]);
});

for (const direction of ['combine', 'separate'] as const) {
  test(`Case tag saves ${direction} literal backslash-zero content without losing the draft`, async ({ page }) => {
    const literalTag = String.raw`first\0second`;
    expect(literalTag).toHaveLength(13);
    expect([...literalTag.slice(5, 7)].map(character => character.charCodeAt(0))).toEqual([92, 48]);
    const previous = direction === 'combine' ? ['first', 'second'] : [literalTag];
    const next = direction === 'combine' ? [literalTag] : ['first', 'second'];
    await page.setViewportSize(direction === 'combine' ? { width: 1280, height: 720 } : { width: 390, height: 844 });
    await page.goto('/cases');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [{
        ...caseRecord({ id: 'literal-tags', domain: 'tag-comparison.example' }), tags: previous,
      }] }),
    }, { destination: '/cases?case=literal-tags' });
    await useTheme(page, direction === 'combine' ? 'dark' : 'light');
    const prompts: string[] = [];
    page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
    await openCaseMetadata(page);
    const tags = page.getByRole('textbox', { name: /^Additional tags/u });
    const save = page.getByRole('button', { name: 'Save tags', exact: true });
    const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
    expect(before.records[0]?.value.tags).toEqual(previous);
    await tags.fill(next.join(', '));
    await save.click();
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('Updated tags');
    const committed = await readBrowserLocalCollection(page, 'cases', { minimumRevision: before.manifest.revision + 1 });
    expect(committed.records[0]?.value.tags).toEqual(next);
    expect(committed.manifest.revision).toBe(before.manifest.revision + 1);
    await expect(tags).toHaveValue(next.join(', '));
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    await expect(page).toHaveURL('/cases');
    expect(prompts).toEqual([]);
    await page.locator('#case-head-literal-tags').click();
    await openCaseMetadata(page);
    await expect(tags).toHaveValue(next.join(', '));

    await tags.fill(previous.join(', '));
    await failNextBrowserLocalManifestWrite(page, 'cases');
    await save.click();
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText(/could not save/iu);
    await expect(tags).toHaveValue(previous.join(', '));
    expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).toEqual(committed);
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    expect(prompts).toHaveLength(1);
    await expect(tags).toHaveValue(previous.join(', '));
    await save.click();
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('Updated tags');
    const restored = await readBrowserLocalCollection(page, 'cases', { minimumRevision: committed.manifest.revision + 1 });
    expect(restored.records[0]?.value.tags).toEqual(previous);
    await page.getByRole('link', { name: 'All Cases', exact: true }).click();
    await expect(page).toHaveURL('/cases');
    expect(prompts).toHaveLength(1);
    await expectNoHorizontalOverflow(page);
  });
}

for (const [section, preserveLaterFocus] of [
  ['evidence', false], ['evidence', true], ['response', false], ['response', true],
] as const) {
  test(`delayed Case detail ${section} ${preserveLaterFocus ? 'preserves later control focus' : 'focuses its ready target'}`, async ({ page }) => {
    await page.goto('/dashboard');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [caseRecord({
        id: 'delayed-case', domain: 'delayed-review.example', evidenceHistory: [snapshot()],
      })] }),
    }, { clearStorage: true, destination: '/dashboard' });
    const chunk = productionChunkPath('src/lib/components/CaseDetail.svelte');
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**${chunk}`, async route => { await held; await route.continue(); });
    try {
      const destination = section === 'response'
        ? '/cases?case=delayed-case&response=1#case-response-preflight-delayed-case'
        : '/cases?case=delayed-case&section=evidence';
      await page.goto(destination, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Opening case…', { exact: true })).toBeVisible();
      await expect(page.locator('#case-head-delayed-case')).toHaveCount(0);
      const laterControl = page.getByRole('button', { name: 'Sign out', exact: true });
      if (preserveLaterFocus) await laterControl.focus();
      release();
      await expect(page.getByRole('heading', { name: 'delayed-review.example', exact: true })).toBeVisible();
      await expect(page.getByText('Opening case…', { exact: true })).toHaveCount(0);
      const target = section === 'response'
        ? page.locator('#case-response-preflight-delayed-case > summary')
        : page.locator('#case-head-delayed-case');
      await expect(preserveLaterFocus ? laterControl : target).toBeFocused();
    } finally { release(); await page.unroute(`**${chunk}`); }
  });
}

test('Case detail replaces the list and returns to its retained filters and focus', async ({ page }, testInfo) => {
  const copied: string[] = [];
  let refuseCopy = false;
  await page.exposeFunction('recordFixtureCaseTimeCopy', (value: string) => {
    if (refuseCopy) throw new Error('Private clipboard failure');
    copied.push(value);
  });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: (value: string) => (window as unknown as { recordFixtureCaseTimeCopy(value: string): Promise<void> }).recordFixtureCaseTimeCopy(value),
  } }));
  const openedAt = '2026-06-01T02:03:04.123Z';
  const updatedAt = '2026-06-03T04:05:06.789Z';
  const noteAt = '2026-06-02T03:04:05.456Z';
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [
      caseRecord({ id: 'workspace-first', domain: 'first-work.example', evidenceHistory: [snapshot()],
        createdAt: openedAt, updatedAt, notes: [{ createdAt: noteAt, body: 'Retained review note.' }] }),
      caseRecord({ id: 'workspace-second', domain: 'second-work.example' }),
    ] }),
  }, { destination: '/cases' });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const search = page.getByRole('textbox', { name: 'Search', exact: true });
  await search.fill('first-work');
  const row = page.locator('#case-head-workspace-first');
  await row.click();
  await expect(page).toHaveURL('/cases?case=workspace-first');
  await expect(page.getByRole('heading', { name: 'first-work.example', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved Cases', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Open a Case for a domain', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Case sections' }).getByRole('link')).toHaveText(['Summary', 'Evidence', 'Assessment', 'Response', 'History']);
  await expect(page.getByRole('group', { name: 'Case response presentation', includeHidden: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: /^Additional tags/, includeHidden: true })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Retained Case records' })).toContainText('1 snapshot');
  const detail = page.locator('[data-case-detail="workspace-first"]');
  await detail.getByText('Case options', { exact: true }).click();
  await openCaseSection(page, 'History');
  for (const [label, value] of [['Case update time', updatedAt], ['Case opening time', openedAt], ['note time', noteAt]] as const) {
    const control = detail.getByRole('button', { name: new RegExp(`Copy exact ${label}:`, 'u') });
    await expect(control).toHaveAttribute('title', value);
    await expect(control.locator('time')).toHaveAttribute('datetime', value);
    await expect(control.locator('time')).toContainText('UTC');
    await expect(control).toHaveAccessibleName(`${await control.locator('time').innerText()} Copy exact ${label}: ${value}`);
    await control.focus();
    await control.press('Enter');
    await expect.poll(() => copied.at(-1)).toBe(value);
    await expect(control).toBeFocused();
    await expect(detail.getByText(`Exact ${label} copied.`, { exact: true })).toHaveCount(1);
  }
  expect(copied).toEqual([updatedAt, openedAt, noteAt]);
  refuseCopy = true;
  await detail.getByRole('button', { name: /Copy exact note time:/u }).click();
  await expect(detail.locator('.notes .evidence-timestamp code')).toHaveText(noteAt);
  await expect(detail.getByText('Clipboard unavailable. Select the exact timestamp below.', { exact: true })).toBeVisible();
  await expect(detail).not.toContainText('Private clipboard failure');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
      await expect(detail.getByRole('button', { name: /Copy exact Case update time:/u })).toBeVisible();
      await expect(detail.getByRole('button', { name: /Copy exact Case opening time:/u })).toBeVisible();
      await expect(detail.locator('.notes .evidence-timestamp code')).toBeVisible();
      for (const name of [/Copy exact Case update time:/u, /Copy exact Case opening time:/u, /Copy exact note time:/u]) {
        const control = detail.getByRole('button', { name });
        await control.focus();
        await expectFocusedResultsVisible(page, control, control);
      }
      if (captureVisualEvidenceEnabled()) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: testInfo.outputPath(`case-times-${theme}-${width}.png`), fullPage: true });
      }
    }
  }
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 })).toEqual(before);
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await expect(search).toHaveValue('first-work');
  await expect(page.locator('.case-head')).toHaveCount(1);
  await expect(row).toBeFocused();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'first-work.example', exact: true })).toBeVisible();
});

test('Case section changes preserve independent drafts and browser history without collecting', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/lookup**', async route => { requests.push(route.request().url()); await route.abort(); });
  await seedCases(page, '/cases?case=workspace-first');
  await openCaseSection(page, 'History');
  await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Unsaved note');
  await page.getByRole('textbox', { name: 'What did you do or decide?', exact: true }).fill('Unsaved manual step');
  await openCaseSection(page, 'Assessment');
  await page.getByRole('textbox', { name: 'Conclusion summary', exact: true }).fill('Unsaved conclusion');
  await openCaseSection(page, 'Response');
  await page.getByRole('textbox', { name: 'Recipient or owner', exact: true }).fill('Unsaved recipient');
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Conclusion summary', exact: true })).toHaveValue('Unsaved conclusion');
  await openCaseSection(page, 'History');
  await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('Unsaved note');
  await expect(page.getByRole('textbox', { name: 'What did you do or decide?', exact: true })).toHaveValue('Unsaved manual step');
  await openCaseSection(page, 'Response');
  await expect(page.getByRole('textbox', { name: 'Recipient or owner', exact: true })).toHaveValue('Unsaved recipient');
  expect(requests).toEqual([]);
});

test('pointer activation is not displaced when an enclosing Case section receives focus', async ({ page }) => {
  await seedCases(page, '/cases?case=workspace-first&section=response&response=1');
  const phases = page.getByRole('navigation', { name: 'Response-packet phases', exact: true });
  const target = phases.getByRole('button', { name: /Export and record/u });
  await target.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(target).toBeInViewport();
  const point = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const response = page.locator('.response-workspace');
  expect(await response.evaluate(element => element.getBoundingClientRect().top
    < document.querySelector('.case-sections')!.getBoundingClientRect().bottom)).toBe(true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  try {
    const before = await page.evaluate(() => scrollY);
    // Some engines focus an enclosing section during a button's pointer press.
    await response.evaluate(element => (element as HTMLElement).focus({ preventScroll: true }));
    expect(await page.evaluate(() => scrollY)).toBe(before);
    expect(await target.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), point)).toBe(true);
  } finally { await page.mouse.up(); }
  await expect(target).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#packet-wizard-step-workspace-first-8')).toBeFocused();
});

test('Case sections retain reading position and keep the assessment evidence and keyboard focus usable', async ({ page }, testInfo) => {
  const pin = {
    id: 'continuity-pin', checkpointId: null, field: 'http.status', category: 'http', label: 'Observed response',
    value: 'The retained observation supports review, not a new collection.', source: 'Fixture observation',
    sourceState: 'complete', sourceSchema: null, observedAt: '2026-09-01T00:00:00.000Z', collectionDepth: 'deep',
    completeness: 'complete', truncated: false, transitionExpectation: null, limitations: [], createdAt: '2026-09-01T00:00:00.000Z',
  };
  await page.goto('/cases');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [caseRecord({
      id: 'continuity-case', domain: 'continuity.invalid', evidencePins: [pin],
      notes: Array.from({ length: 30 }, (_, index) => ({ createdAt: '2026-09-01T00:00:00.000Z', body: `Review ${index + 1}: ${'Retained source context. '.repeat(15)}` })),
    })] }),
  }, { destination: '/cases?case=continuity-case&section=history' });
  const note = page.locator('.notes li').nth(10);
  await note.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const position = await page.evaluate(() => window.scrollY);
  const nav = page.getByRole('navigation', { name: 'Case sections', exact: true });
  await expect(nav).toBeInViewport({ ratio: 1 });
  await openCaseSection(page, 'Assessment');
  const summary = page.getByRole('textbox', { name: 'Conclusion summary', exact: true });
  await summary.fill('Keep this draft while reading');
  await openCaseSection(page, 'History');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(position, 0);
  await expect(note).toBeInViewport();
  await openCaseSection(page, 'Assessment');
  await expect(summary).toHaveValue('Keep this draft while reading');
  const evidence = page.getByRole('group', { name: 'Evidence considered', exact: true });
  const draft = page.locator('.assessment-draft');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440]] as const) {
      await page.setViewportSize({ width, height });
      await expect(evidence).toBeVisible();
      if (width <= 600) {
        const selector = nav.getByRole('combobox', { name: 'Case section', exact: true });
        await expect(selector).toBeVisible();
        await expect(selector).toHaveValue('assessment');
        await expect(selector.locator('option')).toHaveText(['Summary', 'Evidence', 'Assessment', 'Response', 'History']);
        expect((await selector.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(nav.getByRole('link', { includeHidden: true })).toHaveCount(5);
        await expect(nav.getByRole('link', { name: 'Evidence', includeHidden: true })).toBeHidden();
      } else {
        await expect(nav.getByRole('link')).toHaveCount(5);
        expect(await nav.getByRole('link').evaluateAll(links => links.every(link => {
          const range = document.createRange(); range.selectNodeContents(link);
          return range.getClientRects().length === 1 && link.scrollWidth <= link.clientWidth;
        }))).toBe(true);
      }
      const layout = await evidence.evaluate(element => {
        const evidence = element.getBoundingClientRect();
        const draft = document.querySelector('.assessment-draft')!.getBoundingClientRect();
        return { evidenceX: evidence.x, evidenceY: evidence.y, draftRight: draft.right, draftBottom: draft.bottom, draftY: draft.y };
      });
      if (width >= 1200) { expect(layout.evidenceX).toBeGreaterThan(layout.draftRight); expect(Math.abs(layout.evidenceY - layout.draftY)).toBeLessThan(2); }
      else expect(layout.evidenceY).toBeGreaterThan(layout.draftBottom);
      await summary.focus();
      await page.keyboard.press('Tab');
      const rationale = page.getByRole('textbox', { name: 'Evidence-based rationale', exact: true });
      await expect(rationale).toBeFocused();
      const focus = await rationale.boundingBox();
      const navigation = await nav.boundingBox();
      expect(focus && navigation && focus.y >= navigation.y + navigation.height).toBe(true);
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`case-continuity-${theme}-${width}.png`), animations: 'disabled' }); }
    }
  }
  await expect(draft).toContainText('Analyst confidence');
});

test('a committed Case history write with a failed reread is not offered as a failed save', async ({ page }) => {
  await seedCases(page, '/cases?case=workspace-first&section=history');
  await expect(page.getByRole('textbox', { name: 'What did you do or decide?', exact: true })).toBeVisible();
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await page.getByRole('textbox', { name: 'What did you do or decide?', exact: true }).fill('Reviewed the retained evidence');
  await page.getByRole('button', { name: 'Record manual step', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('The change was saved, but cases could not be reread.');
  await expect(page.getByRole('textbox', { name: 'What did you do or decide?', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Record manual step', exact: true })).toBeFocused();
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(saved.records.find(item => item.value.id === 'workspace-first')?.value.manualTrail).toHaveLength(1);
});

test('legacy response deep links still open the packet and Case follow-up keeps an exact scope', async ({ page }) => {
  await seedCases(page, '/monitor?view=cases&case=workspace-first&response=1#case-response-workspace-first');
  await expect(page).toHaveURL('/cases?case=workspace-first&response=1#case-response-workspace-first');
  await expect(page.getByRole('navigation', { name: 'Case sections' }).getByRole('link', { name: 'Response', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#case-response-preflight-workspace-first')).toHaveAttribute('open', '');
  await expect(page.locator('#case-response-preflight-workspace-first > summary')).toBeFocused();
  await openCaseSection(page, 'History');
  await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Keep this draft through response navigation');
  await page.goBack();
  await expect(page.locator('#case-response-preflight-workspace-first > summary')).toBeFocused();
  await expect(page.locator('#case-response-preflight-workspace-first > summary')).toBeInViewport({ ratio: 1 });
  await page.goForward();
  await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('Keep this draft through response navigation');
  await Promise.all([
    page.waitForEvent('dialog').then(async dialog => {
      try {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toMatch(/\b(?:unsaved|not saved)\b/iu);
        expect(dialog.message()).toMatch(/\b(?:lose|discard)\b/iu);
      }
      finally { await dialog.accept(); }
    }),
    page.getByRole('link', { name: 'Review follow-up', exact: true }).click(),
  ]);
  await expect(page).toHaveURL('/monitor?view=inbox&queue=all&case-review=workspace-first');
  const inbox = page.getByRole('region', { name: 'Review inbox', exact: true });
  const clearCaseScope = inbox.getByRole('link', { name: 'Show all Cases', exact: true });
  await expect(clearCaseScope).toBeVisible();
  await expect(clearCaseScope).toHaveAttribute('href', '/monitor?view=inbox&queue=all');
  await clearCaseScope.click();
  await expect(page).toHaveURL('/monitor?view=inbox&queue=all');
});

test('a Case history return preserves focus moved outside the outgoing section', async ({ page }) => {
  await seedCases(page, '/cases?case=workspace-first&response=1#case-response-workspace-first');
  await expect(page.locator('#case-response-preflight-workspace-first > summary')).toBeFocused();
  await openCaseSection(page, 'History');
  await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('Keep this unsaved note');
  const laterControl = page.getByRole('button', { name: 'Sign out', exact: true });
  await laterControl.evaluate(element => {
    window.addEventListener('popstate', () => queueMicrotask(() => element.focus()), { once: true });
  });
  await page.goBack();
  await expect(page.getByRole('navigation', { name: 'Case sections' }).getByRole('link', { name: 'Response', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#case-response-preflight-workspace-first')).toHaveAttribute('open', '');
  await expect(laterControl).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('Keep this unsaved note');
});

for (const theme of ['light', 'dark'] as const) {
  test(`Case sections stay usable across mobile and wide desktop in ${theme}`, async ({ page }, testInfo) => {
    await seedCases(page, '/cases?case=workspace-first');
    await useTheme(page, theme);
    for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
      await page.setViewportSize(viewport);
      for (const section of ['Summary', 'Evidence', 'Assessment', 'Response', 'History'] as const) {
        await openCaseSection(page, section);
        await expectNoHorizontalOverflow(page);
      }
      await openCaseSection(page, 'Summary');
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`case-${theme}-${viewport.width}.png`), fullPage: true }); }
    }
  });
}
