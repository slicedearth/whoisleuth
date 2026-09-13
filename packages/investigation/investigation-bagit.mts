import { prepareBagItEntries, encodeBagItEntries } from '../interchange/bagit.mts';
import { prepareInvestigationPackageEntries, INVESTIGATION_PACKAGE_MANIFEST_PATH } from './investigation-package.mts';
import type { InvestigationManifestInput } from './investigation-manifest.mts';

/** The existing manifest keeps source declarations; BagIt preserves the bytes. */
export async function prepareInvestigationBagIt(input: InvestigationManifestInput, generatedAt: string, version: string) {
  const prepared = await prepareInvestigationPackageEntries(input, generatedAt, version);
  const payload = new Map([...prepared.files].filter(([path]) => path !== INVESTIGATION_PACKAGE_MANIFEST_PATH)
    .map(([path, bytes]) => [`data/${path.slice('artifacts/'.length)}`, bytes]));
  const tags = new Map([['whoisleuth-manifest.json', prepared.files.get(INVESTIGATION_PACKAGE_MANIFEST_PATH)!]]);
  return { manifest: prepared.manifest, files: await prepareBagItEntries(payload, tags) };
}

export async function buildInvestigationBagIt(input: InvestigationManifestInput, generatedAt: string, version: string) {
  const prepared = await prepareInvestigationBagIt(input, generatedAt, version);
  return { manifest: prepared.manifest, bytes: encodeBagItEntries(prepared.files) };
}
