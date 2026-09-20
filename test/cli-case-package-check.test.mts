import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli } from '../cli/runner.mts';
import { checkInstalledCaseFiles } from '../tools/cli-case-package-check.mts';

test('the installed Case packet independently checks retained evidence and handoff integrity', async (context) => {
  for (const diagnostic of ['none', 'dropped-note', 'wrong-authority', 'missing-digest', 'false-structure-integrity',
    'unauthenticated-handoff', 'false-completeness']) await context.test(diagnostic, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-case-packet-'));
    try {
      const packet = checkInstalledCaseFiles(directory, async (args, label, expected = 0, diagnostics) => {
        let stdout = '', stderr = '';
        const deny = () => { throw new Error('Case packet attempted a network operation.'); };
        const code = await runCli(args, { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
          runUnifiedLookup: deny, safeFetch: deny, resolvePublicAddresses: deny, whoisQuery: deny, fetchHomepage: deny, collectTlsIntelligence: deny });
        assert.equal(code, expected, stderr);
        if (diagnostics) assert.match(stderr, diagnostics); else assert.equal(stderr, '');
        if (label === 'offline Case JSON review' && (diagnostic === 'dropped-note' || diagnostic === 'wrong-authority')) {
          const result = JSON.parse(stdout);
          if (diagnostic === 'dropped-note') result.cases[0].notes = [];
          else result.cases[0].observedEffects.reviews[0].sourceClass = 'verified';
          return JSON.stringify(result);
        }
        if (label === 'offline ordinary Case verification' && diagnostic === 'false-structure-integrity') {
          const result = JSON.parse(stdout);
          result.checks.contentIntegrity = 'verified';
          return JSON.stringify(result);
        }
        if (label === 'offline encrypted Case handoff verification' && diagnostic === 'unauthenticated-handoff') {
          const result = JSON.parse(stdout);
          result.checks.authenticatedEncryption = 'not_checked';
          return JSON.stringify(result);
        }
        if (label === 'offline missing Case original refusal' && diagnostic === 'false-completeness') {
          const result = JSON.parse(stdout);
          result.state = 'verified';
          result.package.caseFiles[0].missing = 0;
          return JSON.stringify(result);
        }
        return label === 'offline Case terminal review' && diagnostic === 'missing-digest' ? 'No identity.' : stdout;
      });
      if (diagnostic === 'none') await packet;
      else await assert.rejects(packet, diagnostic === 'false-structure-integrity' ? /Installed ordinary Case verification/u
        : diagnostic === 'unauthenticated-handoff' ? /Installed encrypted Case handoff verification/u
          : diagnostic === 'false-completeness' ? /Installed package verification/u : /Installed Case (?:journey|review)/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
