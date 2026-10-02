import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, openLookupOptionalSources } from './helpers';
import { protectedDestinations } from '../frontend/src/lib/workspaces';
import { consoleCommandNavigation } from '../frontend/src/lib/console-command-navigation';
import { INTELLIGENCE_CAPABILITIES, sectionedLookupFixture } from './lookup-design-fixtures';

// Shared visual-system, navigation and overflow coverage.

test('the active console navigation marker never overlaps its label', async ({ page }) => {
  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.goto('/dashboard');
    if (size.width < 800) await page.getByRole('button', { name: 'Toggle navigation' }).click();
    const active = page.locator('#console-navigation a[aria-current="page"]').filter({ hasText: 'Dashboard' });
    await expect(active).toBeVisible();
    const geometry = await active.evaluate((element) => {
      const link = element.getBoundingClientRect();
      const label = element.querySelector('strong')!.getBoundingClientRect();
      return {
        labelInside: label.left >= link.left && label.right <= link.right,
      };
    });
    expect(geometry.labelInside).toBe(true);
    if (size.width < 800) await page.getByRole('button', { name: 'Close navigation' }).click();
  }
});

test('certificate monitoring highlights the Assure navigation destination', async ({ page }) => {
  await page.goto('/monitor?view=certificates');
  const navigation = page.locator('#console-navigation');
  await expect(navigation.getByRole('link', { name: /^Monitoring/u })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('link', { name: /^Review inbox/u })).not.toHaveAttribute('aria-current', 'page');
});

// A deep-ish result with enough evidence groups to exercise the section
// navigation: assessment + DNS + HTTP evidence plus the always-present
// registry sources and raw response.

test('optional intelligence choices remain labelled and operable on desktop and mobile', async ({ page }) => {
  await page.route('**/api/capabilities', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(INTELLIGENCE_CAPABILITIES),
  }));
  await page.goto('/lookup');
  await page.getByRole('radio', { name: /Deep/u }).check();

  const group = page.getByRole('group', { name: 'Optional third-party intelligence' });
  await openLookupOptionalSources(page);
  await expect(group).toBeVisible();

  for (const size of [
    { width: 1280, height: 800 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(size);
    const first = group.getByRole('checkbox', { name: /Search archived URLscan verdicts/ });
    await expect(first).toBeVisible();
    await group.getByText('Search archived URLscan verdicts').click();
    await expect(first).toBeChecked();
    await group.getByText('Search archived URLscan verdicts').click();
    await expect(first).not.toBeChecked();
    await expectNoHorizontalOverflow(page);
  }
});

test('empty Lookup shows the compact query card without result sections or local navigation', async ({ page }) => {
  await page.goto('/lookup');
  await expect(page.locator('#query')).toBeVisible();
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.locator('.local-nav')).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the protected Console opens through an intentional responsive loading state', async ({ page }) => {
  let releaseSession: (() => void) | undefined;
  const sessionGate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await page.route('**/api/session', async (route) => {
    await sessionGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true }),
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/dashboard');

  const loadingStatus = page.getByRole('status', { name: 'Console loading status' });
  await expect(loadingStatus).toContainText('Opening WHOISleuth');
  await expect(loadingStatus).toContainText('Confirm session');
  await expect(loadingStatus).toContainText('Prepare workspace');
  await expect(loadingStatus).toContainText('Open destination');
  await expectNoHorizontalOverflow(page);

  releaseSession?.();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('the console command palette filters destinations and remains keyboard operable', async ({ page }) => {
  const commandCount = consoleCommandNavigation.length;
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Search console navigation' });
  await expect(trigger).toBeVisible();
  await expect(trigger.locator('.shortcut-wide')).toBeVisible();
  await expect(trigger.locator('.shortcut-wide')).toHaveText('Ctrl/⌘ K');
  await expect(trigger.locator('.command-icon')).toHaveCount(1);
  await expect(trigger.locator('.command-icon')).toBeHidden();

  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  const search = dialog.getByRole('combobox', { name: 'Search pages and tools' });
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await expect(dialog.getByRole('listbox', { name: 'Console destinations' })).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText(/Dashboard.*current page/u);
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-option-0');
  await expect(dialog.getByRole('option', { name: /Dashboard/ })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => dialog.getByRole('option').evaluateAll((options) =>
    options.every((option) => option.getAttribute('tabindex') === '-1')
  )).toBe(true);
  const destinationIcons = dialog.locator('[role="option"] svg[data-icon]');
  await expect(destinationIcons).toHaveCount(commandCount);
  await expect(dialog.locator('[data-command-group]')).toHaveText(consoleCommandNavigation.map((command) => command.group));
  await expect(dialog.locator('[data-command-group]', { hasText: 'Console' })).toHaveCount(0);
  await expect(dialog.getByRole('option', { name: /Lookup/ }).locator('svg')).toHaveAttribute('data-icon', 'lookup');
  await expect(dialog.getByRole('option', { name: /Registry support/ }).locator('svg')).toHaveAttribute('data-icon', 'registry');
  await search.press('End');
  await expect(search).toHaveAttribute('aria-activedescendant', `command-option-${commandCount - 1}`);
  await search.press('Home');
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-option-0');
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-option-1');
  await expect(dialog.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('Tab');
  const shortcuts = dialog.locator('.shortcut-help > summary');
  await expect(shortcuts).toBeFocused();
  await shortcuts.press('Enter');
  await expect(dialog.locator('.shortcut-help')).toContainText('Select the first or last destination');
  await shortcuts.press('Enter');
  await shortcuts.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close command palette' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Pages and tools', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Saved work', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Documentation', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await search.fill('whois');
  await expect(dialog.getByRole('option', { name: /Lookup/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Domain investigation evidence/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /RDAP versus WHOIS/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Local-first investigation/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(4);
  await search.fill('dns whois');
  await expect(dialog.getByRole('option', { name: /Lookup/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Domain investigation evidence/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await search.fill('tld');
  await expect(dialog.getByRole('option', { name: /Registry support/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await search.fill('campaign');
  await expect(dialog.getByRole('option', { name: /^Review inbox/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /^Campaigns/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(2);
  for (const group of ['Start', 'Investigate', 'Respond', 'Assure']) {
    await search.fill(group);
    const commands = consoleCommandNavigation.filter(command => command.group === group);
    expect(commands.length).toBeGreaterThan(0);
    await expect(dialog.getByRole('option')).toHaveCount(commands.length);
    await expect(dialog.locator('.command-copy strong')).toHaveText(commands.map(command => command.label));
    await expect(dialog.locator('[data-command-group]')).toHaveText(commands.map(command => command.group));
  }
  await search.fill('Public');
  const publicMatches = consoleCommandNavigation.filter((command) => (
    `${command.label} ${command.detail} ${command.group} ${command.keywords.join(' ')}`.toLowerCase().includes('public')
  ));
  await expect(dialog.getByRole('option')).toHaveCount(publicMatches.length);
  await expect(dialog.locator('.command-copy strong')).toHaveText(publicMatches.map((command) => command.label));
  await expect(dialog.locator('[data-command-group]')).toHaveText(publicMatches.map((command) => command.group));
  await expect(dialog.getByRole('option', { name: /Overview/u })).toBeVisible();
  await search.fill('review inbox');
  await expect(dialog.getByRole('option', { name: /^Review inbox/ })).toBeVisible();
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-option-0');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/monitor$/);
  await expect(page.locator('#main-content')).toBeFocused();

  await trigger.focus();
  await page.keyboard.press('Control+K');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.goto('/lookup');
  await expect(trigger).toBeVisible();
  const lookupQuery = page.locator('#query');
  await lookupQuery.focus();
  await page.keyboard.press('Control+K');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Lookup/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('option', { name: /Lookup/ })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(lookupQuery).toBeFocused();
  await lookupQuery.dispatchEvent('keydown', {
    key: 'k',
    code: 'KeyK',
    ctrlKey: true,
    repeat: true,
    bubbles: true,
  });
  await expect(dialog).toHaveCount(0);
  await expect(lookupQuery).toBeFocused();

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(trigger).toBeVisible();
  await expect(trigger.locator('.shortcut-wide')).toHaveCount(1);
  await expect(trigger.locator('.shortcut-wide')).toBeHidden();
  const compactIcon = trigger.locator('.command-icon');
  await expect(compactIcon).toBeVisible();
  const compactIconSvg = compactIcon.locator('svg');
  await expect(compactIconSvg).toHaveAttribute('data-icon', 'command');
  await expect(compactIconSvg).toHaveAttribute('width', '18');
  await expect(compactIconSvg).toHaveAttribute('height', '18');
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect.poll(async () => dialog.evaluate((element) => {
    const list = element.querySelector<HTMLElement>('#command-results');
    const bounds = element.getBoundingClientRect();
    return {
      fitsViewport: bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth,
      listIsKeyboardScrollable: (list?.scrollHeight ?? 0) > (list?.clientHeight ?? 0) + 1,
    };
  })).toEqual({
    fitsViewport: true,
    listIsKeyboardScrollable: true,
  });
  const mobileSearch = dialog.getByRole('combobox', { name: 'Search pages and tools' });
  await mobileSearch.press('End');
  await expect(mobileSearch).toHaveAttribute('aria-activedescendant', `command-option-${commandCount - 1}`);
  const lastMobileOption = dialog.getByRole('option').nth(commandCount - 1);
  await expect(lastMobileOption).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => lastMobileOption.evaluate((option) => {
    const list = option.closest('#command-results');
    const palette = option.closest('[role="dialog"]');
    if (!list || !palette) return false;
    const optionBounds = option.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    const paletteBounds = palette.getBoundingClientRect();
    const visibleTop = Math.max(listBounds.top, paletteBounds.top) + 1;
    const visibleBottom = Math.min(listBounds.bottom, paletteBounds.bottom) - 1;
    return optionBounds.top >= visibleTop && optionBounds.bottom <= visibleBottom;
  })).toBe(true);
  await expectNoHorizontalOverflow(page);
  await mobileSearch.fill('Public');
  const publicPagePromise = page.waitForEvent('popup');
  await dialog.getByRole('option', { name: /Contact.*New tab/u }).click();
  const publicPage = await publicPagePromise;
  await publicPage.waitForLoadState('domcontentloaded');
  await expect(publicPage).toHaveURL(/\/contact$/u);
  await expect(page).toHaveURL(/\/lookup$/u);
  await publicPage.close();
});

test('the console command palette keeps every destination heading readable on mobile', async ({ page }) => {
  for (const width of [400, 430, 489, 500]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Search console navigation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Go to' });
    await expect(dialog).toBeVisible();
    const options = dialog.getByRole('option');
    const headings = dialog.locator('.command-copy strong');
    await expect.poll(() => options.count()).toBeGreaterThan(0);
    await expect(headings).toHaveCount(await options.count());
    await expect.poll(() => headings.evaluateAll((items) => items.length > 0 && items.every((heading) =>
      heading.scrollWidth <= heading.clientWidth + 1
    ))).toBe(true);
    await page.keyboard.press('Escape');
  }
});

test('console footer opens policy pages separately while the public footer stays in-tab', async ({ page, context }) => {
  await page.goto('/lookup');
  const consolePrivacy = page.locator('footer.site-footer').getByRole('link', { name: /Privacy/ });
  await expect(consolePrivacy).toHaveAttribute('target', '_blank');
  await expect(consolePrivacy).toHaveAttribute('rel', /noopener/u);
  await expect(consolePrivacy).not.toContainText('↗');
  await expect(consolePrivacy).toHaveAccessibleName(/Privacy.*opens in a new tab/u);
  const [publicPage] = await Promise.all([
    context.waitForEvent('page'),
    consolePrivacy.click(),
  ]);
  await publicPage.bringToFront();
  await publicPage.waitForLoadState('domcontentloaded');
  await expect(publicPage).toHaveURL(/\/privacy$/u);
  await expect(page).toHaveURL(/\/lookup$/u);
  await publicPage.close();
  await page.bringToFront();

  await page.goto('/');
  const publicPrivacy = page.locator('footer.site-footer').getByRole('link', { name: 'Privacy', exact: true });
  await expect(publicPrivacy).not.toHaveAttribute('target', '_blank');
  await publicPrivacy.click();
  await expect(page).toHaveURL(/\/privacy$/u);
});

test('console reference navigation keeps public Resources separate without decorative arrows', async ({ page }) => {
  await page.goto('/dashboard');
  const resources = page.getByRole('navigation', { name: 'Reference' }).getByRole('link', { name: /Resources/ });
  await expect(resources).toHaveAttribute('target', '_blank');
  await expect(resources).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(resources).not.toContainText('↗');
  await expect(resources).toHaveAccessibleName(/Resources.*opens in a new tab/iu);
});

test('Lookup describes pending collection without implying staged completion', async ({ page }) => {
  let releaseLookup: (() => void) | undefined;
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route('**/api/lookup?*', async (route) => {
    await lookupGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sectionedLookupFixture('collection-state.invalid')),
    });
  });
  await page.goto('/lookup');
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.locator('#query').fill('collection-state.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const loadingStatus = page.locator('.loading-note');
  await expect(loadingStatus.getByRole('status')).toContainText('Collecting');
  await expect(loadingStatus).toContainText('Only the final validated response can be retained.');
  const progress = page.getByRole('region', { name: 'Lookup source progress' });
  await expect(progress.getByRole('status')).toContainText('Waiting for source updates');
  await expect(progress.getByRole('listitem')).toHaveCount(0);
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(loadingStatus.getByRole('button', { name: 'Cancel lookup' })).toBeVisible();
  releaseLookup?.();
  await expect(page.locator('#result')).toBeVisible();
});


test('long untrusted values wrap inside result tiles without page overflow', async ({ page }) => {
  const longLabel = 'a'.repeat(63);
  const domain = `${longLabel}.invalid`;
  const fixture = sectionedLookupFixture(domain);
  fixture.availability.nameservers = [`${'n'.repeat(60)}.${domain}`];
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(fixture),
  }));
  await page.goto('/lookup');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();

  await expect(page.getByRole('heading', { name: domain })).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalOverflow(page);
});

test('responsive geometry checks wait for rendered fit and reject persistent overflow', async ({ page }) => {
  await page.goto('/demo');
  await page.setViewportSize({ width: 390, height: 844 });
  const addOverflow = async () => {
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = 'layout-overflow-probe';
      probe.setAttribute('aria-hidden', 'true');
      Object.assign(probe.style, { position: 'absolute', left: '0', top: '0', width: 'calc(100vw + 40px)', height: '1px' });
      document.body.append(probe);
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeGreaterThan(1);
  };
  try {
    await addOverflow();
    const settledFit = expectNoHorizontalOverflow(page).then(() => null, error => error);
    // Adjust real layout after the current render, without a clock-based delay.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById('layout-overflow-probe')!.remove();
      resolve();
    }))));
    expect(await settledFit).toBeNull();

    await addOverflow();
    await expect(expectNoHorizontalOverflow(page)).rejects.toThrow(/horizontal overflow/u);
  } finally {
    await page.evaluate(() => document.getElementById('layout-overflow-probe')?.remove());
  }
  await expectNoHorizontalOverflow(page);
});

test('every public and protected page renders without page-level overflow at narrow and wide widths', async ({ page }) => {
  test.slow();
  for (const path of ['/', ...protectedDestinations.map(({ href }) => href), '/privacy']) {
    await page.goto(path);
    for (const size of [
      { width: 320, height: 640 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await expectNoHorizontalOverflow(page);
    }
  }
});

test('console and policy pages expose one visible primary heading', async ({ page }) => {
  test.slow();
  for (const path of [...protectedDestinations.map(({ href }) => href), '/privacy']) {
    await page.goto(path);
    const heading = page.getByRole('main').getByRole('heading', { level: 1 });
    await expect(heading).toHaveCount(1);
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(/\S/u);
  }
});

test('Console pages keep their content below the header on tall displays', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/dashboard');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('whoisleuth:theme:v1', value), theme);
    for (const path of ['/dashboard', '/lookup', '/discover', '/bulk', '/cases', '/monitor', '/brands', '/registry-support']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      const header = await page.getByRole('banner').boundingBox();
      const main = await page.getByRole('main').boundingBox();
      expect(header).not.toBeNull();
      expect(main).not.toBeNull();
      expect(main!.y, path).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
});
