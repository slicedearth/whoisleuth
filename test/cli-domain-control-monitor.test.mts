import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { runDomainControlMonitor } from '../cli/domain-control-monitor.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import { buildDomainControlManifest, DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA } from '../lib/domain-control-manifest.mts';

const NOW = '2026-08-05T04:00:00.000Z';

function manifest() {
  return buildDomainControlManifest({
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA, version: 1, expiresAt: '2026-09-05T04:00:00.000Z',
    entries: ['alpha.test', 'beta.test', 'gamma.test'].map((domain) => ({ domain, nameservers: [`ns1.${domain}`], ds: [], mx: [], caa: [], tlsIssuer: null, tlsSpkiSha256: null, registrarLock: 'required', renewalReviewAt: null, note: null })),
  }, NOW);
}

function result(domain: string) {
  return {
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'unsupported' } },
    rdap: { parsed: { registrar: { name: 'Example Registrar' }, statuses: ['clientTransferProhibited'], nameservers: [`ns1.${domain}`] } },
    whois: { parsed: {} }, availability: { dns: { status: 'success', records: { ns: [`ns1.${domain}`], mx: [], caa: [] }, delegation: { status: 'success', records: { ds: [] } } }, tls: { status: 'unsupported' }, http: { status: 'unavailable' }, pageIdentity: { status: 'unavailable' } },
  };
}

describe('CLI one-shot domain control monitor', () => {
  test('bounds concurrency and incorporates a prior checkpoint', async () => {
    let active = 0;
    let maximum = 0;
    const executeLookup = async (classified: ClassifiedQuery) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return result(classified.registrableDomain || 'example.test');
    };
    const first = await runDomainControlMonitor(JSON.stringify(manifest()), null, { executeLookup, now: () => NOW, limit: 2, concurrency: 2 });
    const second = await runDomainControlMonitor(JSON.stringify(manifest()), JSON.stringify(first), { executeLookup, now: () => '2026-08-06T04:00:00.000Z', limit: 2, concurrency: 2 });
    assert.ok(maximum <= 2);
    assert.equal(first.collection.requested, 2);
    assert.equal(second.flightRecorder.observationCount, 4);
    assert.equal(second.flightRecorder.summary.unexpectedChanges, 0);
  });

  test('routes collection through the injected lookup boundary', async () => {
    let stdout = '';
    let calls = 0;
    const code = await runCli(['monitor-once', '--limit', '1', '--concurrency', '1', '--json'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write() {} }, now: () => NOW,
      readArtifactInput: async () => JSON.stringify(manifest()),
      runUnifiedLookup: async (classified) => { calls += 1; return result(classified.registrableDomain || 'example.test'); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(stdout).schema, 'whoisleuth.cli.domain-control-monitor');
  });

  test('rejects structurally unsafe manifest and previous JSON before collection', async () => {
    let calls = 0;
    const executeLookup = async () => {
      calls += 1;
      return result('example.test');
    };
    const deep = `${'{"nested":'.repeat(49)}null${'}'.repeat(49)}`;
    await assert.rejects(
      () => runDomainControlMonitor(deep, null, { executeLookup, now: () => NOW, limit: 1, concurrency: 1 }),
      /Domain-control manifest.*nesting limit/u,
    );
    await assert.rejects(
      () => runDomainControlMonitor(JSON.stringify(manifest()), deep, { executeLookup, now: () => NOW, limit: 1, concurrency: 1 }),
      /Previous monitor snapshot.*nesting limit/u,
    );
    await assert.rejects(
      () => runDomainControlMonitor('{"schema":"first","schema":"second"}', null, { executeLookup, now: () => NOW, limit: 1, concurrency: 1 }),
      /Domain-control manifest.*duplicate object key/u,
    );
    await assert.rejects(
      () => runDomainControlMonitor('{"__proto__":{"state":"forged"}}', null, { executeLookup, now: () => NOW, limit: 1, concurrency: 1 }),
      /Domain-control manifest.*unsafe object key/u,
    );
    assert.equal(calls, 0);
  });
});
