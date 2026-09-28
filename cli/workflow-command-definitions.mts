import { INVESTIGATION_PLAN_RECIPES, RUNNABLE_INVESTIGATION_PLAN_RECIPES } from './investigation-recipes.mts';
import { positional, OPTIONAL_FILE_POSITIONAL, constraint, commandSeed, integer, BASE_INTEGER_RANGE, file } from './command-definition.mts';

export const WORKFLOW_COMMAND_DEFINITIONS = Object.freeze({
  "monitor-once": commandSeed({
    reference: {
      description: 'Collect one bounded owned-domain review and compare it with an optional prior checkpoint.',
      example: 'whoisleuth monitor-once manifest.json --previous previous.json --json --output next.json',
      boundary: 'This is an operator-scheduled one-shot collection, not a daemon. It caps targets and concurrency, retains normalised observations, and never changes domain configuration.',
    },
    collection: { mode: 'network', scope: 'Runs deep collection for at most 20 manifest domains with concurrency capped at 3.' },
    summary: 'Run one bounded domain control review',
    options: ['--previous', '--limit', '--concurrency', '--fail-on', '--json', '--junit', '--quiet', '--no-color'],
    optionOverrides: {
      '--concurrency': integer('Set the maximum number of concurrent collection tasks.',
        () => Object.freeze([BASE_INTEGER_RANGE(1, 3)]), () => 2),
    },
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--junit'] }),
  ]),
    handlerOwner: 'workflow',
    networkEffect: 'always_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.domain-control-monitor', 'whoisleuth.domain-control-flight-recorder.input']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "workflow-plan": commandSeed({
    reference: {
      description: 'Build a fixed domain-investigation plan from existing bounded CLI commands.',
      example: 'whoisleuth workflow-plan domain-triage example.test --json',
      boundary: 'Planning is offline and plan-only. It does not execute commands, expand placeholders, read files, make requests, or submit evidence.',
    },
    collection: { mode: 'offline', scope: 'Builds a fixed typed recipe and executes none of its network or file steps.' },
    summary: 'Plan a fixed investigation recipe',
    options: ['--list', '--explain', '--json', '--quiet', '--no-color'],
    positionals: Object.freeze([
    positional('recipe', 'enum', 0, 1, INVESTIGATION_PLAN_RECIPES),
    positional('subject', 'text', 0, 1),
  ]),
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--list', '--explain'] }),
  ]),
    handlerOwner: 'workflow',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.investigation-plan', 'whoisleuth.cli.workflow-recipe-catalogue']),
    primaryArtefacts: Object.freeze(['Plan-only workflow document']),
    planSupport: true,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "workflow-run": commandSeed({
    reference: {
      description: 'Execute approved steps from a fixed investigation recipe and emit a resumable checkpoint.',
      example: 'whoisleuth workflow-run domain-triage example.test --approve-network --json --output run.json',
      boundary: '--preview validates the checkpoint and shows retained outputs, unresolved inputs and remaining approvals without executing or writing. It cannot be combined with approval, interactive, quiet or output-file flags. Only installed recipe commands can run. Network steps require explicit approval for each invocation. New runs connect compatible earlier outputs using the recipe defaults. Use --use-artifact <step-id>:<input-number>=<earlier-step-id> to override a connection; input numbers start at 1. Repeat --select for remaining placeholders in order, or supply every input for a step to replace its connections with files. Values stay literal and cannot start with a hyphen or invoke a shell. Optional --interactive prompts on terminal stderr for missing inputs; a blank answer pauses. It grants neither network approval nor human-review confirmation. A step declaring human review still requires --confirm-review <step-id> for that invocation. Checkpoints do not grant later approvals. Resumes preserve recorded connections. Content digests identify retained output, not authenticity or freshness. Partial collections pause for review and are not recollected on resume; failed validation or export steps remain retryable. Diagnostics go to stderr. File output holds exclusive adjacent locks and refuses concurrently changed state files.',
    },
    collection: { mode: 'network', scope: 'Runs only fixed-recipe steps; network collection requires --approve-network and unresolved analyst selections pause.' },
    summary: 'Execute approved fixed-recipe steps',
    options: ['--select', '--use-artifact', '--confirm-review', '--approve-network', '--resume', '--interactive', '--preview', '--json', '--quiet', '--no-color'],
    optionOverrides: { '--resume': file('Resume the selected workflow checkpoint; approvals must be supplied again.') },
    positionals: Object.freeze([
    positional('recipe', 'enum', 1, 1, RUNNABLE_INVESTIGATION_PLAN_RECIPES),
    positional('subject', 'text', 1, 1),
  ]),
    constraints: Object.freeze([constraint({ kind: 'excludes_all', option: '--preview', excludedOptions: ['--approve-network', '--confirm-review', '--interactive', '--output', '--force', '--quiet'] })]),
    handlerOwner: 'workflow',
    networkEffect: 'conditional_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.investigation-run', 'whoisleuth.cli.investigation-preview']),
    primaryArtefacts: Object.freeze(['Resumable workflow state', 'Offline resume preview']),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
});
