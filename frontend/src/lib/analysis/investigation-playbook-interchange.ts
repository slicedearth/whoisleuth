import {
  normalizeInvestigationTemplate,
  type InvestigationTemplate,
} from './investigation-template-model.ts';

export const INVESTIGATION_CACAO_SPEC_VERSION = 'cacao-2.0';
export const INVESTIGATION_CACAO_PROFILE_VERSION = 1;
export const INVESTIGATION_CACAO_PROFILE_SEMVER = '1.0.0';
export const MAX_INVESTIGATION_CACAO_IMPORT_BYTES = 384 * 1024;

const PROFILE_EXTENSION_ID = 'extension-definition--efb7c8c8-6baf-53f5-91d8-0985992f23d4';
const CREATOR_ID = 'identity--157fc6d9-f6c2-5ebf-814f-baf61eeae5cc';
const ANALYST_AGENT_ID = 'individual--c432204a-92bd-5f4d-a482-f1419194cb96';
const CACAO_ID_RE = /^(?:playbook|start|action|end)--[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_KEYS = new Set([
  'type',
  'spec_version',
  'id',
  'name',
  'description',
  'playbook_types',
  'playbook_activities',
  'created_by',
  'created',
  'modified',
  'workflow_start',
  'workflow',
  'playbook_extensions',
  'agent_definitions',
  'extension_definitions',
]);
const SAFE_START_KEYS = new Set(['type', 'name', 'on_completion']);
const SAFE_ACTION_KEYS = new Set([
  'type',
  'name',
  'description',
  'agent',
  'commands',
  'on_completion',
  'step_extensions',
]);
const SAFE_END_KEYS = new Set(['type', 'name']);
const SAFE_MANUAL_COMMAND_KEYS = new Set(['type', 'command', 'description']);

type UnknownRecord = Record<string, unknown>;

type ProfileMetadata = {
  profile_version: number;
  template_id: string;
  recipe_id: InvestigationTemplate['recipeId'];
  execution_mode: 'manual_only';
  limitations: string[];
};

type StageMetadata = {
  stage_id: string;
  workspace: string;
  expected_evidence: string;
  completion_criteria: string;
  requires_approval: boolean;
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function fnv32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableUuid(value: string): string {
  const words = [
    fnv32(value, 0x811c9dc5),
    fnv32(`1:${value}`, 0x9e3779b9),
    fnv32(`2:${value}`, 0x85ebca6b),
    fnv32(`3:${value}`, 0xc2b2ae35),
  ];
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function cacaoId(type: 'playbook' | 'start' | 'action' | 'end', seed: string): string {
  return `${type}--${stableUuid(`${type}:${seed}`)}`;
}

function timestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('The playbook timestamp is invalid.');
  return new Date(parsed).toISOString();
}

function profileExtension(value: unknown): ProfileMetadata | null {
  const item = record(value);
  if (item?.profile_version !== INVESTIGATION_CACAO_PROFILE_VERSION
    || item.execution_mode !== 'manual_only'
    || typeof item.template_id !== 'string'
    || typeof item.recipe_id !== 'string'
    || !Array.isArray(item.limitations)) return null;
  return {
    profile_version: INVESTIGATION_CACAO_PROFILE_VERSION,
    template_id: item.template_id,
    recipe_id: item.recipe_id as InvestigationTemplate['recipeId'],
    execution_mode: 'manual_only',
    limitations: item.limitations.filter((entry): entry is string => typeof entry === 'string').slice(0, 6),
  };
}

function stageExtension(value: unknown): StageMetadata | null {
  const item = record(value);
  if (typeof item?.stage_id !== 'string'
    || typeof item.workspace !== 'string'
    || typeof item.expected_evidence !== 'string'
    || typeof item.completion_criteria !== 'string'
    || typeof item.requires_approval !== 'boolean') return null;
  return {
    stage_id: item.stage_id,
    workspace: item.workspace,
    expected_evidence: item.expected_evidence,
    completion_criteria: item.completion_criteria,
    requires_approval: item.requires_approval,
  };
}

function requireOnlyKeys(value: UnknownRecord, allowlist: ReadonlySet<string>, label: string): void {
  const unsupported = Object.keys(value).find((key) => !allowlist.has(key));
  if (unsupported) throw new Error(`Unsupported ${label} property: ${unsupported}.`);
}

export function buildCacaoInvestigationPlaybook(
  raw: unknown,
  _generatedAt = new Date().toISOString(),
): UnknownRecord {
  const template = normalizeInvestigationTemplate(raw);
  if (!template) throw new Error('A valid investigation template is required.');
  const created = timestamp(template.createdAt);
  const modified = timestamp(template.updatedAt);
  const playbookId = cacaoId('playbook', template.id);
  const startId = cacaoId('start', template.id);
  const endId = cacaoId('end', template.id);
  const actionIds = template.stages.map((stage) => cacaoId('action', `${template.id}:${stage.id}`));
  const workflow: UnknownRecord = {
    [startId]: {
      type: 'start',
      name: 'Start reviewed investigation',
      on_completion: actionIds[0],
    },
  };
  for (const [index, stage] of template.stages.entries()) {
    workflow[actionIds[index] as string] = {
      type: 'action',
      name: stage.label,
      description: stage.detail,
      agent: ANALYST_AGENT_ID,
      commands: [{
        type: 'manual',
        command: stage.instructions.join('\n'),
        description: 'Analyst-reviewed instructions. Importing this playbook never executes the command.',
      }],
      on_completion: actionIds[index + 1] ?? endId,
      step_extensions: {
        [PROFILE_EXTENSION_ID]: {
          stage_id: stage.id,
          workspace: stage.workspace,
          expected_evidence: stage.expectedEvidence,
          completion_criteria: stage.completionCriteria,
          requires_approval: stage.requiresApproval,
        },
      },
    };
  }
  workflow[endId] = {
    type: 'end',
    name: 'End reviewed investigation',
  };
  const playbook = {
    type: 'playbook',
    spec_version: INVESTIGATION_CACAO_SPEC_VERSION,
    id: playbookId,
    name: template.label,
    description: template.summary,
    playbook_types: ['investigation'],
    playbook_activities: ['identify-indicators'],
    created_by: CREATOR_ID,
    created,
    modified: modified < created ? created : modified,
    workflow_start: startId,
    workflow,
    playbook_extensions: {
      [PROFILE_EXTENSION_ID]: {
        profile_version: INVESTIGATION_CACAO_PROFILE_VERSION,
        template_id: template.id,
        recipe_id: template.recipeId,
        execution_mode: 'manual_only',
        limitations: [
          'This profile contains manual analyst guidance only.',
          'Import does not execute commands, start collection, submit evidence, or change a case.',
          'Only allowlisted WHOISleuth stages survive import; mandatory approval gates cannot be removed.',
        ],
      },
    },
    agent_definitions: {
      [ANALYST_AGENT_ID]: {
        type: 'individual',
        name: 'Human analyst',
        description: 'A person explicitly reviews each step and starts any bounded WHOISleuth action.',
      },
    },
    extension_definitions: {
      [PROFILE_EXTENSION_ID]: {
        type: 'extension-definition',
        name: 'WHOISleuth restricted investigation profile',
        description: 'Maps allowlisted manual investigation stages without adding executable operations.',
        created_by: CREATOR_ID,
        schema: 'WHOISleuth profile v1: template and stage identifiers, workspace, expected evidence, completion criteria, approval requirement, and manual-only limitations.',
        version: INVESTIGATION_CACAO_PROFILE_SEMVER,
      },
    },
  };
  if (encodedBytes(playbook) > MAX_INVESTIGATION_CACAO_IMPORT_BYTES) {
    throw new Error('The restricted CACAO playbook exceeds the 384 KiB limit.');
  }
  return playbook;
}

export function parseCacaoInvestigationPlaybook(raw: unknown): InvestigationTemplate {
  if (encodedBytes(raw) > MAX_INVESTIGATION_CACAO_IMPORT_BYTES) {
    throw new Error('Restricted CACAO playbook imports are limited to 384 KiB.');
  }
  const playbook = record(raw);
  if (!playbook
    || playbook.type !== 'playbook'
    || playbook.spec_version !== INVESTIGATION_CACAO_SPEC_VERSION
    || typeof playbook.id !== 'string'
    || !CACAO_ID_RE.test(playbook.id)) {
    throw new Error('Expected a CACAO 2.0 playbook with a valid playbook identifier.');
  }
  for (const key of Object.keys(playbook)) {
    if (!SAFE_KEYS.has(key)) throw new Error(`Unsupported CACAO property: ${key}.`);
  }
  const definition = record(record(playbook.extension_definitions)?.[PROFILE_EXTENSION_ID]);
  if (definition?.type !== 'extension-definition'
    || definition.version !== INVESTIGATION_CACAO_PROFILE_SEMVER) {
    throw new Error('The playbook does not declare the supported restricted investigation profile.');
  }
  const profile = profileExtension(record(playbook.playbook_extensions)?.[PROFILE_EXTENSION_ID]);
  if (!profile) throw new Error('The restricted investigation profile metadata is missing or invalid.');
  const agents = record(playbook.agent_definitions);
  const agent = record(agents?.[ANALYST_AGENT_ID]);
  if (!agents || Object.keys(agents).length !== 1 || agent?.type !== 'individual') {
    throw new Error('The restricted playbook requires one human analyst agent.');
  }
  const workflow = record(playbook.workflow);
  const startId = typeof playbook.workflow_start === 'string' ? playbook.workflow_start : '';
  const start = workflow ? record(workflow[startId]) : null;
  if (!workflow || !CACAO_ID_RE.test(startId) || start?.type !== 'start') {
    throw new Error('The restricted playbook requires one valid start step.');
  }
  requireOnlyKeys(start, SAFE_START_KEYS, 'start-step');
  const stages: UnknownRecord[] = [];
  const visited = new Set<string>([startId]);
  let nextId = typeof start.on_completion === 'string' ? start.on_completion : '';
  while (nextId) {
    if (!CACAO_ID_RE.test(nextId) || visited.has(nextId)) {
      throw new Error('The restricted playbook workflow must be linear and acyclic.');
    }
    visited.add(nextId);
    const step = record(workflow[nextId]);
    if (!step) throw new Error('The restricted playbook references a missing workflow step.');
    if (step.type === 'end') {
      requireOnlyKeys(step, SAFE_END_KEYS, 'end-step');
      nextId = '';
      break;
    }
    if (step.type !== 'action'
      || step.agent !== ANALYST_AGENT_ID
      || !Array.isArray(step.commands)
      || step.commands.length !== 1) {
      throw new Error('Only single-command manual analyst action steps are supported.');
    }
    requireOnlyKeys(step, SAFE_ACTION_KEYS, 'action-step');
    const command = record(step.commands[0]);
    if (command?.type !== 'manual' || typeof command.command !== 'string') {
      throw new Error('Executable or encoded CACAO commands are not supported.');
    }
    requireOnlyKeys(command, SAFE_MANUAL_COMMAND_KEYS, 'manual-command');
    const metadata = stageExtension(record(step.step_extensions)?.[PROFILE_EXTENSION_ID]);
    if (!metadata) throw new Error('A workflow action is missing its allowlisted stage metadata.');
    stages.push({
      id: metadata.stage_id,
      label: step.name,
      detail: step.description,
      expectedEvidence: metadata.expected_evidence,
      completionCriteria: metadata.completion_criteria,
      instructions: command.command.split(/\r?\n/u).filter(Boolean),
      requiresApproval: metadata.requires_approval,
    });
    nextId = typeof step.on_completion === 'string' ? step.on_completion : '';
  }
  if (!stages.length || visited.size !== Object.keys(workflow).length) {
    throw new Error('The restricted playbook must contain one connected linear workflow.');
  }
  const normalized = normalizeInvestigationTemplate({
    id: profile.template_id,
    label: playbook.name,
    summary: playbook.description,
    recipeId: profile.recipe_id,
    stages,
    createdAt: playbook.created,
    updatedAt: playbook.modified,
  });
  if (!normalized) {
    throw new Error('The playbook does not map to a valid allowlisted investigation template.');
  }
  return normalized;
}
