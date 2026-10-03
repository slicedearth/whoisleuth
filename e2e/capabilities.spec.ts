import { expect, test } from './fixtures';
import { normalizeCapabilities } from '../frontend/src/lib/capabilities';
import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';

const lookupPlanFeatures = CAPABILITY_MANIFEST.capabilities.flatMap(item => item.legacyCapability ? [{
  id: item.id, status: 'supported', execution: item.legacyCapability.execution,
  scanModes: item.legacyCapability.scanModes,
}] : []);

test('preflight follows the target while ineligible optional drafts stay off the request plan', async ({ page }, testInfo) => {
  const lookups: string[] = [];
  await page.route('**/api/capabilities', route => route.fulfill({ json: {
    version: 1, runtime: 'express', authoritative: true, features: lookupPlanFeatures,
  } }));
  await page.route('**/api/lookup?*', route => { lookups.push(route.request().url()); return route.abort(); });
  await page.goto('/lookup');
  await page.locator('#query').fill('portal.example.test');
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.locator('.optional-sources > summary').click();
  const archived = page.getByRole('checkbox', { name: /Search archived URLscan verdicts/u });
  await expect(archived).toBeEnabled(); await archived.check();
  await page.locator('.collection-preflight > summary').click();
  const sources = page.getByRole('list', { name: 'Planned source families', exact: true });
  await expect(sources.locator('[data-source="external_intelligence"]')).toHaveAttribute('data-state', 'included');
  for (const [target, expected] of [
    ['192.0.2.8', ['rdap', 'whois', 'reverse_dns']],
    ['2001:db8::8', ['rdap', 'whois', 'reverse_dns']],
    ['AS64496', ['rdap', 'whois']],
  ] as const) {
    await page.locator('#query').fill(target);
    await expect.poll(() => sources.locator('[data-source]').evaluateAll(rows => rows.map(row => row.getAttribute('data-source')))).toEqual([...expected]);
    await expect(archived).toBeChecked(); await expect(archived).toBeDisabled();
    await page.getByRole('radio', { name: /Fast/u }).check();
    await expect(sources.getByRole('listitem')).toHaveCount(1);
    await expect(sources.locator('[data-source="rdap"]')).toBeVisible();
    await page.getByRole('radio', { name: /Deep/u }).check();
  }
  await page.locator('#query').fill('portal.example.test');
  await expect(archived).toBeEnabled(); await expect(archived).toBeChecked();
  await expect(sources.locator('[data-source="external_intelligence"]')).toHaveAttribute('data-state', 'included');
  for (const width of [320, 390, 1280, 1920]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme); await expectNoHorizontalOverflow(page);
      await expect(sources.locator('[data-source="malware_ioc_intelligence"]')).toBeVisible();
      if (captureVisualEvidenceEnabled()) {
        await sources.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 140, behavior: 'instant' }));
        await page.screenshot({ path: testInfo.outputPath(`collection-plan-${width}-${theme}.png`) });
      }
    }
  }
  expect(lookups).toEqual([]);
});

test('preflight distinguishes missing configuration from disabled dependent sources without probing them', async ({ page }) => {
  const features = lookupPlanFeatures.map(item => ['availability', 'rdap', 'urlhaus_host'].includes(item.id)
    ? { ...item, status: 'disabled' } : item.id === 'urlscan_search' ? { ...item, status: 'unavailable' } : item);
  await page.route('**/api/capabilities', route => route.fulfill({ json: {
    version: 1, runtime: 'express', authoritative: true, features,
  } }));
  const lookups: string[] = [];
  await page.route('**/api/lookup?*', route => { lookups.push(route.request().url()); return route.abort(); });
  await page.goto('/lookup');
  await page.locator('#query').fill('portal.example.test');
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.locator('.collection-preflight > summary').click();
  const sources = page.getByRole('list', { name: 'Planned source families', exact: true });
  for (const id of ['rdap', 'dns_intelligence', 'website_probe', 'tls_intelligence', 'registrar_rdap', 'network_context', 'malware_host_intelligence']) {
    await expect(sources.locator(`[data-source="${id}"]`)).toHaveAttribute('data-state', 'disabled');
  }
  await expect(sources.locator('[data-source="external_intelligence"]')).toHaveAttribute('data-state', 'unavailable');
  await expect(sources.locator('[data-source="malware_ioc_intelligence"]')).toHaveAttribute('data-state', 'optional');
  expect(lookups).toEqual([]);
});

test('an incomplete capability report and an unsupported target cannot imply an included source', async ({ page }) => {
  await page.route('**/api/capabilities', route => route.fulfill({ json: {
    version: 1, runtime: 'express', authoritative: true, features: [],
  } }));
  await page.goto('/lookup');
  await page.locator('#query').fill('AS64496');
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.locator('.collection-preflight > summary').click();
  const sources = page.getByRole('list', { name: 'Planned source families', exact: true });
  await expect(sources.getByRole('listitem')).toHaveCount(2);
  await expect(sources.locator('[data-state="unavailable"]')).toHaveCount(2);
  await page.locator('#query').fill('AS4294967296');
  await expect(sources).toHaveCount(0);
});

test('capability normalization bounds concurrency controls and accepts older version-1 reports', () => {
  const legacy = normalizeCapabilities({
    version: 1,
    runtime: 'express',
    authoritative: true,
    features: [{ id: 'lookup', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] }],
  });
  expect(legacy?.controls).toBeNull();

  const bounded = normalizeCapabilities({
    version: 1,
    runtime: 'netlify',
    authoritative: true,
    features: [],
    controls: {
      concurrency: {
        mode: 'in_memory',
        scope: 'serverless_instance',
        distributed: false,
        classes: [
          { id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 },
          { id: 'registry_light', sessionLimit: 1, runtimeLimit: 2 },
          { id: 'oversized', sessionLimit: 1, runtimeLimit: 1001 },
          { id: 'reversed', sessionLimit: 4, runtimeLimit: 2 },
        ],
      },
    },
  });
  expect(bounded?.controls?.concurrency.classes).toEqual([
    { id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 },
  ]);
  expect(bounded?.controls?.concurrency.usage).toBeNull();

  const distributed = normalizeCapabilities({
    version: 1,
    runtime: 'netlify',
    authoritative: true,
    features: [{ id: 'distributed_budgets', status: 'supported', execution: 'hosted', scanModes: [] }],
    controls: {
      concurrency: {
        mode: 'redis_rest',
        scope: 'deployment',
        distributed: true,
        classes: [{ id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 }],
      },
    },
  });
  expect(distributed?.controls?.concurrency).toEqual({
    mode: 'redis_rest',
    scope: 'deployment',
    distributed: true,
    classes: [{ id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 }],
    usage: null,
  });

  const accounted = normalizeCapabilities({
    version: 1,
    runtime: 'netlify',
    authoritative: true,
    features: [],
    controls: {
      concurrency: {
        mode: 'redis_rest',
        scope: 'deployment',
        distributed: true,
        classes: [{ id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 }],
        usage: {
          mode: 'distributed_fixed_windows',
          modelVersion: 1,
          windowModel: 'utc_epoch_fixed',
          dailyLimit: 1000,
          thirtyDayLimit: 10_000,
          features: [
            { id: 'bulk_deep', dailyLimit: 100, thirtyDayLimit: 1000 },
            { id: 'bulk_deep', dailyLimit: 1, thirtyDayLimit: 2 },
            { id: 'invalid feature', dailyLimit: 1, thirtyDayLimit: 2 },
            { id: 'too_large', dailyLimit: 1001, thirtyDayLimit: 10_001 },
          ],
        },
      },
    },
  });
  expect(accounted?.controls?.concurrency.usage).toEqual({
    mode: 'distributed_fixed_windows',
    modelVersion: 1,
    windowModel: 'utc_epoch_fixed',
    dailyLimit: 1000,
    thirtyDayLimit: 10_000,
    features: [{ id: 'bulk_deep', dailyLimit: 100, thirtyDayLimit: 1000 }],
  });

  expect(normalizeCapabilities({
    version: 1,
    runtime: 'netlify',
    authoritative: true,
    features: [],
    controls: {
      concurrency: {
        mode: 'in_memory',
        scope: 'deployment',
        distributed: true,
        classes: [{ id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 }],
      },
    },
  })?.controls).toBeNull();
});

test('malformed or unsupported capability reports degrade conservatively', async ({ page }) => {
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: 99, authoritative: true, features: [{ id: 'lookup', status: 'supported' }] }),
  }));
  await page.goto('/lookup');
  await expect(page.getByText('Backend unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lookup' })).toBeVisible();
});

test('the serverless runtime label fits the desktop session row without truncation', async ({ page }) => {
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: 1, runtime: 'netlify', authoritative: true, features: [] }),
  }));
  await page.goto('/lookup');

  const backendStatus = page.getByText('Backend · Netlify', { exact: true });
  await expect(backendStatus).toBeVisible();
  await expect(backendStatus).toHaveCSS('white-space', 'nowrap');
  await expect(backendStatus).toHaveCSS('text-overflow', 'clip');
  expect(await backendStatus.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    await backendStatus.evaluate((element) => element.clientWidth + 1),
  );
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCSS('white-space', 'nowrap');
  await expect(page.getByRole('link', { name: 'Privacy' })).toHaveCount(1);
});
