import path from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { requireJsonRecord as record } from './maintainer-tool-helpers.mts';
import type { RunInstalledCli } from './installed-cli-check.mts';

/** Exact-byte package, folder and encrypted-container round trips. */
export async function checkInstalledCliEvidence(repositoryRoot: string, temporaryRoot: string, run: RunInstalledCli): Promise<void> {
  const packageSource = path.join(temporaryRoot, 'package-source.json');
  const packageOpaque = path.join(temporaryRoot, 'package-source.bin');
  const packageOutput = path.join(temporaryRoot, 'evidence.zip');
  await writeFile(packageSource, await readBoundedRegularFileWithin(repositoryRoot, 'test/fixtures/cli-lookup-v1.json', {
    maximumBytes: 1024 * 1024, minimumBytes: 1, label: 'Public saved Lookup fixture',
  }), { flag: 'wx', mode: 0o600 });
  await writeFile(packageOpaque, new Uint8Array([0, 255, 128, 1]), { flag: 'wx', mode: 0o600 });
  const packageCreation = await run(['manifest', packageSource, packageOpaque,
    '--workflow', 'Evidence review', '--package', '--output', packageOutput], 'evidence package creation');
  if (packageCreation !== '') throw new TypeError('Binary package creation emitted terminal content.');
  const packageReview = record(JSON.parse(await run(
    ['verify-artifact', packageOutput, '--package', '--json', '--strict-exit'], 'evidence package verification')), 'Installed evidence package review');
  const packageDetails = record(packageReview.package, 'Installed evidence package details');
  const packageChecks = record(packageReview.checks, 'Installed evidence package checks');
  if (packageReview.state !== 'verified' || packageDetails.storageEffect !== 'none'
    || packageDetails.signatureTrust !== 'not_checked' || packageDetails.timestampAssurance !== 'not_checked'
    || packageChecks.contentIntegrity !== 'verified' || packageChecks.contentIntegrityScope !== 'manifest_and_files'
    || !Array.isArray(packageDetails.entries) || packageDetails.entries.length !== 2
    || record(packageDetails.entries[0], 'Installed package JSON').state !== 'admitted'
    || record(packageDetails.entries[1], 'Installed package binary').state !== 'opaque'
    || record(packageDetails.entries[1], 'Installed package binary').byteLength !== 4) {
    throw new TypeError('Installed package round trip did not preserve file identity and separate assurance.');
  }
  const folderOutput = path.join(temporaryRoot, 'evidence-folder');
  const encryptedOutput = path.join(temporaryRoot, 'evidence.wlep');
  const packagePassphrase = path.join(temporaryRoot, 'package-passphrase.txt');
  await writeFile(packagePassphrase, 'selected package fixture passphrase\n', { flag: 'wx', mode: 0o600 });
  const encryptedCreation = await run(['manifest', packageSource, packageOpaque,
    '--workflow', 'Evidence review', '--package', '--passphrase-file', packagePassphrase, '--output', encryptedOutput], 'encrypted evidence package creation');
  const encryptedReview = record(JSON.parse(await run(
    ['verify-artifact', encryptedOutput, '--package', '--passphrase-file', packagePassphrase, '--json', '--strict-exit'], 'encrypted evidence package verification')), 'Installed encrypted package review');
  if (encryptedCreation !== '' || encryptedReview.state !== 'verified'
    || record(encryptedReview.checks, 'Encrypted package checks').authenticatedEncryption !== 'verified'
    || JSON.stringify(record(encryptedReview.package, 'Encrypted package details').entries) !== JSON.stringify(packageDetails.entries)
    || JSON.stringify(encryptedReview).includes('selected package fixture passphrase')) {
    throw new TypeError('Installed encrypted package round trip did not authenticate unchanged files privately.');
  }
  await run(['verify-artifact', encryptedOutput, '--package', '--json'],
    'encrypted evidence package locked refusal', 3, /^Artefact verification failed: [^\r\n]+\n$/u);
  const folderManifest = record(JSON.parse(await run(['manifest', packageSource, packageOpaque,
    '--workflow', 'Evidence review', '--folder', folderOutput, '--json'], 'evidence folder creation')), 'Installed folder manifest');
  const folderReview = record(JSON.parse(await run(
    ['verify-artifact', '--folder', folderOutput, '--json', '--strict-exit'], 'evidence folder verification')), 'Installed folder verification');
  const folderDetails = record(folderReview.package, 'Installed folder details');
  const folderBytes = await readBoundedRegularFileWithin(folderOutput, 'artifacts/artifact-2', { maximumBytes: 4, expectedBytes: 4, label: 'Installed folder binary' });
  if (folderManifest.schema !== 'whoisleuth.investigation-manifest' || folderReview.state !== 'verified'
    || JSON.stringify(folderDetails.entries) !== JSON.stringify(packageDetails.entries)
    || !folderBytes.equals(Buffer.from([0, 255, 128, 1]))
    || !Array.isArray(folderReview.limitations) || !folderReview.limitations.some(value => typeof value === 'string' && value.includes('not filesystem metadata'))) {
    throw new TypeError('Installed folder output did not preserve exact files and separate container identity.');
  }
  const bagItZip = path.join(temporaryRoot, 'bagit.zip'), bagItFolder = path.join(temporaryRoot, 'bagit-folder');
  if (await run(['manifest', packageSource, packageOpaque, '--workflow', 'Evidence review',
    '--bagit', '--package', '--output', bagItZip], 'BagIt ZIP creation') !== '') throw new TypeError('BagIt creation emitted terminal binary content.');
  await run(['manifest', packageSource, packageOpaque, '--workflow', 'Evidence review',
    '--bagit', '--folder', bagItFolder, '--quiet'], 'BagIt folder creation');
  for (const [label, selection] of [['ZIP', [bagItZip, '--package']], ['folder', ['--folder', bagItFolder]]] as const) {
    const reviewed = record(JSON.parse(await run(['verify-artifact', ...selection,
      '--bagit', '--json', '--strict-exit'], `BagIt ${label} verification`)), 'Installed BagIt review');
    const bag = record(reviewed.bagit, 'Installed BagIt details');
    if (reviewed.state !== 'integrity_valid' || bag.state !== 'valid' || bag.checksumsVerified !== true || bag.complete !== true
      || !Array.isArray(bag.entries) || bag.entries.length !== 2 || record(bag.entries[1], 'BagIt binary').byteLength !== 4
      || record(reviewed.checks, 'BagIt checks').authenticatedEncryption !== 'not_applicable'
      || JSON.stringify(reviewed).includes('package-source')) throw new TypeError('Installed BagIt verification did not preserve bounded, redacted integrity semantics.');
  }
  const bagItBytes = await readBoundedRegularFileWithin(bagItFolder, 'data/artifact-2', { maximumBytes: 4, expectedBytes: 4, label: 'Installed BagIt binary' });
  if (!bagItBytes.equals(Buffer.from([0, 255, 128, 1]))) throw new TypeError('Installed BagIt output changed selected file bytes.');
  await rm(path.join(bagItFolder, 'data/artifact-2'));
  const missingBag = record(JSON.parse(await run(['verify-artifact', '--folder', bagItFolder,
    '--bagit', '--json', '--strict-exit'], 'BagIt incomplete verification', 4)), 'Installed incomplete BagIt review');
  if (missingBag.state !== 'partial' || record(missingBag.bagit, 'Incomplete BagIt details').state !== 'incomplete') throw new TypeError('Installed BagIt verification concealed an absent original.');
  const originalManifestBytes = await readBoundedRegularFileWithin(folderOutput, 'manifest.json', {
    maximumBytes: 512 * 1024, minimumBytes: 1, label: 'Installed folder manifest',
  });
  const refusal = await run(['manifest', packageSource, '--workflow', 'Evidence review', '--folder', folderOutput, '--quiet'],
    'evidence folder replacement refusal', 2, /^Usage error: [^\r\n]+\n$/u);
  const preservedManifestBytes = await readBoundedRegularFileWithin(folderOutput, 'manifest.json', {
    maximumBytes: 512 * 1024, minimumBytes: 1, label: 'Installed folder manifest',
  });
  if (refusal !== '' || !preservedManifestBytes.equals(originalManifestBytes)) throw new TypeError('Folder replacement refusal changed the existing manifest or emitted success output.');
}
