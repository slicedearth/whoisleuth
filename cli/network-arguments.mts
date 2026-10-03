import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { commandDefaultText } from './command-reference.mts';
import { NETWORK_COMMAND_DEFINITIONS } from './network-command-definitions.mts';
import {
  terminalOptions,
  jsonOutput,
  parseOutput,
  singleInputAction,
  type TerminalOptions,
} from './argument-values.mts';

type PostureArguments = {
  action: 'posture';
  domain: string | null;
  output: 'terminal' | 'json' | 'sarif';
  selectorText: string | null;
  retiredSelectorText: string | null;
  mailProfile: 'defensive_no_mail' | 'parked' | 'standard';
  ownedDomain: boolean;
  includeInheritedDns?: true;
} & TerminalOptions;

type DnssecValidateArguments = {
  action: 'dnssec-validate';
  target: string;
  resolver: string;
  trustAnchorSource: string;
  ownedOrAuthorized: true;
  output: 'terminal' | 'json';
} & TerminalOptions;

type MailTransportArguments = {
  action: 'mail-transport';
  source: string | null;
  resolver: string;
  trustAnchorSource: string;
  ownedOrAuthorized: true;
  activeProbeAcknowledged: true;
  output: 'terminal' | 'json';
} & TerminalOptions;

type CtSearchArguments = {
  action: 'ct-search';
  keyword: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type HttpArguments = {
  action: 'http';
  domain: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type TlsArguments = {
  action: 'tls';
  hostname: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

function parsePostureArguments(parsed: ParsedCommandArguments<PostureArguments['action']>): PostureArguments {
  const mailProfile =
    parsed.optionValue('--mail-profile') ?? commandDefaultText('posture', '--mail-profile');
  return {
    action: 'posture',
    domain: parsed.positionalValue('domain'),
    output: parseOutput(parsed, NETWORK_COMMAND_DEFINITIONS.posture),
    selectorText: parsed.optionValue('--selectors'),
    retiredSelectorText: parsed.optionValue('--retired-selectors'),
    mailProfile:
      mailProfile === 'defensive-no-mail'
        ? 'defensive_no_mail'
        : (mailProfile as 'parked' | 'standard'),
    ownedDomain: parsed.hasOption('--owned-domain'),
    ...(parsed.hasOption('--include-inherited-dns') ? { includeInheritedDns: true as const } : {}),
    ...terminalOptions(parsed),
  };
}

function parseDnssecValidateArguments(parsed: ParsedCommandArguments<DnssecValidateArguments['action']>): DnssecValidateArguments {
  return {
    action: 'dnssec-validate',
    target: parsed.positionalValue('domain')!,
    resolver: parsed.optionValue('--resolver')!,
    trustAnchorSource: parsed.optionValue('--trust-anchor')!,
    ownedOrAuthorized: true,
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

function parseMailTransportArguments(parsed: ParsedCommandArguments<MailTransportArguments['action']>): MailTransportArguments {
  return {
    action: 'mail-transport',
    source: parsed.positionalValue('source'),
    resolver: parsed.optionValue('--resolver')!,
    trustAnchorSource: parsed.optionValue('--trust-anchor')!,
    ownedOrAuthorized: true,
    activeProbeAcknowledged: true,
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

export const NETWORK_ARGUMENT_PARSERS = Object.freeze({
  'ct-search': (parsed: ParsedCommandArguments<CtSearchArguments['action']>): CtSearchArguments =>
    singleInputAction('ct-search', parsed, 'keyword'),
  posture: parsePostureArguments,
  http: (parsed: ParsedCommandArguments<HttpArguments['action']>): HttpArguments =>
    singleInputAction('http', parsed, 'domain'),
  tls: (parsed: ParsedCommandArguments<TlsArguments['action']>): TlsArguments =>
    singleInputAction('tls', parsed, 'hostname'),
  'dnssec-validate': parseDnssecValidateArguments,
  'mail-transport': parseMailTransportArguments,
});
