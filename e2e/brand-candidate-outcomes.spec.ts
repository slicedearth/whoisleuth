import { test, expect, openLocalApplication } from './local-application-fixtures';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import { BRAND_PROFILE_SCHEMA, BRAND_PROFILE_SCHEMA_VERSION } from '../packages/contracts/workspace-portability.mts';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';

const NOW = '2000-01-03T00:00:00.000Z';
const domains = ['first.example', 'second.example', 'third.example'];
const profile = normalizeBrandProfile({
  id: 'review-brand', name: 'Review Brand', createdAt: NOW, updatedAt: NOW,
  candidateObservations: domains.map(domain => ({
    domain,
    matches: [{ brandProfileId: 'review-brand', ruleKey: 'keyword:example', term: 'example', reason: 'Exact imported keyword nomination' }],
    sources: [{ source: 'Imported candidate record', revision: null, observedHostname: `login.${domain}`,
      sourceFirstObservedAt: null, sourceLastObservedAt: null, firstLocalObservedAt: NOW,
      completeness: 'partial', gap: 'Source interval and continuous coverage are unknown.' }],
  })),
}, { nowIso: NOW })!;

for (const outcome of ['unknown-first', 'unknown-later', 'success'] as const) {
  test(`candidate batch reports ${outcome} without replaying an uncertain write`, async ({ page, localApplication }, testInfo) => {
    await openLocalApplication(page, localApplication);
    await page.setViewportSize(outcome === 'unknown-first' ? { width: 390, height: 844 } : { width: 1280, height: 720 });
    await useTheme(page, outcome === 'unknown-first' ? 'light' : 'dark');
    await page.goto('/brands');
    const importFile = page.locator('label.file-btn input[type="file"]');
    await expect(importFile).toBeEnabled();
    await importFile.setInputFiles({
      name: 'profiles.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schema: BRAND_PROFILE_SCHEMA, version: BRAND_PROFILE_SCHEMA_VERSION, exportedAt: NOW, profiles: [profile] })),
    });
    await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Imported 1 new and 0 updated profiles');
    const profiles = page.locator('details.brand-profiles');
    if (await profiles.getAttribute('open') === null) await profiles.locator(':scope > summary').click();
    await page.getByRole('radio', { name: 'Set Review Brand active', exact: true }).check();
    await page.goto('/brands#brand-candidate-review');
    const workspace = page.locator('#brand-candidate-review');
    for (const domain of domains) await workspace.getByRole('checkbox', { name: domain, exact: true }).check();
    const reason = workspace.getByLabel('Reason', { exact: true });
    await reason.fill('Retain these exact review decisions.');
    await workspace.getByLabel('Next review / expiry date (UTC)', { exact: true }).fill('2099-01-01');
    const failAt = outcome === 'unknown-first' ? 1 : 2;
    let commits = 0;
    await page.route('**/api/local-workspace/commit', async route => {
      commits++;
      if (outcome !== 'success' && commits === failAt) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else await route.continue();
    });
    await page.route('**/api/local-workspace/receipt/*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const save = workspace.getByRole('button', { name: 'Defer selected until review', exact: true });
    await save.click();
    const status = workspace.getByRole('status', { name: 'Candidate review action status' });
    if (outcome === 'success') {
      await expect(status).toContainText('3 exact Brand candidate decisions recorded');
      expect(commits).toBe(3);
    } else {
      await expect(status).toContainText(outcome === 'unknown-first'
        ? '0 decisions confirmed saved; 1 decision may have been saved; 2 candidates were not attempted'
        : '1 decision confirmed saved; 1 decision may have been saved; 1 candidate was not attempted');
      await expect(reason).toHaveValue('Retain these exact review decisions.');
      for (const domain of domains) await expect(workspace.getByRole('checkbox', { name: domain, exact: true })).toBeChecked();
      expect(commits).toBe(failAt);
      await expect(save).toBeDisabled();
      await expect(workspace.getByRole('button', { name: 'Shortlist selected', exact: true })).toBeDisabled();
      await expect(status).toContainText('Reload and review the saved decisions');
    }
    await expectNoHorizontalOverflow(page);
    if (captureVisualEvidenceEnabled()) await workspace.screenshot({ path: testInfo.outputPath(`candidate-${outcome}.png`), animations: 'disabled' });
    await page.unroute('**/api/local-workspace/commit');
    await page.unroute('**/api/local-workspace/receipt/*');
    if (outcome.startsWith('unknown')) await workspace.getByRole('button', { name: 'Reload saved decisions', exact: true }).click();
    else await page.reload();
    // The real filesystem transaction was committed in the unknown cases. Reload
    // reveals it exactly once, while the unattempted suffix remains untouched.
    const saved = outcome === 'success' ? 3 : failAt;
    await expect(workspace.locator('.candidate-grid > article > p').filter({ hasText: /^deferred$/u })).toHaveCount(saved);
    await expect(workspace.locator('.candidate-grid > article > p').filter({ hasText: /^new$/u })).toHaveCount(3 - saved);
    await expect(save).toBeDisabled(); // Selection is deliberately reset by reload.
  });
}
