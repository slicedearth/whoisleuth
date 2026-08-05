import { CliUsageError } from './errors.mts';

type TerminalOptions = {
  quiet: boolean;
  color: boolean;
};

export type InspectArchiveArguments = {
  action: 'inspect-archive';
  source: string | null;
  passphraseSource: string | null;
  search: string | null;
  reveal: boolean;
  requireMatch: boolean;
  expectedContentDigest: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

export type SignArtifactArguments = {
  action: 'sign-artifact';
  source: string | null;
  privateKeySource: string;
};

export type VerifySignatureArguments = {
  action: 'verify-signature';
  source: string | null;
  publicKeySource: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

export function parseInspectArchiveArguments(argv: string[]): InspectArchiveArguments {
  let source: string | null = null;
  let passphraseSource: string | null = null;
  let search: string | null = null;
  let reveal = false;
  let requireMatch = false;
  let expectedContentDigest: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--passphrase-file') {
      if (passphraseSource !== null) throw new CliUsageError('--passphrase-file may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--passphrase-file requires one bounded UTF-8 file.');
      passphraseSource = value;
    } else if (argument === '--search') {
      if (search !== null) throw new CliUsageError('--search may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--search requires one exact bounded value.');
      search = value;
    } else if (argument === '--reveal') {
      if (reveal) throw new CliUsageError('--reveal may be supplied only once.');
      reveal = true;
    } else if (argument === '--require-match') {
      if (requireMatch) throw new CliUsageError('--require-match may be supplied only once.');
      requireMatch = true;
    } else if (argument === '--expect-content-digest') {
      if (expectedContentDigest !== null) throw new CliUsageError('--expect-content-digest may be supplied only once.');
      const value = argv[++index];
      if (!value || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
        throw new CliUsageError('--expect-content-digest requires sha256 followed by 64 lowercase hexadecimal characters.');
      }
      expectedContentDigest = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('inspect-archive accepts one optional JSON file. Otherwise pipe one archive on stdin.');
  }
  if (reveal && search === null) throw new CliUsageError('--reveal requires --search.');
  if (requireMatch && search === null) throw new CliUsageError('--require-match requires --search.');
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return {
    action: 'inspect-archive',
    source,
    passphraseSource,
    search,
    reveal,
    requireMatch,
    expectedContentDigest,
    output,
    quiet,
    color,
  };
}

export function parseSignArtifactArguments(argv: string[]): SignArtifactArguments {
  let source: string | null = null;
  let privateKeySource: string | null = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--private-key-file') {
      if (privateKeySource !== null) throw new CliUsageError('--private-key-file may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--private-key-file requires one bounded PEM file.');
      privateKeySource = value;
    } else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('sign-artifact accepts one optional JSON file. Otherwise pipe one artefact on stdin.');
  }
  if (!privateKeySource) throw new CliUsageError('sign-artifact requires --private-key-file.');
  return { action: 'sign-artifact', source, privateKeySource };
}

export function parseVerifySignatureArguments(argv: string[]): VerifySignatureArguments {
  let source: string | null = null;
  let publicKeySource: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--public-key-file') {
      if (publicKeySource !== null) throw new CliUsageError('--public-key-file may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--public-key-file requires one bounded PEM file.');
      publicKeySource = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('verify-signature accepts one optional JSON file. Otherwise pipe one package on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return {
    action: 'verify-signature',
    source,
    publicKeySource,
    output,
    quiet,
    color,
  };
}
