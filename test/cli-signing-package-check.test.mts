import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runCli } from '../cli/runner.mts';
import { checkInstalledSigningTrust } from '../tools/cli-signing-package-check.mts';

test('the installed signing packet exercises current trust states and rejects weakened package outputs', async () => {
  for (const diagnostic of ['none', 'private-key', 'legacy-shape', 'policy', 'privacy', 'quiet']) {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-signing-packet-'));
    try {
      const packet = checkInstalledSigningTrust(fileURLToPath(new URL('..', import.meta.url)), directory, async (args, label, expected = 0) => {
        let stdout = '', stderr = '';
        const code = await runCli(args, { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } });
        assert.equal(code, expected, stderr);
        assert.equal(stderr, '');
        if (diagnostic === 'private-key' && label === 'offline evidence signing') return `${stdout}PRIVATE KEY`;
        if (diagnostic === 'legacy-shape' && label === 'offline signature verification') return '{}';
        if (diagnostic === 'policy' && label === 'offline signer revoked policy') {
          const report = JSON.parse(stdout); report.trust.state = 'trusted'; return JSON.stringify(report);
        }
        if (diagnostic === 'privacy' && label === 'offline signer unknown policy') {
          const report = JSON.parse(stdout); report.note = 'Unrelated private review note'; return JSON.stringify(report);
        }
        if (diagnostic === 'quiet' && label === 'quiet signer trusted policy') return 'unexpected';
        return stdout;
      });
      if (diagnostic === 'none') assert.deepEqual(await packet, ['offline-signing-and-verification', 'offline-signer-trust-policy']);
      else await assert.rejects(packet, /Installed (?:signing|signature|signer trust|quiet signer)/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
