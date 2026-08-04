import { createReadStream } from 'node:fs';

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
import {
  readSavedLookupInputBounded,
} from './saved-lookup.mts';
import type { BoundedTextStream } from './bulk.mts';

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
      : await readSavedLookupInputBounded(source
        ? createReadStream(source, { highWaterMark: 64 * 1024 })
        : dependencies.stdin, {
          limit: MAX_OFFLINE_ARTIFACT_BYTES,
          label,
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
): Promise<string> {
  try {
    return injected
      ? await injected(source)
      : await readSavedLookupInputBounded(
        createReadStream(source, { highWaterMark: MAX_SIGNING_KEY_FILE_BYTES }),
        { limit: MAX_SIGNING_KEY_FILE_BYTES, label },
      );
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
    : await readSavedLookupInputBounded(
      createReadStream(source, { highWaterMark: MAX_OFFLINE_PASSPHRASE_FILE_BYTES }),
      { limit: MAX_OFFLINE_PASSPHRASE_FILE_BYTES, label: 'Passphrase file' },
    );
  const passphrase = passphraseText.replace(/\r?\n$/u, '');
  if (!passphrase || /[\r\n\u0000]/u.test(passphrase)) {
    throw new CliUsageError('Passphrase file must contain exactly one non-empty UTF-8 line.');
  }
  return passphrase;
}

export async function runEvidenceCommand(
  args: EvidenceCommandArguments,
  dependencies: EvidenceCommandDependencies,
): Promise<number> {
  if (args.action === 'inspect-archive') {
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

  if (args.action === 'sign-artifact') {
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
    );
    const signed = await signEvidencePackage(
      input,
      privateKey,
      dependencies.now ? dependencies.now() : new Date().toISOString(),
    );
    dependencies.stdout.write(formatJsonDocument(signed));
    return EXIT_CODES.SUCCESS;
  }

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
