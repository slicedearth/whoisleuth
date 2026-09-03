import type { CliCommand } from './command-reference.mts';

const SUPPORT_INLINE_COMMANDS = Object.freeze([
  'completion',
  'commands',
  'manual',
  'doctor',
  'registry-support',
  'registry-doctor',
  'registry-cohort',
  'registry-scaffold',
  'risk-calibrate',
  'lookalike-calibrate',
] as const satisfies readonly CliCommand[]);

const REVIEW_INLINE_COMMANDS = Object.freeze([
  'verify-artifact',
  'interchange-report',
  'source-report',
  'compare',
  'page-compare',
  'mail-review',
  'review-evidence',
  'brief',
  'case-pack',
] as const satisfies readonly CliCommand[]);

const ASSURANCE_INLINE_COMMANDS = Object.freeze([
  'manifest',
  'map-observations',
  'oam-export',
  'domain-control',
  'assurance',
  'change-packet',
  'sharing-review',
  'ct-intake',
] as const satisfies readonly CliCommand[]);

const WORKFLOW_INLINE_COMMANDS = Object.freeze([
  'monitor-once',
  'workflow-plan',
  'workflow-run',
] as const satisfies readonly CliCommand[]);

const HISTORY_INLINE_COMMANDS = Object.freeze([
  'diff',
  'reconcile',
  'timeline',
  'export',
] as const satisfies readonly CliCommand[]);

export {
  ASSURANCE_INLINE_COMMANDS,
  HISTORY_INLINE_COMMANDS,
  REVIEW_INLINE_COMMANDS,
  SUPPORT_INLINE_COMMANDS,
  WORKFLOW_INLINE_COMMANDS,
};
