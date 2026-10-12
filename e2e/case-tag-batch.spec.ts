import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { caseRecord } from './case-test-fixtures';
import { caseNumber } from '../packages/cases/case-workflow-metadata.mts';
import { openCaseMetadata } from './console-navigation';
import { currentBrowserLocalDocument, migrateLegacyBrowserData, readBrowserLocalCollection, expectNoHorizontalOverflow,
  useTheme, failNextBrowserLocalManifestWrite, failNextBrowserLocalCollectionReadAfterWrite, holdNextBrowserLocalCommitAcknowledgement } from './helpers';

const records = Array.from({ length: 26 }, (_, index) => caseRecord({ id: `tag-case-${String(index).padStart(2, '0')}`, domain: `tag-${String(index).padStart(2, '0')}.example` }));
async function seed(page: import('@playwright/test').Page) {
  await page.goto('/cases');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: records }) }, { clearStorage: true, destination: '/cases' });
  await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toBeVisible();
  await page.getByText('Organise Case tags', { exact: true }).click();
  return page.getByRole('region', { name: 'Case batch tagging', exact: true });
}
function select(page: import('@playwright/test').Page, index: number) {
  return page.getByRole('checkbox', { name: `Select Case ${caseNumber(records[index]!.id)} for tag changes`, exact: true });
}

test('Case tag preview keeps cross-page targets separate from inspection and commits one exact transaction', async ({ page }, info) => {
  const panel = await seed(page), before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 });
  const collectionRequests: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/') && url.pathname !== '/api/session') collectionRequests.push(url.pathname); });
  await select(page, 0).check();
  await page.getByRole('navigation', { name: 'Case pages', exact: true }).getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: `Inspect saved Case ${caseNumber(records[25]!.id)}`, exact: true }).click();
  await expect(select(page, 25)).not.toBeChecked();
  await page.getByRole('button', { name: 'Back to queue', exact: true }).click();
  await select(page, 25).check();
  await page.locator('.case-filters').getByLabel('Search', { exact: true }).fill('tag-25');
  await panel.getByLabel('Batch tags', { exact: true }).fill('Reviewed');
  await panel.getByRole('button', { name: 'Preview exact tag changes', exact: true }).click();
  const preview = panel.getByRole('region', { name: 'Exact Case tag changes', exact: true });
  await expect(preview.getByRole('heading', { name: 'Exact Case tag changes', exact: true })).toBeFocused();
  await expect(preview).toContainText('tag-00.example'); await expect(preview).toContainText('tag-25.example');
  await expect(preview.getByRole('article')).toHaveCount(2);
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 })).toEqual(before);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 }); await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('section[aria-label="Case batch tagging"]').analyze()).violations).toEqual([]);
      if (captureVisualEvidenceEnabled()) await panel.screenshot({ path: info.outputPath(`tag-preview-${theme}-${width}.png`) });
    }
  }
  await preview.getByRole('button', { name: 'Apply reviewed tag changes', exact: true }).click();
  await expect(panel.getByRole('status', { name: 'Case tag batch status', exact: true })).toContainText('Tags saved for 2 Cases');
  const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 });
  expect(after.manifest.revision).toBe(before.manifest.revision + 1);
  for (const row of after.records) {
    const old = before.records.find(prior => prior.id === row.id)!;
    if ([records[0]!.id, records[25]!.id].includes(row.id)) expect(row.value.tags).toEqual(['Reviewed']);
    else expect(row).toEqual(old);
  }
  await expect(page.locator('.case-filters').getByLabel('Search', { exact: true })).toHaveValue('tag-25');
  expect(collectionRequests).toEqual([]);
});

test('stale and rejected tag batches preserve the draft, and committed read failures never offer another write', async ({ page, context }) => {
  const panel = await seed(page); await select(page, 0).check(); await select(page, 1).check();
  const text = panel.getByLabel('Batch tags', { exact: true }), prepare = panel.getByRole('button', { name: 'Preview exact tag changes', exact: true });
  await text.fill('Selected batch'); await prepare.click();
  const peer = await context.newPage();
  await peer.goto(`/cases?case=${records[1]!.id}`); await openCaseMetadata(peer);
  await peer.getByRole('textbox', { name: /^Additional tags/u }).fill('Peer tag');
  await peer.getByRole('button', { name: 'Save tags', exact: true }).click();
  await expect(peer.getByRole('status', { name: 'Case workspace action status' })).toContainText('Updated tags');
  const peerSaved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 });
  await panel.getByRole('button', { name: 'Apply reviewed tag changes', exact: true }).click();
  await expect(panel.getByRole('status', { name: 'Case tag batch status' })).toContainText('changed or became unavailable');
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 })).toEqual(peerSaved);
  await expect(text).toHaveValue('Selected batch');
  await peer.close(); await prepare.click();
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await panel.getByRole('button', { name: 'Apply reviewed tag changes', exact: true }).click();
  await expect(panel.getByRole('status', { name: 'Case tag batch status' })).toContainText(/could not save/iu);
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 })).toEqual(peerSaved);
  await expect(text).toHaveValue('Selected batch'); await prepare.click();
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await panel.getByRole('button', { name: 'Apply reviewed tag changes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('The change was saved, but Cases could not be reread');
  await expect(panel.getByRole('status', { name: 'Case tag batch status' })).toContainText('Tags saved for 2 Cases');
  await expect(prepare).toBeDisabled();
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 });
  expect(saved.manifest.revision).toBe(peerSaved.manifest.revision + 1);
  expect(saved.records.find(row => row.id === records[0]!.id)!.value.tags).toEqual(['Selected batch']);
  expect(saved.records.find(row => row.id === records[1]!.id)!.value.tags).toEqual(['Peer tag', 'Selected batch']);
});

test('later tag typing survives a held real commit acknowledgement without being submitted', { tag: '@timing-sensitive' }, async ({ page }) => {
  const panel = await seed(page); await select(page, 0).check(); await select(page, 1).check();
  const text = panel.getByLabel('Batch tags', { exact: true });
  await text.fill('Submitted tag'); await panel.getByRole('button', { name: 'Preview exact tag changes', exact: true }).click();
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 });
  const held = await holdNextBrowserLocalCommitAcknowledgement(page, 'cases');
  try {
    await panel.getByRole('button', { name: 'Apply reviewed tag changes', exact: true }).click(); await held.wait();
    await text.fill('Later draft'); await held.release();
    await expect(panel.getByRole('status', { name: 'Case tag batch status' })).toContainText('current tag draft was not part of this write');
    await expect(text).toHaveValue('Later draft'); await expect(select(page, 0)).toBeChecked(); await expect(select(page, 1)).toBeChecked();
    const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 26 });
    expect(after.manifest.revision).toBe(before.manifest.revision + 1);
    for (const id of [records[0]!.id, records[1]!.id]) expect(after.records.find(row => row.id === id)!.value.tags).toEqual(['Submitted tag']);
    expect(after.records.some(row => row.value.tags.includes('Later draft'))).toBe(false);
  } finally { await held.release(); }
});
