import { openConsoleView } from './console-navigation';
import { expect, test } from './fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { createCase, serializeCaseStore } from '../packages/cases/case-model.mts';
import { createRelationshipObservation } from '../packages/workspace/relationship-observation-model.mts';

const NOW = '2026-09-10T00:00:00.000Z';
function retainedCases() {
  return Array.from({ length: 75 }, (_, index) => {
    const record = createCase({ domain: `retained-${String(index).padStart(2, '0')}.example`, evidencePin: {
      label: 'Undated source fact', value: 'Known value', source: `source-${String(index).padStart(2, '0')}`,
      observedAt: null, sourceState: 'partial', completeness: 'partial',
    } }, NOW);
    record.evidencePins = Array.from({ length: 40 }, (_, pin) => ({ ...record.evidencePins[0]!, id: `pin-${index}-${pin}` }));
    return record;
  });
}
const members = Array.from({ length: 50 }, (_, index) => `member-${String(index).padStart(2, '0')}.example`);

for (const viewport of [
  { width: 1280, height: 720 }, { width: 1024, height: 768 },
  { width: 390, height: 844 }, { width: 320, height: 700 },
]) for (const theme of ['light', 'dark'] as const) {
  test(`complete retained views at ${viewport.width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize(viewport);
    await useTheme(page, theme);
    await page.goto('/monitor?view=timeline');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': JSON.parse(serializeCaseStore(retainedCases())),
      'whoisleuth-relationship-observations-v1': currentBrowserLocalDocument('relationship_observations', {
        observations: [createRelationshipObservation({ type: 'ip_address', value: '192.0.2.10', domains: members }, { retainedAt: NOW })],
      }),
    }, { clearStorage: true, destination: '/monitor?view=timeline' });
    await useTheme(page, theme);
    const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 75 });
    expect(stored.records.reduce((count, record) => count + record.value.evidencePins.length, 0)).toBe(3_000);
    const timeline = page.getByRole('region', { name: 'Investigation timeline', exact: true });
    await expect(timeline).toContainText('3001 retained events');
    await expect(timeline.locator('.timeline-list article')).toHaveCount(50);
    await timeline.getByRole('spinbutton', { name: 'Investigation timeline page number' }).fill('61');
    await timeline.getByRole('navigation', { name: 'Investigation timeline pages', exact: true }).getByRole('button', { name: 'Go', exact: true }).press('Enter');
    await expect(timeline.locator('.timeline-list article')).toHaveCount(1);
    await timeline.getByRole('combobox', { name: 'Event time', exact: true }).selectOption('7d');
    await expect(timeline.locator('.timeline-list article')).toHaveCount(0);
    await timeline.getByRole('combobox', { name: 'Event time', exact: true }).selectOption('undated');
    await timeline.getByRole('searchbox', { name: 'Entity', exact: true }).fill('member-49');
    await expect(timeline.locator('.timeline-list article')).toHaveCount(1);
    const disclosure = timeline.getByText('50 linked domains', { exact: true });
    await disclosure.focus();
    await disclosure.press('Enter');
    const memberPages = timeline.getByRole('navigation', { name: 'Timeline event domains', exact: true });
    await memberPages.getByRole('spinbutton').fill('3');
    await memberPages.getByRole('button', { name: 'Go', exact: true }).press('Enter');
    await expect(timeline.locator('.entities code')).toHaveText(members.slice(40));
    await expect(timeline).toContainText('Observation time unavailable');
    await expectNoHorizontalOverflow(page);
    await timeline.getByRole('heading', { name: 'Investigation timeline', exact: true }).scrollIntoViewIfNeeded();
    await testInfo.attach(`retained-timeline-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    await memberPages.scrollIntoViewIfNeeded();
    await testInfo.attach(`retained-timeline-members-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });

    await openConsoleView(page, 'inbox');
    const debt = page.getByRole('region', { name: 'Evidence gaps', exact: true });
    await expect(debt.locator('.review-heading > strong')).toHaveText('3000 evidence gaps to review');
    await expect(debt.locator('.queue > li')).toHaveCount(25);
    const queuePages = debt.getByRole('navigation', { name: 'Evidence-gap pages', exact: true });
    await queuePages.getByRole('spinbutton').fill('120');
    await queuePages.getByRole('button', { name: 'Go', exact: true }).press('Enter');
    await expect(queuePages.getByRole('status')).toHaveText('Page 120 of 120');
    await expect(debt.locator('.queue > li')).toHaveCount(25);
    await expect(debt.locator('.matrix')).not.toHaveAttribute('open');
    await debt.locator('.matrix > summary').press('Enter');
    await expect(debt.locator('.matrix')).toHaveAttribute('open', '');
    const matrixPages = debt.getByRole('navigation', { name: 'Source-state pages', exact: true });
    await matrixPages.getByRole('spinbutton').fill('3');
    await matrixPages.getByRole('button', { name: 'Go', exact: true }).press('Enter');
    await expect(matrixPages.getByRole('status')).toHaveText('Page 3 of 3');
    const source = viewport.width <= 800 ? debt.locator('.mobile-matrix') : debt.locator('.desktop-matrix');
    await expect(source).toContainText('source-74');
    await matrixPages.scrollIntoViewIfNeeded();
    await testInfo.attach(`retained-gaps-matrix-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    await debt.locator('.matrix > summary').press('Enter');
    await expect(debt.locator('.matrix')).not.toHaveAttribute('open');
    await debt.getByRole('searchbox', { name: 'Source', exact: true }).fill('source-74');
    await expect(debt.locator('.queue > li')).toHaveCount(25);
    await expect(debt.locator('.queue-heading')).toContainText('40 matching');
    await expect(debt.locator('.queue > li').first()).toContainText('retained-74.example');
    await expectNoHorizontalOverflow(page);
    await debt.getByRole('heading', { name: 'Evidence gaps', exact: true }).scrollIntoViewIfNeeded();
    await testInfo.attach(`retained-gaps-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
