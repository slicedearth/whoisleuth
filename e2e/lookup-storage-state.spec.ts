import { expect, test } from './fixtures';
import { expandLookupFamilies, readBrowserLocalCollection } from './helpers';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import { TECHNOLOGY_PROFILE_VERSION, WEBSITE_SECURITY_POSTURE_VERSION } from '../lib/lookup-child-profile-contract.mts';

test('unavailable Case and snapshot reads do not claim absence and retry recovers retained work', async ({ page }) => {
  const domain = 'read-recovery.example';
  const fixture = sectionedLookupFixture(domain);
  const profile = {
    version: 1, status: 'success', observedAt: '2026-09-01T00:00:00.000Z', scanMode: 'deep',
    source: 'derived', durationMs: null, complete: true, truncated: false,
    limitations: ['Deterministic passive snapshot fixture.'], diagnostics: {}, findings: [],
  };
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      ...fixture,
      availability: {
        ...fixture.availability,
        technologyProfile: { ...profile, profileVersion: TECHNOLOGY_PROFILE_VERSION },
        securityPosture: { ...profile, postureVersion: WEBSITE_SECURITY_POSTURE_VERSION, summary: { observed: 0, potentialExposure: 0, observedAbsence: 0, unavailable: 0 } },
      },
    }),
  }));
  await page.goto('/lookup');
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expandLookupFamilies(page);
  const caseCard = page.locator('.case-card');
  await expect(caseCard.getByText(`No case for ${domain} yet.`, { exact: true })).toBeVisible();
  await caseCard.getByRole('button', { name: 'Create case', exact: true }).click();
  const originalCase = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const snapshots = page.locator('.snapshot-manager');
  await snapshots.getByRole('button', { name: 'Save current snapshot' }).click();
  await expect(snapshots.getByRole('status')).toContainText('Saved a compact website-profile snapshot');
  const originalSnapshots = await readBrowserLocalCollection(page, 'website_snapshots', { minimumRecords: 1 });

  // The provider has already initialised successfully. Only subsequent collection reads fail.
  await page.evaluate(() => {
    const target = window as typeof window & { failRetainedReads?: boolean };
    target.failRetainedReads = true;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query: IDBValidKey | IDBKeyRange) {
      if (target.failRetainedReads && this.name === 'manifests' && (query === 'cases' || query === 'website_snapshots')) {
        throw new DOMException('The retained collection is unavailable.', 'InvalidStateError');
      }
      return get.call(this, query);
    };
  });
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expandLookupFamilies(page);
  await expect(caseCard.getByRole('alert')).toContainText('could not be read');
  await expect(caseCard.getByRole('button', { name: 'Create case', exact: true })).toHaveCount(0);
  await expect(caseCard.getByText(`No case for ${domain} yet.`, { exact: true })).toHaveCount(0);
  await expect(snapshots.getByRole('alert')).toContainText('could not be read');
  await expect(snapshots.getByText('No website-profile snapshot is retained for this domain.', { exact: true })).toHaveCount(0);
  await expect(snapshots.getByRole('region', { name: 'Observed certificate inventory' })).toHaveCount(0);
  await expect(snapshots.getByRole('button', { name: 'Save current snapshot' })).toBeDisabled();

  await page.evaluate(() => { (window as typeof window & { failRetainedReads?: boolean }).failRetainedReads = false; });
  await caseCard.getByRole('button', { name: 'Retry Case read' }).click();
  await snapshots.getByRole('button', { name: 'Retry snapshot read' }).click();
  await expect(caseCard.getByRole('button', { name: 'Retry Case read' })).toHaveCount(0);
  await expect(snapshots.getByText(/Manage 1 saved snapshot/u)).toBeVisible();
  await expect(snapshots.getByRole('button', { name: 'Save current snapshot' })).toBeEnabled();
  const recoveredCase = await readBrowserLocalCollection(page, 'cases');
  const recoveredSnapshots = await readBrowserLocalCollection(page, 'website_snapshots');
  expect(recoveredCase.records).toEqual(originalCase.records);
  expect(recoveredCase.manifest.revision).toBe(originalCase.manifest.revision);
  expect(recoveredSnapshots.records).toEqual(originalSnapshots.records);
  expect(recoveredSnapshots.manifest.revision).toBe(originalSnapshots.manifest.revision);
});
