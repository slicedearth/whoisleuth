export const CLI_INVESTIGATION_RUN_SCHEMA = 'whoisleuth.cli.investigation-run';
export const CLI_INVESTIGATION_RUN_VERSION = 3;
export const SUPPORTED_CLI_INVESTIGATION_RUN_VERSIONS = Object.freeze([1, 2, 3] as const);
export const MAX_INVESTIGATION_RUN_BYTES = 24 * 1024 * 1024;
export const MAX_INVESTIGATION_RUN_SELECTIONS = 16;
export const MAX_INVESTIGATION_RUN_SELECTION_LENGTH = 1_024;

// Version 3 retains partial observations without authorising their recollection.
// Earlier readers must reject these checkpoints rather than retry a partial step.
export const INVESTIGATION_RUN_STATES = Object.freeze([
  'complete',
  'partial',
  'awaiting_network_approval',
  'awaiting_analyst_selection',
  'step_failed',
] as const);
export type InvestigationRunState = typeof INVESTIGATION_RUN_STATES[number];
