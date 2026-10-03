import { SUPPORT_COMMAND_DEFINITIONS } from './support-command-definitions.mts';
import { ASSURANCE_COMMAND_DEFINITIONS } from './assurance-command-definitions.mts';
import { COLLECTION_COMMAND_DEFINITIONS } from './collection-command-definitions.mts';
import { NETWORK_COMMAND_DEFINITIONS } from './network-command-definitions.mts';
import { REVIEW_COMMAND_DEFINITIONS } from './review-command-definitions.mts';
import { EVIDENCE_COMMAND_DEFINITIONS } from './evidence-command-definitions.mts';
import { WORKFLOW_COMMAND_DEFINITIONS } from './workflow-command-definitions.mts';
import { HISTORY_COMMAND_DEFINITIONS } from './history-command-definitions.mts';
import type { CliCommand } from '../packages/contracts/cli-command-semantics.mts';
import type { CliCommandSeed } from './command-definition.mts';

export const COMMAND_SEEDS = Object.freeze({
  ...SUPPORT_COMMAND_DEFINITIONS,
  ...ASSURANCE_COMMAND_DEFINITIONS,
  ...COLLECTION_COMMAND_DEFINITIONS,
  ...NETWORK_COMMAND_DEFINITIONS,
  ...REVIEW_COMMAND_DEFINITIONS,
  ...EVIDENCE_COMMAND_DEFINITIONS,
  ...WORKFLOW_COMMAND_DEFINITIONS,
  ...HISTORY_COMMAND_DEFINITIONS,
} satisfies Readonly<Record<CliCommand, CliCommandSeed>>);
