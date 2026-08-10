import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, migrateLegacyBrowserData, useTheme } from './helpers';
import { protectedDestinations } from '../frontend/src/lib/workspaces';
import { readFile } from 'node:fs/promises';

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

test('the wordmark stays clean without a cursor-like status treatment across layouts', async ({ page }) => {
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

test('the approved WHOISleuth mark stays consistent and contained across themes and layouts', async ({ page }) => {
  await useTheme(page, 'dark');
  await page.goto('/');

  const publicMark = page.locator('.public-brand .brand-mark');
  await expect(publicMark).toBeVisible();
  await expect(publicMark).toHaveAttribute('src', '/favicon.svg');
  expect(await publicMark.evaluate((element) => element.tagName)).toBe('IMG');
  expect(await publicMark.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(512);

  await page.getByRole('button', { name: /Colour theme/ }).click();
  await page.getByRole('option', { name: 'Light theme' }).click();
  const lightMark = page.locator('.public-brand .brand-mark');
  await expect(lightMark).toBeVisible();
  await expect(lightMark).toHaveAttribute('src', '/favicon.svg');

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
      source: 'rdap', domainAgeDays: 2_385, expiresInDays: 158,
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
    reverseDns: {
      version: 1, status: 'success', source: 'reverse_dns',
      observedAt: '2026-07-13T00:00:00.000Z', scanMode: 'deep',
      durationMs: 8, complete: true, truncated: false,
      limitations: ['PTR context does not prove hosting control.'],
      diagnostics: { ptr: { status: 'success', answerCount: 1 } },
      records: { ptr: [`edge.${domain}`] },
    },
    rdap: {
      upstreamStatus: 200,
      parsed: { domain, entitiesByRole: {}, lifecycle: { updatedDateIso: '2026-06-10T00:00:00.000Z' } },
      registrarRdap: {
        status: 'success',
        endpoint: 'https://registrar.example.test/domain/sectioned-result.invalid',
        fetchedAt: '2026-07-13T00:00:00.000Z',
        parsed: { domain, entitiesByRole: {} },
      },
    },
    whois: { parsed: {}, chain: [] },
    diagnostics: {
      rdap: { status: 'success', endpoint: 'https://rdap.example.test', registrar: { status: 'success' } },
      whois: { status: 'success' },
      availability: { status: 'complete' },
      reverseDns: { status: 'success' },
    },
    registryInsights: {
      version: 1,
      lifecycle: {
        stage: 'registered',
        label: 'Registered',
        rawStatuses: ['active', 'client transfer prohibited'],
        locks: { client: true, server: false },
      },
      publications: [
        { source: 'registry_rdap', state: 'complete' },
        { source: 'whois', state: 'complete' },
      ],
      contactDisclosure: {
        registryRdap: { state: 'redacted' },
        whois: { state: 'unavailable' },
      },
      abuseRouting: [{
        kind: 'registrar',
        channel: 'email',
        contact: 'abuse@example.test',
        source: 'registrar fixture publication',
      }],
    },
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
  await expect(dialog.locator('[data-command-group]')).toHaveText([
    'Start',
    'Investigate', 'Investigate', 'Investigate',
    'Protect & review', 'Protect & review',
    'Reference', 'Reference', 'Public',
  ]);
  await expect(dialog.locator('[data-command-group]', { hasText: 'Console' })).toHaveCount(0);
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
  await expect(dialog.getByRole('option', { name: /Resources/ })).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await search.fill('dns whois');
  await expect(dialog.getByRole('option', { name: /Lookup/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Resources/ })).toBeVisible();
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
  await search.fill('Protect & review');
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await expect(dialog.locator('[data-command-group]')).toHaveText(['Protect & review', 'Protect & review']);
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

  const loadingStatus = page.locator('.loading-note');
  await expect(loadingStatus).toContainText('Deep lookup is waiting for one final response');
  await expect(page.locator('.collection-trace')).toContainText('Registry RDAP');
  await expect(page.locator('.collection-trace')).toContainText('Domain evidence');
  await expect(page.locator('.collection-trace')).not.toContainText('complete');
  releaseLookup?.();
  await expect(page.locator('#result')).toBeVisible();
});

test('a data-heavy Lookup result groups evidence into navigable sections', {
  tag: [
    '@analyst-journey',
    '@journey-first-domain-assessment',
    '@journey-acquisition-uncertainty-review',
  ],
}, async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture('sectioned-result.invalid')),
  }));
  await page.goto('/lookup');
  await page.locator('#query').fill('sectioned-result.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const controls = page.getByRole('region', { name: 'Choose what to review' });
  const visibility = controls.getByRole('group', { name: 'Evidence family visibility' });
  await expect(visibility.getByRole('button', { name: 'Collapse all' })).toBeDisabled();
  await visibility.getByRole('button', { name: 'Expand all' }).click();
  await expect(visibility.getByRole('button', { name: 'Expand all' })).toBeDisabled();

  const localNav = page.getByRole('navigation', { name: 'Result sections' });
  await expect(localNav).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Web & DNS' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Registration' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Relationships & history' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Source quality' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Advanced' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Web and DNS evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Registration$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toBeVisible();
  await expect(page.getByLabel('Source diagnostics')).toContainText('rdap');
  const sourceQualityColour = await page.locator('#source-quality-title').evaluate((heading) => getComputedStyle(heading).color);
  const caseResponseColour = await page.locator('#case-response-title').evaluate((heading) => getComputedStyle(heading).color);
  expect(caseResponseColour).not.toBe(sourceQualityColour);

  // The D3-backed visual is paired with a complete, keyboard-operable source
  // rail. It does not replace the detailed source sections.
  const topology = page.getByRole('region', { name: 'Where this result came from' });
  await expect(topology).toBeVisible();
  await expect(topology.getByRole('img', { name: 'Where this result came from visual overview' })).toBeVisible();
  const visualKey = topology.getByRole('group', { name: 'Evidence topology visual key' });
  await expect(visualKey).toContainText('Registry');
  await expect(visualKey).toContainText('Network');
  await expect(visualKey).toContainText('Web');
  await expect(visualKey).toContainText('Derived');
  await expect(visualKey).toContainText('Analyst');
  await expect(visualKey).toContainText('Colour, shape, and icon identify each evidence family');
  await expect(visualKey).toContainText('Dot and label show evidence state');
  for (const [family, sectionTitleId] of [
    ['registry', 'registry-title'],
    ['network', 'relationships-history-title'],
    ['web', 'web-evidence-title'],
    ['derived', 'source-quality-title'],
    ['analyst', 'case-response-title'],
  ] as const) {
    const keyColour = await visualKey.locator(`.key-item.family-${family} i`).evaluate((key) => getComputedStyle(key).borderColor);
    const sectionColour = await page.locator(`#${sectionTitleId}`).evaluate((heading) => getComputedStyle(heading).color);
    expect(keyColour).toBe(sectionColour);
  }
  const topologyCopies = topology.locator('foreignObject.node-copy');
  await expect(topologyCopies.first()).toBeVisible();
  expect(await topologyCopies.evaluateAll((copies) => copies.every((copy) => {
    const text = copy.firstElementChild;
    const copyRect = copy.getBoundingClientRect();
    const nodeRect = copy.closest('g')?.querySelector(':scope > .node-surface')?.getBoundingClientRect();
    const styles = text ? getComputedStyle(text) : null;
    const wrapped = copy.classList.contains('wrapped');
    return Boolean(
      text
      && nodeRect
      && copyRect.left >= nodeRect.left - 0.5
      && copyRect.right <= nodeRect.right + 0.5
      && copyRect.top >= nodeRect.top - 0.5
      && copyRect.bottom <= nodeRect.bottom + 0.5
      && styles?.overflow === 'hidden'
      && (wrapped
        ? styles.textOverflow === 'clip'
          && styles.whiteSpace === 'normal'
          && text.scrollWidth <= text.clientWidth
          && text.scrollHeight <= text.clientHeight
        : styles.textOverflow === 'ellipsis'
          && styles.whiteSpace === 'nowrap')
    );
  }))).toBe(true);
  const sourceRail = topology.getByRole('list', { name: 'Evidence item status' });
  const mappedEvidenceCount = await sourceRail.getByRole('listitem').count();
  const derivedCount = await sourceRail.locator('.family-derived').count();
  const directCount = mappedEvidenceCount - derivedCount;
  await expect(topology.locator('.topology-summary strong')).toHaveText(String(mappedEvidenceCount));
  await expect(page.locator('#relationships-history .metric').filter({ hasText: 'mapped direct sources' })).toHaveText(`${directCount} mapped direct sources`);
  await expect(page.locator('#relationships-history .metric').filter({ hasText: 'mapped derived analyses' })).toHaveText(`${derivedCount} mapped derived analyses`);
  await expect(page.getByRole('tab', { name: /^Evidence/ }).locator('span')).toHaveText(String(mappedEvidenceCount));
  await expect(sourceRail.locator('.source-icon')).toHaveCount(await sourceRail.locator('li').count());
  await expect(page.locator('[id="dns-title"]')).toHaveCount(1);
  await expect(page.locator('[id="reverse-dns-title"]')).toHaveCount(1);
  const desktopSourceIcons = topology.locator('.node-source-icon .source-icon');
  await expect(desktopSourceIcons).toHaveCount(await sourceRail.locator('li').count());
  await expect(desktopSourceIcons.first()).toBeVisible();
  const topologyPalette = await topology.evaluate((region) => {
    const styleValue = (selector: string, property: 'fill' | 'stroke') => {
      const element = region.querySelector<SVGElement>(selector);
      return element ? getComputedStyle(element)[property] : '';
    };
    return {
      sourceFamilies: [...region.querySelectorAll<SVGGElement>('.source-node')]
        .map((node) => ({
          family: [...node.classList].find((name) => name.startsWith('family-')) ?? '',
          stroke: getComputedStyle(node.querySelector<SVGElement>('.node-surface')!).stroke,
          icon: getComputedStyle(node.querySelector<SVGElement>('.source-icon')!).color,
        })),
      keyColours: [...region.querySelectorAll<HTMLElement>('.key-item')]
        .map((element) => getComputedStyle(element.querySelector<HTMLElement>('i')!).borderColor),
      successFill: styleValue('.source-node.state-success .status-dot', 'fill'),
      partialFill: styleValue('.source-node.state-partial .status-dot', 'fill'),
    };
  });
  const familyColours = new Map<string, { stroke: string; icon: string }>();
  for (const source of topologyPalette.sourceFamilies) {
    const existing = familyColours.get(source.family);
    if (existing) expect(source).toEqual({ family: source.family, ...existing });
    else familyColours.set(source.family, { stroke: source.stroke, icon: source.icon });
  }
  expect(new Set([...familyColours.values()].map((value) => value.icon)).size).toBe(familyColours.size);
  expect(new Set(topologyPalette.keyColours).size).toBe(topologyPalette.keyColours.length);
  expect(topologyPalette.successFill).not.toBe(topologyPalette.partialFill);
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
  await expect(sourceRail.getByRole('link', { name: /WHOIS.*success/i })).toHaveAttribute('href', '#evidence-registry');
  const dnsSource = sourceRail.getByRole('link', { name: /DNS.*partial/i });
  await expect(dnsSource).toHaveAttribute('href', '#evidence-dns');
  await dnsSource.focus();
  await expect(dnsSource.locator('xpath=..')).toHaveClass(/active/);
  await expect(topology.locator('.source-node.family-network.active')).toHaveCount(1);
  await expect(topology.locator('.topology-edges path.active')).toHaveCount(1);

  const visualTabs = page.getByRole('tablist', { name: 'Relationship and history view' });
  const sourcesTab = visualTabs.getByRole('tab', { name: /^Evidence/ });
  await sourcesTab.focus();
  await sourcesTab.press('ArrowRight');
  await expect(visualTabs.getByRole('tab', { name: /^Relationships/ })).toBeFocused();
  await expect(visualTabs.getByRole('tab', { name: /^Relationships/ })).toHaveAttribute('aria-selected', 'true');
  await visualTabs.getByRole('tab', { name: /^Relationships/ }).press('Home');
  await expect(sourcesTab).toBeFocused();
  await expect(sourcesTab).toHaveAttribute('aria-selected', 'true');

  const linkedVisualNode = topology.locator('.source-nodes > g.linked').first();
  const hashBeforeDrag = await page.evaluate(() => window.location.hash);
  await linkedVisualNode.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20, button: 0 });
  await linkedVisualNode.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 20, button: 0 });
  await linkedVisualNode.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 20, button: 0 });
  expect(await page.evaluate(() => window.location.hash)).toBe(hashBeforeDrag);

  await page.getByRole('button', { name: 'Collapse Web and DNS evidence' }).click();
  await expect(page.locator('#evidence-dns')).toHaveCount(0);
  await dnsSource.press('Enter');
  await expect(page).toHaveURL(/#evidence-dns$/);
  await expect(page.locator('#evidence-dns')).toBeInViewport();

  await page.getByRole('button', { name: 'Collapse Web and DNS evidence' }).click();
  await expect(page.locator('#evidence-dns')).toHaveCount(0);
  await page.evaluate(() => {
    window.history.replaceState(window.history.state, '', window.location.pathname);
    window.location.hash = '#evidence-dns';
  });
  await expect(page).toHaveURL(/#evidence-dns$/);
  await expect(page.locator('#evidence-dns')).toBeInViewport();

  const registrySource = sourceRail.getByRole('link', { name: /Registry RDAP.*success/i });
  await expect(registrySource).toHaveAttribute('href', '#evidence-registry');
  await page.getByRole('button', { name: 'Collapse Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toHaveCount(0);
  await registrySource.press('Enter');
  await expect(page).toHaveURL(/#evidence-registry$/);
  await expect(page.locator('#evidence-registry')).toBeInViewport();

  await page.getByRole('tab', { name: /^Timeline/ }).click();
  const lifecycle = page.getByRole('region', { name: 'Observed lifecycle' });
  await expect(lifecycle).toBeVisible();
  await expect(lifecycle.getByRole('img', { name: 'Chronological lookup lifecycle overview' })).toBeVisible();
  const lifecycleEventList = lifecycle.locator('ol[aria-label="Lookup lifecycle events"]');
  await expect(lifecycleEventList).toContainText('Domain created');
  await expect(lifecycle.locator('.visual-fallback')).toHaveCSS('clip-path', 'inset(50%)');
  const lifecycleTokens = await lifecycle.locator('g.event').evaluateAll((events) => (
    events.map((event) => ({
      kind: event.getAttribute('data-kind'),
      colour: getComputedStyle(event).getPropertyValue('--event-color').trim(),
    }))
  ));
  const colourByKind = new Map<string | null, string>();
  for (const event of lifecycleTokens) {
    expect(event.colour).not.toBe('');
    expect(colourByKind.get(event.kind) ?? event.colour).toBe(event.colour);
    colourByKind.set(event.kind, event.colour);
  }
  expect([...colourByKind.keys()].sort()).toEqual(['observation', 'registry']);
  expect(new Set(colourByKind.values()).size).toBe(colourByKind.size);
  await expect(lifecycle.locator('.event-shape')).toHaveCount(lifecycleTokens.length);
  await expect(lifecycle.locator('.registry-shape')).toHaveCount(3);
  await expect(lifecycle.locator('.observation-shape')).toHaveCount(1);
  await expect(lifecycle.locator('.visual-legend .shape-circle')).toHaveCount(1);
  await expect(lifecycle.locator('.visual-legend .shape-diamond')).toHaveCount(1);
  await expect(lifecycle.locator('.visual-legend .shape-square')).toHaveCount(1);

  const activationContext = page.getByRole('region', { name: 'Observed service relationship' });
  await expect(activationContext).toBeVisible();
  await expect(activationContext).toContainText('Web response observed');
  await expect(activationContext).toContainText('Mail state inconclusive');
  await expect(activationContext).toContainText('Cross-layer timing inconclusive');

  const detailedAssessment = page.locator('details.detailed-assessment');
  await detailedAssessment.locator(':scope > summary').click();
  await expect(detailedAssessment).toHaveAttribute('open', '');
  const acquisitionReview = page.locator('details.acquisition');
  await expect(acquisitionReview).toContainText('Acquisition due diligence');
  await expect(acquisitionReview).not.toHaveAttribute('open', '');
  await acquisitionReview.locator(':scope > summary').click();
  await expect(acquisitionReview).toContainText('Registration observed');
  await expect(acquisitionReview).toContainText('Transfer or update constraints observed');
  await expect(acquisitionReview).toContainText(/published escalation route/iu);
  await expect(acquisitionReview).toContainText('does not value a domain');
  const acquisitionDecision = acquisitionReview.getByRole('region', { name: 'Analyst decision workspace' });
  await acquisitionDecision.getByLabel('Current decision').selectOption('continue_manual_review');
  await acquisitionDecision.getByLabel('Registry eligibility and current availability checked').check();
  await acquisitionDecision.getByLabel('Rationale or unresolved questions').fill('Continue manual checks with the current evidence limitations.');
  const acquisitionDownload = page.waitForEvent('download');
  await acquisitionDecision.getByRole('button', { name: 'Download acquisition review' }).click();
  await expect((await acquisitionDownload).suggestedFilename()).toMatch(/^whoisleuth-acquisition-review-.+\.json$/u);
  await expect(acquisitionDecision.getByRole('status')).toContainText('draft acquisition review');

  const coverage = page.getByRole('region', { name: 'Evidence coverage' });
  await expect(coverage).toBeVisible();
  const coverageSummary = coverage.getByRole('group', { name: 'Evidence coverage summary' });
  await expect(coverageSummary.getByText(/complete$/u)).toBeVisible();
  await expect(coverageSummary.getByText(/limited$/u)).toBeVisible();
  await coverage.getByText(/Review \d+ source and analysis records/u).click();
  await expect(coverage).toContainText('Registry RDAP');
  await expect(coverage).toContainText('WHOIS');
  await expect(coverage).toContainText('DNS');
  await expect(coverage).toContainText('Missing, failed, stale, unsupported, and not-found evidence remains distinct');
  const sourceQualityTable = coverage.getByRole('table', { name: 'Source quality and freshness' });
  await expect(sourceQualityTable).toHaveAttribute('aria-colcount', '5');
  await expect(sourceQualityTable.getByRole('row').first().getByRole('columnheader')).toHaveCount(5);
  const limitationCell = sourceQualityTable.getByRole('cell', { name: 'Limitations for Reverse DNS' });
  await expect(limitationCell).toHaveAttribute('aria-colspan', '5');
  await expect(limitationCell).toContainText('PTR context does not prove hosting control.');
  for (const label of ['Registry RDAP', 'WHOIS', 'Availability decision', 'Registrar RDAP']) {
    const state = coverage.locator('.source strong')
      .filter({ hasText: new RegExp(`^${label}$`, 'u') })
      .locator('xpath=../..')
      .locator('.state-complete');
    await expect(state).toHaveClass(/registration-source/u);
    const colours = await state.evaluate((element) => ({
      actual: getComputedStyle(element).color,
      expected: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
    }));
    expect(colours.actual).toBe(colours.expected.startsWith('#')
      ? `rgb(${Number.parseInt(colours.expected.slice(1, 3), 16)}, ${Number.parseInt(colours.expected.slice(3, 5), 16)}, ${Number.parseInt(colours.expected.slice(5, 7), 16)})`
      : colours.expected);
  }
  await coverage.getByText(/Freshness policy/u).click();
  await coverage.getByLabel('Policy').selectOption('analyst-custom');
  await coverage.getByLabel('Registration days').fill('10');
  await coverage.getByLabel('Registration days').blur();
  await expect(coverage).toContainText('Freshness policy · analyst-defined');
  await expect(coverage).toContainText('Thresholds organise source-refresh suggestions');

  await page.getByRole('button', { name: 'Collapse Source quality evidence' }).click();
  await page.getByRole('button', { name: 'Expand Source quality evidence' }).click();
  await coverage.getByText(/Review \d+ source and analysis records/u).click();
  await coverage.getByText(/Freshness policy/u).click();
  await expect(coverage.getByLabel('Policy')).toHaveValue('analyst-custom');
  await expect(coverage.getByLabel('Registration days')).toHaveValue('10');

  const registrationFact = page.locator('.summaries article').filter({ hasText: 'Registration' }).first();
  await registrationFact.getByText('Inspect evidence').click();
  await expect(registrationFact).toContainText('Registry RDAP');
  await expect(registrationFact).toContainText('Authority-aware registration evidence');
  await expect(registrationFact).toContainText('does not recalculate or override');

  const rdapDiagnostic = page.locator('.diagnostics article').filter({ hasText: 'rdap' }).first();
  await rdapDiagnostic.getByText('Inspect source route').click();
  await expect(rdapDiagnostic).toContainText('IANA RDAP bootstrap discovery');
  await expect(rdapDiagnostic).toContainText('Selected endpoint');

  // Detailed registry and raw unified records stay collapsed and subordinate.
  await expect(page.locator('.sources > details').first()).not.toHaveAttribute('open', '');
  await expect(page.locator('details.raw')).not.toHaveAttribute('open', '');

  // Keyboard operation: activating an anchor link moves to the section.
  const registryLink = localNav.getByRole('link', { name: 'Registration' });
  await registryLink.focus();
  await registryLink.press('Enter');
  await expect(page).toHaveURL(/#registry$/);
  await expect(page.locator('#registry')).toBeInViewport();
  await expect(registryLink).toHaveAttribute('aria-current', 'location');

  // The DNS status stays visible while its detailed warning is disclosed on demand.
  const dnsCard = page.getByLabel('DNS intelligence');
  await expect(dnsCard.locator(':scope > summary .evidence-status')).toHaveText('partial');
  await expect(page.getByText(/A resolver failure is not evidence that a record is absent/)).toBeHidden();
  await dnsCard.locator(':scope > summary').click();
  await expect(page.getByText(/A resolver failure is not evidence that a record is absent/)).toBeVisible();

  const httpCard = page.locator('.http-card');
  await httpCard.locator(':scope > summary').click();
  const redirectDisclosure = httpCard.getByText('Redirect chain · 1 hop');
  await redirectDisclosure.click();
  await expect(httpCard.getByRole('img', { name: 'HTTP redirect path with 1 hop' })).toBeVisible();
  const dependencyReview = page.locator('details.dependency-review');
  await dependencyReview.locator(':scope > summary').click();
  await expect(dependencyReview.getByText('within domain', { exact: true }).first()).toBeVisible();

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 700, height: 900 },
    { width: 430, height: 932 },
    { width: 393, height: 852 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await expectNoHorizontalOverflow(page);

    const redirectPath = httpCard.locator('.redirect-path');
    if (size.width <= 720) {
      await expect(redirectPath.locator('.redirect-mobile')).toBeVisible();
      await expect(httpCard.locator('.disclosure > ol')).toBeHidden();
      const redirectWidth = await redirectPath.evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
      }));
      expect(redirectWidth.scroll).toBeLessThanOrEqual(redirectWidth.client);
    }

    await page.getByRole('tab', { name: /^Evidence/ }).click();
    const topologyGraphic = topology.getByRole('img', { name: 'Where this result came from visual overview' });
    if (size.width > 700) {
      await expect(topologyGraphic).toBeVisible();
      const graphicBox = await boundingBox(topologyGraphic);
      const panelBox = await boundingBox(topology);
      expect(graphicBox.width).toBeGreaterThan(Math.min(520, panelBox.width * 0.72));
      expect(graphicBox.width).toBeLessThanOrEqual(panelBox.width + 1);
      expect(graphicBox.height).toBeGreaterThan(150);
      expect(graphicBox.height).toBeLessThan(560);
    } else {
      await expect(topologyGraphic).toBeHidden();
      await expect(topology.locator('.mobile-target')).toBeVisible();
    }

    await page.getByRole('tab', { name: /^Relationships/ }).click();
    const relationshipMap = page.locator('.asset-graph .relationship-map');
    await expect(relationshipMap).toHaveCount(1);
    const mapFrame = relationshipMap.locator('.map-frame');
    const mobileMap = relationshipMap.locator('.map-mobile');
    const mapFrameVisible = await mapFrame.isVisible();
    const mobileMapVisible = await mobileMap.isVisible();
    expect(Number(mapFrameVisible) + Number(mobileMapVisible)).toBe(1);
    if (size.width === 1920 || size.width === 1440) expect(mapFrameVisible).toBe(true);
    if (size.width === 320) expect(mobileMapVisible).toBe(true);
    if (mapFrameVisible) {
      const graphBox = await boundingBox(mapFrame);
      const panelBox = await boundingBox(relationshipMap);
      expect(graphBox.width).toBeGreaterThan(Math.min(500, panelBox.width * 0.7));
      expect(graphBox.width).toBeLessThanOrEqual(panelBox.width + 1);
      expect(graphBox.height).toBeGreaterThan(180);
      expect(graphBox.height).toBeLessThan(700);
      expect(await mapFrame.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await mapFrame.evaluate((element) => getComputedStyle(element).touchAction)).toContain('pinch-zoom');
      if (size.width === 1440) {
        await mapFrame.scrollIntoViewIfNeeded();
        const wheelTarget = await boundingBox(mapFrame);
        const before = await page.evaluate(() => ({
          y: window.scrollY,
          maximum: document.documentElement.scrollHeight - window.innerHeight,
        }));
        const wheelDelta = before.y < before.maximum - 320 ? 320 : -320;
        await page.mouse.move(
          wheelTarget.x + wheelTarget.width / 2,
          wheelTarget.y + Math.min(wheelTarget.height / 2, 180),
        );
        await page.mouse.wheel(0, wheelDelta);
        if (wheelDelta > 0) {
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before.y);
        } else {
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before.y);
        }
      }
    } else {
      expect(await mobileMap.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }

    await page.getByRole('tab', { name: /^Timeline/ }).click();
    const lifecycleGraphic = lifecycle.getByRole('img', { name: 'Chronological lookup lifecycle overview' });
    if (size.width > 620) {
      await expect(lifecycleGraphic).toBeVisible();
      const graphicBox = await boundingBox(lifecycleGraphic);
      const panelBox = await boundingBox(lifecycle);
      expect(graphicBox.width).toBeGreaterThan(Math.min(500, panelBox.width * 0.7));
      expect(graphicBox.width).toBeLessThanOrEqual(panelBox.width + 1);
      expect(graphicBox.height).toBeGreaterThan(130);
      expect(graphicBox.height).toBeLessThan(520);
    } else {
      await expect(lifecycleGraphic).toBeHidden();
      await expect(lifecycle.locator('ol[aria-label="Lookup lifecycle events"]')).toBeVisible();
    }
  }

  // The desktop source graph becomes a connected, full-width source map on
  // narrow screens instead of shrinking every label into the wide SVG.
  await page.getByRole('tab', { name: /^Evidence/ }).click();
  await expect(topology.getByRole('img', { name: 'Where this result came from visual overview' })).toBeHidden();
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
  await page.getByRole('tab', { name: /^Timeline/ }).click();
  await expect(lifecycle.getByRole('img', { name: 'Chronological lookup lifecycle overview' })).toBeHidden();
  const mobileTimeline = lifecycle.locator('ol[aria-label="Lookup lifecycle events"]');
  await expect(mobileTimeline).toBeVisible();
  expect(await mobileTimeline.locator('li').evaluateAll((items) => items.every((item) => {
    const listRect = item.parentElement?.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    return Boolean(listRect && itemRect.left >= listRect.left - 0.5 && itemRect.right <= listRect.right + 0.5);
  }))).toBe(true);

  // Mobile uses one compact native section picker instead of a horizontally
  // scrolling trace strip. The chosen destination clears the sticky toolbar.
  await expect(localNav).toBeHidden();
  const sectionPicker = page.getByLabel('Jump to section');
  await expect(sectionPicker).toBeVisible();
  await sectionPicker.selectOption('#advanced-evidence');
  await expect(page).toHaveURL(/#advanced-evidence$/);
  await expect.poll(async () => page.locator('#advanced-evidence').evaluate((section) => {
    const sectionTop = section.getBoundingClientRect().top;
    const navigation = document.querySelector('.local-nav-shell');
    return navigation ? sectionTop >= navigation.getBoundingClientRect().bottom + 4 : false;
  })).toBe(true);
  await expect(sectionPicker).toHaveValue('#advanced-evidence');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.export-menu > summary').click();
  await page.getByRole('button', { name: 'Export evidence JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-evidence-sectioned-result\.invalid-.+\.json$/);
});

test('Lookup focus and disclosure controls change presentation without changing evidence', async ({ page }) => {
  const domain = 'presentation-options.invalid';
  await page.setViewportSize({ width: 1440, height: 900 });
  const lookupRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/lookup') lookupRequests.push(request.url());
  });
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(sectionedLookupFixture(domain)),
  }));
  await page.goto('/lookup');
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const controls = page.getByRole('region', { name: 'Choose what to review' });
  const task = controls.getByLabel('Focus');
  const localNav = page.getByRole('navigation', { name: 'Result sections' });
  await expect(task).toHaveValue('general');
  await expect(controls.getByLabel('Detail')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  const atAGlance = page.locator('.at-a-glance');
  const glanceGeometry = await atAGlance.evaluate((section) => {
    const intro = section.querySelector('.glance-intro');
    const note = section.querySelector('.metric-note');
    const sectionBox = section.getBoundingClientRect();
    const introBox = intro?.getBoundingClientRect();
    const noteBox = note?.getBoundingClientRect();
    return {
      sectionClientWidth: section.clientWidth,
      sectionScrollWidth: section.scrollWidth,
      introWidth: introBox?.width ?? 0,
      noteRight: noteBox?.right ?? Number.POSITIVE_INFINITY,
      sectionRight: sectionBox.right,
    };
  });
  expect(glanceGeometry.sectionScrollWidth).toBeLessThanOrEqual(glanceGeometry.sectionClientWidth + 1);
  expect(glanceGeometry.introWidth).toBeGreaterThanOrEqual(230);
  expect(glanceGeometry.noteRight).toBeLessThanOrEqual(glanceGeometry.sectionRight + 1);
  const detailedAssessment = page.locator('details.detailed-assessment');
  await expect(detailedAssessment).not.toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: 'What the current evidence can support' })).toBeHidden();
  await page.getByText('Open assessment', { exact: true }).click();
  await expect(detailedAssessment).toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: 'What the current evidence can support' })).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & { __claimPassportWrites?: number };
    state.__claimPassportWrites = 0;
    const count = () => { state.__claimPassportWrites = (state.__claimPassportWrites ?? 0) + 1; };
    const originalPut = IDBObjectStore.prototype.put;
    const originalAdd = IDBObjectStore.prototype.add;
    const originalDelete = IDBObjectStore.prototype.delete;
    const originalClear = IDBObjectStore.prototype.clear;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalStorageClear = Storage.prototype.clear;
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) { count(); return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key); };
    IDBObjectStore.prototype.add = function add(value: unknown, key?: IDBValidKey) { count(); return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key); };
    IDBObjectStore.prototype.delete = function deleteRecord(query: IDBValidKey | IDBKeyRange) { count(); return originalDelete.call(this, query); };
    IDBObjectStore.prototype.clear = function clear() { count(); return originalClear.call(this); };
    Storage.prototype.setItem = function setItem(key: string, value: string) { count(); return originalSetItem.call(this, key, value); };
    Storage.prototype.removeItem = function removeItem(key: string) { count(); return originalRemoveItem.call(this, key); };
    Storage.prototype.clear = function clear() { count(); return originalStorageClear.call(this); };
  });
  const requestCountBeforeExport = lookupRequests.length;
  const passportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download portable passport for Registration-state statement' }).click();
  const downloadedPassport = await passportDownload;
  expect(downloadedPassport.suggestedFilename()).toMatch(/^whoisleuth-claim-presentation-options\.invalid-registration-state-\d{4}-\d{2}-\d{2}\.json$/u);
  const passportPath = await downloadedPassport.path();
  expect(passportPath).not.toBeNull();
  const passport = JSON.parse(await readFile(passportPath!, 'utf8')) as Record<string, unknown>;
  expect(passport.schema).toBe('whoisleuth.lookup-claim-passport');
  expect(passport.version).toBe(1);
  expect(passport.target).toEqual({ type: 'domain', value: domain });
  expect((passport.claim as Record<string, unknown>).id).toBe('registration-state');
  expect((passport.claim as Record<string, unknown>).requiredEvidenceIds).toEqual([
    'authority-aware-availability',
  ]);
  const keys: string[] = [];
  const inspectKeys = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) inspectKeys(item); return; }
    for (const [key, item] of Object.entries(value)) { keys.push(key); inspectKeys(item); }
  };
  inspectKeys(passport);
  expect(keys).not.toEqual(expect.arrayContaining(['requestUrl', 'finalUrl', 'contacts', 'rawWhois', 'credential']));
  expect(JSON.stringify(passport)).not.toMatch(/\/home|abuse@example\.test|Fixture Registrar/iu);
  await expect(detailedAssessment.getByRole('status')).toContainText('Downloaded a portable passport for Registration-state statement.');
  expect(await page.evaluate(() => (window as typeof window & { __claimPassportWrites?: number }).__claimPassportWrites)).toBe(0);
  expect(lookupRequests).toHaveLength(requestCountBeforeExport);
  await page.getByText('Close assessment', { exact: true }).click();
  await expect(detailedAssessment).not.toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Expand Advanced evidence' })).toBeVisible();
  const familyToggle = page.getByRole('button', { name: 'Expand Registration evidence' }).locator('.toggle-icon');
  await expect(familyToggle).toHaveText('');
  await expect(familyToggle).toHaveCSS('width', '17px');
  await expect(familyToggle).toHaveCSS('height', '17px');
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toHaveCount(0);

  const visibility = controls.getByRole('group', { name: 'Evidence family visibility' });
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toHaveCount(0);
  await expect(visibility.getByRole('button', { name: 'Collapse all' })).toBeDisabled();
  await localNav.getByRole('link', { name: 'Web & DNS' }).click();
  await expect(page.locator('#evidence-dns')).toBeVisible();
  await expect(page).toHaveURL(/#web-evidence$/);
  await visibility.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toBeVisible();
  await expect(page.locator('#raw-data details')).toBeVisible();
  await expect(page.locator('#raw-data details')).toHaveJSProperty('open', false);
  await page.getByRole('button', { name: 'Collapse Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toBeVisible();

  await expect(page.locator('#evidence-dns > details')).toHaveJSProperty('open', false);
  await task.selectOption('acquisition');
  await expect(page.locator('#evidence-dns > details')).toHaveJSProperty('open', false);
  await expect(localNav.getByRole('link').evaluateAll((links) => links.map((link) => link.textContent?.trim()))).resolves.toEqual([
    'Overview',
    'Registration',
    'Relationships & history',
    'Web & DNS',
    'Source quality',
    'Case & response',
    'Advanced',
  ]);

  await visibility.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.getByRole('button', { name: 'Expand Registration evidence' })).toBeVisible();
  await expect(page.locator('#evidence-registry')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand Source quality evidence' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('acquisition');
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Detail')).toHaveCount(0);
});

test('Lookup task query context is bounded, transient, and changes only result presentation', async ({ page }) => {
  const domain = 'task-context.invalid';
  const lookupRequests: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('whoisleuth:lookup-presentation:v1', JSON.stringify({ version: 1, task: 'brand' }));
  });
  await page.route('**/api/lookup?*', (route) => {
    lookupRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sectionedLookupFixture(domain)),
    });
  });

  await page.goto('/lookup?depth=deep&task=acquisition#query');
  expect(lookupRequests).toEqual([]);
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('acquisition');
  expect(lookupRequests).toHaveLength(1);
  expect(new URL(lookupRequests[0]!).searchParams.has('task')).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('whoisleuth:lookup-presentation:v1') || '{}').task)).toBe('brand');

  const acquisitionScores = page.locator('.availability .scores .score');
  await expect(acquisitionScores).toHaveCount(2);
  await expect(acquisitionScores.nth(0)).toHaveAttribute('data-score-hierarchy', 'primary');
  await expect(acquisitionScores.nth(0)).toHaveAttribute('aria-label', /Primary assessment: Opportunity score/u);
  await expect(acquisitionScores.nth(1)).toHaveAttribute('data-score-hierarchy', 'secondary');
  await expect(acquisitionScores.nth(1)).toHaveAttribute('aria-label', /Secondary assessment: Risk score/u);
  const acquisitionDetails = page.locator('.availability .score-details .score-detail');
  await expect(acquisitionDetails.nth(0)).toHaveAttribute('data-score-hierarchy', 'primary');
  await expect(acquisitionDetails.nth(0)).toHaveAttribute('aria-label', 'Primary Opportunity score explanation');
  await expect(acquisitionDetails.nth(1)).toHaveAttribute('data-score-hierarchy', 'secondary');
  await expect(acquisitionDetails.nth(1)).toHaveAttribute('aria-label', 'Secondary Risk score explanation');
  const nextActions = page.locator('.at-a-glance .next-action');
  expect(await nextActions.count()).toBeLessThanOrEqual(3);
  await expect(nextActions.filter({ hasText: 'Review transfer dependencies' })).toHaveCount(1);
  await page.locator('details.detailed-assessment > summary').click();
  await expect(page.getByRole('heading', { name: 'Useful next actions' })).toHaveCount(0);
  const focus = page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus');
  await focus.selectOption('brand');
  await page.evaluate(() => { window.location.hash = 'registry'; });
  await expect(page).toHaveURL(/task=acquisition#registry$/u);
  await expect(focus).toHaveValue('brand');

  await page.goto('/lookup?task=ACQUISITION');
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('brand');
  const brandScores = page.locator('.availability .scores .score');
  await expect(brandScores.nth(0)).toHaveAttribute('data-score-hierarchy', 'primary');
  await expect(brandScores.nth(0)).toHaveAttribute('aria-label', /Primary assessment: Risk score/u);
  await expect(brandScores.nth(1)).toHaveAttribute('data-score-hierarchy', 'secondary');
  await expect(brandScores.nth(1)).toHaveAttribute('aria-label', /Secondary assessment: Opportunity score/u);
  const brandDetails = page.locator('.availability .score-details .score-detail');
  await expect(brandDetails.nth(0)).toHaveAttribute('aria-label', 'Primary Risk score explanation');
  await expect(brandDetails.nth(1)).toHaveAttribute('aria-label', 'Secondary Opportunity score explanation');
  expect(lookupRequests).toHaveLength(2);
  expect(lookupRequests.every((url) => !new URL(url).searchParams.has('task'))).toBe(true);

  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('a task-only Lookup navigation preserves the existing in-memory depth choice', async ({ page }) => {
  await page.goto('/lookup');
  await page.getByRole('radio', { name: /Fast/u }).check();
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/ }).click();
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/lookup?task=acquisition';
    link.textContent = 'Open task context';
    document.body.append(link);
    link.click();
  });
  await expect(page).toHaveURL(/\/lookup\?task=acquisition$/u);
  await expect(page.getByRole('radio', { name: /Fast/u })).toBeChecked();
});

test('same-route Lookup URL changes reconcile retained evidence, depth, and transient task context', async ({ page }) => {
  const retainedDomain = 'retained-fast.invalid';
  await page.addInitScript(() => {
    localStorage.setItem('whoisleuth:lookup-presentation:v1', JSON.stringify({ version: 1, task: 'brand' }));
  });
  await page.route('**/api/lookup?*', async (route) => {
    const url = new URL(route.request().url());
    const domain = url.searchParams.get('q') || retainedDomain;
    if (domain === '192.0.2.20' || domain === 'AS64497') {
      const type = domain.startsWith('AS') ? 'asn' : 'ipv4';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          query: domain,
          type,
          availability: { applicable: false, type },
          rdap: { upstreamStatus: 200, parsed: {} },
          whois: { skipped: true, detail: 'WHOIS is omitted in fast RDAP-only mode.' },
          diagnostics: {
            rdap: { status: 'success' },
            whois: { status: 'skipped' },
            availability: { status: 'not_applicable' },
          },
        }),
      });
      return;
    }
    const fixture = sectionedLookupFixture(domain);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...fixture,
        availability: { ...fixture.availability, deepScanComplete: url.searchParams.get('fast') !== '1' },
      }),
    });
  });
  const navigate = async (href: string) => {
    await page.evaluate((destination) => {
      const link = document.createElement('a');
      link.href = destination;
      link.textContent = 'Lookup context link';
      document.body.append(link);
      link.click();
    }, href);
    await expect.poll(() => {
      const current = new URL(page.url());
      return `${current.pathname}${current.search}`;
    }).toBe(href);
  };

  await page.goto('/lookup');
  await page.locator('#query').fill(retainedDomain);
  await page.getByRole('radio', { name: /Fast/u }).check();
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();

  await navigate('/lookup?depth=deep&task=acquisition');
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await expect(page.locator('#query')).toHaveValue(retainedDomain);
  await expect(page.locator('#result')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('acquisition');

  await navigate('/lookup?task=incident');
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('incident');
  await navigate('/lookup');
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('brand');

  await page.getByRole('radio', { name: /Fast/u }).check();
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await navigate('/lookup?q=next-target.invalid&depth=fast&task=owned');
  await expect(page.locator('#query')).toHaveValue('next-target.invalid');
  await expect(page.getByRole('radio', { name: /Fast/u })).toBeChecked();
  await expect(page.locator('#result')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('owned');

  await navigate('/lookup?q=%00ignored&depth=DEEP&task=OWNED');
  await expect(page.locator('#query')).toHaveValue('next-target.invalid');
  await expect(page.getByRole('radio', { name: /Fast/u })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('brand');
  await page.goBack();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('owned');
  await page.goBack();
  await expect(page).toHaveURL(/\/lookup$/u);
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('brand');
  await page.goForward();
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Focus')).toHaveValue('owned');

  for (const [genericTarget, targetType] of [['192.0.2.20', 'ipv4'], ['AS64497', 'asn']] as const) {
    for (const completedDepth of ['fast', 'deep'] as const) {
      await navigate('/lookup');
      await page.locator('#query').fill(genericTarget);
      await page.getByRole('radio', { name: new RegExp(completedDepth, 'iu') }).check();
      await page.getByRole('button', { name: 'Run lookup' }).click();
      await expect(page.locator('#result')).toBeVisible();
      await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
      await page.getByRole('tab', { name: /^Evidence/u }).click();
      await expect(page.locator('.target-detail-copy')).toContainText(`${targetType} · ${completedDepth} lookup`);

      const otherDepth = completedDepth === 'fast' ? 'deep' : 'fast';
      await page.getByRole('radio', { name: new RegExp(otherDepth, 'iu') }).check();
      await expect(page.locator('.target-detail-copy')).toContainText(`${targetType} · ${completedDepth} lookup`);
      await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
      await page.locator('#console-navigation').getByRole('link', { name: /^Lookup/u }).click();
      await expect(page.locator('#result')).toBeVisible();
      await expect(page.getByRole('radio', { name: new RegExp(otherDepth, 'iu') })).toBeChecked();
      await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
      await page.getByRole('tab', { name: /^Evidence/u }).click();
      await expect(page.locator('.target-detail-copy')).toContainText(`${targetType} · ${completedDepth} lookup`);

      await navigate(`/lookup?q=${encodeURIComponent(genericTarget)}&depth=${otherDepth}`);
      await expect(page.locator('#result')).toHaveCount(0);
    }
  }
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
    ['/discover', 'Discover', 'Find candidates'],
    ['/bulk', 'Bulk', 'Assess domains'],
    ['/monitor', 'Monitor', 'Track findings'],
    ['/brands', 'Brands', 'Protect'],
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
