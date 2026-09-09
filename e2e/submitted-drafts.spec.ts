import { expect, test } from './fixtures';
import { caseRecord } from './case-test-fixtures';
import {
  currentBrowserLocalDocument,
  holdBrowserLocalTransaction,
  migrateLegacyBrowserData,
  openDashboardSecondaryWorkspaces,
  readBrowserLocalCollection,
} from './helpers';

test('campaign creation and membership retain later drafts while a write is pending', async ({ page }) => {
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [
      caseRecord({ id: 'member-a', domain: 'member-a.example' }),
      caseRecord({ id: 'member-b', domain: 'member-b.example' }),
    ] }),
  }, { destination: '/monitor?view=campaigns' });
  const name = page.getByRole('textbox', { name: 'New campaign', exact: true });
  await name.fill('Submitted campaign');
  const releaseCreation = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeDisabled();
    await name.fill('Later campaign draft');
  } finally {
    await releaseCreation();
  }
  await expect(page.getByRole('status')).toContainText('Created campaign “Submitted campaign”');
  await expect(name).toHaveValue('Later campaign draft');
  await page.getByRole('button', { name: 'Submitted campaign 0 cases', exact: true }).click();
  const membership = page.getByRole('combobox', { name: 'Add an existing case', exact: true });
  await membership.selectOption('member-a.example');
  const releaseMembership = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Add case', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add case', exact: true })).toBeDisabled();
    await membership.selectOption('member-b.example');
  } finally {
    await releaseMembership();
  }
  await expect(page.getByRole('status')).toContainText('Added member-a.example');
  await expect(membership).toHaveValue('member-b.example');
  const saved = await readBrowserLocalCollection(page, 'campaigns', { minimumRecords: 1 });
  expect(saved.records.map((entry) => entry.value)).toMatchObject([
    { name: 'Submitted campaign', domains: ['member-a.example'] },
  ]);
  expect(saved.records).toHaveLength(1);
});

test('template saving keeps a later form revision open', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', {
      cases: [caseRecord({ id: 'template-context', domain: 'template-context.example' })],
    }),
  });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByRole('button', { name: 'New template', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Template name', exact: true });
  await name.fill('Submitted template');
  const release = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save template', exact: true })).toBeDisabled();
    await name.fill('Later template draft');
  } finally {
    await release();
  }
  await expect(page.getByRole('status')).toContainText('Saved the Submitted template template.');
  await expect(name).toHaveValue('Later template draft');
  await expect(page.getByRole('button', { name: 'Save template', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 700 });
  const cancel = page.getByRole('region', { name: 'Investigation templates', exact: true }).getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeVisible();
  expect(await cancel.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    return range.getClientRects().length;
  })).toBe(1);
  await page.setViewportSize({ width: 1024, height: 768 });
  const create = page.getByRole('button', { name: 'New template', exact: true });
  await expect(create).toBeVisible();
  const inset = await create.evaluate((element) => {
    const card = element.closest('.card');
    if (!card) throw new Error('The template controls have no containing card.');
    return card.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(card).paddingRight) - element.getBoundingClientRect().right;
  });
  expect(inset).toBeGreaterThanOrEqual(-1);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved the Later template draft template.');
  const stored = await readBrowserLocalCollection(page, 'investigation_templates', { minimumRecords: 1 });
  expect(stored.records).toHaveLength(1);
  expect(stored.records[0]?.value.label).toBe('Later template draft');
  await expect(page.locator('.template-list').getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
});

test('a new template draft cannot overwrite an already persisted identity', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [caseRecord({ id: 'new-template-owner', domain: 'template-owner.example' })] }),
  });
  await openDashboardSecondaryWorkspaces(page);
  const manager = page.getByRole('region', { name: 'Investigation templates', exact: true });
  await manager.getByRole('button', { name: 'New template', exact: true }).click();
  await manager.getByRole('textbox', { name: 'Template name', exact: true }).fill('Persisted template');
  await manager.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText('Saved the Persisted template template.');
  const before = (await readBrowserLocalCollection(page, 'investigation_templates', { minimumRecords: 1 })).records[0]?.value;
  expect(before?.id).toEqual(expect.any(String));
  await page.evaluate((id) => {
    const original = crypto.randomUUID.bind(crypto);
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original });
      return id;
    } });
  }, before?.id);
  await manager.getByRole('button', { name: 'New template', exact: true }).click();
  await manager.getByRole('textbox', { name: 'Template name', exact: true }).fill('Unconfirmed new draft');
  await manager.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText('investigation template changed or was deleted');
  await manager.getByRole('button', { name: 'Refresh saved templates', exact: true }).click();
  await manager.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText('investigation template changed or was deleted');
  await expect(manager.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue('Unconfirmed new draft');
  const after = await readBrowserLocalCollection(page, 'investigation_templates', { minimumRecords: 1 });
  expect(after.records).toHaveLength(1);
  expect(after.records[0]?.value).toEqual(before);
});

test('campaign detail drafts reject same-clock peer edits but preserve unrelated membership changes', async ({ page, context }) => {
  await page.clock.setFixedTime('2026-09-08T00:00:00.000Z');
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [caseRecord({ id: 'shared-member', domain: 'shared-member.example' })] }),
  }, { destination: '/monitor?view=campaigns' });
  await page.getByRole('textbox', { name: 'New campaign', exact: true }).fill('Shared campaign');
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  const editor = page.locator('.campaign-edit');
  await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('Local details');
  await page.getByRole('combobox', { name: 'Add an existing case', exact: true }).selectOption('shared-member.example');
  await page.getByRole('button', { name: 'Add case', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Added shared-member.example');
  await expect(page.getByRole('button', { name: 'Shared campaign 1 case', exact: true })).toBeFocused();
  await editor.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Updated campaign “Local details”');
  const original = (await readBrowserLocalCollection(page, 'campaigns', { minimumRecords: 1 })).records[0]?.value;
  expect(original?.id).toEqual(expect.any(String));
  expect(original?.domains).toEqual(['shared-member.example']);
  await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('Unsaved local draft');
  const other = await context.newPage();
  try {
    await other.clock.setFixedTime('2026-09-08T00:00:00.000Z');
    await other.goto('/monitor?view=campaigns');
    await other.getByRole('button', { name: 'Local details 1 case', exact: true }).click();
    await other.locator('.campaign-edit').getByRole('textbox', { name: 'Name', exact: true }).fill('Peer details');
    await other.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Updated campaign “Peer details”');
    await editor.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('campaign changed or was deleted');
    await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unsaved local draft');
    const stored = (await readBrowserLocalCollection(page, 'campaigns', { minimumRecords: 1 })).records[0]?.value;
    expect(stored).toMatchObject({ name: 'Peer details', domains: ['shared-member.example'], updatedAt: original?.updatedAt });
    await page.getByRole('button', { name: 'Refresh campaigns', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Refreshed campaigns');
    await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unsaved local draft');
    const heading = page.getByRole('button', { name: 'Peer details 1 case', exact: true });
    await heading.click();
    await heading.click();
    await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Peer details');
    await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('Recovered investigation draft');
    other.once('dialog', (dialog) => dialog.accept());
    await other.getByRole('button', { name: 'Delete campaign', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Deleted campaign “Peer details”');
    await editor.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('campaign changed or was deleted');
    await page.getByRole('button', { name: 'Refresh campaigns', exact: true }).click();
    const orphaned = page.getByRole('region', { name: 'Unsaved campaign draft', exact: true });
    await expect(orphaned.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Recovered investigation draft');
    expect((await readBrowserLocalCollection(page, 'campaigns')).records).toHaveLength(0);
    await orphaned.getByRole('button', { name: 'Save as new campaign', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Created campaign “Recovered investigation draft” from the retained draft');
    const recovered = await readBrowserLocalCollection(page, 'campaigns', { minimumRecords: 1 });
    expect(recovered.records).toHaveLength(1);
    expect(recovered.records[0]?.value.id).not.toBe(original?.id);
    expect(recovered.records[0]?.value.domains).toEqual([]);
    expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]?.value.domain).toBe('shared-member.example');
  } finally { await other.close(); }
});

test('template edits preserve drafts across conflicts and cannot recreate a peer-deleted template', async ({ page, context }) => {
  await page.clock.setFixedTime('2026-09-08T00:00:00.000Z');
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [caseRecord({ id: 'shared-template-case', domain: 'shared-template.example' })] }),
  });
  await openDashboardSecondaryWorkspaces(page);
  const manager = page.getByRole('region', { name: 'Investigation templates', exact: true });
  await manager.getByRole('button', { name: 'New template', exact: true }).click();
  await manager.getByRole('textbox', { name: 'Template name', exact: true }).fill('Shared template');
  await manager.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText('Saved the Shared template template.');
  await manager.getByRole('button', { name: 'Edit', exact: true }).click();
  await manager.getByRole('textbox', { name: 'Template name', exact: true }).fill('Unsaved template draft');
  const original = (await readBrowserLocalCollection(page, 'investigation_templates', { minimumRecords: 1 })).records[0]?.value;
  expect(original?.id).toEqual(expect.any(String));
  const other = await context.newPage();
  try {
    await other.clock.setFixedTime('2026-09-08T00:00:00.000Z');
    await other.goto('/dashboard');
    await openDashboardSecondaryWorkspaces(other);
    const peer = other.getByRole('region', { name: 'Investigation templates', exact: true });
    await peer.getByRole('button', { name: 'Edit', exact: true }).click();
    await peer.getByRole('textbox', { name: 'Template name', exact: true }).fill('Peer template');
    await peer.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(peer.getByRole('status')).toContainText('Saved the Peer template template.');
    await manager.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(manager.getByRole('status')).toContainText('investigation template changed or was deleted');
    await expect(manager.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue('Unsaved template draft');
    expect((await readBrowserLocalCollection(page, 'investigation_templates', { minimumRecords: 1 })).records[0]?.value).toMatchObject({ label: 'Peer template', updatedAt: original?.updatedAt });
    await manager.getByRole('button', { name: 'Refresh saved templates', exact: true }).click();
    await expect(manager.getByRole('status')).toContainText('Refreshed saved templates');
    await expect(manager.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue('Unsaved template draft');
    await manager.getByRole('button', { name: 'Edit', exact: true }).click();
    await manager.getByRole('textbox', { name: 'Template name', exact: true }).fill('Draft after peer deletion');
    other.once('dialog', (dialog) => dialog.accept());
    await peer.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(peer.getByRole('status')).toContainText('Deleted the Peer template template.');
    await manager.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(manager.getByRole('status')).toContainText('investigation template changed or was deleted');
    await expect(manager.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue('Draft after peer deletion');
    expect((await readBrowserLocalCollection(page, 'investigation_templates')).records).toHaveLength(0);
    await manager.getByRole('button', { name: 'Refresh saved templates', exact: true }).click();
    await expect(manager.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue('Draft after peer deletion');
    await manager.getByRole('button', { name: 'Save as new template', exact: true }).click();
    await expect(manager.getByRole('status')).toContainText('Saved the Draft after peer deletion template.');
    const recovered = await readBrowserLocalCollection(page, 'investigation_templates', { minimumRecords: 1 });
    expect(recovered.records).toHaveLength(1);
    expect(recovered.records[0]?.value.id).not.toBe(original?.id);
    expect(recovered.records[0]?.value.label).toBe('Draft after peer deletion');
  } finally { await other.close(); }
});

test('campaign deletion retains typing performed after the delete was submitted', async ({ page }) => {
  await page.goto('/monitor?view=campaigns');
  await page.getByRole('textbox', { name: 'New campaign', exact: true }).fill('Deleted campaign');
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Created campaign “Deleted campaign”');
  await expect(page.getByRole('button', { name: 'Delete campaign', exact: true })).toBeEnabled();
  const release = await holdBrowserLocalTransaction(page);
  try {
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete campaign', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete campaign', exact: true })).toBeDisabled();
    await page.locator('.campaign-edit').getByRole('textbox', { name: 'Description', exact: false }).fill('A later draft that has not been saved');
    await page.locator('.campaign-edit').getByRole('textbox', { name: 'Description', exact: false }).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 7, 'backward'));
  } finally { await release(); }
  await expect(page.getByRole('status')).toContainText('Deleted campaign “Deleted campaign”');
  const orphaned = page.getByRole('region', { name: 'Unsaved campaign draft', exact: true });
  await expect(orphaned.getByRole('textbox', { name: 'Description', exact: false })).toHaveValue('A later draft that has not been saved');
  await expect(orphaned.getByRole('textbox', { name: 'Description', exact: false })).toBeFocused();
  expect(await orphaned.getByRole('textbox', { name: 'Description', exact: false }).evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd, element.selectionDirection])).toEqual([2, 7, 'backward']);
  await expect(orphaned.getByRole('button', { name: 'Save as new campaign', exact: true })).toBeEnabled();
  expect((await readBrowserLocalCollection(page, 'campaigns')).records).toHaveLength(0);
});

test('template deletion retains typing performed after the delete was submitted', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [caseRecord({ id: 'deleted-template-context', domain: 'deleted-template.example' })] }),
  });
  await openDashboardSecondaryWorkspaces(page);
  const manager = page.getByRole('region', { name: 'Investigation templates', exact: true });
  await manager.getByRole('button', { name: 'New template', exact: true }).click();
  await manager.getByRole('textbox', { name: 'Template name', exact: true }).fill('Deleted template');
  await manager.getByRole('button', { name: 'Save template', exact: true }).click();
  await manager.getByRole('button', { name: 'Edit', exact: true }).click();
  const release = await holdBrowserLocalTransaction(page);
  try {
    page.once('dialog', (dialog) => dialog.accept());
    await manager.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(manager.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    await manager.getByRole('textbox', { name: 'Template name', exact: true }).fill('A later template draft');
  } finally { await release(); }
  await expect(manager.getByRole('status')).toContainText('Deleted the Deleted template template.');
  await expect(manager.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue('A later template draft');
  await expect(manager.getByRole('button', { name: 'Save as new template', exact: true })).toBeEnabled();
  expect((await readBrowserLocalCollection(page, 'investigation_templates')).records).toHaveLength(0);
});

test('custom rules require the reviewed record for both toggles and deletion', async ({ page, context }) => {
  await page.goto('/monitor?view=rules');
  await page.locator('.rule-builder').getByRole('textbox', { name: 'Name', exact: true }).fill('Shared rule');
  await page.getByRole('button', { name: 'Create custom rule', exact: true }).click();
  const rules = page.getByRole('region', { name: 'Custom detection rules', exact: true });
  await expect(rules).toContainText('Shared rule');
  const other = await context.newPage();
  try {
    await other.goto('/monitor?view=rules');
    const peer = other.getByRole('region', { name: 'Custom detection rules', exact: true });
    await peer.getByRole('button', { name: 'Enabled', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Disabled “Shared rule”');
    await rules.getByRole('button', { name: 'Enabled', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('custom rule changed or was deleted');
    expect((await readBrowserLocalCollection(page, 'detection_rules', { minimumRecords: 1 })).records[0]?.value.enabled).toBe(false);
    await page.getByRole('button', { name: 'Refresh custom rules', exact: true }).click();
    await expect(rules.getByRole('button', { name: 'Disabled', exact: true })).toBeEnabled();
    await peer.getByRole('button', { name: 'Disabled', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Enabled “Shared rule”');
    page.once('dialog', (dialog) => dialog.accept());
    await rules.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('custom rule changed or was deleted');
    const stored = await readBrowserLocalCollection(page, 'detection_rules', { minimumRecords: 1 });
    expect(stored.records).toHaveLength(1);
    expect(stored.records[0]?.value).toMatchObject({ name: 'Shared rule', enabled: true });
  } finally { await other.close(); }
});

test('rule saving retains both later text and condition edits', async ({ page }) => {
  await page.goto('/monitor?view=rules');
  const builder = page.locator('.rule-builder');
  const name = builder.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Submitted rule');
  const release = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Create custom rule', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create custom rule', exact: true })).toBeDisabled();
    await name.fill('Later rule draft');
    await builder.getByRole('button', { name: 'Add condition', exact: true }).click();
  } finally {
    await release();
  }
  await expect(page.getByRole('status')).toContainText('Created custom rule “Submitted rule”');
  await expect(name).toHaveValue('Later rule draft');
  await expect(builder.getByRole('combobox', { name: 'Field', exact: true })).toHaveCount(2);
  const saved = page.getByRole('region', { name: 'Custom detection rules', exact: true });
  await expect(saved).toContainText('Submitted rule');
  await expect(saved).toContainText('1 condition');
  await expect(saved.locator('.rule')).toHaveCount(1);
});
