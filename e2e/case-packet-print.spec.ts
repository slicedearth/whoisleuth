import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { caseRecord, openCaseResponseWorkspace, openSeededTimelineCase } from './case-test-fixtures';
import { currentActionFixture, openPacketWizardStep, caseWorkspaceActionStatus } from './case-response-fixtures';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, requiredValue, useTheme } from './helpers';

test('an analyst disclosure read cannot return after its Case section is replaced', { tag: '@timing-sensitive' }, async ({ page }) => {
  const now = '2000-01-03T00:00:00.000Z'; await page.clock.setFixedTime(now);
  const record = caseRecord({ id: 'delayed-disclosure', domain: 'delayed-disclosure.example',
    evidencePins: [{ id: 'delayed-pin', checkpointId: null, field: 'analyst_note', category: 'page', label: 'Supplied observation',
      value: 'PRIVATE-DELAYED-VALUE', source: 'Supplied source', sourceState: 'partial', sourceSchema: null, observedAt: now,
      collectionDepth: 'deep', completeness: 'partial', truncated: false, transitionExpectation: null,
      limitations: ['No broader coverage is established.'], createdAt: now }] });
  await openSeededTimelineCase(page, record.domain, [record]);
  const workspace = await openCaseResponseWorkspace(page, '', 'advanced', 'Response');
  const packet = workspace.locator('details[id^="case-response-preflight-"]'); await packet.locator(':scope > summary').click();
  await packet.getByLabel('Abuse category', { exact: true }).fill('Review');
  await packet.getByLabel('Affected party', { exact: true }).fill('Example organisation');
  await packet.getByLabel('Observed at', { exact: true }).fill('2000-01-03T00:00');
  await packet.getByLabel(/Exact abusive HTTP/).fill('https://delayed-disclosure.example/page');
  await packet.getByLabel('Observed harm', { exact: true }).fill('The supplied material requires review.');
  await packet.getByRole('checkbox', { name: /Supplied observation/ }).check(); await openPacketWizardStep(packet, 'Export and record');
  const comparison = packet.locator('details.internal-disclosure'); await comparison.locator(':scope > summary').click();
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle), descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const state = { held: false, released: false, release: () => {
      state.released = true;
      if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor); else Reflect.deleteProperty(crypto.subtle, 'digest');
      release();
    } };
    (window as typeof window & { heldDisclosureDigest?: typeof state }).heldDisclosureDigest = state;
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<SubtleCrypto['digest']>) => {
      if (!state.held && !state.released && new TextDecoder().decode(args[1]).includes('whoisleuth.case-response-review-inputs')) { state.held = true; await gate; }
      return original(...args);
    } });
  });
  const release = () => page.evaluate(() => (window as typeof window & { heldDisclosureDigest?: { release: () => void } }).heldDisclosureDigest?.release());
  try {
    await comparison.getByRole('button', { name: 'Compare actual prepared representations', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { heldDisclosureDigest?: { held: boolean } }).heldDisclosureDigest?.held)).toBe(true);
    await openCaseSection(page, 'History'); await release(); await openCaseSection(page, 'Response');
    await expect(comparison.getByRole('button', { name: 'Compare actual prepared representations', exact: true })).toBeEnabled();
    await expect(comparison.getByRole('region', { name: 'Analyst-only prepared disclosures', exact: true })).toHaveCount(0);
    await expect(comparison).not.toContainText('PRIVATE-DELAYED-VALUE');
  } finally { await release(); }
  const compare = comparison.getByRole('button', { name: 'Compare actual prepared representations', exact: true });
  const analyst = comparison.getByRole('region', { name: 'Analyst-only prepared disclosures', exact: true });
  const downloadedPacket = async () => {
    const pending = page.waitForEvent('download');
    await packet.getByRole('button', { name: 'Export JSON draft or authorised packet', exact: true }).click();
    return JSON.parse(await readFile(requiredValue(await (await pending).path(), 'Prepared packet download missing.'), 'utf8'));
  };
  await compare.click(); await expect(analyst).toContainText(`prepared at ${now}`);
  const original = await downloadedPacket();
  const refreshedAt = '2000-01-23T00:00:00.000Z'; await page.clock.setFixedTime(refreshedAt);
  await packet.getByRole('button', { name: 'Refresh manual complaint preview', exact: true }).click();
  await expect(analyst).toHaveCount(0);
  await compare.click(); await expect(analyst).toContainText(`prepared at ${refreshedAt}`);
  const refreshed = await downloadedPacket();
  expect(refreshed.generatedAt).toBe(refreshedAt);
  expect(refreshed.integrity.digestSha256).not.toBe(original.integrity.digestSha256);
  expect(refreshed.authorisation.reviewedInputDigestSha256).not.toBe(original.authorisation.reviewedInputDigestSha256);
  expect(JSON.stringify(refreshed)).not.toContain('PRIVATE-DELAYED-VALUE');
});

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
  const comparison = packet.locator('details.internal-disclosure');
  await comparison.locator(':scope > summary').click();
  await comparison.getByRole('checkbox', { name: 'Include Case notes in the internal comparison', exact: true }).check();
  await comparison.getByRole('button', { name: 'Compare actual prepared representations', exact: true }).click();
  const analyst = comparison.getByRole('region', { name: 'Analyst-only prepared disclosures', exact: true });
  await expect(analyst).toBeVisible();
  await analyst.getByText('Case field: notes · internal only', { exact: true }).click();
  await analyst.getByText('Evidence reference: print-pin · different representation', { exact: true }).click();
  await expect(analyst).toContainText('PRIVATE-CASE-NOTE');
  await expect(analyst).toContainText('PRIVATE-RAW-PIN-VALUE');
  await analyst.getByText('Evidence reference: unselected-pin · internal only', { exact: true }).click();
  await expect(analyst).toContainText('PRIVATE-UNSELECTED-PIN');
  if (captureVisualEvidenceEnabled()) {
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 844 }); await expectNoHorizontalOverflow(page);
        await comparison.screenshot({ path: testInfo.outputPath(`disclosure-comparison-${theme}-${width}.png`) });
      }
    }
  }
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
  for (const view of ['brief', 'evidence', 'timeline', 'full']) {
    await dialog.getByLabel('Recipient reading view', { exact: true }).selectOption(view);
    for (const privateValue of ['PRIVATE-CASE-NOTE', 'PRIVATE-UNSELECTED-PIN', 'PRIVATE-RAW-PIN-VALUE']) await expect(dialog).not.toContainText(privateValue);
    expect(JSON.parse(await dialog.locator('.technical-appendix pre').textContent() || '{}')).toEqual(projected);
    if (view === 'timeline') await expect(dialog.getByRole('region', { name: 'Prepared packet timeline', exact: true })).toBeVisible();
    if (view === 'evidence') await expect(dialog.getByRole('heading', { name: 'Selected evidence · 1', exact: true })).toBeVisible();
    if (captureVisualEvidenceEnabled() && (view === 'timeline' || view === 'brief')) {
      for (const theme of ['light', 'dark'] as const) {
        await dialog.getByRole('button', { name: 'Close report', exact: true }).click();
        await useTheme(page, theme);
        await openReport.click();
        await dialog.getByRole('checkbox', { name: 'Include exact packet JSON as a technical appendix', exact: true }).check();
        await dialog.getByLabel('Recipient reading view', { exact: true }).selectOption(view);
        for (const width of [320, 1280]) {
          await page.setViewportSize({ width, height: 844 });
          await dialog.evaluate(element => element.scrollTop = 0);
          await page.screenshot({ path: testInfo.outputPath(`recipient-${view}-${theme}-${width}.png`) });
          if (view === 'timeline') await dialog.getByRole('region', { name: 'Prepared packet timeline', exact: true }).screenshot({ path: testInfo.outputPath(`recipient-timeline-fields-${theme}-${width}.png`) });
        }
      }
    }
  }
  const reportBeforeReading = await dialog.locator('.report-content').innerText();
  for (const [role, target] of [['Analyst', 'Selected evidence'], ['Domain manager', 'Incident'], ['External reviewer', 'Readiness and unresolved evidence']] as const) {
    await dialog.getByText('Reading guide', { exact: true }).click();
    await dialog.getByRole('button', { name: new RegExp(`^${role}`) }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { name: new RegExp(`^${target}`) })).toBeFocused();
    await expect(dialog.getByRole('navigation', { name: 'Report reading starting points', exact: true })).toBeHidden();
    expect(await dialog.locator('.report-content').innerText()).toBe(reportBeforeReading);
    expect(JSON.parse(await dialog.locator('.technical-appendix pre').innerText())).toEqual(projected);
  }
  await dialog.getByRole('button', { name: 'Close report', exact: true }).click();
  await expect(openReport).toBeFocused();
  const download = page.waitForEvent('download');
  await packet.getByRole('button', { name: 'Export JSON draft or authorised packet', exact: true }).click();
  const downloaded = JSON.parse(await readFile(requiredValue(await (await download).path(), 'Packet JSON download missing.'), 'utf8'));
  expect(downloaded).toEqual(projected);
  await page.emulateMedia({ media: 'print' });
  await expect(analyst).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await comparison.locator(':scope > summary').click();
  await expect(analyst).toHaveCount(0);
  await comparison.locator(':scope > summary').click();
  await comparison.getByRole('button', { name: 'Compare actual prepared representations', exact: true }).click();
  await expect(analyst).toBeVisible();
  await comparison.getByRole('checkbox', { name: 'Include Case notes in the internal comparison', exact: true }).uncheck();
  await expect(analyst).toHaveCount(0);

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    await openReport.click();
    for (const [width, height] of [[1280, 720], [1024, 768], [390, 844], [320, 700], [2560, 1440]] as const) {
      await page.setViewportSize({ width, height });
      await dialog.evaluate(element => element.scrollTop = 0);
      await expect(dialog.getByRole('button', { name: 'Print or save PDF', exact: true })).toBeInViewport();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expectNoHorizontalOverflow(page);
      await dialog.getByText('Reading guide', { exact: true }).click();
      const startReview = dialog.getByRole('button', { name: /^External reviewer/ });
      await expect(startReview).toBeVisible();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`packet-report-${theme}-${width}.png`), animations: 'disabled' }); }
      await startReview.click();
      const reviewHeading = dialog.getByRole('heading', { name: 'Readiness and unresolved evidence', exact: true });
      await expect(reviewHeading).toBeFocused();
      await expect(reviewHeading).toBeInViewport();
      expect(await reviewHeading.evaluate(element => {
        const report = element.closest('dialog')!;
        const controls = report.querySelector<HTMLElement>('.print-controls')!;
        const bounds = report.getBoundingClientRect(), target = element.getBoundingClientRect();
        const visibleTop = getComputedStyle(controls).position === 'sticky' ? Math.max(bounds.top, controls.getBoundingClientRect().bottom) : bounds.top;
        return target.top >= visibleTop && target.bottom <= bounds.bottom;
      })).toBe(true);
      if (captureVisualEvidenceEnabled() && (width === 320 || width === 1280)) {
        await page.screenshot({ path: testInfo.outputPath(`packet-reading-target-${theme}-${width}.png`), animations: 'disabled' });
      }
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
  await expect(dialog.getByText('Reading guide', { exact: true })).toBeHidden();
  await expect(page.locator('.shell > header')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Case sections', exact: true })).toBeHidden();
  await expect(dialog.locator('.technical-appendix')).toHaveCount(0);
  if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath('recipient-print-layout.png'), fullPage: true }); }
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
