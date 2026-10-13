import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { COMMAND_NAVIGATION_READINESS, openInboxReview, inboxReviewControls } from './console-navigation';
import { beginBrowserInteractionReadiness, isBrowserInteractionReadinessMarked, readBrowserInteractionReadiness } from './performance-sampling';
import { caseRecord, createCase, snapshot, openCaseResponseWorkspace } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { expectNoHorizontalOverflow, failNextBrowserLocalCollectionRead, failNextBrowserLocalManifestWrite, holdBrowserLocalTransaction, migrateLegacyBrowserData, openDashboardSecondaryWorkspaces, readBrowserLocalCollection, useTheme } from './helpers';
import { productionChunkPath } from './production-build';
import { caseNumber } from '../packages/cases/case-workflow-metadata.mts';
import { createWorkspace, indicator, namedDatabase, switchWorkspace } from './browser-workspace-fixtures';

test('navigation readiness includes loaded, usable destinations rather than only the dialog shell', async ({ page }) => {
  const chunk = productionChunkPath('src/lib/console-command-navigation.ts');
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${chunk}`, async route => { await pending; await route.continue(); });
  try {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Search console navigation', exact: true })).toBeEnabled();
    await beginBrowserInteractionReadiness(page, { start: { event: 'keydown', key: 'k', controlOrMeta: true }, targets: COMMAND_NAVIGATION_READINESS });
    await page.keyboard.press('Control+K');
    const dialog = page.getByRole('dialog', { name: 'Go to' });
    await expect(dialog.getByRole('combobox')).toBeEnabled();
    await expect(dialog.getByRole('status').filter({ hasText: 'Loading destinations' })).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await isBrowserInteractionReadinessMarked(page)).toBe(false);
    release();
    await readBrowserInteractionReadiness(page);
    await expect(dialog.getByRole('option').first()).toBeVisible();
    await dialog.getByRole('combobox').fill('lookup');
    await expect(dialog.getByRole('option', { name: /^Lookup /u })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Search console navigation', exact: true })).toBeFocused();
  } finally { release(); }
});

test('search remains escapable while its destinations are loading or unavailable', async ({ page }) => {
  const chunk = productionChunkPath('src/lib/console-command-navigation.ts');
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${chunk}`, async route => {
    await pending;
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'throw new Error("Synthetic navigation module failure");' });
  });
  try {
    await page.goto('/dashboard');
    const trigger = page.getByRole('button', { name: 'Search console navigation', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Go to' });
    await expect(dialog.getByRole('status').filter({ hasText: 'Loading destinations' })).toBeVisible();
    await expect(dialog).not.toContainText('No matching destination');
    await expect(dialog.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    release();
    await trigger.click();
    await expect(dialog.getByRole('alert')).toContainText('Destinations could not be loaded');
    await expect(dialog.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByRole('button', { name: 'Reload destinations', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Saved work', exact: true }).click();
    await expect(dialog.getByRole('searchbox', { name: 'Search saved work' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.unroute(`**${chunk}`);
    await trigger.click();
    await dialog.getByRole('button', { name: 'Pages and tools', exact: true }).click();
    await dialog.getByRole('button', { name: 'Reload destinations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await trigger.click();
    await expect(dialog.getByRole('combobox')).toBeFocused();
    await expect(dialog.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByRole('option').first()).toBeVisible();
  } finally { release(); }
});

test('Dashboard rereads peer-tab saved work on focus and recovers a failed read without writing', async ({ page, context }) => {
  const collectionRequests: string[] = [];
  await context.route('**/api/lookup**', async route => { collectionRequests.push(route.request().url()); await route.abort(); });
  await seedWork(page);
  const recent = page.getByRole('region', { name: 'Recent Cases', exact: true });
  await expect(recent).toContainText('review.example');
  const peer = await context.newPage();
  try {
    await peer.goto('/cases');
    await createCase(peer, 'second-review.example');
    await page.bringToFront();
    const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
    // Chromium automation keeps every page focused; deliver the reactivation
    // event explicitly without reloading, altering storage or invoking app code.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(recent).toContainText('second-review.example');
    await expect(page).toHaveURL('/dashboard');
    await failNextBrowserLocalCollectionRead(page, 'cases');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const retry = page.getByRole('button', { name: 'Refresh saved-work summary', exact: true });
    await expect(retry).toBeEnabled();
    await expect(recent).toContainText('Cases could not be read');
    await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toHaveCount(0);
    await retry.click();
    await expect(recent).toContainText('second-review.example');
    await expect(retry).toHaveCount(0);
    await expect(recent.getByRole('heading', { name: 'Recent Cases', exact: true })).toBeFocused();
    await failNextBrowserLocalCollectionRead(page, 'cases');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(retry).toBeEnabled();
    const target = page.getByRole('textbox', { name: 'Investigate a target', exact: true });
    const release = await holdBrowserLocalTransaction(page);
    try {
      await retry.click();
      await expect(retry).toBeDisabled();
      await target.fill('unsaved.example');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    } finally { await release(); }
    await expect(retry).toHaveCount(0);
    await expect(target).toBeFocused();
    await expect(target).toHaveValue('unsaved.example');
    const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
    expect(after.manifest.revision).toBe(before.manifest.revision);
    expect(after.records).toEqual(before.records);
    expect(collectionRequests).toEqual([]);
  } finally { await peer.close(); }
});

async function seedWork(page: import('@playwright/test').Page) {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [caseRecord({
      id: 'navigation-case', domain: 'review.example',
      evidenceHistory: [snapshot({ riskModelVersion: null, profileContextState: 'unavailable' })],
    })] },
  }, { clearStorage: true, destination: '/dashboard' });
}

test('Dashboard opens its exact attention set and retains a direct recent Case destination', async ({ page }) => {
  const collectionRequests: string[] = [];
  await page.route('**/api/lookup**', async route => { collectionRequests.push(route.request().url()); await route.abort(); });
  await seedWork(page);
  const items = page.getByRole('list', { name: 'Items needing attention' });
  await expect(items.getByRole('link').first()).toBeVisible();
  const title = await items.getByRole('link').first().innerText();
  await page.getByRole('link', { name: 'Open review inbox', exact: true }).click();
  await expect(page).toHaveURL('/monitor?view=inbox&attention=1');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Attention needed' })).toBeVisible();
  await page.goBack();
  await page.getByRole('region', { name: 'Recent Cases' }).getByRole('link', { name: /review\.example/ }).click();
  await expect(page).toHaveURL('/cases?case=navigation-case');
  await expect(page.locator('#case-head-navigation-case')).toBeVisible();
  expect(collectionRequests).toEqual([]);
});

test('held checkpoint reads cannot restore cleared references or cross an actual workspace switch', async ({ page }) => {
  const caseId = 'held-checkpoint-case';
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [
    caseRecord({ id: caseId, domain: 'retained-checkpoint.example', notes: [{ createdAt: '2026-06-01T00:00:00.000Z', body: 'Private checkpoint note' }], evidenceHistory: [snapshot({ pageTitle: 'Private observation title' })] }),
  ] } }, { clearStorage: true, destination: '/dashboard' });
  const replacement = await createWorkspace(page, 'Separate checkpoint review');
  const original = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const retainedCase = original.records.find(row => row.value.id === caseId)!.value;
  expect(retainedCase.notes[0]!.body).toBe('Private checkpoint note');
  expect(retainedCase.evidenceHistory[0]!.pageTitle).toBe('Private observation title');
  const checkpoint = retainedCase.evidenceHistory[0]!.id;
  const collections: string[] = [];
  page.on('request', request => { if (/\/api\/(lookup|bulk|domain-feed|discover)(?:[/?]|$)/u.test(request.url())) collections.push(request.url()); });

  for (const action of ['clear', 'replace'] as const) {
    await page.goto(`/cases?case=${caseId}&section=evidence`);
    await page.getByRole('button', { name: `Pin checkpoint ${checkpoint} for comparison`, exact: true }).click();
    await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(indicator(page)).toHaveText('Default');
    await expect(page.locator('.recent-cases')).toContainText('retained-checkpoint.example');
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const binding = `holdPinnedCheckpointRead_${action}`;
    await page.exposeFunction(binding, async () => { entered(); await held; });
    await page.evaluate(({ id, binding }) => {
      const originalDigest = SubtleCrypto.prototype.digest;
      SubtleCrypto.prototype.digest = async function(algorithm, input) {
        const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
        if (!new TextDecoder().decode(bytes).includes(id)) return originalDigest.call(this, algorithm, input);
        SubtleCrypto.prototype.digest = originalDigest;
        const digest = await originalDigest.call(this, algorithm, input);
        await (window as unknown as Record<string, () => Promise<void>>)[binding]!();
        (window as unknown as Record<string, boolean>)[`${binding}Completed`] = true;
        return digest;
      };
    }, { id: caseId, binding });
    try {
      await page.getByText('Tab references', { exact: true }).click();
      const tray = page.getByText('Pinned checkpoints · 1 of 4', { exact: true }).and(page.locator('summary')).locator('..');
      await tray.locator(':scope > summary').click();
      await started;
      await expect(tray.getByRole('status')).toHaveText('Reading retained checkpoints…');
      await expect(tray.getByRole('checkbox')).toBeDisabled();
      if (action === 'clear') {
        await tray.getByRole('button', { name: 'Clear pinned checkpoints', exact: true }).click();
        await expect(tray).toHaveCount(0);
      } else {
        await switchWorkspace(page, replacement.name);
        await expect(indicator(page)).toHaveText(replacement.name);
      }
      release();
      // On clear, prove the held native operation returned before inspecting
      // its UI consequences. A workspace switch instead destroys that realm.
      if (action === 'clear') await page.waitForFunction(key => (window as unknown as Record<string, boolean>)[key] === true, `${binding}Completed`);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByRole('list', { name: 'Pinned Case checkpoint references', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Case checkpoint stage', exact: true })).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Private checkpoint note');
      await expect(page.locator('body')).not.toContainText('Private observation title');
      await expect(page.locator('body')).not.toContainText(checkpoint);
      await expect(page.getByRole('alert').filter({ hasText: 'retained Cases could not be read' })).toHaveCount(0);
      expect(await readBrowserLocalCollection(page, 'cases')).toEqual(original);
      if (action === 'replace') {
        await expect(page.locator('body')).not.toContainText('retained-checkpoint.example');
        expect((await readBrowserLocalCollection(page, 'cases', { databaseName: namedDatabase(replacement.id) })).records).toEqual([]);
      }
    } finally { release(); }
  }
  expect(collections).toEqual([]);
});

test('pinned checkpoints and successful Case visits survive Console navigation without retaining new evidence', async ({ page }, testInfo) => {
  const history = Array.from({ length: 5 }, (_, index) => snapshot({ id: `tray-snapshot-${index}`, capturedAt: `2000-01-0${index + 1}T00:00:00.000Z`, firstCapturedAt: `2000-01-0${index + 1}T00:00:00.000Z`, pageTitle: `Supplied observation ${index}` }));
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [
    caseRecord({ id: 'tray-case', domain: 'tray.example', evidenceHistory: history }),
    caseRecord({ id: 'other-tray-case', domain: 'other-tray.example', evidenceHistory: [snapshot({ id: 'other-snapshot' })] }),
  ] } }, { clearStorage: true, destination: '/cases?case=tray-case&section=evidence' });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const retained = [...before.records.find(item => item.value.id === 'tray-case')!.value.evidenceHistory]
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  expect(retained.map(item => ({ at: item.capturedAt, title: item.pageTitle }))).toEqual(history.map(item => ({ at: item.capturedAt, title: item.pageTitle })));
  const ids = retained.map(item => item.id); expect(new Set(ids).size).toBe(5);
  const pin = (id: string) => page.getByRole('button', { name: `Pin checkpoint ${id} for comparison`, exact: true });
  await expect(pin(ids[0]!)).toBeVisible(); await pin(ids[0]!).focus(); await page.keyboard.press('Enter');
  for (const id of ids.slice(1, 4)) await pin(id).click();
  await pin(ids[0]!).click(); await expect(page.getByRole('status').filter({ hasText: 'already pinned' })).toBeVisible();
  await pin(ids[4]!).click(); await expect(page.getByRole('status').filter({ hasText: 'Four checkpoints are already pinned' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Lookup', exact: true }).click();
  await page.getByText('Tab references', { exact: true }).click();
  const tray = page.getByText('Pinned checkpoints · 4 of 4', { exact: true }).and(page.locator('summary')).locator('..');
  await tray.locator(':scope > summary').click();
  const references = tray.getByRole('list', { name: 'Pinned Case checkpoint references', exact: true });
  await expect(references.locator('li')).toHaveCount(4);
  await expect(references).not.toContainText(ids[4]!);
  const preferences = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
  for (const id of ids) expect(preferences).not.toContain(id);
  for (const id of [ids[0]!, ids[2]!]) await references.locator('label').filter({ hasText: id }).getByRole('checkbox').check();
  await tray.getByRole('button', { name: 'Review selected checkpoints', exact: true }).click();
  const stage = tray.getByRole('region', { name: 'Case checkpoint stage', exact: true });
  await expect(stage.getByRole('combobox', { name: 'Case for checkpoint review', exact: true })).toHaveValue('tray-case');
  const interval = stage.getByRole('combobox', { name: 'Interval to inspect', exact: true });
  await expect(interval).toBeVisible(); await interval.selectOption({ index: 1 });
  await expect(stage.getByRole('heading', { name: 'Selected checkpoint interval', exact: true })).toBeVisible();
  await expect(stage.getByRole('region', { name: 'Earlier selected checkpoint', exact: true })).toContainText(ids[0]!);
  await expect(stage.getByRole('region', { name: 'Later selected checkpoint', exact: true })).toContainText(ids[2]!);
  await stage.getByRole('button', { name: 'Clear stage', exact: true }).click();
  await expect(stage.getByRole('combobox', { name: 'Case for checkpoint review', exact: true })).toHaveValue('');
  await tray.getByRole('button', { name: 'Review selected checkpoints', exact: true }).click();
  await expect(interval).toBeVisible(); await interval.selectOption({ index: 1 });
  await expect(stage.getByRole('region', { name: 'Later selected checkpoint', exact: true })).toContainText(ids[2]!);
  await stage.getByRole('combobox', { name: 'Case for checkpoint review', exact: true }).selectOption('');
  await tray.getByRole('button', { name: 'Review selected checkpoints', exact: true }).click();
  await expect(interval).toBeVisible(); await interval.selectOption({ index: 1 });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 }); await expectNoHorizontalOverflow(page);
      await references.getByRole('button', { name: `Remove pinned checkpoint tray-case ${ids[3]!}`, exact: true }).focus();
      await expect(references.getByRole('button', { name: `Remove pinned checkpoint tray-case ${ids[3]!}`, exact: true })).toBeFocused();
      if (captureVisualEvidenceEnabled()) await tray.screenshot({ path: testInfo.outputPath(`checkpoint-tray-${theme}-${width}.png`) });
    }
  }
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 })).manifest).toEqual(before.manifest);
  await page.setViewportSize({ width: 1280, height: 720 });
  const visits = page.getByText('Navigation trail · 1', { exact: true }).and(page.locator('summary')).locator('..');
  await visits.locator(':scope > summary').click();
  await visits.getByRole('link', { name: /Case tray-case · Evidence/u }).click();
  await expect(page).toHaveURL('/cases?case=tray-case&section=evidence');
  await expect(page.getByRole('heading', { name: 'tray.example', exact: true })).toBeVisible();
  await openCaseResponseWorkspace(page);
  const form = page.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  await form.locator(':scope > summary').click();
  await failNextBrowserLocalManifestWrite(page, 'case_drafts');
  await form.getByLabel('Label', { exact: true }).fill('Unprotected navigation control');
  await expect(form.getByRole('status')).toContainText('could not be saved for recovery');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Lookup', exact: true }).click();
  await expect(page).toHaveURL('/cases?case=tray-case&section=evidence');
  await expect(page.getByText('Navigation trail · 1', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Discard this draft', exact: true }).click();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Lookup', exact: true }).click();
  if (await tray.getAttribute('open') === null) await tray.locator(':scope > summary').click();
  await tray.getByRole('button', { name: 'Clear pinned checkpoints', exact: true }).click();
  await expect(page.getByText(/Pinned checkpoints ·/u)).toHaveCount(0);
  const publicLink = page.getByRole('link', { name: /^Privacy \(opens in a new tab\)$/u });
  // Exercise same-tab Console departure instead of the footer's normal new tab.
  await publicLink.evaluate(element => element.removeAttribute('target'));
  await publicLink.click();
  await expect(page).toHaveURL('/privacy');
  await page.goBack();
  await expect(page.getByText(/Navigation trail ·/u)).toHaveCount(0);
});

test('tab favourites resolve exact retained Cases and canonical destinations without storing another entity', async ({ page }, testInfo) => {
  const requests: string[] = [];
  await page.route(/\/api\/(lookup|dns|tls|certificates?|certificate-transparency)(\/|\?|$)/u, async route => { requests.push(route.request().url()); await route.abort(); });
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [
    caseRecord({ id: 'favourite-case', domain: 'favourite.example' }),
    caseRecord({ id: 'other-favourite-case', domain: 'favourite.example' }),
  ] } }, { clearStorage: true, destination: '/cases?case=favourite-case&section=evidence' });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const preferencesSnapshot = () => page.evaluate(() => {
    const local = { ...localStorage };
    delete local['whoisleuth:theme:v1']; // The rendered theme matrix deliberately changes this existing preference.
    return { local, session: { ...sessionStorage } };
  });
  const preferencesBefore = await preferencesSnapshot();
  const sidebar = page.locator('#console-navigation');
  const open = async () => {
    const toggle = page.getByRole('button', { name: 'Toggle navigation', exact: true });
    if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    const summary = sidebar.getByText('Favourites in this tab', { exact: true });
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
    const favourites = sidebar.getByRole('region', { name: 'Favourites in this tab', exact: true });
    await expect(favourites.getByRole('button', { name: 'Add destination favourite', exact: true })).toBeEnabled();
    return favourites;
  };
  let favourites = await open();
  await expect(favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true })).toBeEnabled();
  await favourites.getByRole('combobox', { name: 'Case section', exact: true }).selectOption('evidence');
  await favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true }).click();
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await page.getByRole('link').and(page.locator('a[href="/cases?case=other-favourite-case"]')).click();
  favourites = await open();
  await expect(favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true })).toBeEnabled();
  await favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true }).click();
  await favourites.getByRole('combobox', { name: 'Tool or reference', exact: true }).selectOption('/lookup');
  await favourites.getByRole('button', { name: 'Add destination favourite', exact: true }).click();
  await favourites.getByRole('combobox', { name: 'Tool or reference', exact: true }).selectOption('/cli');
  await favourites.getByRole('button', { name: 'Add destination favourite', exact: true }).click();
  const links = favourites.getByRole('navigation', { name: 'Favourite destinations', exact: true });
  await expect(links.getByRole('link')).toHaveCount(4);
  const caseLink = links.getByRole('link', { name: `favourite.example · Evidence ${caseNumber('favourite-case')}`, exact: true });
  const otherLink = links.getByRole('link', { name: `favourite.example · Evidence ${caseNumber('other-favourite-case')}`, exact: true });
  await expect(caseLink).toHaveAttribute('href', '/cases?case=favourite-case&section=evidence');
  await expect(otherLink).toHaveAttribute('href', '/cases?case=other-favourite-case&section=evidence');
  await otherLink.click();
  favourites = await open();
  await expect(otherLink).toHaveAttribute('aria-current', 'page');
  await favourites.getByRole('combobox', { name: 'Case section', exact: true }).selectOption('response');
  await favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true }).click();
  const responseLink = links.getByRole('link', { name: `favourite.example · Response ${caseNumber('other-favourite-case')}`, exact: true });
  // Exercise a supported retained URL through ordinary same-document link navigation.
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/cases?case=other-favourite-case&response=1'; link.textContent = 'Open retained response fixture';
    document.getElementById('main-content')!.append(link);
  });
  const legacy = page.getByRole('link', { name: 'Open retained response fixture', exact: true });
  await legacy.click();
  await expect(responseLink).toHaveAttribute('aria-current', 'page');
  await expect(otherLink).not.toHaveAttribute('aria-current', 'page');
  await legacy.evaluate(link => link.remove());
  await expect(links.locator('a[href="/cli"]')).toHaveAttribute('target', '_blank');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 2560]) {
      await page.setViewportSize({ width, height: 844 }); favourites = await open();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await favourites.screenshot({ path: testInfo.outputPath(`favourites-${theme}-${width}.png`) });
    }
    expect((await new AxeBuilder({ page }).include('.sidebar-favourites').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  await links.getByRole('link', { name: 'Lookup', exact: true }).click();
  await expect(page).toHaveURL(/\/lookup$/u); favourites = await open();
  await caseLink.click(); await expect(page).toHaveURL(/\/cases\?case=favourite-case&section=evidence$/u);
  await expect(page.locator('#case-head-favourite-case').getByRole('heading', { name: 'favourite.example', exact: true })).toBeVisible();
  await expect(favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true })).toBeEnabled();
  const favouritesSummary = sidebar.getByText('Favourites in this tab', { exact: true });
  await favouritesSummary.click();
  const heldRead = await page.evaluateHandle(() => {
    const original = SubtleCrypto.prototype.digest;
    let reached!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { reached = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    SubtleCrypto.prototype.digest = async function(algorithm, input) {
      const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
      if (!new TextDecoder().decode(bytes).includes('favourite-case')) return original.call(this, algorithm, input);
      SubtleCrypto.prototype.digest = original;
      await original.call(this, algorithm, input);
      reached(); await held;
      throw new Error('Synthetic superseded retained read');
    };
    return { wait: () => started, release: () => { SubtleCrypto.prototype.digest = original; release(); } };
  });
  try {
    favourites = await open(); await heldRead.evaluate(control => control.wait());
    await expect(favourites.getByRole('status').filter({ hasText: 'Reading retained Case references' })).toBeVisible();
    await favourites.getByRole('button', { name: 'Clear favourites', exact: true }).click();
    await expect(favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true })).toBeEnabled();
    await heldRead.evaluate(control => control.release());
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await expect(favourites.getByRole('alert')).toHaveCount(0);
    await expect(favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true })).toBeEnabled();
    await expect(links).toHaveCount(0);
  } finally { await heldRead.evaluate(control => control.release()); await heldRead.dispose(); }
  await favourites.getByRole('combobox', { name: 'Case section', exact: true }).selectOption('evidence');
  await favourites.getByRole('button', { name: 'Add selected Case favourite', exact: true }).click();
  const caseOptions = page.getByText('Case options', { exact: true }).and(page.locator('summary'));
  if (await caseOptions.locator('..').getAttribute('open') === null) await caseOptions.click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete case', exact: true }).click();
  favourites = await open(); await expect(favourites).toContainText('no longer retained');
  await expect(caseLink).toHaveCount(0);
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records.map(item => item.value.id)).toEqual(['other-favourite-case']);
  expect(await preferencesSnapshot()).toEqual(preferencesBefore);
  await favourites.getByRole('button', { name: 'Clear favourites', exact: true }).click();
  await expect(links).toHaveCount(0);
  await expect(favourites.getByRole('status').filter({ hasText: 'Favourites cleared' })).toBeFocused();
  expect(requests).toEqual([]);
});

test('a selected Dashboard review opens Case assessment and returns to the same inbox item', async ({ page }) => {
  const collectionRequests: string[] = [];
  await page.route('**/api/lookup**', async route => { collectionRequests.push(route.request().url()); await route.abort(); });
  await seedWork(page);
  const attention = page.getByRole('list', { name: 'Items needing attention' }).getByRole('link').first();
  const title = await attention.innerText();
  await attention.click();
  await expect(page).toHaveURL(/\/monitor\?view=inbox&attention=1&review=/u);
  const inboxUrl = new URL(page.url());
  const returnHref = `${inboxUrl.pathname}${inboxUrl.search}${inboxUrl.hash}`;
  const selected = await openInboxReview(inboxReviewControls(page, title));
  const review = selected.getByRole('link', { name: 'Review', exact: true });
  await expect(review).toHaveAttribute('href', '/cases?case=navigation-case&section=assessment');
  await review.click();
  await expect(page.getByRole('navigation', { name: 'Case sections', exact: true }).getByRole('link', { name: 'Assessment', exact: true })).toHaveAttribute('aria-current', 'page');
  const returnLink = page.getByRole('link', { name: 'Return to review inbox', exact: true });
  await expect(returnLink).toHaveAttribute('href', returnHref);
  await returnLink.click();
  await expect(page).toHaveURL(returnHref);
  await expect(selected).toBeVisible();
  expect(collectionRequests).toEqual([]);
});

test('global saved-work search opens an existing Case without collecting and restores keyboard focus', async ({ page }) => {
  const collectionRequests: string[] = [];
  await page.route('**/api/lookup**', async route => { collectionRequests.push(route.request().url()); await route.abort(); });
  await seedWork(page);
  await page.goto('/lookup');
  const trigger = page.getByRole('button', { name: 'Search console navigation', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  await dialog.getByRole('button', { name: 'Saved work', exact: true }).click();
  const search = dialog.getByRole('searchbox', { name: 'Search saved work' });
  await expect(search).toBeFocused();
  await search.fill('review.example');
  const result = dialog.getByRole('list', { name: 'Local investigation search results' });
  await expect(result).toContainText('review.example');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Saved work', exact: true }).click();
  await dialog.getByRole('searchbox', { name: 'Search saved work' }).fill('review.example');
  await result.getByRole('link', { name: /^Open case/ }).click();
  await expect(page).toHaveURL('/cases?case=navigation-case');
  await expect(dialog).toHaveCount(0);
  expect(collectionRequests).toEqual([]);
});

test('review and monitoring navigation expose their own views and preserve history', async ({ page }) => {
  await page.goto('/monitor');
  const tabs = page.getByRole('tablist', { name: 'Monitor views' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await tabs.getByRole('tab', { name: /^Inbox/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /^Campaigns/ })).toBeFocused();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Monitoring', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(tabs.getByRole('tab', { name: /^Watchlists/ })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(tabs.getByRole('tab', { name: /^Campaigns/ })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/monitor?view=cases&case=navigation-case#case-response-navigation-case');
  await expect(page).toHaveURL('/cases?case=navigation-case#case-response-navigation-case');
});

test('global and embedded saved-work search keep independent labels and query drafts', async ({ page }) => {
  await seedWork(page);
  await openDashboardSecondaryWorkspaces(page);
  const embedded = page.getByRole('region', { name: 'Search saved work', exact: true });
  const embeddedInput = embedded.getByRole('searchbox', { name: 'Search saved work' });
  await embeddedInput.fill('embedded query');
  const embeddedId = await embeddedInput.getAttribute('id');
  await page.getByRole('button', { name: 'Search console navigation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  await dialog.getByRole('button', { name: 'Saved work', exact: true }).click();
  const globalInput = dialog.getByRole('searchbox', { name: 'Search saved work' });
  await expect(globalInput).toBeFocused();
  const globalId = await globalInput.getAttribute('id');
  expect(globalId).toBeTruthy();
  expect(globalId).not.toBe(embeddedId);
  await dialog.locator('label').filter({ hasText: 'Search saved work' }).click();
  await expect(globalInput).toBeFocused();
  await globalInput.fill('review.example');
  await expect(dialog.getByRole('list', { name: 'Local investigation search results' })).toContainText('review.example');
  await page.keyboard.press('Escape');
  await expect(embeddedInput).toHaveValue('embedded query');
});

for (const theme of ['light', 'dark'] as const) {
  test(`console work queue remains usable from mobile to wide desktop in ${theme}`, async ({ page }, testInfo) => {
    await seedWork(page);
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920, 2560]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await expect(page.getByRole('heading', { name: 'Attention needed', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`dashboard-${theme}-${width}.png`), fullPage: true }); }
    }
  });
}
