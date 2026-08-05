import test from 'node:test';
import assert from 'node:assert/strict';

import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const NOW = '2026-08-05T00:00:00.000Z';

function lookup(index: number) {
  const domain = `cohort-${index}.dev`;
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt: NOW, mode: 'deep', type: 'domain', query: domain, registrableDomain: domain,
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
    rdap: { parsed: { domain: domain.toUpperCase(), handle: `D-${index}`, objectClassName: 'domain', conformance: ['rdap_level_0'], links: [{ rel: 'self' }], events: [{ action: 'registration', date: NOW }], lifecycle: { createdDateIso: NOW } } },
    whois: { skipped: true },
  };
}

test('runs a target-free registry cohort through the CLI', async () => {
  let stdout = '';
  const input = Array.from({ length: 5 }, (_, index) => JSON.stringify(lookup(index))).join('\n');
  const code = await runCli(['registry-cohort', '--json'], {
    stdout: { write(value) { stdout += value; } }, stderr: { write() {} }, now: () => NOW,
    readCompareInput: async () => input,
  });
  assert.equal(code, EXIT_CODES.SUCCESS);
  const output = JSON.parse(stdout);
  assert.equal(output.cohorts[0]?.state, 'consistent');
  assert.doesNotMatch(stdout, /cohort-\d/u);
});

test('prints a sanitised registry fixture scaffold through the CLI', async () => {
  let stdout = '';
  const code = await runCli(['registry-scaffold', '--profile', 'nic-io-colon', '--suffix', 'ac', '--scenario', 'registered'], {
    stdout: { write(value) { stdout += value; } }, stderr: { write() {} }, now: () => NOW,
  });
  assert.equal(code, EXIT_CODES.SUCCESS);
  assert.match(stdout, /Synthetic scaffold only/u);
  assert.match(stdout, /EXAMPLE\.AC/u);
  assert.doesNotMatch(stdout, /@(?:gmail|outlook|yahoo)\./iu);
});
