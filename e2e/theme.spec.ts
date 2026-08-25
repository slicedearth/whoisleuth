import { expect, test } from './fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, openDashboardSecondaryWorkspaces } from './helpers';

const STORAGE_KEY = 'whoisleuth:theme:v1';

async function chooseTheme(page: import('@playwright/test').Page, label: 'Dark' | 'Light' | 'System') {
  const trigger = page.getByRole('button', { name: /^Colour theme,/ });
  await trigger.click();
  await page.getByRole('option', { name: `${label} theme` }).click();
}

async function clearThemePreference(page: import('@playwright/test').Page) {
  await page.addInitScript((key) => {
    const sentinel = 'whoisleuth:e2e-theme-initialized';
    if (sessionStorage.getItem(sentinel)) return;
    localStorage.removeItem(key);
    sessionStorage.setItem(sentinel, '1');
  }, STORAGE_KEY);
}

async function sourceTokenContrast(page: import('@playwright/test').Page, family: 'registry' | 'network' | 'technology') {
  return page.evaluate((sourceFamily) => {
    const parseColour = (value: string): [number, number, number] => {
      const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Could not parse computed colour ${value}.`);
      return channels as [number, number, number];
    };
    const luminance = (colour: string) => {
      const channels = parseColour(colour).map((channel) => {
        const normalised = channel / 255;
        return normalised <= 0.04045 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
    };
    const ratio = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
      return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
    };
    const sample = document.createElement('span');
    document.body.append(sample);
    const resolveColour = (token: string) => {
      sample.style.color = `var(${token})`;
      return getComputedStyle(sample).color;
    };
    const panel = resolveColour('--panel');
    const text = resolveColour(`--source-${sourceFamily}-text`);
    const stroke = resolveColour(`--source-${sourceFamily}-stroke`);
    sample.remove();
    return { text, stroke, textRatio: ratio(text, panel), strokeRatio: ratio(stroke, panel) };
  }, family);
}

async function clusterTokenContrast(page: import('@playwright/test').Page, index: number) {
  return page.evaluate((clusterIndex) => {
    const parseColour = (value: string): [number, number, number] => {
      const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Could not parse computed colour ${value}.`);
      return channels as [number, number, number];
    };
    const luminance = (colour: string) => {
      const channels = parseColour(colour).map((channel) => {
        const normalised = channel / 255;
        return normalised <= 0.04045 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
    };
    const ratio = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
      return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
    };
    const sample = document.createElement('span');
    document.body.append(sample);
    const resolveColour = (token: string) => {
      sample.style.color = `var(${token})`;
      return getComputedStyle(sample).color;
    };
    const contrast = ratio(resolveColour(`--cluster-${clusterIndex}`), resolveColour('--panel'));
    sample.remove();
    return contrast;
  }, index);
}

test('the default system preference follows the operating-system colour scheme', async ({ page }) => {
  await clearThemePreference(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  const trigger = page.getByRole('button', { name: 'Colour theme, System selected' });
  await expect(trigger).toHaveAttribute('title', 'System theme');
  await expect(trigger.locator('.theme-trigger-label')).toHaveText('Theme');
  await expect(trigger.locator('[data-theme-symbol="system"]')).toBeVisible();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#e7e2d8');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(250, 247, 241)');
  await expect(page.locator('.hero-preview .preview-note')).toHaveCSS('color', 'rgb(88, 80, 69)');
  await expect(page.locator('.topology-backdrop')).toHaveCSS('opacity', '0.16');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(231, 226, 216)');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('border-color', 'rgb(214, 207, 194)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f1115');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(23, 26, 33)');
  await expect(page.locator('.hero-preview .preview-note')).toHaveCSS('color', 'rgb(139, 147, 167)');
  await expect(page.locator('.topology-backdrop')).toHaveCSS('opacity', '0.22');

  const navFontSizes = await page.locator('.public-header').evaluate((header) => ({
    navigation: getComputedStyle(header.querySelector('a[href="/demo"]')!).fontSize,
    themeLabel: getComputedStyle(header.querySelector('.theme-trigger-label')!).fontSize,
  }));
  expect(navFontSizes.themeLabel).toBe(navFontSizes.navigation);
});

test('light preference applies before reload and persists across public pages', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');

  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#e7e2d8');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(250, 247, 241)');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('light');

  await page.goto('/demo');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const trigger = page.getByRole('button', { name: 'Colour theme, Light selected' });
  await expect(trigger.locator('[data-theme-symbol="light"]')).toBeVisible();
  await expect(trigger).not.toContainText('Light');
});

test('source text and graph stroke tokens stay distinct and contrast-safe in both themes', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');

  for (const theme of ['Dark', 'Light'] as const) {
    await chooseTheme(page, theme);
    for (const family of ['registry', 'network', 'technology'] as const) {
      const contrast = await sourceTokenContrast(page, family);
      expect(contrast.text).not.toBe(contrast.stroke);
      expect(contrast.textRatio).toBeGreaterThanOrEqual(4.5);
      expect(contrast.strokeRatio).toBeGreaterThanOrEqual(3);
    }
  }
});

test('relationship-map cluster strokes stay contrast-safe in both themes', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');

  for (const theme of ['Dark', 'Light'] as const) {
    await chooseTheme(page, theme);
    for (let index = 0; index < 8; index += 1) {
      expect(await clusterTokenContrast(page, index)).toBeGreaterThanOrEqual(3);
    }
  }
});

test('light surfaces avoid pure white and separate layers, structural borders, and controls by role', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');
  await chooseTheme(page, 'Light');

  const palette = await page.evaluate(() => {
    const sample = document.createElement('span');
    document.body.append(sample);
    const resolveColour = (token: string) => {
      sample.style.color = `var(${token})`;
      return getComputedStyle(sample).color;
    };
    const parseColour = (value: string): [number, number, number] => {
      const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Could not parse computed colour ${value}.`);
      return channels as [number, number, number];
    };
    const luminance = (colour: string) => {
      const channels = parseColour(colour).map((channel) => {
        const normalised = channel / 255;
        return normalised <= 0.04045 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
    };
    const contrast = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
      return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
    };
    const panel = resolveColour('--panel');
    const background = resolveColour('--bg');
    const raised = resolveColour('--panel-raised');
    const tokens = Object.fromEntries(
      ['--text', '--muted', '--muted-subtle', '--accent', '--accent2', '--border', '--border-strong', '--control-border']
        .map((token) => [token, resolveColour(token)]),
    );
    const semanticFillAlpha = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--semantic-fill-alpha'));
    const semanticBorderAlpha = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--semantic-border-alpha'));
    sample.remove();
    return {
      background,
      panel,
      raised,
      luminance: { panel: luminance(panel) },
      layerContrast: {
        panelToCanvas: contrast(panel, background),
        raisedToCanvas: contrast(raised, background),
        panelToRaised: contrast(panel, raised),
      },
      semanticFillAlpha,
      semanticBorderAlpha,
      contrast: Object.fromEntries(Object.entries(tokens).map(([token, colour]) => [token, contrast(colour, panel)])),
    };
  });

  expect(palette.panel).not.toBe('rgb(255, 255, 255)');
  expect(palette.luminance.panel).toBeLessThanOrEqual(0.94);
  expect(palette.layerContrast.panelToCanvas).toBeGreaterThanOrEqual(1.18);
  expect(palette.layerContrast.raisedToCanvas).toBeGreaterThanOrEqual(1.04);
  expect(palette.layerContrast.panelToRaised).toBeGreaterThanOrEqual(1.12);
  expect(palette.semanticFillAlpha).toBeGreaterThanOrEqual(0.1);
  expect(palette.semanticBorderAlpha).toBeGreaterThanOrEqual(0.4);
  expect(palette.semanticBorderAlpha).toBeLessThanOrEqual(0.5);
  expect(palette.contrast['--text']).toBeGreaterThanOrEqual(7);
  expect(palette.contrast['--muted']).toBeGreaterThanOrEqual(4.5);
  expect(palette.contrast['--muted-subtle']).toBeGreaterThanOrEqual(4.5);
  expect(palette.contrast['--accent']).toBeGreaterThanOrEqual(4.5);
  expect(palette.contrast['--accent2']).toBeGreaterThanOrEqual(4.5);
  expect(palette.contrast['--border']).toBeGreaterThanOrEqual(1.3);
  expect(palette.contrast['--border']).toBeLessThan(2);
  expect(palette.contrast['--border-strong']).toBeGreaterThanOrEqual(2);
  expect(palette.contrast['--border-strong']).toBeLessThan(3);
  expect(palette.contrast['--control-border']).toBeGreaterThanOrEqual(3);
});

test('dark chrome restores the deployed secondary accent while light chrome stays blue', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/lookup');

  for (const theme of ['Dark', 'Light'] as const) {
    await chooseTheme(page, theme);
    const roles = await page.evaluate(() => {
      const probe = document.createElement('button');
      probe.className = 'btn active';
      probe.textContent = 'Selected';
      document.body.append(probe);
      const colour = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const interfaceAccent = colour('--interface-accent');
      const accent = colour('--accent');
      const accent2 = colour('--accent2');
      const borderStrong = colour('--border-strong');
      const controlBorder = colour('--control-border');
      probe.style.color = '';
      const selected = getComputedStyle(probe);
      const heading = document.querySelector<HTMLElement>('.heading')!;
      const navigation = document.querySelector<HTMLElement>('nav a.active')!;
      const prompt = document.querySelector<HTMLElement>('.terminal-strip .prompt-sigil')!;
      const eyebrow = document.querySelector<HTMLElement>('.heading .eyebrow')!;
      const field = document.querySelector<HTMLElement>('#query')!;
      const result = {
        interfaceAccent,
        accent,
        accent2,
        borderStrong,
        controlBorder,
        selectedColour: selected.color,
        selectedBorder: selected.borderTopColor,
        eyebrow: getComputedStyle(eyebrow).color,
        prompt: getComputedStyle(prompt).color,
        navArrow: getComputedStyle(navigation, '::before').color,
        navBorder: getComputedStyle(navigation).borderLeftColor,
        headingRule: getComputedStyle(heading, '::after').backgroundImage,
        caret: getComputedStyle(field).caretColor,
      };
      probe.remove();
      return result;
    });

    expect(roles.selectedColour).toBe(roles.interfaceAccent);
    expect(roles.eyebrow).toBe(roles.interfaceAccent);
    expect(roles.prompt).toBe(roles.interfaceAccent);
    expect(roles.navArrow).toBe(roles.interfaceAccent);
    expect(roles.navBorder).toBe(roles.interfaceAccent);
    expect(roles.caret).toBe(roles.interfaceAccent);
    expect(roles.headingRule).toContain(roles.interfaceAccent);
    expect(roles.headingRule).toContain(roles.accent);

    if (theme === 'Dark') {
      expect(roles.interfaceAccent).toBe(roles.accent2);
      expect(roles.controlBorder).toBe(roles.borderStrong);
    } else {
      expect(roles.interfaceAccent).toBe(roles.accent);
      expect(roles.controlBorder).not.toBe(roles.borderStrong);
    }
  }
});

test('light chrome uses a theme-aware mark without a bright boxed plate', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/dashboard');
  await chooseTheme(page, 'Light');

  const rail = page.locator('.shell > aside');
  await expect(rail).toHaveCSS('background-color', 'rgba(250, 247, 241, 0.97)');
  await expect(rail.locator('.brand strong')).toHaveCSS('color', 'rgb(28, 25, 21)');
  await expect(rail.locator('nav a').first()).toHaveCSS('color', 'rgb(28, 25, 21)');
  await expect(rail.locator('nav a small').first()).toHaveCSS('color', 'rgb(88, 80, 69)');
  await expect(rail.locator('.brand .mark')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(rail.locator('[data-brand-tone="primary"]')).toHaveCSS('fill', 'rgb(0, 91, 145)');
  await expect(rail.locator('[data-brand-tone="secondary"]')).toHaveCSS('fill', 'rgb(0, 107, 73)');

  await page.goto('/');
  await expect(page.locator('.public-brand .mark')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.public-brand [data-brand-tone="primary"]')).toHaveCSS('fill', 'rgb(0, 91, 145)');
  await expect(page.locator('.public-brand [data-brand-tone="secondary"]')).toHaveCSS('fill', 'rgb(0, 107, 73)');
});

test('theme-specific controls, nested surfaces, score visibility, and form hints retain their roles', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/lookup');

  for (const theme of ['Dark', 'Light'] as const) {
    await chooseTheme(page, theme);
    const contrast = await page.evaluate(() => {
      const sample = document.createElement('span');
      document.body.append(sample);
      const colour = (token: string) => {
        sample.style.color = `var(${token})`;
        return getComputedStyle(sample).color;
      };
      const channels = (value: string) => value.match(/[\d.]+/gu)!.slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [red, green, blue] = channels(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };
      const ratio = (left: string, right: string) => {
        const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
        return (lighter! + 0.05) / (darker! + 0.05);
      };
      const value = {
        controlBoundary: ratio(colour('--control-border'), colour('--panel-raised')),
        quietControlBoundary: ratio(colour('--quiet-control-border'), colour('--panel')),
        structuralBoundary: ratio(colour('--border'), colour('--panel')),
        hintText: ratio(colour('--muted'), colour('--panel')),
        surface: colour('--surface'),
        panel: colour('--panel'),
        raised: colour('--panel-raised'),
        scoreTrackHeight: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--score-track-height')),
        factorFillAlpha: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--factor-fill-alpha')),
      };
      sample.remove();
      return value;
    });
    if (theme === 'Dark') {
      expect(contrast.controlBoundary).toBeLessThan(3);
      expect(contrast.controlBoundary).toBeGreaterThan(contrast.quietControlBoundary);
      expect(contrast.quietControlBoundary).toBeCloseTo(contrast.structuralBoundary, 5);
      expect(contrast.quietControlBoundary).toBeLessThan(2);
      expect(contrast.surface).toBe(contrast.panel);
      expect(contrast.scoreTrackHeight).toBe(5);
      expect(contrast.factorFillAlpha).toBeCloseTo(0.22, 5);
    } else {
      expect(contrast.controlBoundary).toBeGreaterThanOrEqual(3);
      expect(contrast.quietControlBoundary).toBeGreaterThanOrEqual(3);
      expect(contrast.surface).toBe(contrast.raised);
      expect(contrast.scoreTrackHeight).toBe(10);
      expect(contrast.factorFillAlpha).toBeCloseTo(0.45, 5);
    }
    expect(contrast.hintText).toBeGreaterThanOrEqual(4.5);
  }
});

test('dashboard fields and quiet buttons use the theme-specific boundary', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-shortlist-v1': currentBrowserLocalDocument('shortlist', {
      entries: [{ domain: 'theme.invalid', availability: 'unknown', mutationTypes: [], savedAt: '2026-08-23T00:00:00.000Z' }],
    }),
  });
  await openDashboardSecondaryWorkspaces(page);

  for (const theme of ['Dark', 'Light'] as const) {
    await chooseTheme(page, theme);
    const expectedBorder = await page.evaluate((token) => {
      const probe = document.createElement('span');
      probe.style.border = `1px solid var(${token})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return value;
    }, theme === 'Dark' ? '--border' : '--control-border');
    const controls = [
      page.locator('#browser-target'),
      page.locator('#handoff-destination'),
      page.getByRole('button', { name: 'Prepare exact preview' }),
      page.getByRole('button', { name: /^Colour theme,/u }),
      page.getByRole('button', { name: 'Sign out' }),
    ];
    for (const control of controls) await expect(control).toHaveCSS('border-top-color', expectedBorder);
  }
});

test('text fields retain a visible focus outline in forced-colours mode', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/lookup');
  const query = page.locator('#query');
  await query.focus();
  const outline = await query.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
});

test('system preference follows operating-system colour-scheme changes', async ({ page }) => {
  await clearThemePreference(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await chooseTheme(page, 'System');

  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the theme trigger controls only a rendered option list', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');

  const trigger = page.getByRole('button', { name: /^Colour theme,/ });
  await expect(trigger).not.toHaveAttribute('aria-controls');
  await expect(page.locator('#colour-theme-options')).toHaveCount(0);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-controls', 'colour-theme-options');
  await expect(page.locator('#colour-theme-options')).toBeVisible();

  await page.getByRole('option', { name: 'System theme' }).click();
  await expect(trigger).not.toHaveAttribute('aria-controls');
  await expect(page.locator('#colour-theme-options')).toHaveCount(0);
});

test('the public theme menu uses the surrounding canvas surface', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/resources');
  await chooseTheme(page, 'Light');

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const trigger = page.getByRole('button', { name: 'Colour theme, Light selected' });
    await trigger.click();
    const options = page.getByRole('listbox', { name: 'Colour theme options' });
    await expect(options).toBeVisible();

    const colours = await page.evaluate(() => ({
      canvas: getComputedStyle(document.body).backgroundColor,
      trigger: getComputedStyle(document.querySelector('.theme-trigger')!).backgroundColor,
      options: getComputedStyle(document.querySelector('.theme-options')!).backgroundColor,
    }));
    expect(colours.trigger).toBe(colours.canvas);
    expect(colours.options).toBe(colours.canvas);

    await trigger.click();
    await expect(options).toHaveCount(0);
  }
});

test('a theme still applies to the current tab when persistent storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', { configurable: true, value: () => { throw new Error('blocked'); } });
    Object.defineProperty(Storage.prototype, 'setItem', { configurable: true, value: () => { throw new Error('blocked'); } });
  });
  await page.goto('/');

  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('status')).toContainText('Theme applies to this tab only');
});

test('the authenticated console reuses the same persisted selector', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/dashboard');

  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Colour theme, Light selected' }).locator('[data-theme-symbol="light"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('theme controls fit beside authenticated public navigation across common phone widths', async ({ page }) => {
  await clearThemePreference(page);
  for (const width of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const mobileNavigation = page.locator('.public-navigation-mobile');
    const publicBrand = page.locator('.public-brand');
    const menu = mobileNavigation.locator('.site-menu');
    const menuTrigger = menu.locator(':scope > summary');
    const theme = mobileNavigation.locator('.theme-selector');
    const themeTrigger = mobileNavigation.getByRole('button', { name: /^Colour theme,/ });
    const consoleLink = mobileNavigation.getByRole('link', { name: 'Open console' });
    await expect(mobileNavigation).toBeVisible();
    await expect(menuTrigger).toBeVisible();
    await expect(consoleLink).toBeVisible();
    await expect(themeTrigger).toBeVisible();

    const [brandBox, navigationBox, menuTriggerBox, themeBox, themeTriggerBox, consoleBox] = await Promise.all([
      publicBrand.boundingBox(),
      mobileNavigation.boundingBox(),
      menuTrigger.boundingBox(),
      theme.boundingBox(),
      themeTrigger.boundingBox(),
      consoleLink.boundingBox(),
    ]);

    expect(brandBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    expect(menuTriggerBox).not.toBeNull();
    expect(themeBox).not.toBeNull();
    expect(themeTriggerBox).not.toBeNull();
    expect(consoleBox).not.toBeNull();
    const brandRight = brandBox!.x + brandBox!.width;
    const brandBottom = brandBox!.y + brandBox!.height;
    const navigationRight = navigationBox!.x + navigationBox!.width;
    const navigationBottom = navigationBox!.y + navigationBox!.height;
    const overlapsBrand = Math.min(brandRight, navigationRight) - Math.max(brandBox!.x, navigationBox!.x) > 0
      && Math.min(brandBottom, navigationBottom) - Math.max(brandBox!.y, navigationBox!.y) > 0;
    expect(overlapsBrand).toBe(false);
    if (navigationBox!.y >= brandBottom) {
      expect(navigationBox!.y - brandBottom).toBeGreaterThanOrEqual(2);
    } else {
      expect(navigationBox!.x - brandRight).toBeGreaterThanOrEqual(2);
    }
    expect(navigationRight).toBeLessThanOrEqual(width);
    expect(menuTriggerBox!.x).toBeGreaterThanOrEqual(navigationBox!.x);
    expect(consoleBox!.x).toBeGreaterThan(menuTriggerBox!.x + menuTriggerBox!.width);
    expect(themeBox!.x).toBeGreaterThan(consoleBox!.x + consoleBox!.width);
    expect(themeTriggerBox!.x).toBeGreaterThanOrEqual(themeBox!.x);
    const themeSymbolSize = await themeTrigger.locator('.theme-symbol').evaluate(
      (element) => parseFloat(getComputedStyle(element).width),
    );
    expect(themeSymbolSize).toBeLessThanOrEqual(16);

    await menuTrigger.click();
    const publicNavigation = menu.getByRole('navigation', { name: 'Public navigation' });
    await expect(publicNavigation.getByRole('link', { name: 'Demo', exact: true })).toBeVisible();
    await expect(publicNavigation.getByRole('link', { name: 'Resources', exact: true })).toBeVisible();
    await expect(publicNavigation.getByRole('link', { name: 'CLI', exact: true })).toBeVisible();
    await expect(publicNavigation.getByRole('button', { name: 'Sign out' })).toBeVisible();
    const menuBox = await publicNavigation.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width);
    await menuTrigger.click();
    await expect(publicNavigation).toBeHidden();
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: /^Colour theme,/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the mobile option list is anchored directly beneath its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await clearThemePreference(page);
  await page.goto('/');

  const trigger = page.getByRole('button', { name: /^Colour theme,/ });
  await expect(trigger.locator('.theme-trigger-label')).toHaveText('Theme');
  await expect(trigger.locator('.theme-trigger-label')).toBeVisible();
  await trigger.click();
  const options = page.getByRole('listbox', { name: 'Colour theme options' });
  const triggerBox = await trigger.boundingBox();
  const optionsBox = await options.boundingBox();

  expect(triggerBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();
  expect(Math.abs(optionsBox!.x - triggerBox!.x)).toBeLessThan(1);
  expect(Math.abs(optionsBox!.width - triggerBox!.width)).toBeLessThan(1);
  expect(optionsBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height + 5);
  expect(await options.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expectNoHorizontalOverflow(page);
});
