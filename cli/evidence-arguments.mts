import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { CliUsageError } from './errors.mts';
import { parseArchiveContentDigest } from './archive-content-digest.mts';
import { terminalOptions, type TerminalOptions } from './argument-values.mts';

type InspectArchiveArguments = {
  action: 'inspect-archive';
  source: string | null;
  passphraseSource: string | null;
  search: string | null;
  reveal: boolean;
  requireMatch: boolean;
  expectedContentDigest: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type SignArtifactArguments = {
  action: 'sign-artifact';
  source: string | null;
  privateKeySource: string;
};

type VerifySignatureArguments = {
  action: 'verify-signature';
  source: string | null;
  publicKeySource: string | null;
  trustStoreSource: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

function parseInspectArchiveArguments(parsed: ParsedCommandArguments): InspectArchiveArguments {
  const expectedContentDigest = parsed.optionValue('--expect-content-digest');
  try {
    parseArchiveContentDigest(expectedContentDigest);
  } catch {
    throw new CliUsageError(
      '--expect-content-digest requires sha256:<64 lowercase hex> or sorted-json-v2:sha256:<64 lowercase hex>.',
    );
  }
  return {
    action: 'inspect-archive',
    source: parsed.positionalValue('source'),
    passphraseSource: parsed.optionValue('--passphrase-file'),
    search: parsed.optionValue('--search'),
    reveal: parsed.hasOption('--reveal'),
    requireMatch: parsed.hasOption('--require-match'),
    expectedContentDigest,
    output: parsed.hasOption('--json') ? 'json' : 'terminal',
    ...terminalOptions(parsed),
  };
}

function parseSignArtifactArguments(parsed: ParsedCommandArguments): SignArtifactArguments {
  return {
    action: 'sign-artifact',
    source: parsed.positionalValue('source'),
    privateKeySource: parsed.optionValue('--private-key-file')!,
  };
}

function parseVerifySignatureArguments(parsed: ParsedCommandArguments): VerifySignatureArguments {
  return {
    action: 'verify-signature',
    source: parsed.positionalValue('source'),
    publicKeySource: parsed.optionValue('--public-key-file'),
    trustStoreSource: parsed.optionValue('--trust-store-file'),
    output: parsed.hasOption('--json') ? 'json' : 'terminal',
    ...terminalOptions(parsed),
  };
}

export const EVIDENCE_ARGUMENT_PARSERS = Object.freeze({
  'inspect-archive': parseInspectArchiveArguments,
  'sign-artifact': parseSignArtifactArguments,
  'verify-signature': parseVerifySignatureArguments,
});
