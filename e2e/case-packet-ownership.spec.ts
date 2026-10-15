import type { Locator, Page } from '@playwright/test';
import { CASE_SCHEMA_VERSION, type CaseRecord } from '../packages/cases/case-record-contracts.mts';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';
import { caseRecord, openCaseResponseWorkspace, openSeededTimelineCase } from './case-test-fixtures';
import { caseWorkspaceActionStatus, currentActionFixture, openPacketWizardStep } from './case-response-fixtures';
import { openCaseSection, openConsoleView } from './console-navigation';
import { expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';

type HeldPreparation = { entered: boolean; release: () => Promise<void> };
type PacketProbe = typeof window & { heldPackets: HeldPreparation[]; packetOutputs: string[] };

async function openPacket(page: Page, overrides: Parameters<typeof caseRecord>[0] & Pick<CaseRecord, 'checkpointCollectionReceipts'> = {}) {
  const now = '2000-01-03T00:00:00.000Z';
  await page.clock.setFixedTime(now);
  const record = { ...caseRecord({ id: 'packet-owner', domain: 'packet-owner.example',
    evidencePins: [{ id: 'owner-pin', checkpointId: null, field: 'analyst_note', category: 'page', label: 'Selected observation',
      value: 'Retained fixture fact', source: 'Selected source', sourceState: 'partial', sourceSchema: null, observedAt: now,
      collectionDepth: 'deep', completeness: 'partial', truncated: false, transitionExpectation: null, limitations: [], createdAt: now }],
    actions: [currentActionFixture({ id: 'owner-action', type: 'internal_review', recipient: 'Internal review desk',
      contactSource: 'Analyst supplied', routeObservedAt: now, contactLimitations: [], dueAt: null,
      targetState: 'ready_for_review', reference: null, followUpAt: null, outcome: null, createdAt: now, updatedAt: now })] }), ...overrides };
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  const workspace = await openCaseResponseWorkspace(page, '', 'advanced', 'Response');
  const packet = workspace.locator('details[id^="case-response-preflight-"]');
  await packet.locator(':scope > summary').click();
  await packet.getByLabel('Abuse category', { exact: true }).fill('Review');
  await packet.getByLabel('Affected party', { exact: true }).fill('Example organisation');
  await packet.getByLabel('Observed at', { exact: true }).fill('2000-01-03T00:00');
  await packet.getByLabel(/Exact abusive HTTP/).fill('https://packet-owner.example/page');
  await packet.getByLabel('Observed harm', { exact: true }).fill('A source-qualified observation for manual review.');
  await packet.getByRole('checkbox', { name: /Selected observation/ }).check();
  await openPacketWizardStep(packet, 'Export and record');
  await page.evaluate(() => {
    const state = window as PacketProbe;
    state.packetOutputs = []; state.heldPackets = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) state.packetOutputs.push('download'); else original.call(this);
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { state.packetOutputs.push('clipboard'); },
    } });
  });
  return packet;
}

test('selected packet references navigate to exact local collection context without changing the recipient copy or saved Case', async ({ page }, testInfo) => {
  const receipt = JSON.parse(readFileSync(path.resolve(__dirname, '../test/fixtures/cli-lookup-v3.json'), 'utf8')).collectionReceipt;
  const pin = { id: 'trace-pin', checkpointId: 'trace-checkpoint', field: 'dns.nameservers', category: 'dns', label: 'Selected observation',
    value: 'Private retained observation value', source: 'Selected source', sourceState: 'partial', sourceSchema: null,
    observationHostname: 'portal.packet-owner.example', responseObject: { kind: 'hostname' as const, identifier: 'portal.packet-owner.example', incidentTargetId: null },
    observedAt: '2000-01-01T00:00:00.000Z', createdAt: '2000-01-02T00:00:00.000Z', collectionDepth: 'deep' as const,
    completeness: 'partial' as const, truncated: false, transitionExpectation: null, limitations: [] };
  const packet = await openPacket(page, { evidencePins: [pin, { ...pin, id: 'other-trace-pin', checkpointId: 'other-checkpoint', label: 'Other observation' }],
    checkpointCollectionReceipts: [{ checkpointId: pin.checkpointId, collectionReceipt: receipt }] });
  const before = await readBrowserLocalCollection(page, 'cases');
  await openPacketWizardStep(packet, 'Review');
  const material = await packet.locator('.packet-disclosure pre').textContent();
  const trace = packet.locator('.evidence-lineage');
  await trace.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
  const choice = trace.getByRole('combobox', { name: 'Evidence reference to trace', exact: true });
  await expect(choice.locator('option')).toHaveCount(2);
  await choice.selectOption(pin.id);
  const context = trace.getByRole('region', { name: 'Selected checkpoint collection context', exact: true });
  await expect(context).toContainText('portal.packet-owner.example');
  await expect(context.locator(`time[datetime="${pin.observedAt}"]`)).toHaveCount(1);
  await expect(context.locator(`time[datetime="${pin.createdAt}"]`)).toHaveCount(1);
  await expect(context).toContainText('trace-checkpoint');
  await expect(context).toContainText('Original collection choices');
  await expect(trace).toContainText('not added to the recipient copy');
  expect(await packet.locator('.packet-disclosure pre').textContent()).toBe(material);
  expect(material).not.toMatch(/Private retained observation value|collectionReceipt|checkpointCollectionReceipts/u);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await context.getByRole('heading', { name: 'Retained observation', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
      if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`packet-lineage-${theme}-${width}.png`) });
    }
  }
  expect((await new AxeBuilder({ page }).include('.evidence-lineage').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await openPacketWizardStep(packet, 'Prepare');
  await packet.getByRole('checkbox', { name: /Selected observation/ }).uncheck();
  await packet.getByRole('checkbox', { name: /Other observation/ }).check();
  await openPacketWizardStep(packet, 'Review');
  await expect(trace).not.toHaveAttribute('open', '');
  await trace.locator(':scope > summary').click();
  await expect(choice).toHaveValue('');
  await expect(choice.locator('option')).toHaveCount(2);
  await choice.selectOption('other-trace-pin');
  await expect(context).toContainText('Collection context is unavailable for this exact reference');
  await expect(context.getByRole('heading', { name: 'Original collection choices' })).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await page.evaluate(() => (window as PacketProbe).packetOutputs)).toEqual([]);
});

// Hold the final packet hash, not a timer or a mocked preparation callback.
// Completion includes the real hash and subsequent component/render microtasks.
async function holdPreparation(page: Page, fail = false, reviewOnly = false) {
  const index = await page.evaluate(({ fail, reviewOnly }) => {
    const state = window as PacketProbe, original = crypto.subtle.digest.bind(crypto.subtle);
    let unblock!: () => void, complete!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const completed = new Promise<void>(resolve => { complete = resolve; });
    const held: HeldPreparation = { entered: false, release: async () => {
      unblock(); await completed;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    } };
    const index = state.heldPackets.push(held) - 1;
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<SubtleCrypto['digest']>) => {
      const schema = reviewOnly ? 'whoisleuth.case-response-review-inputs' : 'whoisleuth.case-response-packet';
      if (!held.entered && new TextDecoder().decode(args[1]).includes(`"${reviewOnly ? 'contract' : 'schema'}":"${schema}"`)) {
        held.entered = true;
        Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: original });
        await gate;
        try { if (fail) throw new Error('Earlier packet preparation failed.'); return await original(...args); }
        finally { complete(); }
      }
      return original(...args);
    } });
    return index;
  }, { fail, reviewOnly });
  return {
    entered: () => expect.poll(() => page.evaluate(index => (window as PacketProbe).heldPackets[index]!.entered, index)).toBe(true),
    release: () => page.evaluate(index => (window as PacketProbe).heldPackets[index]!.release(), index),
  };
}

async function prepareAuthorisation(packet: Locator, confirm = true) {
  await openPacketWizardStep(packet, 'Review');
  for (const label of ['Infrastructure responsibility', 'Analyst authority', 'Contradiction review', 'Source limitations review']) {
    const section = packet.locator('.readiness-editor section', { hasText: label });
    await section.getByRole('combobox', { name: 'State', exact: true }).selectOption('complete');
    await section.getByLabel('Detail', { exact: true }).fill(`Reviewed ${label.toLowerCase()} for this fixture.`);
  }
  await packet.getByRole('button', { name: 'Review and bind exact inputs', exact: true }).click();
  const confirmations = packet.getByRole('group', { name: 'Explicit confirmations', exact: true });
  await expect(confirmations.getByRole('checkbox')).toHaveCount(5);
  if (confirm) {
    for (const confirmation of await confirmations.getByRole('checkbox').all()) await confirmation.check();
    await expect(packet.getByRole('button', { name: 'Authorise exact bound inputs', exact: true })).toBeEnabled();
  }
}

test('packet approval explains the next review and focuses its existing control without taking the action', async ({ page }, testInfo) => {
  const packet = await openPacket(page);
  const status = packet.getByRole('region', { name: 'Packet authorisation status', exact: true });
  await expect(status).toContainText('Complete the analyst authority review');
  await status.getByRole('button', { name: 'Review missing readiness', exact: true }).click();
  const authority = packet.locator('.readiness-editor section', { hasText: 'Analyst authority' });
  await expect(authority.getByRole('combobox', { name: 'State', exact: true })).toBeFocused();
  await openPacketWizardStep(packet, 'Prepare');
  await status.getByRole('button', { name: 'View full readiness matrix', exact: true }).click();
  await expect(packet.getByRole('region', { name: 'Profile-specific readiness matrix', exact: true })).toBeFocused();

  await prepareAuthorisation(packet, false);
  await status.getByRole('button', { name: 'Go to confirmations', exact: true }).click();
  const confirmations = packet.getByRole('group', { name: 'Explicit confirmations', exact: true }).getByRole('checkbox');
  await expect(confirmations.first()).toBeFocused();
  await expect(confirmations.first()).not.toBeChecked();
  for (const confirmation of await confirmations.all()) await confirmation.check();
  await status.getByRole('button', { name: 'Go to authorisation', exact: true }).click();
  await expect(packet.getByRole('button', { name: 'Authorise exact bound inputs', exact: true })).toBeFocused();
  await expect(packet.getByLabel('Confirmation time', { exact: true })).toHaveValue('');

  await authority.getByLabel('Detail', { exact: true }).fill('Changed authority context for manual review.');
  await expect(status).toContainText('Material inputs changed');
  await status.getByRole('button', { name: 'Go to exact-input review', exact: true }).click();
  await expect(packet.getByRole('button', { name: 'Review and bind exact inputs', exact: true })).toBeFocused();
  await expect(packet).toContainText('review stale');
  expect(await page.evaluate(() => (window as PacketProbe).packetOutputs)).toEqual([]);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await status.screenshot({ path: testInfo.outputPath(`packet-approval-${theme}-${width}.png`) });
    }
  }
});

for (const reselect of [false, true]) test(`withdrawing a pending packet confirmation${reselect ? ' and selecting it again' : ''} cannot restore authorisation`, { tag: '@timing-sensitive' }, async ({ page }) => {
  const packet = await openPacket(page);
  await prepareAuthorisation(packet);
  const held = await holdPreparation(page, false, true);
  await packet.getByRole('button', { name: 'Authorise exact bound inputs', exact: true }).click();
  await held.entered();
  const confirmation = packet.getByRole('checkbox', { name: 'I reviewed the exact selected evidence.', exact: true });
  await confirmation.uncheck();
  if (reselect) await confirmation.check();
  await held.release();
  await expect(packet.getByLabel('Confirmation time', { exact: true })).toHaveValue('');
  await expect(packet).toContainText('draft · authorisation incomplete');
  await expect(caseWorkspaceActionStatus(page)).toContainText('confirmation decision changed');
  await openPacketWizardStep(packet, 'Export and record');
  await expect(packet.locator('.wizard-status')).toContainText('remains a draft');
  await packet.getByRole('button', { name: 'Preview manual complaint', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Prepared the exact draft manual complaint preview');
});

test('packet authorisation requires unchanged material and readiness while the digest is pending', { tag: '@timing-sensitive' }, async ({ page }) => {
  const packet = await openPacket(page);
  await prepareAuthorisation(packet);
  const held = await holdPreparation(page, false, true);
  await packet.getByRole('button', { name: 'Authorise exact bound inputs', exact: true }).click();
  await held.entered();
  const authority = packet.locator('.readiness-editor section', { hasText: 'Analyst authority' });
  await authority.getByRole('combobox', { name: 'State', exact: true }).selectOption('unavailable');
  await held.release();
  await expect(packet.getByLabel('Confirmation time', { exact: true })).toHaveValue('');
  await expect(packet.getByRole('button', { name: 'Authorise exact bound inputs', exact: true })).toBeDisabled();
  await expect(packet).toContainText('review stale');
  await openPacketWizardStep(packet, 'Export and record');
  await expect(packet.locator('.wizard-status')).toContainText('remains a draft');
});

test('a closed authorisation cannot complete or clear a replacement operation', { tag: '@timing-sensitive' }, async ({ page }) => {
  const packet = await openPacket(page);
  await prepareAuthorisation(packet);
  const authorise = packet.getByRole('button', { name: 'Authorise exact bound inputs', exact: true });
  const old = await holdPreparation(page, false, true);
  await authorise.click();
  await old.entered();
  await packet.locator(':scope > summary').click();
  await expect(packet).not.toHaveAttribute('open', '');
  await packet.locator(':scope > summary').click();
  await expect(packet.getByRole('region', { name: 'Packet authorisation status', exact: true }))
    .toContainText('The previous authorisation stopped when its review context changed');
  const current = await holdPreparation(page, false, true);
  await authorise.click();
  await current.entered();
  const message = await caseWorkspaceActionStatus(page).textContent();
  await old.release();
  await expect(authorise).toBeDisabled();
  await expect(packet.getByLabel('Confirmation time', { exact: true })).toHaveValue('');
  expect(await caseWorkspaceActionStatus(page).textContent()).toBe(message);
  await current.release();
  await expect(packet.locator('.wizard-status')).toHaveText('The current exact inputs are authorised for deliberate local export.');
  await openPacketWizardStep(packet, 'Review');
  await expect(packet.getByLabel('Confirmation time', { exact: true })).toHaveValue('2000-01-03T00:00');
  await expect(packet).toContainText('authorised inputs');
  await expect(packet.getByRole('region', { name: 'Packet authorisation status', exact: true }))
    .not.toContainText('The previous authorisation stopped');
});

test('closed packet preparations cannot download, copy, reveal previews or retain a delivery handoff', { tag: '@timing-sensitive' }, async ({ page }) => {
  const packet = await openPacket(page);
  for (const name of ['Export JSON draft or authorised packet', 'Copy email draft', 'Preview manual complaint', 'Preview printable report']) {
    if (name === 'Copy email draft') await packet.getByText('Other export formats', { exact: true }).click();
    const held = await holdPreparation(page);
    await packet.getByRole('button', { name, exact: true }).click(); await held.entered();
    await packet.locator(':scope > summary').click();
    await expect(packet).not.toHaveAttribute('open', '');
    await held.release();
    expect(await page.evaluate(() => (window as PacketProbe).packetOutputs)).toEqual([]);
    await expect(page.getByRole('dialog', { name: 'packet-owner.example', exact: true })).toHaveCount(0);
    await packet.locator(':scope > summary').click();
    await expect(packet.getByRole('button', { name, exact: true })).toBeEnabled();
    await expect(packet.getByRole('textbox', { name: /^Exact manual complaint/ })).toHaveCount(0);
    await expect(packet.getByRole('button', { name: 'Continue to record delivery' })).toHaveCount(0);
  }
});

test('leaving a packet phase, Case section or route cancels pending output without changing its inputs', { tag: '@timing-sensitive' }, async ({ page }) => {
  const packet = await openPacket(page);
  for (const leave of ['phase', 'section', 'route']) {
    const held = await holdPreparation(page);
    await packet.getByRole('button', { name: 'Export JSON draft or authorised packet', exact: true }).click(); await held.entered();
    if (leave === 'phase') {
      await openPacketWizardStep(packet, 'Prepare'); await openPacketWizardStep(packet, 'Export and record');
    } else if (leave === 'section') {
      await openCaseSection(page, 'History'); await openCaseSection(page, 'Response');
    } else await openConsoleView(page, 'inbox');
    await held.release();
    expect(await page.evaluate(() => (window as PacketProbe).packetOutputs)).toEqual([]);
    if (leave !== 'route') {
      await expect(packet.getByRole('button', { name: 'Export JSON draft or authorised packet', exact: true })).toBeEnabled();
      await expect(packet.getByRole('button', { name: 'Continue to record delivery' })).toHaveCount(0);
    }
  }
});

for (const fail of [false, true]) test(`an abandoned packet ${fail ? 'error' : 'success'} cannot replace a newer preparation or clear its busy state`, { tag: '@timing-sensitive' }, async ({ page }) => {
  const packet = await openPacket(page), preview = packet.getByRole('button', { name: 'Preview manual complaint', exact: true });
  const old = await holdPreparation(page, fail);
  await preview.click(); await old.entered();
  await packet.locator(':scope > summary').click(); await packet.locator(':scope > summary').click();
  await expect(preview).toBeEnabled();
  const current = await holdPreparation(page);
  await preview.click(); await current.entered();
  const before = await caseWorkspaceActionStatus(page).textContent();
  await old.release();
  await expect(preview).toBeDisabled();
  expect(await caseWorkspaceActionStatus(page).textContent()).toBe(before);
  await expect(packet.getByRole('textbox', { name: /^Exact manual complaint/ })).toHaveCount(0);
  await current.release();
  await expect(packet.getByRole('textbox', { name: /^Exact manual complaint/ })).toHaveValue(/source-qualified observation/);
  await expect(caseWorkspaceActionStatus(page)).toContainText('Prepared the exact draft manual complaint preview');
});

test('closing a pending print check leaves a replacement report untouched', { tag: '@timing-sensitive' }, async ({ page }) => {
  const packet = await openPacket(page), preview = packet.getByRole('button', { name: 'Preview printable report', exact: true });
  await page.evaluate(() => { window.print = () => { (window as PacketProbe).packetOutputs.push('print'); }; });
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'packet-owner.example', exact: true });
  const held = await holdPreparation(page, false, true);
  await dialog.getByRole('button', { name: 'Print or save PDF', exact: true }).click(); await held.entered();
  await dialog.getByRole('button', { name: 'Close report', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(preview).toBeEnabled();
  await preview.click(); await expect(dialog).toBeVisible();
  await held.release();
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as PacketProbe).packetOutputs)).toEqual([]);
  await dialog.getByRole('button', { name: 'Print or save PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as PacketProbe).packetOutputs)).toEqual(['print']);
});

test('Console scope clearing cancels pending output and an initiated clipboard result cannot overwrite a later review', { tag: '@timing-sensitive' }, async ({ page }) => {
  const packet = await openPacket(page);
  const held = await holdPreparation(page);
  await packet.getByRole('button', { name: 'Export JSON draft or authorised packet', exact: true }).click(); await held.entered();
  // Exercise the real document-lifecycle handler that clears Console scope.
  // This is not a simulation of authentication or proof of a workspace lock.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await held.release();
  expect(await page.evaluate(() => (window as PacketProbe).packetOutputs)).toEqual([]);
  await expect(packet.getByRole('button', { name: 'Continue to record delivery' })).toHaveCount(0);

  await page.evaluate(() => {
    const state = window as PacketProbe & { rejectPacketCopy?: () => void };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => { state.packetOutputs.push('clipboard'); return new Promise<void>((_resolve, reject) => {
        state.rejectPacketCopy = () => reject(new Error('Earlier clipboard request failed.'));
      }); },
    } });
  });
  await packet.getByText('Other export formats', { exact: true }).click();
  await packet.getByRole('button', { name: 'Copy email draft', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as PacketProbe).packetOutputs)).toEqual(['clipboard']);
  await packet.locator(':scope > summary').click(); await packet.locator(':scope > summary').click();
  // Clipboard initiation cannot be recalled; closing must not claim it was.
  await expect(caseWorkspaceActionStatus(page)).toHaveCount(0);
  await packet.getByRole('button', { name: 'Preview manual complaint', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Prepared the exact draft manual complaint preview');
  const message = await caseWorkspaceActionStatus(page).textContent();
  await page.evaluate(async () => {
    (window as PacketProbe & { rejectPacketCopy?: () => void }).rejectPacketCopy?.();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  expect(await caseWorkspaceActionStatus(page).textContent()).toBe(message);
  await expect(packet.getByRole('button', { name: 'Refresh manual complaint preview', exact: true })).toBeEnabled();
});
