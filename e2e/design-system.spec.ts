import { expect, test } from './fixtures';
import { boundingBox, currentBrandProfileBrowserStore, expectNoHorizontalOverflow, migrateLegacyBrowserData, useTheme } from './helpers';
import { protectedDestinations } from '../frontend/src/lib/workspaces';
import { consoleCommandNavigation } from '../frontend/src/lib/console-command-navigation';
import { INTELLIGENCE_CAPABILITIES, sectionedLookupFixture } from './lookup-design-fixtures';

// Shared visual-system, navigation and overflow coverage.

test('the wordmark stays clean without a cursor-like status treatment across layouts', async ({ page }) => {
  const variants = [
    { path: '/', selector: '.public-brand strong', width: 1280, height: 800, visible: true },
    { path: '/', selector: '.public-brand strong', width: 320, height: 700, visible: true },
    { path: '/lookup', selector: '.brand strong', width: 1280, height: 800, visible: true },
    { path: '/lookup', selector: '.shell > header > a > strong', width: 390, height: 844, visible: true },
  ];

  for (const variant of variants) {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.goto(variant.path);

    const wordmark = page.locator(variant.selector);
    if (variant.visible) await expect(wordmark).toBeVisible();
    else await expect(wordmark).toBeHidden();
    const marker = await wordmark.evaluate((element) => {
      const markerStyle = getComputedStyle(element, '::after');
      return {
        content: markerStyle.content,
        boxShadow: markerStyle.boxShadow,
        animationName: markerStyle.animationName,
      };
    });

    expect(marker.content).toBe('none');
    expect(marker.boxShadow).toBe('none');
    expect(marker.animationName).toBe('none');
    await expectNoHorizontalOverflow(page);
  }
});

test('the theme-aware WHOISleuth mark stays consistent and contained across themes and layouts', async ({ page }) => {
  await useTheme(page, 'dark');
  await page.goto('/');

  const publicMark = page.locator('.public-brand .brand-mark');
  await expect(publicMark).toBeVisible();
  await expect(publicMark).toHaveAttribute('viewBox', '34 38 448 448');
  await expect(publicMark).toHaveAttribute('aria-hidden', 'true');
  expect(await publicMark.evaluate((element) => element.tagName)).toBe('svg');
  await expect(publicMark.locator('[data-brand-tone="primary"]')).toHaveCount(1);
  await expect(publicMark.locator('[data-brand-tone="secondary"]')).toHaveCount(1);

  await page.getByRole('button', { name: /Colour theme/ }).click();
  await page.getByRole('option', { name: 'Light theme' }).click();
  const lightMark = page.locator('.public-brand .brand-mark');
  await expect(lightMark).toBeVisible();
  await expect(lightMark.locator('[data-brand-tone="primary"]')).toHaveCSS('fill', 'rgb(0, 91, 145)');
  await expect(lightMark.locator('[data-brand-tone="secondary"]')).toHaveCSS('fill', 'rgb(0, 107, 73)');

  await page.setViewportSize({ width: 320, height: 640 });
  await page.reload();
  const mobileBrandBox = await boundingBox(page.locator('.public-brand'));
  const mobileMarkBox = await boundingBox(page.locator('.public-brand .brand-mark'));
  expect(mobileMarkBox.x).toBeGreaterThanOrEqual(mobileBrandBox.x);
  expect(mobileMarkBox.x + mobileMarkBox.width).toBeLessThanOrEqual(mobileBrandBox.x + mobileBrandBox.width + 1);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await expect(page.locator('.brand .brand-mark')).toBeVisible();
  await expect(page.locator('.shell > header .brand-mark')).toHaveCount(1);

  await page.setViewportSize({ width: 320, height: 640 });
  await page.reload();
  await expect(page.locator('.shell > header .brand-mark')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

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
        marker: getComputedStyle(element, '::before').content,
        labelInside: label.left >= link.left && label.right <= link.right,
      };
    });
    expect(geometry.marker).toBe('""');
    expect(geometry.labelInside).toBe(true);
    if (size.width < 800) await page.getByRole('button', { name: 'Close navigation' }).click();
  }
});

test('certificate monitoring highlights the Assure navigation destination', async ({ page }) => {
  await page.goto('/monitor?view=certificates');
  const navigation = page.locator('#console-navigation');
  await expect(navigation.getByRole('link', { name: /^Watchlists & controls/u })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('link', { name: /^Monitor/u })).not.toHaveAttribute('aria-current', 'page');
});

// A deep-ish result with enough evidence groups to exercise the section
// navigation: assessment + DNS + HTTP evidence plus the always-present
// registry sources and raw response.

test('optional intelligence checkboxes stay native-sized and aligned with their labels', async ({ page }) => {
  await page.route('**/api/capabilities', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(INTELLIGENCE_CAPABILITIES),
  }));
  await page.goto('/lookup');
  await page.getByRole('radio', { name: /Deep/u }).check();

  const group = page.getByRole('group', { name: 'Optional third-party intelligence' });
  await expect(group).toBeVisible();

  for (const size of [
    { width: 1280, height: 800 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(size);
    for (const option of await page.locator('.intelligence-option').all()) {
      const checkbox = option.locator('input[type="checkbox"]');
      const optionBox = await boundingBox(option);
      const checkboxBox = await boundingBox(checkbox);
      // Native control size: the global text-field sizing must not apply.
      expect(checkboxBox.width).toBeLessThanOrEqual(20);
      expect(checkboxBox.height).toBeLessThanOrEqual(20);
      // Contained inside its own label row.
      expect(checkboxBox.x).toBeGreaterThanOrEqual(optionBox.x - 1);
      expect(checkboxBox.x + checkboxBox.width).toBeLessThanOrEqual(optionBox.x + optionBox.width + 1);
      // Aligned with the first line of the label text, not floating below it.
      expect(checkboxBox.y).toBeGreaterThanOrEqual(optionBox.y - 1);
      expect(checkboxBox.y).toBeLessThanOrEqual(optionBox.y + 14);
    }
    await expectNoHorizontalOverflow(page);
  }

  // The control still operates by clicking its label text.
  const first = page.getByRole('checkbox', { name: /Search archived URLscan verdicts/ });
  await page.getByText('Search archived URLscan verdicts').click();
  await expect(first).toBeChecked();
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
  const trigger = page.getByRole('button', { name: 'Open console navigation' });
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
  const searchFrame = dialog.locator('.command-search');
  await expect(search).toHaveCSS('box-shadow', 'none');
  await expect.poll(() => dialog.getByRole('status').evaluate((element) => {
    const styles = getComputedStyle(element);
    return `${styles.width} ${styles.height} ${styles.clip}`;
  })).toBe('1px 1px rect(0px, 0px, 0px, 0px)');
  await expect.poll(() => searchFrame.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const matchesAccent = getComputedStyle(element).borderColor === getComputedStyle(probe).color;
    probe.remove();
    return matchesAccent;
  })).toBe(true);
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
  await expect(dialog.getByRole('button', { name: 'Close command palette' })).toBeFocused();
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
  await expect(dialog.getByRole('option', { name: /Monitor/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await search.fill('Start');
  await expect(dialog.getByRole('option', { name: /Dashboard/ })).toBeVisible();
  await expect(dialog.locator('[data-command-group]', { hasText: 'Start' })).toHaveCount(1);
  await search.fill('Investigate');
  await expect(dialog.getByRole('option')).toHaveCount(3);
  await expect(dialog.locator('[data-command-group]')).toHaveText(['Investigate', 'Investigate', 'Investigate']);
  await search.fill('Respond');
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog.locator('[data-command-group]')).toHaveText(['Respond']);
  await search.fill('Assure');
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await expect(dialog.locator('[data-command-group]')).toHaveText(['Assure', 'Assure']);
  await search.fill('Public');
  const publicMatches = consoleCommandNavigation.filter((command) => (
    `${command.label} ${command.detail} ${command.group} ${command.keywords.join(' ')}`.toLowerCase().includes('public')
  ));
  await expect(dialog.getByRole('option')).toHaveCount(publicMatches.length);
  await expect(dialog.locator('.command-copy strong')).toHaveText(publicMatches.map((command) => command.label));
  await expect(dialog.locator('[data-command-group]')).toHaveText(publicMatches.map((command) => command.group));
  await expect(dialog.getByRole('option', { name: /Overview/u })).toBeVisible();
  await search.fill('monitor');
  await expect(dialog.getByRole('option', { name: /Monitor/ })).toBeVisible();
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
    await page.getByRole('button', { name: 'Open console navigation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Go to' });
    await expect(dialog).toBeVisible();
    const options = dialog.getByRole('option');
    const headings = dialog.locator('.command-copy strong');
    expect(await options.count()).toBeGreaterThan(0);
    expect(await headings.count()).toBe(await options.count());
    expect(await headings.evaluateAll((items) => items.every((heading) =>
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
  await publicPage.waitForLoadState('domcontentloaded');
  await expect(publicPage).toHaveURL(/\/privacy$/u);
  await expect(page).toHaveURL(/\/lookup$/u);
  await publicPage.close();

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

test('Lookup reports requested source families without implying staged completion', async ({ page }) => {
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
  await expect(loadingStatus).toContainText('Deep lookup is waiting for one final response');
  await expect(page.locator('.collection-trace')).toContainText('Registry RDAP');
  await expect(page.locator('.collection-trace')).toContainText('Domain evidence');
  await expect(page.locator('.collection-trace')).not.toContainText('complete');
  releaseLookup?.();
  await expect(page.locator('#result')).toBeVisible();
});


test('primary, secondary, and destructive actions are visually distinct', async ({ page }) => {
  await useTheme(page, 'dark');
  await page.goto('/brands');
  const now = '2026-07-13T00:00:00.000Z';
  const profile = {
      id: 'design-profile', name: 'Design profile', officialDomains: ['official.invalid'], productNames: [],
      tlds: [], approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
      createdAt: now, updatedAt: now, pageBaseline: null,
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile]),
    'whois-rdap-active-brand-profile-v1': 'design-profile',
  });

  const primary = page.getByRole('button', { name: 'New profile' });
  const neutral = page.getByRole('button', { name: 'Export JSON' }).first();
  const destructive = page.getByRole('button', { name: 'Delete' }).first();

  // Primary: bright gradient with dark text.
  await expect(primary).toHaveCSS('background-image', /linear-gradient/);
  await expect(primary).toHaveCSS('color', 'rgb(7, 16, 28)');
  // Secondary: flat panel, light text, no gradient.
  await expect(neutral).toHaveCSS('background-image', 'none');
  await expect(neutral).toHaveCSS('color', 'rgb(230, 232, 238)');
  // Destructive: rendered in the danger colour.
  await expect(destructive).toHaveCSS('color', 'rgb(255, 107, 107)');
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

test('console and policy pages expose one consistent primary heading', async ({ page }) => {
  test.slow();
  for (const [path, title, eyebrow] of [
    ['/dashboard', 'Dashboard', 'Console'],
    ['/lookup', 'Lookup', 'Investigate'],
    ['/discover', 'Discover', 'Investigate'],
    ['/bulk', 'Bulk', 'Investigate'],
    ['/monitor', 'Monitor', 'Respond'],
    ['/brands', 'Brands', 'Assure'],
    ['/registry-support', 'Registry support', 'Reference'],
    ['/privacy', 'Privacy policy', 'Policy'],
  ] as const) {
    await page.goto(path);
    const heading = page.locator('.heading');
    await expect(heading).toHaveCount(1);
    await expect(heading.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(heading.locator('.eyebrow')).toHaveText(eyebrow);
  }
});
