import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expectNoHorizontalOverflow, useTheme } from './helpers';

const MARKER = 'private-review-marker';
const LINK = `https://destination.example/private?token=${MARKER}#local`;
type PublicState = { databaseCalls: number; copies: string[]; failCopy: boolean; releaseCopy?: () => void; holdCopy: boolean; execution: boolean };

async function openInspector(page: Page, authenticated: boolean) {
  await page.addInitScript(() => {
    const state: PublicState = { databaseCalls: 0, copies: [], failCopy: false, holdCopy: false, execution: false };
    Object.assign(window, { publicLinkState: state });
    for (const name of ['open', 'deleteDatabase', 'databases'] as const) {
      const original = IDBFactory.prototype[name];
      if (typeof original === 'function') Object.defineProperty(IDBFactory.prototype, name, { configurable: true, value: (..._args: unknown[]) => {
        state.databaseCalls += 1;
        throw new Error('Public processing must not access a saved database.');
      } });
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => {
      state.copies.push(value);
      if (state.failCopy) throw new Error('Private clipboard implementation detail');
      if (state.holdCopy) await new Promise<void>(resolve => { state.releaseCopy = resolve; });
    } } });
  });
  await page.route('**/api/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated }) }));
  const session = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session');
  await page.goto('/link-inspector');
  await session;
  const inspector = page.getByRole('region', { name: 'Offline Link Inspector', exact: true });
  await expect(inspector).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.public-navigation-desktop .console-link')).toHaveAttribute('href', authenticated ? '/dashboard' : '/login');
  return inspector;
}

async function storageSnapshot(page: Page) {
  return page.evaluate(() => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
}

for (const authenticated of [false, true]) {
  test(`public link processing is inert and request/storage-free after ${authenticated ? 'authenticated' : 'anonymous'} page entry`, async ({ page }) => {
    const requests: { url: string; body: string | null; type: string }[] = [];
    const messages: string[] = [];
    const downloads: string[] = [];
    page.on('request', request => requests.push({ url: request.url(), body: request.postData(), type: request.resourceType() }));
    page.on('console', message => messages.push(message.text()));
    page.on('pageerror', error => messages.push(error.message));
    page.on('download', download => downloads.push(download.suggestedFilename()));
    const inspector = await openInspector(page, authenticated);
    const initialRequests = requests.length;
    const before = await storageSnapshot(page);
    await page.getByLabel('Link to inspect', { exact: true }).fill(LINK);
    await page.getByLabel('Displayed link text (optional)', { exact: true }).fill('different.example');
    await inspector.getByRole('button', { name: 'Review links', exact: true }).click();
    const results = inspector.getByRole('region', { name: 'Parsed links', exact: true });
    await expect(results).toContainText('destination.example');
    await expect(results).toContainText('Different hostname');
    await expect(results.getByRole('link')).toHaveCount(0);
    await expect(results.locator('iframe,img,script')).toHaveCount(0);
    await expect(results.locator('pre')).not.toBeVisible();
    await results.getByRole('button', { name: 'Copy hostname for link 1', exact: true }).click();
    await expect(inspector.getByRole('status').filter({ hasText: 'Copied the selected value.' })).toBeVisible();
    const reveal = results.locator('details').filter({ has: page.getByText('Reveal parsed URL for link 1', { exact: true }) });
    await reveal.locator('summary').focus(); await page.keyboard.press('Enter');
    await expect(reveal.locator('pre')).toHaveText(LINK);
    await reveal.getByRole('button', { name: 'Copy parsed URL for link 1', exact: true }).click();
    expect(await page.evaluate(() => (window as typeof window & { publicLinkState: PublicState }).publicLinkState.copies)).toEqual(['destination.example', LINK]);
    expect(await storageSnapshot(page)).toEqual(before);
    expect(await page.evaluate(() => (window as typeof window & { publicLinkState: PublicState }).publicLinkState.databaseCalls)).toBe(0);
    await page.evaluate(value => {
      const input = document.getElementById('public-link-input') as HTMLTextAreaElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form!.requestSubmit();
    }, `https://replacement.example/private?token=${MARKER}-replacement`);
    await expect(results).toContainText('replacement.example');
    await expect(results.locator('pre')).toHaveCount(1);
    await expect(results.locator('pre')).not.toBeVisible();
    await page.emulateMedia({ media: 'print' });
    const printed = page.getByRole('region', { name: 'Offline Link Inspector', exact: true, includeHidden: true });
    await expect(printed).toHaveCount(1); await expect(printed).not.toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await inspector.getByRole('button', { name: 'Clear input and results', exact: true }).click();
    await expect(page.getByLabel('Link to inspect', { exact: true })).toHaveValue('');
    await expect(results).toHaveCount(0);
    await expect(page).toHaveURL('/link-inspector');
    expect(await storageSnapshot(page)).toEqual(before);
    const after = requests.slice(initialRequests);
    for (const request of after) {
      expect(request.body).toBeNull();
      const url = new URL(request.url);
      expect(url.origin).toBe(new URL(page.url()).origin);
      if (url.pathname === '/favicon.svg') {
        expect(url.search).toBe('');
        expect(['image', 'other']).toContain(request.type);
      } else {
        expect(url.pathname).toMatch(/^\/_app\//u);
        expect(['script', 'stylesheet', 'font', 'image']).toContain(request.type);
      }
    }
    expect(requests.some(request => request.url.includes(MARKER) || request.url.includes('destination.example') || request.body?.includes(MARKER))).toBe(false);
    expect(messages.join('\n')).not.toContain(MARKER);
    expect(downloads).toEqual([]);
  });
}

test('pasted markup and unsupported links stay inert; edits and navigation clear revealed results', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  const inspector = await openInspector(page, false);
  await inspector.getByRole('button', { name: 'Use a fictional example', exact: true }).click();
  await expect(page.getByLabel('Link to inspect', { exact: true })).toHaveValue(/^hxxps:\/\/signin\.example\//u);
  await expect(inspector.getByRole('region', { name: 'Parsed links', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Pasted text', exact: true }).check();
  const input = page.getByLabel('Text containing links', { exact: true });
  await input.fill(`<script>window.publicLinkState.execution=true</script><img src="https://image.example/${MARKER}"> hxxps://EXAMPLE[.]COM/report!`);
  await inspector.getByRole('button', { name: 'Review links', exact: true }).click();
  const results = inspector.getByRole('region', { name: 'Parsed links', exact: true });
  await expect(results).toContainText('example.com');
  await expect(results.locator('img,script,a,iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { publicLinkState: PublicState }).publicLinkState.execution)).toBe(false);
  expect(requests.some(url => url.includes('image.example') || url.includes(MARKER))).toBe(false);
  await input.fill('https://replacement.example/');
  await expect(results).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Review links', exact: true }).click();
  await expect(results).toContainText('replacement.example');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(input).toHaveValue('');
  await expect(results).toHaveCount(0);
  await input.fill('https://replacement.example/');
  await inspector.getByRole('button', { name: 'Review links', exact: true }).click();
  await page.goto('/resources');
  await expect(page.getByRole('button', { name: 'Print this guide', exact: true })).toBeEnabled();
  await page.goBack();
  await expect(inspector).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('textbox', { name: /^(?:Link to inspect|Text containing links)$/u })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Parsed links', exact: true })).toHaveCount(0);
  expect(requests.some(url => url.includes(MARKER))).toBe(false);
});

test('clipboard failures are sanitised and late completions cannot restore a cleared review', async ({ page }) => {
  const inspector = await openInspector(page, false);
  await page.getByLabel('Link to inspect', { exact: true }).fill(LINK);
  await inspector.getByRole('button', { name: 'Review links', exact: true }).click();
  await page.evaluate(() => { (window as typeof window & { publicLinkState: PublicState }).publicLinkState.failCopy = true; });
  await inspector.getByRole('button', { name: 'Copy hostname for link 1', exact: true }).click();
  await expect(inspector.getByRole('status').filter({ hasText: 'Copy was unavailable.' })).toBeVisible();
  await expect(inspector).not.toContainText('Private clipboard implementation detail');
  await page.evaluate(() => { const state = (window as typeof window & { publicLinkState: PublicState }).publicLinkState; state.failCopy = false; state.holdCopy = true; });
  await inspector.getByRole('button', { name: 'Copy hostname for link 1', exact: true }).click();
  await page.evaluate(() => { const state = (window as typeof window & { publicLinkState: PublicState }).publicLinkState; state.failCopy = true; state.holdCopy = false; });
  await inspector.getByText('Reveal parsed URL for link 1', { exact: true }).click();
  await inspector.getByRole('button', { name: 'Copy parsed URL for link 1', exact: true }).click();
  await expect(inspector.getByRole('status').filter({ hasText: 'Copy was unavailable.' })).toBeVisible();
  await page.evaluate(async () => { (window as typeof window & { publicLinkState: PublicState }).publicLinkState.releaseCopy?.(); await Promise.resolve(); });
  await expect(inspector.getByRole('status').filter({ hasText: 'Copy was unavailable.' })).toBeVisible();
  await expect(inspector.getByRole('status').filter({ hasText: 'Copied the selected value.' })).toHaveCount(0);
  await page.evaluate(() => { const state = (window as typeof window & { publicLinkState: PublicState }).publicLinkState; state.failCopy = false; state.holdCopy = true; });
  await inspector.getByRole('button', { name: 'Copy hostname for link 1', exact: true }).click();
  await inspector.getByRole('button', { name: 'Clear input and results', exact: true }).click();
  await page.evaluate(() => (window as typeof window & { publicLinkState: PublicState }).publicLinkState.releaseCopy?.());
  await expect(inspector.getByRole('region', { name: 'Parsed links', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('status')).toHaveCount(0);
});

test('local link review supports keyboard operation, both themes and narrow reading without active destinations', async ({ page }, testInfo) => {
  const inspector = await openInspector(page, false);
  await page.getByLabel('Link to inspect', { exact: true }).fill('https://long-name.example/' + 'a'.repeat(250));
  const submit = inspector.getByRole('button', { name: 'Review links', exact: true });
  await submit.focus(); await page.keyboard.press('Enter');
  await expect(inspector.getByRole('region', { name: 'Parsed links', exact: true })).toContainText('long-name.example');
  await inspector.getByText('Reveal parsed URL for link 1', { exact: true }).focus(); await page.keyboard.press('Enter');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 2560]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
      await expect(inspector.getByRole('button', { name: 'Copy parsed URL for link 1', exact: true })).toBeEnabled();
      const a11y = await new AxeBuilder({ page }).include('.inspector').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(a11y.violations).toEqual([]);
      if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`public-links-${theme}-${width}.png`), fullPage: true });
    }
  }
});

test('prerendered link controls cannot submit supplied input before client initialisation', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/link-inspector');
    await expect(page.getByRole('button', { name: 'Review links', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Link to inspect', { exact: true })).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Parsed links', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
