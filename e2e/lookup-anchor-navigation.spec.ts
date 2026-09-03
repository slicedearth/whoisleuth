import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { expectLookupTargetAligned, sectionedLookupFixture } from './lookup-design-fixtures';

// Lookup section and evidence-map anchor stability coverage.

test('Lookup section and mapped-evidence navigation settle at the requested anchor', async ({ page }) => {
  test.slow();
  const domain = 'lookup-scroll.invalid';
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(sectionedLookupFixture(domain)),
  }));
  await page.goto('/lookup');
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();

  await page.getByRole('button', { name: 'Expand Web and DNS evidence' }).click();
  await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
  const topology = page.getByRole('region', { name: 'Where this result came from' });
  const sourceRail = topology.getByRole('list', { name: 'Evidence item status' });
  const dnsSource = sourceRail.getByRole('link', { name: /DNS.*partial/iu });
  const resultNavigation = page.getByRole('navigation', { name: 'Result sections' });
  await expect(dnsSource).toBeVisible();

  const registryNode = topology.locator('.source-node[data-source-id="registry-rdap"]').locator('xpath=..');
  await registryNode.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 20, button: 0 });
  await registryNode.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 20, button: 0 });
  await expect(page).toHaveURL(/#evidence-registry$/u);
  await expectLookupTargetAligned(page, '#evidence-registry');
  await page.getByRole('button', { name: 'Collapse Registration evidence' }).click();
  await expectLookupTargetAligned(page, '#registry');

  await resultNavigation.getByRole('link', { name: 'Relationships & history' }).click();
  await dnsSource.click();
  await expect(page).toHaveURL(/#evidence-dns$/u);
  await expectLookupTargetAligned(page, '#evidence-dns');

  // A settled nested hash must not pull a later disclosure back to the old
  // evidence item when its deferred content becomes ready.
  for (const [label, selector] of [
    ['Registration', '#registry'],
    ['Source quality', '#source-quality'],
    ['Case and response', '#case-response'],
    ['Advanced', '#advanced-evidence'],
  ] as const) {
    await page.getByRole('button', { name: `Expand ${label} evidence` }).click();
    await expect(page.getByRole('button', { name: `Collapse ${label} evidence` })).toBeVisible();
    await expectLookupTargetAligned(page, selector);
    await page.getByRole('button', { name: `Collapse ${label} evidence` }).click();
    await expectLookupTargetAligned(page, selector);
    await page.getByRole('button', { name: `Expand ${label} evidence` }).click();
    await expectLookupTargetAligned(page, selector);
  }

  await page.getByRole('button', { name: 'Collapse Relationships and history evidence' }).click();
  await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
  await expect(topology).toBeVisible();
  await expectLookupTargetAligned(page, '#relationships-history');

  // Visual nodes, keyboard-operable rail links, delegated evidence links,
  // local navigation, and direct hashes share the same destination contract.
  await page.getByRole('button', { name: 'Collapse Registration evidence' }).click();
  await page.getByRole('button', { name: 'Collapse Web and DNS evidence' }).click();
  await resultNavigation.getByRole('link', { name: 'Relationships & history' }).click();
  await dnsSource.focus();
  await dnsSource.press('Enter');
  await expect(page).toHaveURL(/#evidence-dns$/u);
  await expectLookupTargetAligned(page, '#evidence-dns');

  await page.getByRole('button', { name: 'Collapse Source quality evidence' }).click();
  await resultNavigation.getByRole('link', { name: 'Source quality' }).click();
  await expect(page).toHaveURL(/#source-quality$/u);
  await expectLookupTargetAligned(page, '#source-quality');

  await page.evaluate(() => {
    window.history.replaceState(window.history.state, '', window.location.pathname);
    window.location.hash = '#evidence-registry';
  });
  await expect(page).toHaveURL(/#evidence-registry$/u);
  await expect(page.getByRole('button', { name: 'Collapse Registration evidence' })).toBeVisible();
  await expectLookupTargetAligned(page, '#evidence-registry');

  const delegatedQualityLink = page.getByRole('link', { name: /^Review limited or stale sources/u }).first();
  await expect(delegatedQualityLink).toBeVisible();
  await expect(delegatedQualityLink).toHaveAttribute('href', '#evidence-quality');
  await page.getByRole('button', { name: 'Collapse Source quality evidence' }).click();
  await delegatedQualityLink.click();
  await expect(page).toHaveURL(/#evidence-quality$/u);
  await expect(page.getByRole('button', { name: 'Collapse Source quality evidence' })).toBeVisible();
  await expectLookupTargetAligned(page, '#evidence-quality');

  for (const eventName of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) {
    const cancellation = await page.evaluate((name) => {
      const button = document.querySelector<HTMLButtonElement>('.family-web button.family-summary');
      const root = document.getElementById('result');
      if (!button || !root) throw new Error('The Lookup cancellation fixture is incomplete.');
      button.click();
      const activeBeforeInput = root.classList.contains('lookup-scroll-aligning');
      const inputEvent = name === 'wheel'
        ? new WheelEvent(name, { bubbles: true, deltaY: 120 })
        : name === 'pointerdown'
          ? new PointerEvent(name, { bubbles: true, pointerType: 'mouse' })
          : name === 'keydown'
            ? new KeyboardEvent(name, { bubbles: true, key: 'ArrowDown' })
            : new Event(name, { bubbles: true });
      window.dispatchEvent(inputEvent);
      return {
        activeBeforeInput,
        activeAfterInput: root.classList.contains('lookup-scroll-aligning'),
      };
    }, eventName);
    expect(cancellation).toEqual({ activeBeforeInput: true, activeAfterInput: false });
  }
});

test('Lookup keeps a deferred mapped-evidence hash aligned through post-release layout changes @timing-sensitive', async ({ page }) => {
  test.slow();
  const builtManifest = JSON.parse(await readFile(
    join(process.cwd(), 'frontend', '.svelte-kit', 'output', 'client', '.vite', 'manifest.json'),
    'utf8',
  )) as Record<string, { file: string }>;
  const dnsChunkPath = builtManifest['src/lib/components/LookupDnsEvidence.svelte']?.file;
  if (!dnsChunkPath) throw new TypeError('The production manifest does not own the Lookup DNS evidence chunk.');

  let releaseChunk = () => {};
  let markChunkRequested = () => {};
  const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve; });
  const chunkRequested = new Promise<void>((resolve) => { markChunkRequested = resolve; });
  let chunkHeld = false;
  await page.route('**/*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/${dnsChunkPath}`) {
      if (!chunkHeld) {
        chunkHeld = true;
        markChunkRequested();
      }
      await chunkGate;
    }
    await route.fallback();
  });
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(sectionedLookupFixture('deferred-anchor.invalid')),
  }));

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/lookup');
  await page.locator('#query').fill('deferred-anchor.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
  const topology = page.getByRole('region', { name: 'Where this result came from' });
  const dnsSource = topology.getByRole('list', { name: 'Evidence item status' })
    .getByRole('link', { name: /DNS.*partial/iu });
  await expect(dnsSource).toBeVisible();
  await dnsSource.click();
  await chunkRequested;

  await expect(page).toHaveURL(/#evidence-dns$/u);
  await expect(page.locator('#result')).toHaveClass(/lookup-scroll-aligning/u);
  await page.evaluate(() => {
    const runtime = window as typeof window & { __lookupReleaseShiftDone?: boolean };
    const root = document.getElementById('result');
    const web = document.getElementById('web-evidence');
    if (!root || !web) throw new Error('The Lookup alignment fixture could not find its result geometry.');
    document.documentElement.style.overflowAnchor = 'none';
    const spacer = document.createElement('div');
    spacer.dataset.lookupReleaseShift = 'true';
    spacer.style.height = '0px';
    spacer.style.pointerEvents = 'none';
    web.before(spacer);
    runtime.__lookupReleaseShiftDone = false;
    const observer = new MutationObserver(() => {
      if (root.classList.contains('lookup-scroll-aligning')) return;
      observer.disconnect();
      void (async () => {
        for (const height of [96, 24, 144, 48, 113]) {
          spacer.style.height = `${height}px`;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        runtime.__lookupReleaseShiftDone = true;
      })();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  });

  releaseChunk();
  await expect(page.locator('#evidence-dns')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __lookupReleaseShiftDone?: boolean }).__lookupReleaseShiftDone
  ))).toBe(true);
  await expect(page).toHaveURL(/#evidence-dns$/u);
  await expectLookupTargetAligned(page, '#evidence-dns');
  await expect(page.locator('#result')).not.toHaveClass(/lookup-scroll-aligning/u);
});
