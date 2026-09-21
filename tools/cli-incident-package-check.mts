import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { requireJsonRecord as record } from './maintainer-tool-helpers.mts';
import type { RunInstalledCli } from './installed-cli-check.mts';
import { MAX_INVESTIGATION_RUN_BYTES } from '../packages/contracts/investigation-run.mts';
import { CLI_CASE_PACK_WRITER_FIXTURE_ID } from '../packages/contracts/case-portability.mts';
import { assertReleaseVersionDerivedCasePack } from './release-version-check.mts';

/** Independent identity and privacy expectations across exported Case audiences. */
export async function checkInstalledCliIncidents(repositoryRoot: string, temporaryRoot: string, packageVersion: string, run: RunInstalledCli): Promise<void> {
  const currentPack = record(JSON.parse((await readBoundedRegularFileWithin(repositoryRoot,
    `test/fixtures/case-lifecycle/${CLI_CASE_PACK_WRITER_FIXTURE_ID}.json`, {
      maximumBytes: MAX_INVESTIGATION_RUN_BYTES, minimumBytes: 1, label: 'Current Case-pack fixture',
    })).toString('utf8')), 'Current Case-pack fixture');
  if (!Array.isArray(currentPack.cases) || !currentPack.cases.length) throw new TypeError('Current Case fixture has no records.');
  const sourceIncident = record(currentPack.cases[0], 'Current incident fixture');
  const incidentInput = path.join(temporaryRoot, 'incident-cases.json');
  await writeFile(incidentInput, JSON.stringify({ version: currentPack.version, exportedAt: currentPack.exportedAt, cases: [
    { ...sourceIncident, id: 'installed-incident-first', title: 'First private incident title' },
    { ...sourceIncident, id: 'installed-incident-second', title: 'Second private incident title' },
  ] }), { mode: 0o600, flag: 'wx' });
  for (const audience of ['internal', 'trusted', 'public']) {
    const output = await run(['case-pack', incidentInput, '--audience', audience, '--reviewed', '--json'], `incident pack ${audience}`);
    const pack = record(JSON.parse(output), 'Installed incident pack');
    assertReleaseVersionDerivedCasePack(pack, packageVersion);
    if (!Array.isArray(pack.cases) || pack.cases.length !== 2
      || new Set(pack.cases.map(item => record(item, 'Installed incident').id)).size !== 2
      || new Set(pack.cases.map(item => record(item, 'Installed incident').domain)).size !== 1
      || (audience !== 'internal' && /private incident title/u.test(output))) {
      throw new TypeError('Installed incident pack lost Case identity or exposed a shared-audience title.');
    }
    const incidentOutput = path.join(temporaryRoot, `incidents-${audience}.json`);
    await writeFile(incidentOutput, output, { mode: 0o600, flag: 'wx' });
    const verified = record(JSON.parse(await run(
      ['verify-artifact', incidentOutput, '--json', '--strict-exit'], `incident pack ${audience} verification`)), 'Installed incident verification');
    if (verified.state !== 'verified') throw new TypeError('The installed incident pack did not verify offline.');
  }
}
