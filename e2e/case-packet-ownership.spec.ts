import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { caseRecord, openCaseResponseWorkspace, openSeededTimelineCase } from './case-test-fixtures';
import { caseWorkspaceActionStatus, currentActionFixture, openPacketWizardStep } from './case-response-fixtures';
import { openCaseSection, openConsoleView } from './console-navigation';

type HeldPreparation = { entered: boolean; release: () => Promise<void> };
type PacketProbe = typeof window & { heldPackets: HeldPreparation[]; packetOutputs: string[] };

async function openPacket(page: Page) {
  const now = '2000-01-03T00:00:00.000Z';
  await page.clock.setFixedTime(now);
  const record = caseRecord({ id: 'packet-owner', domain: 'packet-owner.example',
    evidencePins: [{ id: 'owner-pin', checkpointId: null, field: 'analyst_note', category: 'page', label: 'Selected observation',
      value: 'Retained fixture fact', source: 'Selected source', sourceState: 'partial', sourceSchema: null, observedAt: now,
      collectionDepth: 'deep', completeness: 'partial', truncated: false, transitionExpectation: null, limitations: [], createdAt: now }],
    actions: [currentActionFixture({ id: 'owner-action', type: 'internal_review', recipient: 'Internal review desk',
      contactSource: 'Analyst supplied', routeObservedAt: now, contactLimitations: [], dueAt: null,
      targetState: 'ready_for_review', reference: null, followUpAt: null, outcome: null, createdAt: now, updatedAt: now })] });
  await openSeededTimelineCase(page, record.domain, [record]);
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
