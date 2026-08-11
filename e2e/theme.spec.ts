import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#e1e8ef');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(240, 243, 245)');
  await expect(page.locator('.hero-preview .preview-note')).toHaveCSS('color', 'rgb(41, 67, 89)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(225, 232, 239)');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('border-color', 'rgb(92, 118, 142)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f1115');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(23, 26, 33)');
  await expect(page.locator('.hero-preview .preview-note')).toHaveCSS('color', 'rgb(139, 147, 167)');

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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#e1e8ef');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(240, 243, 245)');
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

test('light surfaces avoid pure white and keep semantic foregrounds and boundaries distinct', async ({ page }) => {
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
    const tokens = Object.fromEntries(
      ['--text', '--muted', '--accent', '--accent2', '--border'].map((token) => [token, resolveColour(token)]),
    );
    sample.remove();
    return {
      panel,
      surface: resolveColour('--surface'),
      contrast: Object.fromEntries(Object.entries(tokens).map(([token, colour]) => [token, contrast(colour, panel)])),
    };
  });

  expect(palette.panel).not.toBe('rgb(255, 255, 255)');
  expect(palette.surface).not.toBe('rgb(255, 255, 255)');
  expect(palette.contrast['--text']).toBeGreaterThanOrEqual(7);
  expect(palette.contrast['--muted']).toBeGreaterThanOrEqual(4.5);
  expect(palette.contrast['--accent']).toBeGreaterThanOrEqual(4.5);
  expect(palette.contrast['--accent2']).toBeGreaterThanOrEqual(4.5);
  expect(palette.contrast['--border']).toBeGreaterThanOrEqual(3);
});

test('secondary controls and form hints keep accessible contrast in both themes', async ({ page }) => {
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
        hintText: ratio(colour('--muted'), colour('--panel')),
      };
      sample.remove();
      return value;
    });
    expect(contrast.controlBoundary).toBeGreaterThanOrEqual(3);
    expect(contrast.hintText).toBeGreaterThanOrEqual(4.5);
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
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    const publicNavigation = page.getByRole('navigation', { name: 'Public navigation' });
    const publicBrand = page.locator('.public-brand');
    const demoLink = publicNavigation.locator('a[href="/demo"]');
    const resourcesLink = publicNavigation.getByRole('link', { name: 'Resources', exact: true });
    const theme = publicNavigation.locator('.theme-selector');
    const trigger = publicNavigation.getByRole('button', { name: /^Colour theme,/ });
    const consoleLink = publicNavigation.getByRole('link', { name: 'Open console' });
    const signOut = publicNavigation.getByRole('button', { name: 'Sign out' });
    const [brandBox, navigationBox, demoBox, resourcesBox, themeBox, triggerBox, consoleBox, signOutBox] = await Promise.all([
      publicBrand.boundingBox(),
      publicNavigation.boundingBox(),
      demoLink.boundingBox(),
      resourcesLink.boundingBox(),
      theme.boundingBox(),
      trigger.boundingBox(),
      consoleLink.boundingBox(),
      signOut.boundingBox(),
    ]);

    expect(brandBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    expect(demoBox).toBeNull();
    expect(resourcesBox).not.toBeNull();
    expect(themeBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    expect(consoleBox).not.toBeNull();
    expect(signOutBox).not.toBeNull();
    expect(navigationBox!.x - (brandBox!.x + brandBox!.width)).toBeGreaterThanOrEqual(2);
    if (demoBox) expect(demoBox.x - (brandBox!.x + brandBox!.width)).toBeGreaterThanOrEqual(2);
    expect(consoleBox!.x - (resourcesBox!.x + resourcesBox!.width)).toBeGreaterThanOrEqual(5);
    expect(themeBox!.x - (consoleBox!.x + consoleBox!.width)).toBeGreaterThanOrEqual(5);
    expect(triggerBox!.x).toBeGreaterThanOrEqual(themeBox!.x);
    expect(signOutBox!.x - (themeBox!.x + themeBox!.width)).toBeGreaterThanOrEqual(5);
    expect(signOutBox!.x + signOutBox!.width).toBeLessThanOrEqual(width);
    const [themeFontSize, consoleFontSize, signOutFontSize] = await Promise.all([
      trigger.evaluate((element) => getComputedStyle(element).fontSize),
      consoleLink.evaluate((element) => getComputedStyle(element).fontSize),
      signOut.evaluate((element) => getComputedStyle(element).fontSize),
    ]);
    const themeSymbolSize = await trigger.locator('.theme-symbol').evaluate(
      (element) => parseFloat(getComputedStyle(element).width),
    );
    expect(themeFontSize).toBe(consoleFontSize);
    expect(themeFontSize).toBe(signOutFontSize);
    expect(themeSymbolSize).toBeLessThanOrEqual(16);
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
