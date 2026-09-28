import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { CliUsageError } from './errors.mts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACTS } from '../packages/contracts/investigation-package-limits.mts';
import { terminalOptions, jsonOutput, singleInputAction, type TerminalOptions } from './argument-values.mts';

type ManifestArguments = {
  action: 'manifest';
  sources: readonly string[];
  workflow: string;
  configurationDigestSha256: string | null;
  package?: true;
  bagit?: true;
  folder?: string;
  passphraseSource?: string;
  output: 'terminal' | 'json';
} & TerminalOptions;

type SharingReviewArguments = {
  action: 'sharing-review';
  source: string | null;
  output: 'terminal' | 'json';
  marking: 'clear' | 'green' | 'amber' | 'amber-strict' | 'red';
  recipientScope: 'public' | 'community' | 'organization' | 'named-recipients';
  purpose: string;
  humanReviewed: boolean;
  personalDataReviewed: boolean;
  redactionsConfirmed: boolean;
} & TerminalOptions;

type MapObservationsArguments = {
  action: 'map-observations';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type OamExportArguments = {
  action: 'oam-export';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type CtIntakeArguments = {
  action: 'ct-intake';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type DomainControlArguments = {
  action: 'domain-control';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type AssuranceArguments = {
  action: 'assurance';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type ChangePacketArguments = {
  action: 'change-packet';
  source: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

function parseManifestArguments(parsed: ParsedCommandArguments): ManifestArguments {
  const sources = parsed.positionalValues('artefacts');
  if (sources.some((source) => !source))
    throw new CliUsageError(
      `manifest requires from 1 to ${MAX_INVESTIGATION_MANIFEST_ARTIFACTS} artefact files.`,
    );
  if (new Set(sources).size !== sources.length)
    throw new CliUsageError('manifest artefact files must be different.');
  const configurationDigestSha256 = parsed.optionValue('--configuration-digest');
  if (configurationDigestSha256 !== null && !/^sha256:[a-f0-9]{64}$/u.test(configurationDigestSha256)) {
    throw new CliUsageError('--configuration-digest requires a sha256: hexadecimal digest.');
  }
  return {
    action: 'manifest',
    sources,
    workflow: parsed.optionValue('--workflow')!,
    configurationDigestSha256,
    ...(parsed.optionValue('--passphrase-file')
      ? { passphraseSource: parsed.optionValue('--passphrase-file')! }
      : {}),
    ...(parsed.hasOption('--package') ? { package: true as const } : {}),
    ...(parsed.hasOption('--bagit') ? { bagit: true as const } : {}),
    ...(parsed.optionValue('--folder') ? { folder: parsed.optionValue('--folder')! } : {}),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

function parseSharingReviewArguments(parsed: ParsedCommandArguments): SharingReviewArguments {
  const purpose = parsed.optionValue('--purpose')!.replace(/\s+/gu, ' ').trim();
  if (!purpose || purpose.length > 200) throw new CliUsageError('--purpose is limited to 200 characters.');
  return {
    action: 'sharing-review',
    source: parsed.positionalValue('source'),
    output: jsonOutput(parsed),
    marking: parsed.optionValue('--marking') as 'clear' | 'green' | 'amber' | 'amber-strict' | 'red',
    recipientScope: parsed.optionValue('--recipient-scope') as
      'public' | 'community' | 'organization' | 'named-recipients',
    purpose,
    humanReviewed: parsed.hasOption('--human-reviewed'),
    personalDataReviewed: parsed.hasOption('--personal-data-reviewed'),
    redactionsConfirmed: parsed.hasOption('--redactions-confirmed'),
    ...terminalOptions(parsed),
  };
}

export const ASSURANCE_ARGUMENT_PARSERS = Object.freeze({
  manifest: parseManifestArguments,
  'map-observations': (parsed: ParsedCommandArguments): MapObservationsArguments =>
    singleInputAction('map-observations', parsed),
  'oam-export': (parsed: ParsedCommandArguments): OamExportArguments =>
    singleInputAction('oam-export', parsed),
  'ct-intake': (parsed: ParsedCommandArguments): CtIntakeArguments => singleInputAction('ct-intake', parsed),
  'domain-control': (parsed: ParsedCommandArguments): DomainControlArguments =>
    singleInputAction('domain-control', parsed),
  assurance: (parsed: ParsedCommandArguments): AssuranceArguments => singleInputAction('assurance', parsed),
  'change-packet': (parsed: ParsedCommandArguments): ChangePacketArguments =>
    singleInputAction('change-packet', parsed),
  'sharing-review': parseSharingReviewArguments,
});
