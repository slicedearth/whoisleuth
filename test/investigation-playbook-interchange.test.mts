import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVESTIGATION_CACAO_PROFILE_VERSION,
  INVESTIGATION_CACAO_SPEC_VERSION,
  MAX_INVESTIGATION_CACAO_IMPORT_BYTES,
  buildCacaoInvestigationPlaybook,
  parseCacaoInvestigationPlaybook,
} from '../frontend/src/lib/analysis/investigation-playbook-interchange.ts';

const CREATED_AT = '2026-07-31T01:00:00.000Z';
const UPDATED_AT = '2026-07-31T02:00:00.000Z';

function template() {
  return {
    id: 'supplier-review',
    label: 'Supplier review',
    summary: 'Review a bounded domain with an explicit analyst gate.',
    recipeId: 'new_domain_triage',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    stages: [
      {
        id: 'lookup',
        label: 'Collect domain evidence',
        detail: 'Collect separately attributed evidence.',
        expectedEvidence: 'Authority-aware registration and supported network observations.',
        completionCriteria: 'Source states and limitations were reviewed.',
        instructions: ['Confirm the domain is in scope.', 'Start a Deep lookup explicitly.'],
        requiresApproval: false,
      },
      {
        id: 'monitor',
        label: 'Record disposition',
        detail: 'Record a reviewed analyst decision.',
        expectedEvidence: 'A bounded case decision.',
        completionCriteria: 'The decision and its evidence limitations are retained.',
        instructions: ['Open the case.', 'Record only evidence-supported conclusions.'],
        requiresApproval: false,
      },
    ],
  };
}

function clonedPlaybook(): Record<string, unknown> {
  return structuredClone(buildCacaoInvestigationPlaybook(template(), UPDATED_AT));
}

test('exports a bounded manual CACAO 2.0 profile and round-trips allowlisted stages', () => {
  const playbook = buildCacaoInvestigationPlaybook(template(), UPDATED_AT);
  assert.equal(playbook.type, 'playbook');
  assert.equal(playbook.spec_version, INVESTIGATION_CACAO_SPEC_VERSION);
  assert.match(String(playbook.id), /^playbook--/u);
  assert.equal(
    JSON.stringify(playbook).includes(`"profile_version":${INVESTIGATION_CACAO_PROFILE_VERSION}`),
    true,
  );
  assert.equal(JSON.stringify(playbook).includes('"type":"manual"'), true);
  assert.equal(JSON.stringify(playbook).includes('"type":"bash"'), false);
  assert.ok(new TextEncoder().encode(JSON.stringify(playbook)).byteLength < MAX_INVESTIGATION_CACAO_IMPORT_BYTES);

  const imported = parseCacaoInvestigationPlaybook(playbook);
  assert.equal(imported.id, 'supplier-review');
  assert.equal(imported.recipeId, 'new_domain_triage');
  assert.deepEqual(imported.stages.map((stage) => stage.id), ['lookup', 'monitor']);
  assert.equal(imported.stages[0]?.requiresApproval, true);
  assert.equal(imported.stages[0]?.path, '/lookup');
  assert.equal(imported.stages[1]?.workspace, 'monitor');
});

test('rejects executable commands, branching, disconnected steps, and extra capabilities', () => {
  const executable = clonedPlaybook();
  const workflow = executable.workflow as Record<string, Record<string, unknown>>;
  const action = Object.values(workflow).find((step) => step.type === 'action');
  assert.ok(action);
  action.commands = [{ type: 'bash', command: 'exit 0' }];
  assert.throws(() => parseCacaoInvestigationPlaybook(executable), /Executable or encoded/u);

  const branching = clonedPlaybook();
  const branchingWorkflow = branching.workflow as Record<string, Record<string, unknown>>;
  const branchingAction = Object.values(branchingWorkflow).find((step) => step.type === 'action');
  assert.ok(branchingAction);
  branchingAction.on_success = branchingAction.on_completion;
  assert.throws(() => parseCacaoInvestigationPlaybook(branching), /Unsupported action-step property|linear/u);

  const disconnected = clonedPlaybook();
  const disconnectedWorkflow = disconnected.workflow as Record<string, Record<string, unknown>>;
  disconnectedWorkflow['action--11111111-1111-5111-a111-111111111111'] = {
    type: 'action',
    agent: 'individual--c432204a-92bd-5f4d-a482-f1419194cb96',
    commands: [{ type: 'manual', command: 'Hidden step' }],
  };
  assert.throws(() => parseCacaoInvestigationPlaybook(disconnected), /connected linear workflow/u);

  const targeted = clonedPlaybook();
  targeted.target_definitions = {};
  assert.throws(() => parseCacaoInvestigationPlaybook(targeted), /Unsupported CACAO property/u);
});

test('rejects missing profile metadata, cycles, and oversized input before normalization', () => {
  const missingProfile = clonedPlaybook();
  missingProfile.playbook_extensions = {};
  assert.throws(() => parseCacaoInvestigationPlaybook(missingProfile), /profile metadata/u);

  const cyclic = clonedPlaybook();
  const workflow = cyclic.workflow as Record<string, Record<string, unknown>>;
  const startId = String(cyclic.workflow_start);
  const firstActionId = String(workflow[startId]?.on_completion);
  workflow[firstActionId]!.on_completion = firstActionId;
  assert.throws(() => parseCacaoInvestigationPlaybook(cyclic), /linear and acyclic/u);

  assert.throws(() => parseCacaoInvestigationPlaybook({
    ...clonedPlaybook(),
    description: 'x'.repeat(MAX_INVESTIGATION_CACAO_IMPORT_BYTES),
  }), /limited to 384 KiB/u);
});
