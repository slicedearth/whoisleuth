import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';
import { caseRecord, openCaseResponseWorkspace, openSeededTimelineCase } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

test('retained explanations compare opposite relationships and shared sources without editing the Case', async ({ page }, testInfo) => {
  const timestamp = '2026-09-01T00:00:00.000Z';
  await page.clock.setFixedTime('2026-09-13T10:00:00.000Z');
  const pin = {
    id: 'pin-one', checkpointId: 'checkpoint-one', field: 'dns.nameservers', category: 'dns',
    label: 'Nameservers', value: 'ns1.example.test', source: 'Fixture DNS', sourceState: 'partial',
    sourceSchema: null, observedAt: timestamp, collectionDepth: 'deep', completeness: 'partial',
    truncated: false, transitionExpectation: null, limitations: ['One resolver response.'], createdAt: timestamp,
  };
  const assertion = {
    id: 'first-explanation', kind: 'hypothesis', statement: 'A shared service explains the match.', rationale: 'Review the source before inferring common control.',
    evidencePinIds: [pin.id], evidenceRelations: [{ evidencePinId: pin.id, stance: 'supports' }],
    state: 'open', createdAt: timestamp, updatedAt: timestamp,
  };
  const record = caseRecord({
    domain: 'compare-explanations.invalid', evidencePins: [pin, { ...pin, id: 'pin-two', label: 'Address', value: '192.0.2.1' }],
    assertions: [assertion, { ...assertion, id: 'second-explanation', statement: 'Common control explains the match.',
      evidencePinIds: ['pin-one', 'pin-two'], evidenceRelations: [{ evidencePinId: 'pin-one', stance: 'contradicts' }, { evidencePinId: 'pin-two', stance: 'unresolved' }],
    }, { ...assertion, id: 'third-explanation', statement: 'No retained observation addresses this explanation.', evidencePinIds: [], evidenceRelations: [] }],
  });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'advanced', 'Assessment');
  const retained = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const details = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: 'Compare explanations' }) });
  const summary = details.locator(':scope > summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  const rows = details.getByRole('list', { name: 'Evidence across explanations', exact: true }).locator(':scope > li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Supports');
  await expect(rows.nth(0)).toContainText('Contradicts');
  await expect(rows.nth(1)).toContainText('Not linked');
  await expect(rows.nth(1)).toContainText('Unresolved');
  await details.getByText('Shared source context', { exact: true }).click();
  await expect(details).toContainText('Same collection checkpoint — observations 1, 2');
  await expect(details).toContainText('Same declared source: Fixture DNS — observations 1, 2');
  const second = details.getByRole('combobox', { name: 'Second explanation', exact: true });
  await second.selectOption('third-explanation');
  await second.focus();
  await expect(second).toBeFocused();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Not linked');
  await second.selectOption('second-explanation');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440]] as const) {
      await page.setViewportSize({ width, height });
      await expect(details.getByRole('heading', { name: assertion.statement, exact: true })).toBeVisible();
      await expect(rows).toHaveCount(2);
      await expectNoHorizontalOverflow(page);
      await summary.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: testInfo.outputPath(`assessment-page-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
      const first = details.getByRole('combobox', { name: 'First explanation', exact: true });
      await first.focus();
      const visibleControl = await first.boundingBox();
      const navigation = await page.getByRole('navigation', { name: 'Case sections', exact: true }).boundingBox();
      expect(visibleControl && navigation && visibleControl.y >= navigation.y + navigation.height).toBe(true);
    }
  }
  await summary.focus();
  await summary.press('Enter');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records).toEqual(retained.records);
});
