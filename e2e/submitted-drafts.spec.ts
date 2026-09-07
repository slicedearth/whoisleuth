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
