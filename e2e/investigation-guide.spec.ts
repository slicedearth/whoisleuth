import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, migrateLegacyBrowserData } from './helpers';

const GUIDE_KEY = 'whoisleuth:investigation-guide:v2';
const LEGACY_GUIDE_KEY = 'whoisleuth:investigation-guide:v1';

async function startRecipe(
  page: import('@playwright/test').Page,
  recipe: 'Brand sweep' | 'Infrastructure pivot' | 'New-domain triage' = 'New-domain triage',
) {
  await page.goto('/dashboard');
  await page.getByRole('combobox', { name: 'Guide' }).selectOption({ label: recipe });
  await page.getByRole('textbox', { name: recipe === 'Brand sweep' ? 'Official domain' : recipe === 'Infrastructure pivot' ? 'Starting domain' : 'Domain' }).fill('Portal.Example.Test.');
  await page.getByRole('button', { name: 'Start guide' }).click();
}

test('the dashboard starts a selected tab-scoped recipe without navigation or analysis', async ({ page }) => {
  const analysisRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:lookup|rdap|whois|availability|ct-search)(?:\?|$)/.test(request.url())) analysisRequests.push(request.url());
  });

  await startRecipe(page, 'Brand sweep');

  await expect(page).toHaveURL('/dashboard');
  const guide = page.locator('.guide');
  await expect(guide).toContainText('Brand sweep: portal.example.test');
  await expect(guide.getByRole('listitem')).toHaveCount(5);
  await expect(guide).toContainText('Expected evidence');
  await expect(guide).toContainText('What this step requests');
  await expect(guide).toContainText('Before you start');
  await expect(guide).toContainText('When to mark it complete');
  await expect(guide).toContainText('No saved observation in this browser currently links to this domain.');
  await expect(guide).toBeFocused();
  expect(analysisRequests).toEqual([]);

  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored).toMatchObject({ version: 2, recipeId: 'brand_sweep', domain: 'portal.example.test', status: 'active' });
  expect(stored.stages).toHaveLength(5);
  expect(stored.stages.every((stage: Record<string, unknown>) => stage.outcome === 'pending' && stage.openedAt === null)).toBe(true);
});

test('the dashboard rejects non-domain recipe targets without changing storage', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('https://example.test/path');
  await page.getByRole('button', { name: 'Start guide' }).click();

  await expect(page.getByRole('alert')).toHaveText('Enter one valid domain without a URL, path, port, or spaces.');
  await expect(page).toHaveURL('/dashboard');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBeNull();
});

test('network stages require keyboard-operable approval before tool navigation', async ({ page }) => {
  await startRecipe(page);
  const lookupStage = page.locator('.guide li').filter({ hasText: 'Collect domain evidence' });
  await expect(lookupStage.getByRole('link', { name: 'Open Lookup' })).toHaveCount(0);
  await expect(lookupStage).toContainText('Opening the tool only takes you there.');

  await page.goto('/lookup');
  const manualLookupStage = page.locator('.guide li').filter({ hasText: 'Collect domain evidence' });
  await expect(manualLookupStage.getByRole('option', { name: 'Complete' })).toHaveAttribute('disabled', '');
  await expect(manualLookupStage.getByRole('option', { name: 'Partial' })).toHaveAttribute('disabled', '');
  let stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored.stages[0].openedAt).toBeNull();
  await page.goto('/dashboard');

  const reopenedLookupStage = page.locator('.guide li').filter({ hasText: 'Collect domain evidence' });
  const approve = reopenedLookupStage.getByRole('button', { name: 'Allow this step' });
  await approve.focus();
  await page.keyboard.press('Enter');
  await expect(reopenedLookupStage.getByRole('link', { name: 'Open Lookup' })).toBeVisible();
  await reopenedLookupStage.getByRole('link', { name: 'Open Lookup' }).click();

  await expect(page).toHaveURL('/lookup?q=portal.example.test');
  await expect(page.getByRole('textbox', { name: 'Domain, IP address, ASN, or domain list' })).toHaveValue('portal.example.test');
  stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored.stages[0].approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(stored.stages[0].openedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(stored.stages[0].outcome).toBe('pending');
});

test('partial progress, pause, and resume survive reload without implying completion', async ({ page }) => {
  await startRecipe(page, 'Infrastructure pivot');
  const lookupStage = page.locator('.guide li').filter({ hasText: 'Collect starting evidence' });
  await lookupStage.getByRole('button', { name: 'Allow this step' }).click();
  await lookupStage.getByRole('link', { name: 'Open Lookup' }).click();

  await page.getByRole('combobox', { name: 'Outcome for Collect starting evidence' }).selectOption('partial');
  await expect(page.locator('.guide')).toContainText('Partial');
  await page.getByRole('button', { name: 'Pause guide' }).click();
  await expect(page.locator('.guide')).toContainText('Paused');
  await expect(page.getByRole('combobox', { name: 'Outcome for Collect starting evidence' })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume guide' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume guide' }).click();
  await expect(page.getByRole('combobox', { name: 'Outcome for Collect starting evidence' })).toHaveValue('partial');
  await expect(page.locator('.guide li').filter({ hasText: 'Collect starting evidence' }).locator('.stage-state')).toHaveText('Current · Partial');
});

test('restart requires confirmation and clears only the recipe progress', async ({ page }) => {
  await startRecipe(page);
  const bulkStage = page.locator('.guide li').filter({ hasText: 'Compare focused peers' });
  await bulkStage.locator('summary').click();
  await page.getByRole('combobox', { name: 'Outcome for Compare focused peers' }).selectOption('skipped');
  await expect(bulkStage).toContainText('Skipped');

  await page.getByRole('button', { name: 'Restart guide' }).click();
  await expect(page.getByRole('button', { name: 'Confirm restart' })).toBeVisible();
  await expect(bulkStage).toContainText('Skipped');
  await page.getByRole('button', { name: 'Confirm restart' }).click();
  await bulkStage.locator('summary').click();
  await expect(page.getByRole('combobox', { name: 'Outcome for Compare focused peers' })).toHaveValue('pending');
  await expect(page.locator('.guide')).toContainText('portal.example.test');
});

test('exports only a compact versioned progress summary after explicit action', async ({ page }) => {
  await startRecipe(page);
  await page.getByRole('button', { name: 'Export summary' }).click();
  await expect(page.getByRole('button', { name: 'Confirm export' })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Confirm export' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  const payload = JSON.parse(Buffer.concat(body).toString('utf-8'));

  expect(download.suggestedFilename()).toMatch(/^whoisleuth-recipe-portal\.example\.test-.+\.json$/);
  expect(payload).toMatchObject({
    schema: 'whoisleuth.investigation-recipe-summary',
    version: 1,
    recipe: { id: 'new_domain_triage' },
    target: { type: 'domain', value: 'portal.example.test' },
  });
  expect(Object.keys(payload).sort()).toEqual(['createdAt', 'generatedAt', 'limitations', 'recipe', 'schema', 'stages', 'status', 'target', 'updatedAt', 'version']);
  expect(JSON.stringify(payload)).not.toContain('rawEvidence');
});

test('shows retained evidence through the typed local projection without treating it as completion', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 2, cases: [{
      id: 'case-recipe-1',
      domain: 'portal.example.test',
      status: 'new',
      disposition: 'unreviewed',
      tags: [],
      notes: [],
      source: 'lookup',
      evidenceHistory: [],
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    }] },
  });
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('portal.example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();

  await expect(page.locator('.evidence-checkpoint')).toContainText('1 retained observation');
  await expect(page.getByRole('combobox', { name: 'Outcome for Collect domain evidence' })).toHaveValue('pending');
});

test('legacy navigation migrates while future and oversized current records stay untouched', async ({ page }) => {
  await page.goto('/dashboard');
  const legacy = JSON.stringify({
    version: 1,
    domain: 'example.test',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:05:00.000Z',
    visitedStages: ['lookup'],
  });
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [LEGACY_GUIDE_KEY, legacy]);
  await page.reload();
  await expect(page.locator('.guide')).toContainText('New-domain triage: example.test');
  const migrated = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(migrated).toMatchObject({ version: 2, recipeId: 'new_domain_triage' });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), LEGACY_GUIDE_KEY)).toBe(legacy);

  const future = JSON.stringify({ version: 3, recipeId: 'new_domain_triage' });
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [GUIDE_KEY, future]);
  await page.reload();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBe(future);

  const oversized = 'x'.repeat(12_289);
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [GUIDE_KEY, oversized]);
  await page.reload();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBe(oversized);
});

test('the guide remains usable without horizontal overflow at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await startRecipe(page, 'Brand sweep');
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.guide')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Pause guide' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Outcome for Confirm brand profile' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Outcome for Confirm brand profile' }).selectOption('skipped');
  const nextStep = page.locator('[data-stage-id="discover"] summary');
  await expect(nextStep).toBeFocused();
  await expect(nextStep).toBeInViewport();
  await expect(nextStep.locator('xpath=..')).toHaveAttribute('open', '');
});

test('ending a recipe removes current and legacy tab records only', async ({ page }) => {
  await startRecipe(page);
  await page.evaluate((key) => sessionStorage.setItem(key, 'legacy-copy'), LEGACY_GUIDE_KEY);
  await page.locator('.guide').getByRole('button', { name: 'End guide' }).click();

  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate(([current, legacy]) => [sessionStorage.getItem(current), sessionStorage.getItem(legacy)], [GUIDE_KEY, LEGACY_GUIDE_KEY])).toEqual([null, null]);
  await expect(page).toHaveURL('/dashboard');
});
