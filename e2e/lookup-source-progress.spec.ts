import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';
import { createLookupProgressStart, createLookupProgressSource, createLookupProgressFinal, encodeLookupProgressEvent } from '../lib/lookup-progress.mts';

const SOURCES = ['rdap', 'whois', 'domain_evidence', 'registrar_rdap', 'network_context'] as const;
const RESULT = { query: 'example.test', type: 'domain', registrableDomain: 'example.test',
  rdap: { error: 'Fixture source unavailable' }, whois: { parsed: {}, chain: [] },
  availability: { applicable: true, state: 'registered', confidence: 'medium', domain: 'example.test', deepScanComplete: true },
  diagnostics: { version: 8, rdap: { status: 'error' }, whois: { status: 'partial' }, availability: { status: 'complete' } } };
const FRAMES = [createLookupProgressStart('deep', SOURCES),
  ...SOURCES.map((source, index) => createLookupProgressSource(index + 1, source, index === 0 ? 'partial' : 'unsupported', { status: index === 0 ? 'partial' : 'unsupported' })),
  createLookupProgressFinal(SOURCES.length + 1, SOURCES, RESULT),
].map(encodeLookupProgressEvent);

declare global {
  interface Window {
    lookupProgressFixture: { finish: (index?: number, incomplete?: boolean) => void; requests: { accept: string | null; cancelled: boolean }[] };
  }
}

async function prepare(page: Page, buffered = false) {
  await page.addInitScript(({ frames, result, buffered }) => {
    const original = window.fetch.bind(window);
    const streams: { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean }[] = [];
    const requests: { accept: string | null; cancelled: boolean }[] = [];
    const encode = (value: string) => new TextEncoder().encode(value);
    window.lookupProgressFixture = { requests, finish(index = streams.length - 1, incomplete = false) {
      const stream = streams[index]; if (!stream || stream.closed) return;
      stream.controller.enqueue(encode(buffered ? result : frames.slice(2, incomplete ? -1 : undefined).join('')));
      stream.closed = true; stream.controller.close();
    } };
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin !== location.origin || url.pathname !== '/api/lookup') return original(input, init);
      const request = { accept: new Headers(init?.headers).get('accept'), cancelled: false };
      requests.push(request);
      let stream: (typeof streams)[number];
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        stream = { controller, closed: false }; streams.push(stream);
        if (!buffered) controller.enqueue(encode(frames.slice(0, 2).join('')));
      }, cancel() { stream.closed = true; request.cancelled = true; } });
      return new Response(body, { headers: { 'Content-Type': buffered ? 'application/json' : 'application/x-ndjson' } });
    };
  }, { frames: FRAMES, result: JSON.stringify(RESULT), buffered });
  await page.goto('/lookup');
  await page.locator('#query').fill('example.test');
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  return page.getByRole('region', { name: 'Lookup source progress', exact: true });
}

for (const width of [320, 390, 1024, 1280, 2560]) for (const theme of ['light', 'dark'] as const) {
  test(`source updates stay readable and provisional at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    const progress = await prepare(page);
    await useTheme(page, theme);
    await expect(progress.getByRole('status')).toHaveText('1 of 5 sources finished · Registry RDAP: Partial');
    await expect(progress.getByRole('listitem')).toHaveCount(5);
    await expect(progress.getByRole('listitem').filter({ hasText: 'WHOIS chain' })).toHaveText(/WHOIS chain\s+Waiting/u);
    await expect(page.locator('#result')).toHaveCount(0);
    expect((await readBrowserLocalCollection(page, 'cases')).records).toHaveLength(0);
    await expectNoHorizontalOverflow(page);
    const cancel = page.getByRole('button', { name: 'Cancel lookup', exact: true });
    await cancel.focus(); await expect(cancel).toBeFocused();
    await progress.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`lookup-progress-${width}-${theme}.png`) });
    await page.evaluate(() => window.lookupProgressFixture.finish());
    await expect(page.getByRole('heading', { name: 'registered', exact: true })).toBeVisible();
    await expect(progress).toHaveCount(0);
    expect((await readBrowserLocalCollection(page, 'cases')).records).toHaveLength(0);
    const requests = await page.evaluate(() => window.lookupProgressFixture.requests);
    expect(requests).toHaveLength(1); expect(requests[0]!.accept).toContain('application/x-ndjson');
  });
}

test('cancellation discards partial sources and the next request is independent', async ({ page }) => {
  const progress = await prepare(page);
  await expect(progress.getByRole('status')).toContainText('1 of 5');
  await page.getByRole('button', { name: 'Cancel lookup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Lookup cancelled. No partial response was retained.');
  await expect(progress).toHaveCount(0); await expect(page.locator('#result')).toHaveCount(0);
  await page.evaluate(() => window.lookupProgressFixture.finish(0));
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(progress.getByRole('status')).toContainText('1 of 5');
  await page.evaluate(() => window.lookupProgressFixture.finish(1));
  await expect(page.getByRole('heading', { name: 'registered', exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.lookupProgressFixture.requests))[0]!.cancelled).toBe(true);
  expect((await readBrowserLocalCollection(page, 'cases')).records).toHaveLength(0);
});

test('an incomplete stream cannot become a result or a saved observation', async ({ page }) => {
  const progress = await prepare(page);
  await expect(progress.getByRole('status')).toContainText('1 of 5');
  await page.evaluate(() => window.lookupProgressFixture.finish(0, true));
  await expect(page.getByRole('alert')).toHaveText('Lookup returned an invalid response.');
  await expect(progress).toHaveCount(0); await expect(page.locator('#result')).toHaveCount(0);
  expect((await readBrowserLocalCollection(page, 'cases')).records).toHaveLength(0);
});

test('buffered delivery is explicit and does not trigger a replacement request', async ({ page }) => {
  const progress = await prepare(page, true);
  await expect(progress.getByRole('status')).toHaveText('This connection returns sources together in the final response.');
  await expect(progress.getByRole('listitem')).toHaveCount(0);
  await page.evaluate(() => window.lookupProgressFixture.finish());
  await expect(page.getByRole('heading', { name: 'registered', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.lookupProgressFixture.requests.length)).toBe(1);
});
