import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  MAX_OFFLINE_PASSPHRASE_FILE_BYTES,
} from './artifact-verify.mts';
import {
  formatArchiveInspection,
  inspectWorkspaceArchive,
} from './archive-inspect.mts';
import {
  MAX_SIGNING_KEY_FILE_BYTES,
  formatEvidenceSignatureVerification,
  signEvidencePackage,
  verifyEvidencePackageSignature,
} from './evidence-signing.mts';
import type {
  InspectArchiveArguments,
  SignArtifactArguments,
  VerifySignatureArguments,
} from './evidence-command-arguments.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { formatJsonDocument } from './formatters/json.mts';
import { readCliTextInput } from './input.mts';
import type { BoundedTextStream } from './bulk.mts';
import { runDiscriminatedCommandHandler, type DiscriminatedCommandHandlerMap } from './discriminated-command-handlers.mts';

type WritableLike = { write(value: string): unknown };
export type EvidenceCommandArguments =
  | InspectArchiveArguments
  | SignArtifactArguments
  | VerifySignatureArguments;
export type EvidenceCommandDependencies = Readonly<{
  stdout: WritableLike;
  stdin: BoundedTextStream;
  readArtifactInput: ((source?: string | null) => string | Promise<string>) | undefined;
  readPassphraseFile: ((source: string) => string | Promise<string>) | undefined;
  readPrivateKeyFile: ((source: string) => string | Promise<string>) | undefined;
  readPublicKeyFile: ((source: string) => string | Promise<string>) | undefined;
  now: (() => string) | undefined;
  signal: AbortSignal | undefined;
}>;

export function isEvidenceCommand(
  args: { action: string },
): args is EvidenceCommandArguments {
  return args.action === 'inspect-archive'
    || args.action === 'sign-artifact'
    || args.action === 'verify-signature';
}

export function evidenceCommandFailureLabel(
  action: EvidenceCommandArguments['action'],
): string {
  if (action === 'inspect-archive') return 'Archive inspection';
  if (action === 'sign-artifact') return 'Evidence signing';
  return 'Evidence signature verification';
}

async function readArtifact(
  source: string | null,
  label: string,
  dependencies: EvidenceCommandDependencies,
): Promise<string> {
  try {
    return dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(source)
      : await readCliTextInput(source, dependencies.stdin, {
        maximumBytes: MAX_OFFLINE_ARTIFACT_BYTES,
        label,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      });
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(
      `Could not read ${label.toLowerCase()}: ${boundedCliErrorMessage(error, 'Input could not be read')}`,
    );
  }
}

async function readKey(
  source: string,
  label: string,
  injected: ((source: string) => string | Promise<string>) | undefined,
  dependencies: EvidenceCommandDependencies,
): Promise<string> {
  try {
    return injected
      ? await injected(source)
      : await readCliTextInput(source, dependencies.stdin, {
        maximumBytes: MAX_SIGNING_KEY_FILE_BYTES,
        label,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      });
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(
      `Could not read ${label.toLowerCase()}: ${boundedCliErrorMessage(error, 'File could not be read')}`,
    );
  }
}

async function readPassphrase(
  source: string,
  dependencies: EvidenceCommandDependencies,
): Promise<string> {
  const passphraseText = dependencies.readPassphraseFile
    ? await dependencies.readPassphraseFile(source)
    : await readCliTextInput(source, dependencies.stdin, {
      maximumBytes: MAX_OFFLINE_PASSPHRASE_FILE_BYTES,
      label: 'Passphrase file',
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    });
  const passphrase = passphraseText.replace(/\r?\n$/u, '');
  if (!passphrase || /[\r\n\u0000]/u.test(passphrase)) {
    throw new CliUsageError('Passphrase file must contain exactly one non-empty UTF-8 line.');
  }
  return passphrase;
}

async function runInspectArchiveCommand(
  args: Extract<EvidenceCommandArguments, { action: 'inspect-archive' }>,
  dependencies: EvidenceCommandDependencies,
): Promise<number> {
  const input = await readArtifact(args.source, 'Archive input', dependencies);
  if (!input.trim()) {
    throw new CliUsageError(
      'inspect-archive requires one workspace archive file or an archive on stdin.',
    );
  }
  const passphrase = args.passphraseSource
    ? await readPassphrase(args.passphraseSource, dependencies)
    : null;
  const report = await inspectWorkspaceArchive(input, {
    passphrase,
    search: args.search,
    reveal: args.reveal,
    requireMatch: args.requireMatch,
    expectedContentDigest: args.expectedContentDigest,
  });
  if (!args.quiet) {
    dependencies.stdout.write(
      args.output === 'json'
        ? formatJsonDocument(report)
        : formatArchiveInspection(report),
    );
  }
  return EXIT_CODES.SUCCESS;
}

async function runSignArtifactCommand(
  args: Extract<EvidenceCommandArguments, { action: 'sign-artifact' }>,
  dependencies: EvidenceCommandDependencies,
): Promise<number> {
  const input = await readArtifact(args.source, 'Evidence artefact input', dependencies);
  if (!input.trim()) {
    throw new CliUsageError(
      'sign-artifact requires one reviewed artefact file or an artefact on stdin.',
    );
  }
  const privateKey = await readKey(
    args.privateKeySource,
    'Private key file',
    dependencies.readPrivateKeyFile,
    dependencies,
  );
  const signed = await signEvidencePackage(
    input,
    privateKey,
    dependencies.now ? dependencies.now() : new Date().toISOString(),
  );
  dependencies.stdout.write(formatJsonDocument(signed));
  return EXIT_CODES.SUCCESS;
}

async function runVerifySignatureCommand(
  args: Extract<EvidenceCommandArguments, { action: 'verify-signature' }>,
  dependencies: EvidenceCommandDependencies,
): Promise<number> {
  const input = await readArtifact(args.source, 'Signed evidence package input', dependencies);
  if (!input.trim()) {
    throw new CliUsageError(
      'verify-signature requires one signed package file or a package on stdin.',
    );
  }
  const publicKey = args.publicKeySource
    ? await readKey(
      args.publicKeySource,
      'Public key file',
      dependencies.readPublicKeyFile,
      dependencies,
    )
    : null;
  const report = await verifyEvidencePackageSignature(input, publicKey);
  if (!args.quiet) {
    dependencies.stdout.write(
      args.output === 'json'
        ? formatJsonDocument(report)
        : formatEvidenceSignatureVerification(report),
    );
  }
  return EXIT_CODES.SUCCESS;
}

const EVIDENCE_COMMAND_HANDLERS = Object.freeze({
  'inspect-archive': runInspectArchiveCommand,
  'sign-artifact': runSignArtifactCommand,
  'verify-signature': runVerifySignatureCommand,
} satisfies DiscriminatedCommandHandlerMap<
  EvidenceCommandArguments,
  [EvidenceCommandDependencies],
  number
>);

function runEvidenceCommand(
  args: EvidenceCommandArguments,
  dependencies: EvidenceCommandDependencies,
): Promise<number> {
  return runDiscriminatedCommandHandler(EVIDENCE_COMMAND_HANDLERS, args, dependencies);
}

export { EVIDENCE_COMMAND_HANDLERS, runEvidenceCommand };
