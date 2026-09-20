import { createHash, generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { SIGNER_TRUST_STORE_SCHEMA, SIGNER_TRUST_STORE_VERSION } from '../cli/signer-trust.mts';

type RunInstalled = (args: readonly string[], label: string, expectedExitCode?: number) => Promise<string>;

export async function checkInstalledSigningTrust(root: string, temporaryRoot: string, run: RunInstalled): Promise<readonly string[]> {
  const fixture = join(temporaryRoot, 'signing-manifest.json');
  await writeFile(fixture, await readBoundedRegularFileWithin(root, 'test/fixtures/case-lifecycle/case-response-packet-v8.json', {
    maximumBytes: 64 * 1024, minimumBytes: 1, label: 'Published response-packet fixture',
  }), { flag: 'wx', mode: 0o600 });
  const pair = generateKeyPairSync('ed25519');
  const privateFile = join(temporaryRoot, 'signing-private.pem');
  const publicFile = join(temporaryRoot, 'signing-public.pem');
  await writeFile(privateFile, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
  await writeFile(publicFile, pair.publicKey.export({ format: 'pem', type: 'spki' }), { flag: 'wx', mode: 0o600 });
  const fingerprint = createHash('sha256').update(pair.publicKey.export({ format: 'der', type: 'spki' })).digest('hex');
  const signed = await run(['sign-artifact', fixture, '--private-key-file', privateFile], 'offline evidence signing');
  if (signed.includes('PRIVATE KEY')) throw new TypeError('Installed signing output included private-key material.');
  const signedFile = join(temporaryRoot, 'signed-manifest.json');
  await writeFile(signedFile, signed, { flag: 'wx', mode: 0o600 });
  const ordinary = JSON.parse(await run(['verify-signature', signedFile, '--public-key-file', publicFile, '--json'], 'offline signature verification'));
  if (ordinary.schema !== 'whoisleuth.evidence-signature-verification' || ordinary.version !== 2
    || ordinary.signature?.state !== 'valid' || ordinary.signature?.keyIdSha256 !== fingerprint || ordinary.signature?.publicKeyMatched !== true) {
    throw new TypeError('Installed signature verification changed its established contract.');
  }
  for (const state of ['trusted', 'retired', 'revoked', 'unknown']) {
    const trustFile = join(temporaryRoot, `signer-${state}.json`);
    await writeFile(trustFile, JSON.stringify({
      schema: SIGNER_TRUST_STORE_SCHEMA, version: SIGNER_TRUST_STORE_VERSION,
      entries: [
        { keyIdSha256: '0'.repeat(64), label: 'Unrelated policy entry', status: 'trusted', updatedAt: '2026-01-01T00:00:00.000Z', note: 'Unrelated private review note' },
        ...(state === 'unknown' ? [] : [{ keyIdSha256: fingerprint, label: 'Package check', status: state, updatedAt: '2026-01-01T00:00:00.000Z' }]),
      ],
    }), { flag: 'wx', mode: 0o600 });
    const code = state === 'trusted' ? 0 : 4;
    const args = ['verify-signature', signedFile, '--public-key-file', publicFile, '--trust-store-file', trustFile];
    const output = await run([...args, '--json'], `offline signer ${state} policy`, code);
    const report = JSON.parse(output);
    if (report.schema !== 'whoisleuth.evidence-signer-trust-report' || report.version !== 1
      || report.trust?.state !== state || report.verification?.signature?.publicKeyMatched !== true
      || output.includes('Unrelated') || output.includes(temporaryRoot) || output.includes('PUBLIC KEY')) {
      throw new TypeError('Installed signer trust did not preserve policy or output privacy.');
    }
    if (await run([...args, '--quiet'], `quiet signer ${state} policy`, code) !== '') {
      throw new TypeError('Installed quiet signer policy emitted output.');
    }
  }
  return ['offline-signing-and-verification', 'offline-signer-trust-policy'];
}
