import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { createBulkCheckpointWriter, parseBulkCheckpoint } from '../cli/bulk-checkpoint.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildCliLookupDocument } from '../cli/formatters/json.mts';
import { buildCliLookupDiff } from '../cli/lookup-diff.mts';
import { buildCliLookupReconciliation } from '../cli/lookup-reconcile.mts';
import { buildCliLookupTimeline } from '../cli/lookup-timeline.mts';
import { MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES } from '../cli/investigation-manifest.mts';
import { CLI_PROGRESS_EVENT_SCHEMA, CLI_PROGRESS_EVENT_VERSION, createCliProgressEvents } from '../cli/progress-events.mts';
import { runCli } from '../cli/runner.mts';
import { lookupStrictExitFindings } from '../cli/strict-exit.mts';
import type { BulkLookupResult } from '../cli/bulk.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';

const NOW = '2026-08-01T00:00:00.000Z';

function capture() {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    value: () => value,
  };
}

function classifiedDomain(domain: string): ClassifiedQuery {
  return {
    type: 'domain',
    value: domain,
    inputHostname: domain,
    registrableDomain: domain,
    isSubdomain: false,
  };
}

function lookupResult(domain: string, status = 'success', address?: string) {
  return {
    rdap: {
      parsed: {
        domain: domain.toUpperCase(),
        registrar: { name: domain.startsWith('left') ? 'Registrar One' : 'Registrar Two' },
        lifecycle: { createdDateIso: domain.startsWith('left') ? '2025-01-01T00:00:00.000Z' : '2025-02-01T00:00:00.000Z' },
        nameservers: [`ns1.${domain}`],
      },
    },
    whois: { skipped: true, detail: 'WHOIS is omitted in fast mode.' },
    availability: {
      applicable: true,
      domain,
      state: 'registered',
      confidence: 'high',
      dns: { status: 'success', records: { a: [address ?? (domain.startsWith('left') ? '192.0.2.10' : '192.0.2.20')] } },
    },
    diagnostics: {
      version: 8,
      rdap: { status },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
  };
}

function savedLookup(
  domain: string,
  generatedAt = NOW,
  address?: string,
  collectionContext: Readonly<{ observerLabel?: string; vantageLabel?: string }> = {},
): string {
  return JSON.stringify(buildCliLookupDocument(
    domain,
    classifiedDomain(domain),
    lookupResult(domain, 'success', address),
    generatedAt,
    'fast',
    collectionContext,
  ));
}

describe('CLI automation arguments', () => {
  test('parses opt-in output, strict-exit, event, diff, manual, and checkpoint controls', () => {
    assert.deepEqual(parseCliArguments(['manual']), { action: 'manual' });
    assert.deepEqual(parseCliArguments([
      'manifest', 'lookup.json', 'comparison.json', '--workflow', 'domain review',
      '--configuration-digest', `sha256:${'a'.repeat(64)}`, '--json',
    ]), {
      action: 'manifest', sources: ['lookup.json', 'comparison.json'], workflow: 'domain review',
      configurationDigestSha256: `sha256:${'a'.repeat(64)}`, output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['diff', 'left.json', 'right.json', '--json']), {
      action: 'diff', leftSource: 'left.json', rightSource: 'right.json', leftSessionId: null, rightSessionId: null, output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['diff', 'left.json', 'right.json', '--left-session', 'earlier', '--right-session', 'later']), {
      action: 'diff', leftSource: 'left.json', rightSource: 'right.json', leftSessionId: 'earlier', rightSessionId: 'later', output: 'terminal', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['timeline', 'first.json', 'second.json', 'latest.json', '--json']), {
      action: 'timeline', sources: ['first.json', 'second.json', 'latest.json'], output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['reconcile', 'office.json', 'mobile.json', '--json']), {
      action: 'reconcile', sources: ['office.json', 'mobile.json'], output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['assurance', 'plan.json', '--json']), {
      action: 'assurance', source: 'plan.json', output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['change-packet', 'change.json', '--json']), {
      action: 'change-packet', source: 'change.json', output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['ct-intake', 'events.json', '--json']), {
      action: 'ct-intake', source: 'events.json', output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['map-observations', 'mapping.json', '--json']), {
      action: 'map-observations', source: 'mapping.json', output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['oam-export', 'findings.json', '--json']), {
      action: 'oam-export', source: 'findings.json', output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments([
      'sharing-review', 'packet.json', '--marking', 'amber', '--recipient-scope', 'organization',
      '--purpose', 'Reviewed handoff', '--human-reviewed', '--personal-data-reviewed', '--redactions-confirmed', '--json',
    ]), {
      action: 'sharing-review', source: 'packet.json', output: 'json', marking: 'amber', recipientScope: 'organization',
      purpose: 'Reviewed handoff', humanReviewed: true, personalDataReviewed: true, redactionsConfirmed: true,
      quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['lookup', 'example.test', '--strict-exit', '--output', 'result.json', '--force']), {
      action: 'lookup', query: 'example.test', output: 'terminal', deep: false, detail: 'standard', strictExit: true,
      events: false, plan: false, includeAttribution: true, observerLabel: null, vantageLabel: null, quiet: false, color: true, destination: 'result.json', force: true,
    });
    assert.deepEqual(parseCliArguments(['bulk', '--checkpoint', 'bulk.json', '--resume', '--events']), {
      action: 'bulk', source: null, output: 'terminal', deep: false, quiet: false, color: true, concurrency: 4,
      checkpoint: 'bulk.json', resume: true, events: true, plan: false, filter: 'all',
    });
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--events', '--output', 'result.json']), /cannot be combined/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--force']), /requires --output/u);
    assert.throws(() => parseCliArguments(['bulk', '--resume']), /requires --checkpoint/u);
    assert.throws(() => parseCliArguments(['diff', 'same.json', 'same.json']), /two different input files/u);
    assert.throws(() => parseCliArguments(['timeline', 'one.json']), /from 2 to 20/u);
    assert.throws(() => parseCliArguments(['timeline', 'same.json', 'same.json']), /must be different/u);
    assert.throws(() => parseCliArguments(['reconcile', 'one.json']), /from 2 to 5/u);
    assert.throws(() => parseCliArguments(['manifest', 'one.json']), /requires --workflow/iu);
    assert.throws(() => parseCliArguments(['manifest', 'one.json', 'one.json', '--workflow', 'review']), /must be different/iu);
  });
});

describe('offline domain assurance', () => {
  test('normalises assurance-family read failures through one usage boundary', async () => {
    const cases = [
      { argv: ['manifest', 'artefact.json', '--workflow', 'review'], label: 'manifest artefact' },
      { argv: ['map-observations', 'mapping.json'], label: 'observation mapping' },
      { argv: ['oam-export', 'bridge.json'], label: 'asset bridge' },
      { argv: ['domain-control', 'control.json'], label: 'domain control' },
      { argv: ['assurance', 'assurance.json'], label: 'domain assurance' },
      { argv: ['change-packet', 'change.json'], label: 'domain change packet' },
      {
        argv: [
          'sharing-review', 'packet.json', '--marking', 'amber', '--recipient-scope', 'organization',
          '--purpose', 'Reviewed handoff', '--human-reviewed', '--personal-data-reviewed', '--redactions-confirmed',
        ],
        label: 'sharing review',
      },
      { argv: ['ct-intake', 'events.json'], label: 'certificate event' },
    ] as const;
    for (const { argv, label } of cases) {
      const stdout = capture();
      const stderr = capture();
      const failRead = async () => {
        throw new Error('Input failed\n/private/source-detail');
      };
      const code = await runCli([...argv], {
        stdout: stdout.stream,
        stderr: stderr.stream,
        readDiffInput: failRead,
        readArtifactInput: failRead,
      });
      assert.equal(code, EXIT_CODES.USAGE, label);
      assert.equal(stdout.value(), '', label);
      assert.match(stderr.value(), new RegExp(`Could not read ${label}`, 'iu'), label);
      assert.doesNotMatch(stderr.value(), /[\r\n].*[\r\n]/u, label);
    }
  });

  test('rejects empty and malformed assurance-family documents before processing', async () => {
    const cases = [
      ['map-observations', 'mapping.json'],
      ['oam-export', 'bridge.json'],
      ['domain-control', 'control.json'],
      ['assurance', 'assurance.json'],
      ['change-packet', 'change.json'],
      ['ct-intake', 'events.json'],
    ] as const;
    for (const argv of cases) {
      for (const input of ['', '{"schema":"first","schema":"second"}']) {
        const stdout = capture();
        const stderr = capture();
        const code = await runCli([...argv], {
          stdout: stdout.stream,
          stderr: stderr.stream,
          readArtifactInput: async () => input,
        });
        assert.equal(code, EXIT_CODES.USAGE, `${argv[0]} ${input ? 'malformed' : 'empty'}`);
        assert.equal(stdout.value(), '', argv[0]);
        assert.match(stderr.value(), /Usage error:/u, argv[0]);
      }
    }
  });

  test('reviews a bounded retirement input without network collection', async () => {
    const stdout = capture();
    let lookupCalled = false;
    const code = await runCli(['assurance', 'retirement.json', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readArtifactInput: async () => JSON.stringify({
        schema: 'whoisleuth.domain-assurance.input',
        version: 2,
        kind: 'retirement',
        domain: 'retired.example',
        checks: { autoRenewDisabled: true, registrarLockMaintained: true },
      }),
      runUnifiedLookup: async () => { lookupCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.domain-assurance');
  });

  test('returns partial failure when a pre-sharing review is blocked', async () => {
    const stdout = capture();
    const code = await runCli([
      'sharing-review', 'lookup.json', '--marking', 'clear', '--recipient-scope', 'public',
      '--purpose', 'External handoff', '--json',
    ], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readArtifactInput: async () => savedLookup('share.example'),
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(JSON.parse(stdout.value()).summary.status, 'blocked');
  });

  test('assembles a bounded change packet without network collection', async () => {
    const stdout = capture();
    let lookupCalled = false;
    const change = (address: string) => ({
      schema: 'whoisleuth.domain-change.input', version: 1, domain: 'example.test',
      authoritySnapshots: [
        { label: 'Authority A', source: 'fixture', state: 'observed', observedAt: NOW, records: [{ owner: 'example.test', type: 'A', value: address }] },
        { label: 'Authority B', source: 'fixture', state: 'observed', observedAt: NOW, records: [{ owner: 'example.test', type: 'A', value: address }] },
      ],
      resolverSnapshots: [], acmeDependencies: [], certificate: null, hsts: null,
    });
    const code = await runCli(['change-packet', 'change.json', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readArtifactInput: async () => JSON.stringify({
        schema: 'whoisleuth.domain-change-packet.input', version: 1, domain: 'example.test', reference: 'CHG-42',
        preChange: change('192.0.2.10'), postChange: change('192.0.2.20'),
        assurance: {
          schema: 'whoisleuth.domain-assurance.input', version: 2, kind: 'planned-change', domain: 'example.test',
          change: {
            reference: 'CHG-42', startsAt: '2026-08-05T00:00:00Z', endsAt: '2026-08-05T02:00:00Z',
            milestones: [{ id: 'dns', label: 'DNS published', expectedBy: NOW, evidenceSource: 'fixture', state: 'observed', observedAt: NOW, evidenceReference: 'post:dns' }],
            rollbackCriteria: [{ id: 'rollback-dns', condition: 'DNS is unavailable', owner: 'Change lead', state: 'not_met' }],
            postChangeChecks: [{ id: 'post-dns', label: 'DNS agrees', expectedState: 'aligned', evidenceSource: 'fixture', state: 'matched', evidenceReference: 'post:dns' }],
          },
        },
      }),
      runUnifiedLookup: async () => { lookupCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.domain-change-packet');
  });
});

describe('local certificate event intake', () => {
  test('emits an import-compatible document without network collection', async () => {
    const stdout = capture();
    let lookupCalled = false;
    const code = await runCli(['ct-intake', 'events.json', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readArtifactInput: async () => JSON.stringify({
        schema: 'whoisleuth.ct-event-batch', version: 1,
        source: { name: 'Fixture source', reference: null, collectedAt: NOW },
        events: [{
          logId: 'fixture:1', observedAt: NOW, certificateSha256: 'a'.repeat(64),
          dnsNames: ['event.example.test'], issuer: null, notAfter: null,
          completeness: 'complete', limitations: [],
        }],
      }),
      runUnifiedLookup: async () => { lookupCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.external-findings');
  });

  test('maps source observations and projects them without collection', async () => {
    const mappingStdout = capture();
    const mappedCode = await runCli(['map-observations', 'mapping.json', '--json'], {
      stdout: mappingStdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readArtifactInput: async () => JSON.stringify({
        schema: 'whoisleuth.external-observation-mapping', version: 1,
        source: { name: 'Fixture source', reference: null, collectedAt: NOW },
        profile: {
          id: 'fixture', version: 1, domainField: 'domain', summaryField: 'summary', observedAtField: 'observedAt',
          referenceField: null, completenessField: null, category: 'other', evidenceClass: 'deployment_observation', limitations: [],
        },
        records: [{ domain: 'mapped.example.test', summary: 'Mapped fixture observation', observedAt: NOW }],
      }),
    });
    assert.equal(mappedCode, EXIT_CODES.SUCCESS);
    const bridgeStdout = capture();
    const bridgeCode = await runCli(['oam-export', 'findings.json', '--json'], {
      stdout: bridgeStdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readArtifactInput: async () => mappingStdout.value(),
    });
    assert.equal(bridgeCode, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(bridgeStdout.value()).assets[0]?.type, 'FQDN');
  });
});

describe('reproducible investigation manifest', () => {
  test('reads ordered local artefacts and emits no source paths', async () => {
    const stdout = capture();
    let lookupCalled = false;
    const code = await runCli(['manifest', '/private/lookup.json', '/private/brief.json', '--workflow', 'domain review', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readDiffInput: async (source) => source.endsWith('lookup.json')
        ? '{"schema":"whoisleuth.cli.lookup","version":1}'
        : '{"schema":"whoisleuth.cli.lookup-brief","version":2}',
      runUnifiedLookup: async () => { lookupCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.investigation-manifest');
    assert.doesNotMatch(stdout.value(), /private|lookup\.json|brief\.json/iu);
  });

  test('stops reading manifest sources when their cumulative bytes exceed the bound', async () => {
    const stderr = capture();
    const large = JSON.stringify({ data: 'x'.repeat(Math.floor(MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES / 3) + 1) });
    let reads = 0;
    const code = await runCli([
      'manifest', 'one.json', 'two.json', 'three.json', 'four.json', '--workflow', 'domain review', '--json',
    ], {
      stdout: capture().stream,
      stderr: stderr.stream,
      now: () => NOW,
      readDiffInput: async () => { reads += 1; return large; },
    });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.equal(reads, 3);
    assert.match(stderr.value(), /combined limit/iu);
  });
});

describe('safe local output', () => {
  test('writes privately, refuses replacement by default, and replaces only with --force', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-cli-output-'));
    const destination = join(directory, 'manual.1');
    try {
      const firstStdout = capture();
      assert.equal(await runCli(['manual', '--output', destination], { stdout: firstStdout.stream, stderr: capture().stream }), EXIT_CODES.SUCCESS);
      assert.equal(firstStdout.value(), '');
      assert.match(await readFile(destination, 'utf8'), /^\.TH WHOISLEUTH 1/mu);
      assert.equal((await stat(destination)).mode & 0o777, 0o600);

      const refused = capture();
      assert.equal(await runCli(['manual', '--output', destination], { stderr: refused.stream }), EXIT_CODES.USAGE);
      assert.match(refused.value(), /already exists/u);

      await writeFile(destination, 'stale\n', { mode: 0o600 });
      assert.equal(await runCli(['manual', '--output', destination, '--force'], { stderr: capture().stream }), EXIT_CODES.SUCCESS);
      assert.match(await readFile(destination, 'utf8'), /^\.TH WHOISLEUTH 1/mu);
      assert.equal((await stat(destination)).mode & 0o777, 0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('does not publish an output file when command execution fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-cli-failed-output-'));
    const destination = join(directory, 'lookup.json');
    try {
      const code = await runCli(['lookup', 'example.test', '--json', '--output', destination], {
        stderr: capture().stream,
        classifyQuery: () => classifiedDomain('example.test'),
        runUnifiedLookup: async () => { throw new Error('bounded upstream failure'); },
      });
      assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
      await assert.rejects(readFile(destination, 'utf8'), (error: unknown) => (
        Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      ));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('saves one exact completed browser document privately and never overwrites it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-cli-browser-save-'));
    const destination = join(directory, 'lookup.json');
    try {
      const code = await runCli(['lookup', 'example.test', '--browse', '--save-lookup', destination], {
        stdout: capture().stream,
        stderr: capture().stream,
        canBrowseLookup: () => true,
        classifyQuery: () => classifiedDomain('example.test'),
        runUnifiedLookup: async () => lookupResult('example.test'),
        browseLookupOperation: async (options) => options.collect!({
          signal: new AbortController().signal,
          onSourceSettled: () => undefined,
        }),
      });
      assert.equal(code, EXIT_CODES.SUCCESS);
      const saved = JSON.parse(await readFile(destination, 'utf8'));
      assert.equal(saved.schema, 'whoisleuth.cli.lookup');
      assert.equal(saved.query, 'example.test');
      assert.equal((await stat(destination)).mode & 0o777, 0o600);

      const refused = capture();
      assert.equal(await runCli(['lookup', 'example.test', '--browse', '--save-lookup', destination], {
        stdout: capture().stream,
        stderr: refused.stream,
        canBrowseLookup: () => true,
        classifyQuery: () => classifiedDomain('example.test'),
        runUnifiedLookup: async () => lookupResult('example.test'),
        browseLookupOperation: async (options) => options.collect!({
          signal: new AbortController().signal,
          onSourceSettled: () => undefined,
        }),
      }), EXIT_CODES.USAGE);
      assert.match(refused.value(), /already exists/u);
      assert.equal(JSON.parse(await readFile(destination, 'utf8')).generatedAt, saved.generatedAt);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('does not save a partial document when collection or browser review fails', async () => {
    for (const failure of ['collection', 'browser'] as const) {
      const directory = await mkdtemp(join(tmpdir(), `whoisleuth-cli-browser-${failure}-`));
      const destination = join(directory, 'lookup.json');
      try {
        const code = await runCli(['lookup', 'example.test', '--browse', '--save-lookup', destination], {
          stdout: capture().stream,
          stderr: capture().stream,
          canBrowseLookup: () => true,
          classifyQuery: () => classifiedDomain('example.test'),
          runUnifiedLookup: async () => {
            if (failure === 'collection') throw new Error('fixture collection failure');
            return lookupResult('example.test');
          },
          browseLookupOperation: async (options) => {
            await options.collect!({
              signal: new AbortController().signal,
              onSourceSettled: () => undefined,
            });
            throw new Error('fixture browser failure');
          },
        });
        assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
        await assert.rejects(readFile(destination, 'utf8'), (error: unknown) => (
          Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        ));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test('does not begin a local save after cancellation wins the post-browser boundary', async () => {
    const controller = new AbortController();
    let saveCalls = 0;
    const code = await runCli(['lookup', 'example.test', '--browse', '--save-lookup', 'fixture-review.json'], {
      stdout: capture().stream,
      stderr: capture().stream,
      signal: controller.signal,
      canBrowseLookup: () => true,
      classifyQuery: () => classifiedDomain('example.test'),
      runUnifiedLookup: async () => lookupResult('example.test'),
      browseLookupOperation: async (options) => {
        const document = await options.collect!({
          signal: controller.signal,
          onSourceSettled: () => undefined,
        });
        controller.abort(new DOMException('Aborted', 'AbortError'));
        return document;
      },
      writePrivateFile: async () => {
        saveCalls += 1;
        return 'fixture-review.json';
      },
    });
    assert.equal(code, EXIT_CODES.CANCELLED);
    assert.equal(saveCalls, 0);
  });
});

describe('strict exit and machine progress events', () => {
  test('treats requested source health as strict while keeping skipped and attempt history neutral', () => {
    assert.deepEqual(lookupStrictExitFindings({
      diagnostics: {
        rdap: { status: 'success', attempts: [{ outcome: 'rate_limited' }] },
        whois: { status: 'skipped' },
        registrar: { status: 'partial' },
      },
    }), [{ path: 'diagnostics.registrar.status', state: 'partial' }]);
  });

  test('keeps the final JSON document on stdout and emits only versioned JSONL on stderr', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['lookup', 'example.test', '--deep', '--json', '--strict-exit', '--events'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => NOW,
      classifyQuery: () => classifiedDomain('example.test'),
      runUnifiedLookup: async (_classified, options) => {
        options?.onSourceSettled?.({
          source: 'rdap', state: 'partial', complete: false, truncated: false,
          fragment: { status: 'partial', limitation: 'This source returned incomplete evidence; missing fields remain unknown.' },
        });
        return lookupResult('example.test', 'partial');
      },
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.cli.lookup');
    const events = stderr.value().trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.event), ['started', 'source_settled', 'completed']);
    assert.ok(events.every((event, index) => event.schema === CLI_PROGRESS_EVENT_SCHEMA
      && event.version === CLI_PROGRESS_EVENT_VERSION
      && event.sequence === index));
    assert.equal(events.at(-1).exitCode, EXIT_CODES.PARTIAL_FAILURE);
    assert.doesNotMatch(stderr.value(), /example\.test/u);
  });

  test('represents usage failure as a terminal event without mixing human text into JSONL', async () => {
    const stderr = capture();
    const code = await runCli(['lookup', '--events'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      readStdin: async () => '',
      now: () => NOW,
    });
    assert.equal(code, EXIT_CODES.USAGE);
    const events = stderr.value().trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.event), ['started', 'failed']);
    assert.deepEqual(events.at(-1), {
      schema: CLI_PROGRESS_EVENT_SCHEMA,
      version: CLI_PROGRESS_EVENT_VERSION,
      sequence: 1,
      generatedAt: NOW,
      command: 'lookup',
      event: 'failed',
      state: 'usage',
      reason: 'missing_input',
      exitCode: EXIT_CODES.USAGE,
    });
  });

  test('escapes terminal-unsafe Unicode in machine progress events without changing parsed values', () => {
    const stderr = capture();
    const events = createCliProgressEvents(stderr.stream, {
      command: 'lookup', enabled: true, now: () => NOW,
    });
    events.emit({
      event: 'warning',
      source: 'fixture\u009bsource',
      state: 'partial\u202e',
      reason: 'line\u2028break\u00admarker',
    });

    assert.doesNotMatch(stderr.value(), /[\u007f-\u009f\u2028\u2029]|\p{Default_Ignorable_Code_Point}/u);
    const parsed = JSON.parse(stderr.value());
    assert.equal(parsed.source, 'fixture\u009bsource');
    assert.equal(parsed.state, 'partial\u202e');
    assert.equal(parsed.reason, 'line break\u00admarker');
  });
});

describe('direct reports and saved Lookup diff', () => {
  test('retains analyst-supplied observation labels without changing collection', async () => {
    const stdout = capture();
    const code = await runCli([
      'lookup', 'example.test', '--json', '--observer', 'Office resolver', '--vantage', 'Melbourne fibre',
    ], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      classifyQuery: () => classifiedDomain('example.test'),
      runUnifiedLookup: async () => lookupResult('example.test'),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(JSON.parse(stdout.value()).collectionContext, {
      observerLabel: 'Office resolver',
      vantageLabel: 'Melbourne fibre',
    });
  });

  test('renders Markdown and HTML directly from one completed domain lookup', async () => {
    for (const [flag, marker] of [['--markdown', '# Lookup evidence report'], ['--html', '<!doctype html>']] as const) {
      const stdout = capture();
      const code = await runCli(['lookup', 'example.test', flag], {
        stdout: stdout.stream,
        stderr: capture().stream,
        now: () => NOW,
        classifyQuery: () => classifiedDomain('example.test'),
        runUnifiedLookup: async () => lookupResult('example.test'),
      });
      assert.equal(code, EXIT_CODES.SUCCESS);
      assert.match(stdout.value(), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
      assert.match(stdout.value(), /Generated with WHOISleuth/u);
      assert.doesNotMatch(stdout.value(), /raw response|authorization header/iu);
    }
  });

  test('can omit only the direct report generator footer', async () => {
    const stdout = capture();
    const code = await runCli(['lookup', 'example.test', '--markdown', '--no-attribution'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      classifyQuery: () => classifiedDomain('example.test'),
      runUnifiedLookup: async () => lookupResult('example.test'),
    });

    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.match(stdout.value(), /\*\*Generator:\*\* WHOISleuth/u);
    assert.doesNotMatch(stdout.value(), /Generated with WHOISleuth/u);
  });

  test('rejects a direct report for non-domain input before collection starts', async () => {
    let lookupCalled = false;
    const stderr = capture();
    const code = await runCli(['lookup', 'AS64500', '--markdown'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      classifyQuery: () => ({ type: 'asn', value: 'AS64500' }),
      runUnifiedLookup: async () => { lookupCalled = true; },
    });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.equal(lookupCalled, false);
    assert.match(stderr.value(), /domain lookups only/u);
  });

  test('compares two bounded saved observations without making a network request', async () => {
    const left = savedLookup('left.example');
    const right = savedLookup('right.example');
    const direct = buildCliLookupDiff(left, right, NOW);
    assert.equal(direct.schema, 'whoisleuth.cli.lookup-diff');
    assert.ok(direct.comparison.counts.different + direct.comparison.counts.conflicting > 0);
    assert.equal(direct.comparison.rows.find((row) => row.id === 'official-assets')?.state, 'equal');
    assert.equal(direct.comparison.rows.find((row) => row.id === 'official-assets')?.left, 'Not observed');
    assert.equal(direct.comparison.rows.find((row) => row.id === 'official-assets')?.right, 'Not observed');
    assert.equal(direct.comparison.rows.find((row) => row.id === 'ip-addresses')?.state, 'different');

    const stdout = capture();
    let lookupCalled = false;
    const code = await runCli(['diff', 'left.json', 'right.json', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readDiffInput: async (source) => source === 'left.json' ? left : right,
      runUnifiedLookup: async () => { lookupCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.cli.lookup-diff');
    assert.doesNotMatch(stdout.value(), /response|contact/iu);
  });

  test('orders and compares a bounded same-domain observation history offline', async () => {
    const oldest = savedLookup('history.example', '2026-06-01T00:00:00.000Z', '192.0.2.10');
    const middle = savedLookup('history.example', '2026-07-01T00:00:00.000Z', '192.0.2.20');
    const latest = savedLookup('history.example', '2026-08-01T00:00:00.000Z', '192.0.2.30');
    const direct = buildCliLookupTimeline([latest, oldest, middle], NOW);
    assert.equal(direct.schema, 'whoisleuth.cli.lookup-timeline');
    assert.deepEqual(direct.observations.map((item) => item.generatedAt), [
      '2026-06-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
    ]);
    assert.equal(direct.summary.transitionCount, 2);
    assert.equal(direct.summary.transitionsWithObservedChanges, 2);
    assert.ok(direct.transitions.every((item) => item.comparison.leftDomain === 'history.example'
      && item.comparison.rightDomain === 'history.example'));

    const stdout = capture();
    let lookupCalled = false;
    const inputs: Record<string, string> = { 'first.json': oldest, 'second.json': middle, 'latest.json': latest };
    const code = await runCli(['timeline', 'latest.json', 'first.json', 'second.json', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readDiffInput: async (source) => inputs[source] || '',
      runUnifiedLookup: async () => { lookupCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.cli.lookup-timeline');
    assert.doesNotMatch(stdout.value(), /first\.json|second\.json|latest\.json/iu);
    assert.equal(JSON.parse(stdout.value()).privacy.rawRegistryPayloadsCopied, 0);

    assert.throws(
      () => buildCliLookupTimeline([oldest, savedLookup('other.example', '2026-07-01T00:00:00.000Z')], NOW),
      /exactly one domain/u,
    );
    assert.throws(() => buildCliLookupTimeline([oldest, oldest], NOW), /observation times must be unique/u);

    const legacyZoneLess = JSON.parse(savedLookup('history.example')) as Record<string, unknown>;
    legacyZoneLess.version = 1;
    legacyZoneLess.generatedAt = '2026-01-15T12:00:00';
    const legacyExplicit = JSON.parse(savedLookup('history.example')) as Record<string, unknown>;
    legacyExplicit.version = 1;
    legacyExplicit.generatedAt = '2026-01-15T01:30:00.000Z';
    const before = structuredClone(legacyZoneLess);
    assert.throws(
      () => buildCliLookupTimeline([JSON.stringify(legacyZoneLess), JSON.stringify(legacyExplicit)], NOW),
      /explicit timezone/u,
    );
    assert.deepEqual(legacyZoneLess, before);
    assert.deepEqual(
      buildCliLookupTimeline([JSON.stringify(legacyExplicit), oldest], NOW)
        .observations.map((item) => item.generatedAt),
      ['2026-01-15T01:30:00.000Z', '2026-06-01T00:00:00.000Z'],
    );
  });

  test('reconciles labelled same-domain observations without retaining filenames or voting on truth', async () => {
    const office = savedLookup('reconcile.example', '2026-06-01T00:00:00.000Z', '192.0.2.10', {
      observerLabel: 'Office', vantageLabel: 'Resolver A',
    });
    const mobile = savedLookup('reconcile.example', '2026-06-01T00:01:00.000Z', '192.0.2.20', {
      observerLabel: 'Mobile', vantageLabel: 'Resolver B',
    });
    const direct = buildCliLookupReconciliation([office, mobile], NOW);
    assert.equal(direct.schema, 'whoisleuth.cli.lookup-reconciliation');
    assert.equal(direct.independence.state, 'verified_distinct_labels');
    assert.ok(direct.summary.disagreement > 0);
    assert.equal(direct.privacy.filenamesRetained, 0);

    const stdout = capture();
    const inputs: Record<string, string> = { 'office.json': office, 'mobile.json': mobile };
    const code = await runCli(['reconcile', 'office.json', 'mobile.json', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      readDiffInput: async (source) => inputs[source] || '',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.cli.lookup-reconciliation');
    assert.doesNotMatch(stdout.value(), /office\.json|mobile\.json/iu);

    const unlabelled = buildCliLookupReconciliation([
      savedLookup('reconcile.example', '2026-06-01T00:02:00.000Z'),
      savedLookup('reconcile.example', '2026-06-01T00:03:00.000Z'),
    ], NOW);
    assert.equal(unlabelled.independence.state, 'unverified');
  });
});

describe('resumable Bulk checkpoints', () => {
  test('creates a private compact checkpoint and validates matching resume input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-cli-checkpoint-'));
    const path = join(directory, 'bulk.json');
    const queries = ['one.example', 'two.example'];
    const first: BulkLookupResult = {
      index: 0,
      query: queries[0]!,
      ok: true,
      classified: classifiedDomain(queries[0]!),
      result: {
        availability: lookupResult(queries[0]!).availability,
        diagnostics: lookupResult(queries[0]!).diagnostics,
      },
    };
    try {
      const writer = await createBulkCheckpointWriter({ path, queries, deep: false, resume: false, classifyQuery: classifiedDomain, now: () => NOW });
      writer.record(first);
      await writer.flush();
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      const checkpointText = await readFile(path, 'utf8');
      const checkpoint = parseBulkCheckpoint(checkpointText, { queries, deep: false, classifyQuery: classifiedDomain });
      assert.deepEqual(checkpoint.results.map((item) => item.query), ['one.example']);
      assert.equal(checkpoint.version, 2);
      assert.equal(checkpoint.results[0]?.observedAt, NOW);

      const zoneLess = JSON.parse(checkpointText);
      zoneLess.startedAt = '2026-08-01T00:00:00';
      assert.throws(
        () => parseBulkCheckpoint(JSON.stringify(zoneLess), { queries, deep: false, classifyQuery: classifiedDomain }),
        /metadata is invalid/u,
      );

      const fullResponse = JSON.parse(checkpointText);
      fullResponse.results[0].result.rdap = { raw: 'not compact evidence' };
      assert.throws(
        () => parseBulkCheckpoint(JSON.stringify(fullResponse), { queries, deep: false, classifyQuery: classifiedDomain }),
        /invalid or duplicate result/u,
      );

      const tooDeep = JSON.parse(checkpointText);
      let nested = tooDeep.results[0].result.availability;
      for (let depth = 0; depth < 14; depth++) {
        nested.next = {};
        nested = nested.next;
      }
      assert.throws(
        () => parseBulkCheckpoint(JSON.stringify(tooDeep), { queries, deep: false, classifyQuery: classifiedDomain }),
        /invalid or duplicate result/u,
      );

      const resumed = await createBulkCheckpointWriter({ path, queries, deep: false, resume: true, classifyQuery: classifiedDomain, now: () => NOW });
      assert.deepEqual(resumed.initialResults.map((item) => item.query), ['one.example']);
      assert.equal(resumed.initialResults[0]?.collectionOrigin, 'resumed_checkpoint');
      await assert.rejects(
        createBulkCheckpointWriter({ path, queries: ['changed.example'], deep: false, resume: true, classifyQuery: classifiedDomain }),
        /does not match/u,
      );

      const malformedPath = join(directory, 'malformed.json');
      const malformed = await createBulkCheckpointWriter({
        path: malformedPath,
        queries: ['one.example'],
        deep: false,
        resume: false,
        classifyQuery: classifiedDomain,
        now: () => NOW,
      });
      malformed.record({
        index: 0,
        query: 'one.example',
        ok: true,
        classified: classifiedDomain('one.example'),
        result: lookupResult('one.example'),
      });
      await assert.rejects(malformed.flush(), /not a bounded compact lookup result/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects a reader-only checkpoint without inventing observation time', () => {
    const queries = ['legacy.example'];
    const legacy = {
      schema: 'whoisleuth.cli.bulk-checkpoint',
      version: 1,
      mode: 'fast',
      inputDigestSha256: createHash('sha256').update('fast\n').update(queries.join('\n')).digest('hex'),
      queryCount: 1,
      startedAt: '2026-08-01T00:00:00.000',
      updatedAt: '2026-08-01T00:01:00.000',
      results: [{
        index: 0,
        query: queries[0],
        ok: true,
        classified: classifiedDomain(queries[0]!),
        result: {
          availability: lookupResult(queries[0]!).availability,
          diagnostics: lookupResult(queries[0]!).diagnostics,
        },
      }],
    };
    const before = structuredClone(legacy);
    assert.throws(() => parseBulkCheckpoint(JSON.stringify(legacy), {
      queries,
      deep: false,
      classifyQuery: classifiedDomain,
    }), /version 2/u);
    assert.deepEqual(legacy, before);
  });

  test('coalesces settlement bursts into one active write and one follow-up', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-cli-checkpoint-coalesce-'));
    const path = join(directory, 'bulk.json');
    const queries = Array.from({ length: 100 }, (_, index) => `item-${index}.example`);
    let releaseFirstWrite: (() => void) | undefined;
    let writes = 0;
    try {
      const writer = await createBulkCheckpointWriter({
        path,
        queries,
        deep: false,
        resume: false,
        classifyQuery: classifiedDomain,
        now: () => NOW,
        writeFile: async () => {
          writes += 1;
          if (writes === 1) await new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
          return path;
        },
      });
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      for (let index = 0; index < queries.length; index += 1) {
        const query = queries[index]!;
        writer.record({
          index,
          query,
          ok: true,
          classified: classifiedDomain(query),
          result: {
            availability: lookupResult(query).availability,
            diagnostics: lookupResult(query).diagnostics,
          },
        });
      }
      releaseFirstWrite?.();
      await writer.flush();
      assert.equal(writes, 2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('keeps completed output when the final checkpoint write fails', async () => {
    const stdout = capture();
    const stderr = capture();
    const recorded: BulkLookupResult[] = [];
    const code = await runCli(['bulk', '--json', '--checkpoint', 'fixture-checkpoint.json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => NOW,
      readBulkInput: async () => 'one.example\ntwo.example\n',
      classifyQuery: classifiedDomain,
      runUnifiedLookup: async (classified) => lookupResult(classified.value),
      createBulkCheckpointWriter: async () => ({
        initialResults: [],
        record(result) { recorded.push(result); },
        async flush() { throw new Error('fixture checkpoint destination unavailable'); },
      }),
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(recorded.length, 2);
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.bulk');
    assert.equal(document.results.length, 2);
    assert.match(stderr.value(), /Checkpoint warning: fixture checkpoint destination unavailable/u);
    assert.doesNotMatch(stderr.value(), /one\.example|two\.example/u);
  });

  test('uses checkpoint-specific guidance if creation loses an existence race', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-cli-checkpoint-race-'));
    const path = join(directory, 'bulk.json');
    try {
      const writer = await createBulkCheckpointWriter({
        path,
        queries: ['one.example'],
        deep: false,
        resume: false,
        classifyQuery: classifiedDomain,
        now: () => NOW,
      });
      await writeFile(path, 'racing writer\n', { mode: 0o600 });
      await assert.rejects(writer.flush(), /use --resume or choose another path/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('keeps checkpoint failure target-free in machine progress events', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['bulk', '--json', '--events', '--checkpoint', 'fixture-checkpoint.json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => NOW,
      readBulkInput: async () => 'one.example\n',
      classifyQuery: classifiedDomain,
      runUnifiedLookup: async (classified) => lookupResult(classified.value),
      createBulkCheckpointWriter: async () => ({
        initialResults: [],
        record() {},
        async flush() { throw new Error('one.example must not be emitted'); },
      }),
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(JSON.parse(stdout.value()).results.length, 1);
    const events = stderr.value().trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.event), ['started', 'item_settled', 'warning', 'completed']);
    assert.equal(events.at(-2).state, 'checkpoint_unavailable');
    assert.equal(events.at(-1).exitCode, EXIT_CODES.PARTIAL_FAILURE);
    assert.doesNotMatch(stderr.value(), /one\.example/u);
  });
});

describe('analyst cancellation', () => {
  test('returns 130 and emits no partial result when an in-flight lookup is cancelled', async () => {
    const controller = new AbortController();
    const stdout = capture();
    const stderr = capture();
    const command = runCli(['lookup', 'example.test'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      signal: controller.signal,
      classifyQuery: () => classifiedDomain('example.test'),
      runUnifiedLookup: async () => new Promise(() => {}),
    });
    setImmediate(() => controller.abort());
    assert.equal(await command, EXIT_CODES.CANCELLED);
    assert.equal(stdout.value(), '');
    assert.equal(stderr.value(), 'Cancelled by analyst.\n');
  });
});
