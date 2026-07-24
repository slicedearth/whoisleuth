import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, migrateLegacyBrowserData, useTheme } from './helpers';
import { protectedDestinations } from '../frontend/src/lib/workspaces';

// Coverage for the shared design system: native-sized checkbox controls with
// correct label alignment, the Lookup result's grouped sections and local
// navigation, visually distinguishable action variants, and overflow-safe
// rendering of long untrusted values. Every lookup here is fulfilled from a
// local fixture route; nothing reaches a live registry.

const INTELLIGENCE_CAPABILITIES = {
  version: 1,
  runtime: 'express',
  authoritative: true,
  features: [
    { id: 'lookup', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
    { id: 'urlscan_search', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
    { id: 'urlhaus_host', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
    { id: 'threatfox_domain_ioc', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  ],
  controls: null,
  limitations: [],
};

test('the phosphorous brand cursor stays aligned and static across public and console layouts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const variants = [
    { path: '/', selector: '.public-brand strong', width: 1280, height: 800 },
    { path: '/', selector: '.public-brand strong', width: 390, height: 844 },
    { path: '/lookup', selector: '.brand strong', width: 1280, height: 800 },
    { path: '/lookup', selector: '.shell > header > a > strong', width: 390, height: 844 },
  ];

  for (const variant of variants) {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.goto(variant.path);

    const wordmark = page.locator(variant.selector);
    await expect(wordmark).toBeVisible();
    const cursor = await wordmark.evaluate((element) => {
      const wordmarkStyle = getComputedStyle(element);
      const cursorStyle = getComputedStyle(element, '::after');
      const fontSize = Number.parseFloat(wordmarkStyle.fontSize);
      return {
        content: cursorStyle.content,
        display: cursorStyle.display,
        heightRatio: Number.parseFloat(cursorStyle.height) / fontSize,
        verticalAlignRatio: Number.parseFloat(cursorStyle.verticalAlign) / fontSize,
        animationName: cursorStyle.animationName,
      };
    });

    expect(cursor.content).toBe('""');
    expect(cursor.display).toBe('inline-block');
    expect(cursor.heightRatio).toBeCloseTo(0.76, 2);
    expect(cursor.verticalAlignRatio).toBeCloseTo(-0.02, 2);
    expect(cursor.animationName).toBe('none');
    await expectNoHorizontalOverflow(page);
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const motion = await page.locator('.public-brand strong').evaluate((element) => {
    const cursorStyle = getComputedStyle(element, '::after');
    return {
      animationName: cursorStyle.animationName,
      boxShadow: cursorStyle.boxShadow,
    };
  });
  expect(motion.animationName).toBe('none');
  expect(motion.boxShadow).not.toBe('none');
});

test('the Signal Lens mark stays transparent, theme-aware, and contained across layouts', async ({ page }) => {
  await useTheme(page, 'dark');
  await page.goto('/');

  const publicMark = page.locator('.public-brand .brand-mark');
  await expect(publicMark).toBeVisible();
  await expect(publicMark.locator('.primary')).toHaveCount(2);
  await expect(publicMark.locator('.secondary-fill')).toHaveCount(3);
  await expect(publicMark.locator('circle.primary')).toHaveAttribute('fill', 'none');

  const darkColors = await publicMark.evaluate((element) => {
    const primary = element.querySelector<SVGElement>('.primary');
    const secondary = element.querySelector<SVGElement>('.secondary');
    return {
      primary: primary ? getComputedStyle(primary).stroke : '',
      secondary: secondary ? getComputedStyle(secondary).stroke : '',
    };
  });

  await page.getByRole('button', { name: /Colour theme/ }).click();
  await page.getByRole('option', { name: 'Light theme' }).click();
  const lightMark = page.locator('.public-brand .brand-mark');
  const lightColors = await lightMark.evaluate((element) => {
    const primary = element.querySelector<SVGElement>('.primary');
    const secondary = element.querySelector<SVGElement>('.secondary');
    return {
      primary: primary ? getComputedStyle(primary).stroke : '',
      secondary: secondary ? getComputedStyle(secondary).stroke : '',
    };
  });
  expect(lightColors.primary).not.toBe(darkColors.primary);
  expect(lightColors.secondary).not.toBe(darkColors.secondary);

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

// A deep-ish result with enough evidence groups to exercise the section
// navigation: assessment + DNS + HTTP evidence plus the always-present
// registry sources and raw response.
function sectionedLookupFixture(domain: string) {
  return {
    query: domain, type: 'domain', registrableDomain: domain,
    availability: {
      state: 'registered', confidence: 'high', domain,
      createdDateIso: '2020-01-02T00:00:00.000Z',
      expiryDateIso: '2027-01-02T00:00:00.000Z',
      registrar: { name: 'Fixture Registrar LLC' },
      nameservers: [`ns1.${domain}`, `ns2.${domain}`],
      dns: {
        status: 'partial', source: 'dns', scanMode: 'deep', complete: false, truncated: false,
        records: { a: ['192.0.2.10'], aaaa: [], cname: [], ns: [`ns1.${domain}`], mx: [], spf: [], dmarc: [], caa: [] },
        diagnostics: { cname: { status: 'error', error: 'resolver timed out' } },
      },
      http: {
        version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z', scanMode: 'deep', source: 'http',
        durationMs: 100, complete: true, truncated: false, limitations: [], diagnostics: {},
        requestUrl: `https://${domain}/`, finalUrl: `https://www.${domain}/home`, transportSecurity: 'https',
        redirectCount: 1, redirectLimitReached: false, crossOriginRedirect: false, httpsDowngrade: false,
        redirects: [{ status: 301, from: `https://${domain}/`, to: `https://www.${domain}/home`, queryOmitted: false }], attempts: [],
        response: {
          status: 200, contentType: 'text/html', contentLanguage: null, server: null,
          declaredContentLength: null, capturedBodyBytes: 1024, bodyInspected: true, bodyTruncated: false,
          bodyHash: null, securityHeaders: {},
        },
      },
    },
    rdap: { upstreamStatus: 200, parsed: { domain, entitiesByRole: {}, lifecycle: { updatedDateIso: '2026-06-10T00:00:00.000Z' } } },
    whois: { parsed: {}, chain: [] },
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
  };
}

test('optional intelligence checkboxes stay native-sized and aligned with their labels', async ({ page }) => {
  await page.route('**/api/capabilities', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(INTELLIGENCE_CAPABILITIES),
  }));
  await page.goto('/lookup');

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
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('the console command palette filters destinations and remains keyboard operable', async ({ page }) => {
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Open command palette' });
  await expect(trigger).toBeVisible();
  await expect(trigger.locator('.shortcut-wide')).toBeVisible();
  await expect(trigger.locator('.shortcut-wide')).toHaveText('Ctrl/⌘ K');
  await expect(trigger.locator('.command-icon')).toBeHidden();

  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  const search = dialog.getByRole('combobox', { name: 'Search pages' });
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
    probe.style.color = 'var(--accent2)';
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
  await expect(destinationIcons).toHaveCount(9);
  await expect(dialog.getByRole('option', { name: /Lookup/ }).locator('svg')).toHaveAttribute('data-icon', 'lookup');
  await expect(dialog.getByRole('option', { name: /Registry support/ }).locator('svg')).toHaveAttribute('data-icon', 'registry');
  await search.press('End');
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-option-8');
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
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await search.fill('dns whois');
  await expect(dialog.getByRole('option', { name: /Lookup/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await search.fill('tld');
  await expect(dialog.getByRole('option', { name: /Registry support/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await search.fill('campaign');
  await expect(dialog.getByRole('option', { name: /Monitor/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(1);
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
      listFitsWithoutScrolling: (list?.scrollHeight ?? 0) <= (list?.clientHeight ?? 0) + 1,
    };
  })).toEqual({
    fitsViewport: true,
    listFitsWithoutScrolling: true,
  });
  await expectNoHorizontalOverflow(page);
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
  await page.locator('#query').fill('collection-state.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const loadingStatus = page.getByRole('status');
  await expect(loadingStatus).toContainText('Deep lookup is collecting');
  await expect(page.locator('.collection-trace')).toContainText('Authority');
  await expect(page.locator('.collection-trace')).toContainText('Enrichment');
  await expect(page.locator('.collection-trace')).not.toContainText('complete');
  releaseLookup?.();
  await expect(page.locator('#result')).toBeVisible();
});

test('a data-heavy Lookup result groups evidence into navigable sections', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture('sectioned-result.invalid')),
  }));
  await page.goto('/lookup');
  await page.locator('#query').fill('sectioned-result.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const localNav = page.getByRole('navigation', { name: 'Result sections' });
  await expect(localNav).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Web & DNS' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Registry' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Raw data' })).toBeVisible();
  // Sections that have no evidence in this fixture offer no dead anchors.
  await expect(localNav.getByRole('link', { name: 'External intel' })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Web and DNS evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registry sources' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toBeVisible();
  await expect(page.getByLabel('Source diagnostics')).toContainText('rdap');

  // The D3-backed visual is paired with a complete, keyboard-operable source
  // rail. It does not replace the detailed source sections.
  const topology = page.getByRole('region', { name: 'Evidence topology' });
  await expect(topology).toBeVisible();
  await expect(topology.getByRole('img', { name: 'Evidence topology visual overview' })).toBeVisible();
  const visualKey = topology.getByRole('group', { name: 'Evidence topology visual key' });
  await expect(visualKey).toContainText('Registry');
  await expect(visualKey).toContainText('Network');
  await expect(visualKey).toContainText('Web');
  await expect(visualKey).toContainText('Derived');
  await expect(visualKey).toContainText('Analyst');
  await expect(visualKey).toContainText('Dot and label show source state');
  const topologyCopies = topology.locator('foreignObject.node-copy');
  await expect(topologyCopies.first()).toBeVisible();
  expect(await topologyCopies.evaluateAll((copies) => copies.every((copy) => {
    const text = copy.firstElementChild;
    const copyRect = copy.getBoundingClientRect();
    const nodeRect = copy.closest('g')?.querySelector(':scope > .node-surface')?.getBoundingClientRect();
    const styles = text ? getComputedStyle(text) : null;
    return Boolean(
      text
      && nodeRect
      && copyRect.left >= nodeRect.left - 0.5
      && copyRect.right <= nodeRect.right + 0.5
      && copyRect.top >= nodeRect.top - 0.5
      && copyRect.bottom <= nodeRect.bottom + 0.5
      && styles?.overflow === 'hidden'
      && styles.textOverflow === 'ellipsis'
      && styles.whiteSpace === 'nowrap'
    );
  }))).toBe(true);
  const sourceRail = topology.getByRole('list', { name: 'Evidence source status' });
  await expect(sourceRail.locator('.source-icon')).toHaveCount(await sourceRail.locator('li').count());
  const desktopSourceIcons = topology.locator('.node-source-icon .source-icon');
  await expect(desktopSourceIcons).toHaveCount(await sourceRail.locator('li').count());
  await expect(desktopSourceIcons.first()).toBeVisible();
  expect(await desktopSourceIcons.evaluateAll((icons) => icons.every((icon) => {
    const iconRect = icon.getBoundingClientRect();
    const discRect = icon.closest('.source-node')?.querySelector('.glyph-disc')?.getBoundingClientRect();
    return Boolean(
      discRect
      && iconRect.width > 0
      && iconRect.width <= 32
      && iconRect.height > 0
      && iconRect.height <= 32
      && iconRect.left >= discRect.left - 2
      && iconRect.right <= discRect.right + 2
      && iconRect.top >= discRect.top - 2
      && iconRect.bottom <= discRect.bottom + 2
    );
  }))).toBe(true);
  await expect(sourceRail.getByRole('link', { name: /Registry RDAP.*success/i })).toHaveAttribute('href', '#evidence-registry');
  await expect(sourceRail.getByRole('link', { name: /WHOIS.*partial/i })).toHaveAttribute('href', '#evidence-registry');
  const dnsSource = sourceRail.getByRole('link', { name: /DNS.*partial/i });
  await expect(dnsSource).toHaveAttribute('href', '#evidence-dns');
  await dnsSource.focus();
  await expect(dnsSource.locator('xpath=..')).toHaveClass(/active/);
  await expect(topology.locator('.source-node.family-network.active')).toHaveCount(1);
  await expect(topology.locator('.topology-edges path.active')).toHaveCount(1);

  const linkedVisualNode = topology.locator('.source-nodes > g.linked').first();
  const hashBeforeDrag = await page.evaluate(() => window.location.hash);
  await linkedVisualNode.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20, button: 0 });
  await linkedVisualNode.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 20, button: 0 });
  await linkedVisualNode.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 20, button: 0 });
  expect(await page.evaluate(() => window.location.hash)).toBe(hashBeforeDrag);

  await dnsSource.press('Enter');
  await expect(page).toHaveURL(/#evidence-dns$/);
  await expect(page.locator('#evidence-dns')).toBeInViewport();

  const lifecycle = page.getByRole('region', { name: 'Observed lifecycle' });
  await expect(lifecycle).toBeVisible();
  await expect(lifecycle.getByRole('img', { name: 'Chronological lookup lifecycle overview' })).toBeVisible();
  await expect(lifecycle.getByRole('list', { name: 'Lookup lifecycle events' })).toContainText('Domain created');

  // Detailed registry and raw unified records stay collapsed and subordinate.
  await expect(page.locator('.sources > details').first()).not.toHaveAttribute('open', '');
  await expect(page.locator('details.raw')).not.toHaveAttribute('open', '');

  // Keyboard operation: activating an anchor link moves to the section.
  const registryLink = localNav.getByRole('link', { name: 'Registry' });
  await registryLink.focus();
  await registryLink.press('Enter');
  await expect(page).toHaveURL(/#registry$/);
  await expect(page.locator('#registry')).toBeInViewport();
  await expect(registryLink).toHaveAttribute('aria-current', 'location');

  // The DNS status stays visible while its detailed warning is disclosed on demand.
  const dnsCard = page.locator('.dns-card');
  await expect(dnsCard.locator(':scope > summary .evidence-status')).toHaveText('partial');
  await expect(page.getByText(/A resolver failure is not evidence that a record is absent/)).toBeHidden();
  await dnsCard.locator(':scope > summary').click();
  await expect(page.getByText(/A resolver failure is not evidence that a record is absent/)).toBeVisible();

  const httpCard = page.locator('.http-card');
  await httpCard.locator(':scope > summary').click();
  const redirectDisclosure = httpCard.getByText('Redirect chain · 1 hop');
  await redirectDisclosure.click();
  await expect(httpCard.getByRole('img', { name: 'HTTP redirect path with 1 hop' })).toBeVisible();

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await expectNoHorizontalOverflow(page);
  }

  // The desktop source graph becomes a connected, full-width source map on
  // narrow screens instead of shrinking every label into the wide SVG.
  await expect(topology.getByRole('img', { name: 'Evidence topology visual overview' })).toBeHidden();
  await expect(topology.locator('.mobile-target')).toBeVisible();
  await expect(sourceRail.locator('.source-copy small').first()).toBeVisible();
  const mobileSourceIcons = sourceRail.locator('.source-glyph .source-icon');
  await expect(mobileSourceIcons.first()).toBeVisible();
  expect(await mobileSourceIcons.evaluateAll((icons) => icons.every((icon) => {
    const iconRect = icon.getBoundingClientRect();
    const holderRect = icon.closest('.source-glyph')?.getBoundingClientRect();
    return Boolean(
      holderRect
      && iconRect.width > 0
      && iconRect.width <= 20
      && iconRect.height > 0
      && iconRect.height <= 20
      && iconRect.left >= holderRect.left - 0.5
      && iconRect.right <= holderRect.right + 0.5
      && iconRect.top >= holderRect.top - 0.5
      && iconRect.bottom <= holderRect.bottom + 0.5
    );
  }))).toBe(true);
  expect(await sourceRail.locator('li').evaluateAll((items) => items.every((item) => {
    const listRect = item.parentElement?.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    return Boolean(
      listRect
      && itemRect.width >= 180
      && itemRect.height >= 58
      && itemRect.left >= listRect.left - 0.5
      && itemRect.right <= listRect.right + 0.5
    );
  }))).toBe(true);

  // The wide chronological plot becomes a connected vertical timeline on
  // narrow screens rather than requiring a nested horizontal scrollbar.
  await expect(lifecycle.getByRole('img', { name: 'Chronological lookup lifecycle overview' })).toBeHidden();
  const mobileTimeline = lifecycle.getByRole('list', { name: 'Lookup lifecycle events' });
  await expect(mobileTimeline).toBeVisible();
  expect(await mobileTimeline.locator('li').evaluateAll((items) => items.every((item) => {
    const listRect = item.parentElement?.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    return Boolean(listRect && itemRect.left >= listRect.left - 0.5 && itemRect.right <= listRect.right + 0.5);
  }))).toBe(true);

  // The local navigation stays a single scrollable row on narrow screens
  // rather than stacking into a tall block. It also exposes overflow and
  // keeps the active destination inside the visible strip.
  const navBox = await boundingBox(localNav);
  expect(navBox.height).toBeLessThanOrEqual(64);
  expect(await localNav.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await localNav.evaluate((element) => {
    element.scrollLeft = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('.local-nav-shell')).toHaveClass(/show-end-fade/);
  await page.locator('#raw-data').evaluate((element) => element.scrollIntoView({ block: 'start' }));
  const rawDataLink = localNav.getByRole('link', { name: 'Raw data' });
  await expect(rawDataLink).toHaveAttribute('aria-current', 'location');
  await expect.poll(async () => page.locator('#raw-data').evaluate((section) => {
    const sectionTop = section.getBoundingClientRect().top;
    const navigation = document.querySelector('.local-nav-shell');
    return navigation ? sectionTop >= navigation.getBoundingClientRect().bottom + 4 : false;
  })).toBe(true);
  await expect.poll(async () => rawDataLink.evaluate((link) => {
    const navigation = link.closest('nav');
    if (!navigation) return false;
    const navigationRect = navigation.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    return linkRect.left >= navigationRect.left - 0.5 && linkRect.right <= navigationRect.right + 0.5;
  })).toBe(true);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export evidence JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-evidence-sectioned-result\.invalid-.+\.json$/);
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
    'whois-rdap-brand-profiles-v1': [profile],
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

  await expect(page.getByRole('heading', { name: domain })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('every public and protected page renders without page-level overflow at narrow and wide widths', async ({ page }) => {
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
  for (const [path, title, eyebrow] of [
    ['/dashboard', 'Dashboard', 'Console'],
    ['/lookup', 'Lookup', 'Investigate'],
    ['/discover', 'Discover', 'Find candidates'],
    ['/bulk', 'Bulk', 'Assess domains'],
    ['/monitor', 'Monitor', 'Track findings'],
    ['/brands', 'Brands', 'Protect'],
    ['/registry-support', 'Registry support', 'Reference'],
    ['/privacy', 'Privacy policy', 'Policy'],
  ]) {
    await page.goto(path);
    const heading = page.locator('.heading');
    await expect(heading).toHaveCount(1);
    await expect(heading.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(heading.locator('.eyebrow')).toHaveText(eyebrow);
  }
});
