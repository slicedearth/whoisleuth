import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { type CliHelpGroup, type CompletionShell } from './command-reference.mts';
import { terminalOptions, jsonOutput, singleInputAction, type TerminalOptions } from './argument-values.mts';

type CompletionArguments = { action: 'completion'; shell: CompletionShell };

type DoctorArguments = { action: 'doctor'; network: boolean; output: 'terminal' | 'json' } & TerminalOptions;

type CommandsArguments = {
  action: 'commands';
  output: 'terminal' | 'json';
  common: boolean;
  group: CliHelpGroup | null;
  mode: 'offline' | 'network' | null;
} & TerminalOptions;

type ManualArguments = { action: 'manual' };

type RegistrySupportArguments = {
  action: 'registry-support';
  target: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type RegistryDoctorArguments = {
  action: 'registry-doctor';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type RegistryCohortArguments = {
  action: 'registry-cohort';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type RegistryScaffoldArguments = {
  action: 'registry-scaffold';
  profile: string;
  suffix: string;
  scenario: 'registered' | 'not_found' | 'inconclusive';
};

type RiskCalibrateArguments = {
  action: 'risk-calibrate';
  source: string | null;
  output: 'terminal' | 'json' | 'summary_json';
} & TerminalOptions;

type LookalikeCalibrateArguments = {
  action: 'lookalike-calibrate';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

export const SUPPORT_ARGUMENT_PARSERS = Object.freeze({
  completion: (parsed: ParsedCommandArguments<CompletionArguments['action']>): CompletionArguments => ({
    action: 'completion',
    shell: parsed.positionalValue('shell') as CompletionShell,
  }),
  doctor: (parsed: ParsedCommandArguments<DoctorArguments['action']>): DoctorArguments => ({
    action: 'doctor',
    network: parsed.hasOption('--network'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  commands: (parsed: ParsedCommandArguments<CommandsArguments['action']>): CommandsArguments => ({
    action: 'commands',
    output: jsonOutput(parsed),
    common: parsed.hasOption('--common'),
    group: parsed.optionValue('--group') as CliHelpGroup | null,
    mode: parsed.optionValue('--mode') as 'offline' | 'network' | null,
    ...terminalOptions(parsed),
  }),
  manual: (): ManualArguments => ({ action: 'manual' }),
  'registry-support': (parsed: ParsedCommandArguments<RegistrySupportArguments['action']>): RegistrySupportArguments => ({
    action: 'registry-support',
    target: parsed.positionalValue('domain-or-suffix'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  }),
  'registry-doctor': (parsed: ParsedCommandArguments<RegistryDoctorArguments['action']>): RegistryDoctorArguments =>
    singleInputAction('registry-doctor', parsed),
  'registry-cohort': (parsed: ParsedCommandArguments<RegistryCohortArguments['action']>): RegistryCohortArguments =>
    singleInputAction('registry-cohort', parsed),
  'registry-scaffold': (parsed: ParsedCommandArguments<RegistryScaffoldArguments['action']>): RegistryScaffoldArguments => ({
    action: 'registry-scaffold',
    profile: parsed.optionValue('--profile')!,
    suffix: parsed.optionValue('--suffix')!,
    scenario: parsed.optionValue('--scenario') as 'registered' | 'not_found' | 'inconclusive',
  }),
  'risk-calibrate': (parsed: ParsedCommandArguments<RiskCalibrateArguments['action']>): RiskCalibrateArguments => ({
    action: 'risk-calibrate',
    source: parsed.positionalValue('source'),
    output: parsed.hasOption('--json')
      ? 'json'
      : parsed.hasOption('--summary-json')
        ? 'summary_json'
        : 'terminal',
    ...terminalOptions(parsed),
  }),
  'lookalike-calibrate': (parsed: ParsedCommandArguments<LookalikeCalibrateArguments['action']>): LookalikeCalibrateArguments =>
    singleInputAction('lookalike-calibrate', parsed),
});
