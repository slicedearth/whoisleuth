import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { openCaseResponseWorkspace } from './case-test-fixtures';

// Shared Case response fixtures and status locators.

type CurrentActionTargetState = 'ready_for_review' | 'acknowledged' | 'terminal';

function currentActionFixture(input: {
  id: string;
  type: string;
  recipient: string;
  contactSource: string;
  contactLimitations: string[];
  dueAt: string | null;
  targetState: CurrentActionTargetState;
  reference: string | null;
  followUpAt: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  const { targetState, ...material } = input;
  const states = targetState === 'ready_for_review'
    ? ['drafting', 'ready_for_review'] as const
    : targetState === 'acknowledged'
      ? ['drafting', 'ready_for_review', 'reviewed', 'authorised', 'submitted', 'acknowledged'] as const
      : ['drafting', 'ready_for_review', 'reviewed', 'authorised', 'submitted', 'terminal'] as const;
  const start = Date.parse(input.createdAt);
  const end = Date.parse(input.updatedAt);
  const providerOutcome = targetState === 'acknowledged'
    ? 'accepted_for_review'
    : targetState === 'terminal' ? 'provider_reports_resolved' : null;
  const history = states.map((nextState, index) => {
    const final = index === states.length - 1;
    const sourceClass = index === 0
      ? 'browser_local'
      : nextState === 'acknowledged' || nextState === 'terminal' ? 'provider' : 'analyst';
    return {
      id: `${input.id}-event-${index + 1}`,
      previousState: index === 0 ? null : states[index - 1]!,
      nextState,
      occurredAt: new Date(start + Math.floor((end - start) * index / (states.length - 1))).toISOString(),
      sourceClass,
      provenance: index === 0
        ? 'browser_local_fixture_action'
        : sourceClass === 'provider' ? 'provider_fixture_update' : 'analyst_fixture_transition',
      reference: final ? input.reference : null,
      evidencePinId: null,
      limitations: [],
      providerOutcome: final ? providerOutcome : null,
      outcomeDetail: final ? input.outcome : null,
      originActionId: null,
      applied: true,
    };
  });
  return {
    ...material,
    state: targetState,
    providerOutcome,
    originActionId: null,
    history,
    historyOmitted: 0,
    historyLimitations: [],
    metadataUpdatedAt: input.updatedAt,
  };
}

async function addFixtureCasePin(page: Page, label: string): Promise<void> {
  const workspace = await openCaseResponseWorkspace(page);
  const pin = workspace.locator('details', { hasText: 'Pin an observed fact' });
  await pin.getByText('Pin an observed fact', { exact: true }).click();
  await pin.getByLabel('Label').fill(label);
  await pin.getByLabel('Source').fill('Fixture evidence');
  await pin.getByLabel('Fact').fill('A bounded fixture fact for branch recovery testing.');
  await pin.getByRole('button', { name: 'Pin evidence' }).click();
  await expect(workspace).toContainText(label);
}

async function openPacketWizardStep(
  packet: import('@playwright/test').Locator,
  name: string,
): Promise<void> {
  const button = packet.getByRole('navigation', { name: 'Response-packet handoff steps' })
    .getByRole('button', { name: new RegExp(name, 'iu') });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'step');
}

function caseWorkspaceActionStatus(page: Page) {
  return page
    .getByRole('region', { name: 'Case workspace controls' })
    .getByRole('status', { name: 'Case workspace action status' });
}

function operationsReportActionStatus(page: Page, text: string) {
  return page
    .locator('.operations-report')
    .getByRole('status')
    .filter({ hasText: text });
}

function reviewInboxActionStatus(page: Page, text: string) {
  return page
    .locator('#monitor-view-panel')
    .getByRole('status')
    .filter({ hasText: text });
}

export {
  addFixtureCasePin,
  caseWorkspaceActionStatus,
  currentActionFixture,
  openPacketWizardStep,
  operationsReportActionStatus,
  reviewInboxActionStatus,
};
