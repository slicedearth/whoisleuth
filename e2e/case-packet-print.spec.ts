import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { caseRecord, openCaseResponseWorkspace, openSeededTimelineCase } from './case-test-fixtures';
import { currentActionFixture, openPacketWizardStep, caseWorkspaceActionStatus } from './case-response-fixtures';
import { expectNoHorizontalOverflow, requiredValue, useTheme } from './helpers';

test('printable packets preserve the exact audience projection, isolate print content and recheck freshness', async ({ page, browserName }, testInfo) => {
  const now = '2026-09-10T10:00:00.000Z';
  await page.clock.setFixedTime(now);
  const source = 'Fixture retained observation';
  const pin = { id: 'print-pin', checkpointId: null, field: 'analyst_note', category: 'page',
    label: 'Selected page observation', value: 'PRIVATE-RAW-PIN-VALUE', source, sourceState: 'partial',
    sourceSchema: null, observedAt: now, collectionDepth: 'deep', completeness: 'partial', truncated: false,
    transitionExpectation: null, limitations: ['A partial observation does not establish absence.'], createdAt: now };
  const record = caseRecord({ id: 'case-print', domain: 'packet-print.invalid',
    notes: [{ body: 'PRIVATE-CASE-NOTE', createdAt: now }],
    evidencePins: [pin, { ...pin, id: 'unselected-pin', label: 'PRIVATE-UNSELECTED-PIN' }],
    actions: [currentActionFixture({ id: 'print-action', type: 'internal_review', recipient: 'Selected review desk',
      contactSource: 'Explicit fixture recipient', routeObservedAt: now, contactLimitations: [], dueAt: null,
      targetState: 'ready_for_review', reference: null, followUpAt: null, outcome: null,
      createdAt: '2026-09-10T09:00:00.000Z', updatedAt: now })] });
  await openSeededTimelineCase(page, record.domain, [record]);
  const workspace = await openCaseResponseWorkspace(page, '', 'advanced', 'Response');
  const packet = workspace.locator('details[id^="case-response-preflight-"]');
  await packet.locator(':scope > summary').click();
  await packet.getByLabel('Abuse category', { exact: true }).fill('Credential page review');
  await packet.getByLabel('Affected party', { exact: true }).fill('Example organisation');
  await packet.getByLabel('Observed at', { exact: true }).fill('2026-09-10T10:00');
  await packet.getByLabel(/Exact abusive HTTP/).fill('https://packet-print.invalid/review?selected=1');
  const harm = 'Observed form <img src=x onerror="window.fixtureInjected=true">';
  await packet.getByLabel('Observed harm', { exact: true }).fill(harm);
  await packet.getByRole('checkbox', { name: /Selected page observation/ }).check();
  await openPacketWizardStep(packet, 'Export and record');
  const openReport = packet.getByRole('button', { name: 'Preview printable report', exact: true });
  await openReport.click();
  const dialog = page.getByRole('dialog', { name: 'packet-print.invalid', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'packet-print.invalid', exact: true })).toBeFocused();
  await expect(dialog).toContainText('Draft — authorisation incomplete');
  await expect(dialog).toContainText(harm);
  await expect(dialog).toContainText('Selected review desk');
  await expect(dialog).toContainText('2026-09-10 10:00:00.000 UTC');
  await expect(dialog.locator('img,script,iframe')).toHaveCount(0);
  for (const privateValue of ['PRIVATE-CASE-NOTE', 'PRIVATE-UNSELECTED-PIN', 'PRIVATE-RAW-PIN-VALUE']) await expect(dialog).not.toContainText(privateValue);

  await dialog.getByRole('checkbox', { name: 'Include exact packet JSON as a technical appendix', exact: true }).check();
  const projected = JSON.parse(await dialog.locator('.technical-appendix pre').innerText());
  expect(projected.selectedEvidence).toEqual([expect.objectContaining({ id: 'print-pin', source, observedAt: now, completeness: 'partial' })]);
  expect(projected.selectedEvidence[0]).not.toHaveProperty('value');
  expect(projected.case).not.toHaveProperty('notes');
  await dialog.getByRole('button', { name: 'Close report', exact: true }).click();
  await expect(openReport).toBeFocused();
  const download = page.waitForEvent('download');
  await packet.getByRole('button', { name: 'Export JSON draft or authorised packet', exact: true }).click();
  const downloaded = JSON.parse(await readFile(requiredValue(await (await download).path(), 'Packet JSON download missing.'), 'utf8'));
  expect(downloaded).toEqual(projected);

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    await openReport.click();
    for (const [width, height] of [[1280, 720], [1024, 768], [390, 844], [320, 700], [2560, 1440]] as const) {
      await page.setViewportSize({ width, height });
      await dialog.evaluate(element => element.scrollTop = 0);
      await expect(dialog.getByRole('button', { name: 'Print or save PDF', exact: true })).toBeInViewport();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`packet-report-${theme}-${width}.png`), animations: 'disabled' });
    }
    await dialog.getByRole('button', { name: 'Close report', exact: true }).click();
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await openReport.click();
  await expect(dialog.getByRole('heading', { name: 'packet-print.invalid', exact: true })).toBeFocused();
  const focusedControls = new Set<string>();
  // Native macOS WebKit uses Option–Tab to include buttons and checkboxes.
  const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press(nextControl);
    const focus = await dialog.evaluate(element => ({
      inside: element.contains(document.activeElement),
      browserControls: !document.hasFocus() && document.activeElement === document.body,
      control: document.activeElement?.matches('input[type="checkbox"]') ? 'appendix'
        : document.activeElement?.matches('button') ? document.activeElement.textContent?.trim() : null,
    }));
    expect(focus.inside || focus.browserControls).toBe(true);
    if (focus.inside && focus.control) focusedControls.add(focus.control);
  }
  expect(focusedControls).toEqual(new Set(['Print or save PDF', 'Close report', 'appendix']));
  await openReport.evaluate(element => element.focus());
  await expect(openReport).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(openReport).toBeFocused();

  await openReport.click();
  await page.emulateMedia({ media: 'print' });
  await expect(dialog.locator('.print-guard')).toBeVisible();
  await expect(dialog.locator('.report-content')).toBeHidden();
  await expect(page.locator('.shell > header')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    const state = window as typeof window & { fixturePrintCalls: number };
    state.fixturePrintCalls = 0;
    window.print = () => { state.fixturePrintCalls += 1; };
  });
  const print = dialog.getByRole('button', { name: 'Print or save PDF', exact: true });
  await print.click();
  await expect(dialog).toHaveClass(/print-approved/u);
  expect(await page.evaluate(() => (window as typeof window & { fixturePrintCalls: number }).fixturePrintCalls)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(dialog.locator('.report-content')).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(dialog.locator('.print-controls')).toBeHidden();
  await expect(page.locator('.shell > header')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Case sections', exact: true })).toBeHidden();
  await expect(dialog.locator('.technical-appendix')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('recipient-print-layout.png'), fullPage: true });
  if (browserName === 'chromium') await page.pdf({ path: testInfo.outputPath('recipient-report.pdf'), format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(dialog).not.toHaveClass(/print-approved/u);
  await expect(print).toBeEnabled();
  await page.clock.setFixedTime('2026-09-20T10:00:00.000Z');
  await print.click();
  await expect(dialog).toHaveCount(0);
  await expect(caseWorkspaceActionStatus(page)).toContainText('no longer current');
  expect(await page.evaluate(() => (window as typeof window & { fixturePrintCalls: number }).fixturePrintCalls)).toBe(1);
  expect(await page.evaluate(() => (window as typeof window & { fixtureInjected?: boolean }).fixtureInjected)).toBeUndefined();
});
