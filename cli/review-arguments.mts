import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { CliUsageError } from './errors.mts';
import { CLI_CASE_OPERATIONS, CLI_INDICATOR_OPERATIONS } from './command-reference.mts';
import {
  terminalOptions,
  jsonOutput,
  parseTwoFileComparisonArguments,
  singleInputAction,
  type TerminalOptions,
} from './argument-values.mts';

type VerifyArtifactArguments = {
  action: 'verify-artifact';
  source: string | null;
  passphraseSource: string | null;
  manifestSource: string | null;
  manifestEntryId: string | null;
  package?: true;
  bagit?: true;
  folder?: string;
  output: 'terminal' | 'json';
  strictExit: boolean;
} & TerminalOptions;

type CaseArguments = {
  action: 'case';
  operation: (typeof CLI_CASE_OPERATIONS)[number];
  source: string | null;
  caseId: string | null;
  domain: string | null;
  title: string | null;
  newIncident: boolean;
  text: string | null;
  noteSource: string | null;
  inputSource: string | null;
  expectedFileDigest: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type InterchangeReportArguments = {
  action: 'interchange-report';
  source: string | null;
  passphraseSource: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type SourceReportArguments = {
  action: 'source-report';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type CompareArguments = {
  action: 'compare';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type PageCompareArguments = {
  action: 'page-compare';
  leftSource: string;
  rightSource: string;
  output: 'terminal' | 'json';
} & TerminalOptions;

type MailReviewArguments = {
  action: 'mail-review';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type MailHeadersArguments = {
  action: 'mail-headers';
  source: string | null;
  trustedAuthHeaders?: readonly string[];
  output: 'terminal' | 'json';
} & TerminalOptions;

type IntakeArguments = {
  action: 'intake';
  kind: import('../packages/contracts/message-intake.mts').MessageIntakeKind;
  reportedActions: readonly import('../packages/contracts/message-intake.mts').IdentityAction[];
  trustedAuthHeaders?: readonly string[];
  intakeContextSource?: string;
  source: string | null;
  output: 'terminal' | 'json';
  strictExit: boolean;
} & TerminalOptions;

type ReviewEvidenceArguments = {
  action: 'review-evidence';
  source: string | null;
  mmdbSource: string | null;
  output: 'terminal' | 'json';
  strictExit: boolean;
} & TerminalOptions;

type BriefArguments = {
  action: 'brief';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type IndicatorSetArguments = {
  action: 'indicator-set';
  operation: (typeof CLI_INDICATOR_OPERATIONS)[number];
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type CasePackArguments = {
  action: 'case-pack';
  source: string | null;
  output: 'terminal' | 'json';
  audience: 'internal' | 'trusted' | 'public';
  reviewed: true;
} & TerminalOptions;

function parseVerifyArtifactArguments(parsed: ParsedCommandArguments<VerifyArtifactArguments['action']>): VerifyArtifactArguments {
  if (parsed.hasOption('--folder') && parsed.positionalValue('source'))
    throw new CliUsageError('--folder selects its own input; do not also supply a file or stdin marker.');
  return {
    action: 'verify-artifact',
    source: parsed.positionalValue('source'),
    passphraseSource: parsed.optionValue('--passphrase-file'),
    manifestSource: parsed.optionValue('--manifest'),
    manifestEntryId: parsed.optionValue('--manifest-entry'),
    ...(parsed.hasOption('--package') ? { package: true as const } : {}),
    ...(parsed.hasOption('--bagit') ? { bagit: true as const } : {}),
    ...(parsed.optionValue('--folder') ? { folder: parsed.optionValue('--folder')! } : {}),
    output: jsonOutput(parsed),
    strictExit: parsed.hasOption('--strict-exit'),
    ...terminalOptions(parsed),
  };
}

function parseCaseArguments(parsed: ParsedCommandArguments<CaseArguments['action']>): CaseArguments {
  const operation = parsed.positionalValue('operation') as (typeof CLI_CASE_OPERATIONS)[number];
  const source = parsed.positionalValue('source');
  const domain = parsed.optionValue('--domain');
  const caseId = parsed.optionValue('--case-id');
  const title = parsed.optionValue('--title');
  const newIncident = parsed.hasOption('--new-incident');
  const text = parsed.optionValue('--text');
  const noteSource = parsed.optionValue('--note-file');
  const inputSource = parsed.optionValue('--input');
  const expectedFileDigest = parsed.optionValue('--expect-file-digest');
  if (source === '-' || inputSource === '-' || noteSource === '-')
    throw new CliUsageError('Case operations require selected files, not stdin.');
  if (operation !== 'open' && !source) throw new CliUsageError(`${operation} requires a Case file.`);
  if (operation !== 'show' && !parsed.hasOption('--output'))
    throw new CliUsageError('Case mutations require --output; nothing was changed.');
  if (operation === 'open' && !domain) throw new CliUsageError('case open requires --domain.');
  if (operation !== 'open' && (title || newIncident))
    throw new CliUsageError('--title and --new-incident belong to case open.');
  if (newIncident && (!title || caseId))
    throw new CliUsageError(
      '--new-incident requires a distinguishing --title and cannot select an existing --case-id.',
    );
  if (operation === 'note' ? text === null && !noteSource : text !== null || noteSource !== null) {
    throw new CliUsageError('Only case note accepts and requires --text or --note-file.');
  }
  if (
    ['pin', 'link', 'withdraw-link', 'assess', 'recheck', 'incident-link', 'action', 'action-event', 'recheck-question', 'close-object'].includes(operation)
      ? !inputSource
      : inputSource !== null
  ) {
    throw new CliUsageError(
      'This Case mutation requires --input; show, open and note do not accept it.',
    );
  }
  if (expectedFileDigest !== null && (!source || !/^sha256:[a-f0-9]{64}$/u.test(expectedFileDigest))) {
    throw new CliUsageError(
      '--expect-file-digest requires a source file and sha256:<64 lowercase hexadecimal characters>.',
    );
  }
  return {
    action: 'case',
    operation,
    source,
    caseId,
    domain,
    title,
    newIncident,
    text,
    noteSource,
    inputSource,
    expectedFileDigest,
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

export const REVIEW_ARGUMENT_PARSERS = Object.freeze({
  'verify-artifact': parseVerifyArtifactArguments,
  'interchange-report': (parsed: ParsedCommandArguments<InterchangeReportArguments['action']>): InterchangeReportArguments => ({
    action: 'interchange-report',
    source: parsed.positionalValue('source'),
    passphraseSource: parsed.optionValue('--passphrase-file'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  'source-report': (parsed: ParsedCommandArguments<SourceReportArguments['action']>): SourceReportArguments =>
    singleInputAction('source-report', parsed),
  compare: (parsed: ParsedCommandArguments<CompareArguments['action']>): CompareArguments => singleInputAction('compare', parsed),
  'page-compare': (parsed: ParsedCommandArguments<PageCompareArguments['action']>): PageCompareArguments => ({
    action: 'page-compare',
    ...parseTwoFileComparisonArguments(parsed, 'page-compare'),
  }),
  'mail-review': (parsed: ParsedCommandArguments<MailReviewArguments['action']>): MailReviewArguments =>
    singleInputAction('mail-review', parsed),
  'mail-headers': (parsed: ParsedCommandArguments<MailHeadersArguments['action']>): MailHeadersArguments => ({
    ...singleInputAction('mail-headers', parsed),
    ...(parsed.hasOption('--trusted-auth-header')
      ? { trustedAuthHeaders: parsed.optionValues('--trusted-auth-header') }
      : {}),
  }),
  intake: (parsed: ParsedCommandArguments<IntakeArguments['action']>): IntakeArguments => ({
    action: 'intake',
    kind: parsed.positionalValue(
      'kind',
    ) as import('../packages/contracts/message-intake.mts').MessageIntakeKind,
    reportedActions: parsed.optionValues(
      '--reported-action',
    ) as readonly import('../packages/contracts/message-intake.mts').IdentityAction[],
    ...(parsed.hasOption('--intake-context') ? { intakeContextSource: parsed.optionValue('--intake-context')! } : {}),
    ...(parsed.hasOption('--trusted-auth-header')
      ? { trustedAuthHeaders: parsed.optionValues('--trusted-auth-header') }
      : {}),
    source: parsed.positionalValue('source'),
    output: jsonOutput(parsed),
    strictExit: parsed.hasOption('--strict-exit'),
    ...terminalOptions(parsed),
  }),
  'review-evidence': (parsed: ParsedCommandArguments<ReviewEvidenceArguments['action']>): ReviewEvidenceArguments => ({
    action: 'review-evidence',
    source: parsed.positionalValue('source'),
    mmdbSource: parsed.optionValue('--mmdb'),
    output: jsonOutput(parsed),
    strictExit: parsed.hasOption('--strict-exit'),
    ...terminalOptions(parsed),
  }),
  brief: (parsed: ParsedCommandArguments<BriefArguments['action']>): BriefArguments => singleInputAction('brief', parsed),
  case: parseCaseArguments,
  'indicator-set': (parsed: ParsedCommandArguments<IndicatorSetArguments['action']>): IndicatorSetArguments => ({
    action: 'indicator-set',
    operation: parsed.positionalValue('operation') as (typeof CLI_INDICATOR_OPERATIONS)[number],
    source: parsed.positionalValue('source'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  'case-pack': (parsed: ParsedCommandArguments<CasePackArguments['action']>): CasePackArguments => ({
    action: 'case-pack',
    source: parsed.positionalValue('source'),
    output: jsonOutput(parsed),
    audience: parsed.optionValue('--audience') as 'internal' | 'trusted' | 'public',
    reviewed: true,
    ...terminalOptions(parsed),
  }),
});
