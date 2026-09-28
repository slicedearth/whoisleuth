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
} & TerminalOptions;

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

type ExportArguments = {
  action: 'export';
  source: string | null;
  format: 'json' | 'markdown' | 'html';
  compact: boolean;
  includeAttribution: boolean;
};

function parseDiffArguments(parsed: ParsedCommandArguments): DiffArguments {
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
  return { action: 'diff', ...compared, leftSessionId, rightSessionId };
}

export const HISTORY_ARGUMENT_PARSERS = Object.freeze({
  diff: parseDiffArguments,
  reconcile: (parsed: ParsedCommandArguments): ReconcileArguments => ({
    action: 'reconcile',
    sources: uniqueSources(parsed, 'reconcile'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  timeline: (parsed: ParsedCommandArguments): TimelineArguments => ({
    action: 'timeline',
    sources: uniqueSources(parsed, 'timeline'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  export: (parsed: ParsedCommandArguments): ExportArguments => ({
    action: 'export',
    source: parsed.positionalValue('source'),
    format: parsed.hasOption('--markdown') ? 'markdown' : parsed.hasOption('--html') ? 'html' : 'json',
    compact: parsed.hasOption('--compact'),
    includeAttribution: !parsed.hasOption('--no-attribution'),
  }),
});
