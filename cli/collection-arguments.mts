import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { type CliFailPolicy } from './fail-policy.mts';
import { commandDefaultNumber, commandDefaultText } from './command-reference.mts';
import { COLLECTION_COMMAND_DEFINITIONS } from './collection-command-definitions.mts';
import {
  terminalOptions,
  normalizedLabel,
  failPolicies,
  parseOutput,
  type TerminalOptions,
  type LookupDetail,
} from './argument-values.mts';

type LookupArguments = {
  action: 'lookup';
  query: string | null;
  output: 'terminal' | 'json' | 'markdown' | 'html' | 'junit';
  deep: boolean;
  detail: LookupDetail;
  strictExit: boolean;
  events: boolean;
  plan: boolean;
  includeAttribution: boolean;
  observerLabel: string | null;
  vantageLabel: string | null;
  exactUrl?: true;
  browse?: true;
  saveLookup?: string;
  failOn?: readonly CliFailPolicy[];
} & TerminalOptions;

type BulkArguments = {
  action: 'bulk';
  source: string | null;
  output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'csv_metadata' | 'domains' | 'queries' | 'junit';
  deep: boolean;
  concurrency: number;
  checkpoint: string | null;
  resume: boolean;
  events: boolean;
  plan: boolean;
  filter: 'all' | 'registered' | 'inconclusive' | 'errors';
  failOn?: readonly CliFailPolicy[];
} & TerminalOptions;

type DiscoverArguments = {
  action: 'discover';
  seed: string | null;
  output: 'terminal' | 'json' | 'jsonl' | 'domains';
  preset: 'common' | 'impersonation' | 'all' | 'custom';
  keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' | 'all';
  tldText: string | null;
  dictionarySource: string | null;
  familyText: string | null;
  snapshotSource: string | null;
} & TerminalOptions;

type DiscoverScanArguments = {
  action: 'discover-scan';
  seed: string | null;
  output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'csv_metadata' | 'domains';
  preset: 'common' | 'impersonation' | 'all' | 'custom';
  keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' | 'all';
  tldText: string | null;
  dictionarySource: string | null;
  familyText: string | null;
  deep: boolean;
  scanLimit: number;
  chunkSize: number;
  concurrency: number;
  checkpoint: string | null;
  resume: boolean;
  resolverText: string | null;
  observationSnapshot: string | null;
  allowlistSource: string | null;
  filter: 'all' | 'registered' | 'inconclusive' | 'acquisition' | 'suppressed';
  events: boolean;
  plan: boolean;
  failOn?: readonly CliFailPolicy[];
} & TerminalOptions;

function parseLookupArguments(parsed: ParsedCommandArguments<LookupArguments['action']>): LookupArguments {
  const output = parseOutput(parsed, COLLECTION_COMMAND_DEFINITIONS.lookup);
  const selectedFailPolicies = failPolicies(parsed, 'lookup');
  return {
    action: 'lookup',
    query: parsed.positionalValue('target'),
    output,
    deep: parsed.hasOption('--deep'),
    detail: parsed.hasOption('--summary')
      ? 'summary'
      : parsed.hasOption('--verbose')
        ? 'verbose'
        : 'standard',
    strictExit: parsed.hasOption('--strict-exit'),
    events: parsed.hasOption('--events'),
    plan: parsed.hasOption('--plan'),
    includeAttribution: !parsed.hasOption('--no-attribution'),
    observerLabel: normalizedLabel(parsed, '--observer', 80),
    vantageLabel: normalizedLabel(parsed, '--vantage', 80),
    ...terminalOptions(parsed),
    ...(parsed.hasOption('--browse') ? { browse: true as const } : {}),
    ...(parsed.hasOption('--exact-url') ? { exactUrl: true as const } : {}),
    ...(parsed.optionValue('--save-lookup')
      ? { saveLookup: parsed.optionValue('--save-lookup')! }
      : {}),
    ...(selectedFailPolicies ? { failOn: selectedFailPolicies } : {}),
  };
}

function parseBulkArguments(parsed: ParsedCommandArguments<BulkArguments['action']>): BulkArguments {
  const deep = parsed.hasOption('--deep');
  const selectedFailPolicies = failPolicies(parsed, 'bulk');
  const output = parseOutput(parsed, COLLECTION_COMMAND_DEFINITIONS.bulk);
  const filter = parsed.hasOption('--registered-only')
    ? 'registered'
    : parsed.hasOption('--inconclusive-only')
      ? 'inconclusive'
      : parsed.hasOption('--errors-only')
        ? 'errors'
        : 'all';
  return {
    action: 'bulk',
    source: parsed.positionalValue('source'),
    output,
    deep,
    concurrency:
      parsed.integerOption('--concurrency') ?? commandDefaultNumber('bulk', '--concurrency', deep),
    checkpoint: parsed.optionValue('--checkpoint'),
    resume: parsed.hasOption('--resume'),
    events: parsed.hasOption('--events'),
    plan: parsed.hasOption('--plan'),
    filter,
    ...terminalOptions(parsed),
    ...(selectedFailPolicies ? { failOn: selectedFailPolicies } : {}),
  };
}

function parseDiscoverArguments(parsed: ParsedCommandArguments<DiscoverArguments['action']>): DiscoverArguments {
  return {
    action: 'discover',
    seed: parsed.positionalValue('subject'),
    output: parseOutput(parsed, COLLECTION_COMMAND_DEFINITIONS.discover),
    ...discoveryValues(parsed),
    snapshotSource: parsed.optionValue('--snapshot'),
    ...terminalOptions(parsed),
  };
}

function discoveryValues(parsed: ParsedCommandArguments) {
  const familyText = parsed.optionValue('--families');
  return {
    preset: (familyText
      ? 'custom'
      : (parsed.optionValue('--preset') ?? commandDefaultText('discover', '--preset'))) as
      'common' | 'impersonation' | 'all' | 'custom',
    keyboardLayout: (parsed.optionValue('--keyboard') ??
      commandDefaultText('discover', '--keyboard')) as 'qwerty' | 'azerty' | 'qwertz' | 'all',
    tldText: parsed.optionValue('--tlds'),
    dictionarySource: parsed.optionValue('--dictionary'),
    familyText,
  };
}

function parseDiscoverScanArguments(parsed: ParsedCommandArguments<DiscoverScanArguments['action']>): DiscoverScanArguments {
  const deep = parsed.hasOption('--deep');
  const selectedFailPolicies = failPolicies(parsed, 'discover-scan');
  const filter = parsed.hasOption('--registered-only')
    ? 'registered'
    : parsed.hasOption('--inconclusive-only')
      ? 'inconclusive'
      : parsed.hasOption('--acquisition-only')
        ? 'acquisition'
        : parsed.hasOption('--suppressed-only')
          ? 'suppressed'
          : 'all';
  return {
    action: 'discover-scan',
    seed: parsed.positionalValue('subject'),
    output: parseOutput(parsed, COLLECTION_COMMAND_DEFINITIONS['discover-scan']),
    ...discoveryValues(parsed),
    deep,
    scanLimit:
      parsed.integerOption('--scan-limit') ??
      commandDefaultNumber('discover-scan', '--scan-limit', deep),
    chunkSize:
      parsed.integerOption('--chunk-size') ?? commandDefaultNumber('discover-scan', '--chunk-size'),
    concurrency:
      parsed.integerOption('--concurrency') ??
      commandDefaultNumber('discover-scan', '--concurrency', deep),
    checkpoint: parsed.optionValue('--checkpoint'),
    resume: parsed.hasOption('--resume'),
    resolverText: parsed.optionValue('--resolver'),
    observationSnapshot: parsed.optionValue('--observation-snapshot'),
    allowlistSource: parsed.optionValue('--allowlist'),
    filter,
    events: parsed.hasOption('--events'),
    plan: parsed.hasOption('--plan'),
    ...terminalOptions(parsed),
    ...(selectedFailPolicies ? { failOn: selectedFailPolicies } : {}),
  };
}

export const COLLECTION_ARGUMENT_PARSERS = Object.freeze({
  lookup: parseLookupArguments,
  bulk: parseBulkArguments,
  discover: parseDiscoverArguments,
  'discover-scan': parseDiscoverScanArguments,
});
