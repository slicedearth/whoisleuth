import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { caseRecord, openCaseResponseWorkspace, openSeededTimelineCase } from './case-test-fixtures';
import { caseWorkspaceActionStatus } from './case-response-fixtures';
import { openCaseSection } from './console-navigation';
import { expectFocusedResultsVisible, expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

test('distinguishes retained facts and reveals the exact evidence behind decisions, assertions and sightings', async ({ page }, testInfo) => {
  const collectionRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) collectionRequests.push(path);
  });
  const at = '2026-09-01T00:00:00.000Z';
  const pins = ['old.example.test', `new-${'x'.repeat(240)}.example.test`].map((value, index) => ({
    id: `evidence-${index + 1}`, checkpointId: 'checkpoint-one', field: `dns.field-${index}`, category: 'dns',
    label: 'Nameservers', value, source: 'DNS', sourceState: 'partial', sourceSchema: null,
    observedAt: at, collectionDepth: 'deep', completeness: 'partial', truncated: false,
    transitionExpectation: null, limitations: ['A single retained resolver observation.'], createdAt: at,
  }));
  await page.clock.setFixedTime('2026-09-10T00:00:00.000Z');
  await openSeededTimelineCase(page, 'evidence-review.invalid', [caseRecord({ id: 'evidence-review', domain: 'evidence-review.invalid', evidencePins: pins })], CASE_SCHEMA_VERSION);
  const workspace = await openCaseResponseWorkspace(page, 'evidence-review', 'quick', 'Assessment');
  const assessment = workspace.getByRole('region', { name: 'Case assessment', exact: true });
  const first = assessment.getByRole('checkbox', { name: `Pin 1: Nameservers · DNS · ${at}`, exact: true });
  const second = assessment.getByRole('checkbox', { name: `Pin 2: Nameservers · DNS · ${at}`, exact: true });
  await expect(first.locator('..')).toContainText(pins[0]!.value);
  await expect(second.locator('..')).toContainText(pins[1]!.value);
  await expect(second.locator('..')).toContainText('Completeness: partial');
  await second.focus();
  await page.keyboard.press('Space');
  await expect(second).toBeChecked();
  await expect(first).not.toBeChecked();
  await assessment.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await assessment.getByRole('combobox', { name: 'Review reason', exact: true }).selectOption('other_reviewed');
  await assessment.getByLabel('Conclusion summary', { exact: true }).fill('Review the later infrastructure separately');
  await assessment.getByLabel('Evidence-based rationale', { exact: true }).fill('This conclusion references the second retained fact only.');
  const prompts = assessment.locator('details.decision-review-prompts');
  const beforePrompt = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await expect(prompts).not.toHaveAttribute('open', '');
  await assessment.getByLabel('Evidence-based rationale', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(prompts.locator('summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(prompts).toHaveAttribute('open', '');
  await expect(prompts).toContainText('retained observations weaken this conclusion');
  await expect(prompts).toContainText('same object, time and collection conditions');
  await expect(prompts).toContainText('What remains unresolved');
  await expect(assessment.getByLabel('Conclusion summary', { exact: true })).toHaveValue('Review the later infrastructure separately');
  await expect(assessment.getByLabel('Evidence-based rationale', { exact: true })).toHaveValue('This conclusion references the second retained fact only.');
  await expect(second).toBeChecked();
  await expect(first).not.toBeChecked();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records).toEqual(beforePrompt.records);
  await page.keyboard.press('Enter');
  await expect(prompts).not.toHaveAttribute('open', '');
  await assessment.getByRole('button', { name: 'Record conclusion', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded an analyst decision');
  const decision = assessment.locator('ol.records').first().locator(':scope > li').first();
  await decision.getByText('Linked evidence (1)', { exact: true }).click();
  await expect(decision).toContainText(pins[1]!.value);
  await expect(decision).not.toContainText(pins[0]!.value);
  const stored = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(stored.decisions).toEqual([expect.objectContaining({ evidencePinIds: ['evidence-2'] })]);

  await openCaseResponseWorkspace(page, 'evidence-review', 'advanced', 'Assessment');
  const assertions = assessment.locator('details[id^="case-response-assessment-assertions-"]');
  await assertions.locator(':scope > summary').click();
  await assertions.getByLabel('Statement', { exact: true }).fill('The retained facts support competing explanations.');
  await assertions.getByRole('combobox', { name: `Relationship for Pin 1: Nameservers · DNS · ${at}`, exact: true }).selectOption('contradicts');
  await assertions.getByRole('combobox', { name: `Relationship for Pin 2: Nameservers · DNS · ${at}`, exact: true }).selectOption('supports');
  await assertions.getByRole('button', { name: 'Record assertion', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded a structured analyst assertion');
  const retainedAssertion = assertions.locator('ol.records > li').first();
  await retainedAssertion.getByText('Linked evidence (2)', { exact: true }).click();
  await expect(retainedAssertion.locator('.linked-evidence li').filter({ hasText: pins[0]!.value })).toContainText('contradicts');
  await expect(retainedAssertion.locator('.linked-evidence li').filter({ hasText: pins[1]!.value })).toContainText('supports');
  await assessment.getByText('Record an analyst decision', { exact: true }).click();
  await prompts.locator('summary').click();

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      await retainedAssertion.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await expect(retainedAssertion.locator('.linked-evidence')).toBeVisible();
      if (viewport.width === 320 || viewport.width === 1280) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`linked-evidence-${theme}-${viewport.width}.png`) }); }
      if (viewport.width === 320) {
        const accessibility = await new AxeBuilder({ page }).include('.response-workspace')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(accessibility.violations).toEqual([]);
      }
      await assessment.getByLabel('Rationale', { exact: true }).focus();
      await page.keyboard.press('Tab');
      await expectFocusedResultsVisible(page, prompts.locator('summary'), prompts.locator('summary'));
      await expect(prompts.getByRole('list')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if ((viewport.width === 320 || viewport.width === 1280) && captureVisualEvidenceEnabled()) {
        await page.screenshot({ path: testInfo.outputPath(`assessment-prompts-${theme}-${viewport.width}.png`) });
      }
    }
  }

  await openCaseSection(page, 'Evidence');
  const observation = workspace.getByRole('region', { name: 'Case observations', exact: true });
  await observation.getByText('Record a source-qualified sighting', { exact: true }).click();
  const select = observation.getByRole('combobox', { name: 'Supporting evidence pin', exact: true });
  await select.selectOption('evidence-2');
  await expect(select).toHaveAccessibleDescription(new RegExp(pins[1]!.value.replaceAll('.', '\\.')));
  await expectNoHorizontalOverflow(page);
  await observation.getByRole('button', { name: 'Record sighting', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded a source-qualified sighting');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.sightings).toEqual([expect.objectContaining({ evidencePinId: 'evidence-2' })]);
  expect(collectionRequests).toEqual([]);
});
