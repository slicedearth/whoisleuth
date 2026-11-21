import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { CliUsageError } from './errors.mts';
import {
  terminalOptions,
  jsonOutput,
  parseTwoFileComparisonArguments,
  uniqueSources,
  type TerminalOptions,
} from './argument-values.mts';

type DiffArguments = {
  action: 'diff';
  leftSource: string;
  rightSource: string;
  leftSessionId: string | null;
  rightSessionId: string | null;
  output: 'terminal' | 'json';
  browse?: boolean;
} & TerminalOptions;

type ViewArguments = {
  action: 'view';
  source: string | null;
  browse: boolean;
  output: 'terminal' | 'json';
} & TerminalOptions;

type McpArguments = { action: 'mcp'; sources: readonly string[] };

type ReconcileArguments = {
  action: 'reconcile';
  sources: readonly string[];
  output: 'terminal' | 'json';
} & TerminalOptions;

type TimelineArguments = {
  action: 'timeline';
  sources: readonly string[];
  output: 'terminal' | 'json';
} & TerminalOptions;

type PriorRegistrationArguments = {
  action: 'prior-registration';
  source: string | null;
  certificateResults: string | null;
  archiveHistory: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type ExportArguments = {
  action: 'export';
  source: string | null;
  format: 'json' | 'markdown' | 'html';
  compact: boolean;
  includeAttribution: boolean;
};

function parseDiffArguments(parsed: ParsedCommandArguments<DiffArguments['action']>): DiffArguments {
  const compared = parseTwoFileComparisonArguments(parsed, 'diff');
  const leftSessionId = parsed.optionValue('--left-session');
  const rightSessionId = parsed.optionValue('--right-session');
  for (const [option, value] of [
    ['--left-session', leftSessionId],
    ['--right-session', rightSessionId],
  ] as const) {
    if (value !== null && !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
      throw new CliUsageError(`${option} requires one bounded saved-session ID.`);
    }
  }
  return { action: 'diff', ...compared, leftSessionId, rightSessionId, ...(parsed.hasOption('--browse') ? { browse: true } : {}) };
}

export const HISTORY_ARGUMENT_PARSERS = Object.freeze({
  mcp: (parsed: ParsedCommandArguments<McpArguments['action']>): McpArguments => {
    const sources = parsed.positionalValues('sources');
    if (sources.includes('-') || new Set(sources).size !== sources.length) throw new CliUsageError('MCP requires distinct named evidence files; stdin is reserved for the protocol.');
    return { action: 'mcp', sources };
  },
  view: (parsed: ParsedCommandArguments<ViewArguments['action']>): ViewArguments => ({
    action: 'view', source: parsed.positionalValue('source'), browse: parsed.hasOption('--browse'),
    output: jsonOutput(parsed), ...terminalOptions(parsed),
  }),
  diff: parseDiffArguments,
  reconcile: (parsed: ParsedCommandArguments<ReconcileArguments['action']>): ReconcileArguments => ({
    action: 'reconcile',
    sources: uniqueSources(parsed, 'reconcile'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  timeline: (parsed: ParsedCommandArguments<TimelineArguments['action']>): TimelineArguments => ({
    action: 'timeline',
    sources: uniqueSources(parsed, 'timeline'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  'prior-registration': (parsed: ParsedCommandArguments<PriorRegistrationArguments['action']>): PriorRegistrationArguments => ({
    action: 'prior-registration',
    source: parsed.positionalValue('source'),
    certificateResults: parsed.optionValue('--ct-results'),
    archiveHistory: parsed.optionValue('--archive-history'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  export: (parsed: ParsedCommandArguments<ExportArguments['action']>): ExportArguments => ({
    action: 'export',
    source: parsed.positionalValue('source'),
    format: parsed.hasOption('--markdown') ? 'markdown' : parsed.hasOption('--html') ? 'html' : 'json',
    compact: parsed.hasOption('--compact'),
    includeAttribution: !parsed.hasOption('--no-attribution'),
  }),
});
