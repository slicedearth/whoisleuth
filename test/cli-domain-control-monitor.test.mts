import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { runDomainControlMonitor } from '../cli/domain-control-monitor.mts';
import { buildInvestigationPlan } from '../cli/investigation-plan.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import { buildDomainControlManifest, DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA } from '../lib/domain-control-manifest.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE,
} from '../packages/contracts/domain-control-flight-recorder.mts';
import { MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES } from '../packages/contracts/domain-control-monitor.mts';

const NOW = '2026-08-05T04:00:00.000Z';

function manifest() {
  return buildDomainControlManifest({
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA, version: 1, expiresAt: '2026-09-05T04:00:00.000Z',
    entries: ['alpha.test', 'beta.test', 'gamma.test'].map((domain) => ({ domain, nameservers: [`ns1.${domain}`], ds: [], mx: [], caa: [], tlsIssuer: null, tlsSpkiSha256: null, registrarLock: 'required', renewalReviewAt: null, note: null })),
  }, NOW);
}

function result(domain: string) {
  return {
    diagnostics: { rdap: { status: 'success', observedAt: NOW }, whois: { status: 'unsupported' } },
    rdap: { parsed: { registrar: { name: 'Example Registrar' }, statuses: ['clientTransferProhibited'], nameservers: [`ns1.${domain}`] } },
    whois: { parsed: {} }, availability: { dns: { status: 'success', records: { ns: [`ns1.${domain}`], mx: [], caa: [] }, delegation: { status: 'success', records: { ds: [] } } }, tls: { status: 'unsupported' }, http: { status: 'unavailable' }, pageIdentity: { status: 'unavailable' } },
  };
}

describe('CLI one-shot domain control monitor', () => {
  test('captures after collection and keeps source, capture and completion times distinct', async () => {
    const times = [NOW, '2026-08-05T04:01:00.000Z', '2026-08-05T04:02:00.000Z'];
    const source = result('alpha.test');
    source.diagnostics.rdap.observedAt = '2026-08-05T04:00:30.000Z';
    const report = await runDomainControlMonitor(JSON.stringify(manifest()), null, {
      executeLookup: async () => source, now: () => times.shift()!, limit: 1, concurrency: 1,
    });
    assert.equal(times.length, 0);
    assert.equal(report.generatedAt, '2026-08-05T04:02:00.000Z');
    assert.equal(report.observations[0]?.capturedAt, '2026-08-05T04:01:00.000Z');
    assert.equal(report.observations[0]?.fields.find((field) => field.id === 'registry_nameservers')?.observedAt, '2026-08-05T04:00:30.000Z');
    assert.equal(report.review.domains[0]?.comparisons.find((field) => field.field === 'nameservers')?.state, 'aligned');
    await assert.doesNotReject(() => runDomainControlMonitor(JSON.stringify(manifest()), JSON.stringify(report), {
      executeLookup: async () => source, now: () => '2026-08-06T04:00:00.000Z', limit: 1, concurrency: 1,
    }));
  });

  test('retains public checkpoints without upgrading their run time to a source time', async () => {
    const previous = readFileSync(new URL('./fixtures/domain-control-monitor-v1.json', import.meta.url), 'utf8');
    const passport = readFileSync(new URL('./fixtures/domain-control-manifest-v2.json', import.meta.url), 'utf8');
    const report = await runDomainControlMonitor(passport, previous, {
      executeLookup: async () => result('example.test'), now: () => '2026-08-21T00:00:00.000Z', limit: 1, concurrency: 1,
    });
    assert.equal(report.version, 2);
    assert.equal(report.flightRecorder.summary.observedChanges, 0);
    const priorEvents = report.flightRecorder.events.filter((event) => event.capturedAt === '2026-08-20T00:00:00.000Z');
    assert.equal(priorEvents.length, 13);
    assert.equal(priorEvents.every((event) => event.observedAt === null && event.state === 'partial'), true);
  });

  test('rejects an internally inconsistent source clock before collecting again', async () => {
    const first = await runDomainControlMonitor(JSON.stringify(manifest()), null, {
      executeLookup: async () => result('alpha.test'), now: () => NOW, limit: 1, concurrency: 1,
    });
    const forged = JSON.parse(JSON.stringify(first));
    forged.review.domains[0].comparisons.find((field: { field: string }) => field.field === 'nameservers').observedAt = '2026-08-05T03:00:00.000Z';
    let calls = 0;
    await assert.rejects(() => runDomainControlMonitor(JSON.stringify(manifest()), JSON.stringify(forged), {
      executeLookup: async () => { calls += 1; return result('alpha.test'); },
      now: () => '2026-08-06T04:00:00.000Z', limit: 1, concurrency: 1,
    }), /inconsistent with its observation projection/);
    assert.equal(calls, 0);
  });

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
    const document = JSON.parse(stdout);
    assert.equal(document.schema, 'whoisleuth.cli.domain-control-monitor');
    const recheck = buildInvestigationPlan('post-change-verification', 'alpha.test', NOW)
      .steps.find((step) => step.id === 'recheck');
    assert.ok(recheck);
    assert.equal(recheck.command, 'monitor-once');
    assert.equal(recheck.produces, document.schema);
    assert.equal(document.review.schema, 'whoisleuth.domain-control-review');
    assert.notEqual(recheck.produces, document.review.schema);
    assert.equal(document.flightRecorder.schema, DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA);
    const edge = DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.consumerEdges
      .find((candidate) => candidate.id === 'domain-control-flight-recorder.cli-monitor-embedding');
    assert.equal(edge?.hookIds.includes('domain-control-flight-recorder.cli.monitor'), true);
    assert.equal(edge?.requestMode, 'explicit_bounded_passive_deep');
    assert.equal(edge?.retentionEffect, 'operator_controlled_output');
    const privacy = DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.privacyProfiles
      .find((profile) => profile.id === edge?.privacyProfileId);
    assert.equal(privacy?.sharingReview, 'required');
    assert.equal(privacy?.excludedCategories.includes('raw-upstream-payloads'), true);
  });

  test('preserves terminal, JUnit, quiet, prior-snapshot, and failure-policy paths', async () => {
    const previous = await runDomainControlMonitor(JSON.stringify(manifest()), null, {
      executeLookup: async (classified) => result(classified.registrableDomain || 'example.test'),
      now: () => NOW,
      limit: 1,
      concurrency: 1,
    });
    const outputs = [
      { argv: ['monitor-once', '--limit', '1', '--concurrency', '1', '--no-color'], match: /One-shot domain control review/iu },
      { argv: ['monitor-once', '--limit', '1', '--concurrency', '1', '--junit'], match: /<testsuite/u },
      { argv: ['monitor-once', '--limit', '1', '--concurrency', '1', '--quiet'], match: null },
    ] as const;
    for (const { argv, match } of outputs) {
      let stdout = '';
      const code = await runCli(argv, {
        stdout: { write(value) { stdout += value; } },
        stderr: { write() {} },
        now: () => '2026-08-06T04:00:00.000Z',
        readArtifactInput: async () => JSON.stringify(manifest()),
        runUnifiedLookup: async (classified) => result(classified.registrableDomain || 'example.test'),
      });
      assert.equal(code, EXIT_CODES.SUCCESS);
      if (match) assert.match(stdout, match);
      else assert.equal(stdout, '');
    }

    let previousRead = false;
    assert.equal(await runCli([
      'monitor-once', '--previous', 'previous.json', '--limit', '1', '--concurrency', '1', '--quiet',
    ], {
      stdout: { write() {} },
      stderr: { write() {} },
      now: () => '2026-08-06T04:00:00.000Z',
      readArtifactInput: async () => JSON.stringify(manifest()),
      readDiffInput: async () => { previousRead = true; return JSON.stringify(previous); },
      runUnifiedLookup: async (classified) => result(classified.registrableDomain || 'example.test'),
    }), EXIT_CODES.SUCCESS);
    assert.equal(previousRead, true);

    let policyNotice = '';
    assert.equal(await runCli([
      'monitor-once', '--limit', '2', '--concurrency', '1', '--fail-on', 'source-failure', '--quiet',
    ], {
      stdout: { write() {} },
      stderr: { write(value) { policyNotice += value; } },
      now: () => NOW,
      readArtifactInput: async () => JSON.stringify(manifest()),
      runUnifiedLookup: async (classified) => {
        const domain = classified.registrableDomain || 'example.test';
        if (domain === 'beta.test') throw new Error('Fixture collection failure');
        return result(domain);
      },
    }), EXIT_CODES.PARTIAL_FAILURE);
    assert.match(policyNotice, /source-failure/iu);
  });

  test('propagates cancellation and stops admitting monitor lookups', async () => {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(
      () => runDomainControlMonitor(JSON.stringify(manifest()), null, {
        executeLookup: async () => {
          calls += 1;
          controller.abort(new DOMException('Cancelled', 'AbortError'));
          return result('example.test');
        },
        now: () => NOW,
        limit: 3,
        concurrency: 1,
        signal: controller.signal,
      }),
      { name: 'AbortError' },
    );
    assert.equal(calls, 1);
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
    await assert.rejects(
      () => runDomainControlMonitor(JSON.stringify(manifest()), '', { executeLookup, now: () => NOW, limit: 1, concurrency: 1 }),
      /Previous monitor snapshot must be valid JSON/u,
    );
    await assert.rejects(
      () => runDomainControlMonitor(' '.repeat(MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES + 1), null, { executeLookup, now: () => NOW, limit: 1, concurrency: 1 }),
      /Domain-control manifest exceeds the .*byte limit/u,
    );
    assert.equal(calls, 0);
  });

  test('rejects invalid direct action bounds and expired manifests before collection', async () => {
    let calls = 0;
    const executeLookup = async () => {
      calls += 1;
      return result('example.test');
    };
    for (const options of [
      { limit: 0, concurrency: 1 },
      { limit: 21, concurrency: 1 },
      { limit: 1, concurrency: 0 },
      { limit: 1, concurrency: 4 },
    ]) {
      await assert.rejects(
        () => runDomainControlMonitor(JSON.stringify(manifest()), null, {
          executeLookup,
          now: () => NOW,
          ...options,
        }),
        /monitor (?:limit|concurrency) must be from/iu,
      );
    }

    await assert.rejects(
      () => runDomainControlMonitor(JSON.stringify(manifest()), null, {
        executeLookup,
        now: () => '2026-09-05T04:00:00.000Z',
        limit: 1,
        concurrency: 1,
      }),
      /unexpired manifest/iu,
    );
    await assert.rejects(
      () => runDomainControlMonitor(JSON.stringify(manifest()), null, {
        executeLookup,
        now: () => 'not-a-timestamp',
        limit: 1,
        concurrency: 1,
      }),
      /valid ISO 8601 timestamp/iu,
    );
    assert.equal(calls, 0);
  });
});
