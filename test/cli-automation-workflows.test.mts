import assert from 'node:assert/strict';
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
import { CLI_PROGRESS_EVENT_SCHEMA, CLI_PROGRESS_EVENT_VERSION } from '../cli/progress-events.mts';
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

function lookupResult(domain: string, status = 'success') {
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
      dns: { status: 'success', records: { a: domain.startsWith('left') ? ['192.0.2.10'] : ['192.0.2.20'] } },
    },
    diagnostics: {
      version: 8,
      rdap: { status },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
  };
}

function savedLookup(domain: string): string {
  return JSON.stringify(buildCliLookupDocument(
    domain,
    classifiedDomain(domain),
    lookupResult(domain),
    NOW,
    'fast',
  ));
}

describe('CLI automation arguments', () => {
  test('parses opt-in output, strict-exit, event, diff, manual, and checkpoint controls', () => {
    assert.deepEqual(parseCliArguments(['manual']), { action: 'manual' });
    assert.deepEqual(parseCliArguments(['diff', 'left.json', 'right.json', '--json']), {
      action: 'diff', leftSource: 'left.json', rightSource: 'right.json', output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['lookup', 'example.test', '--strict-exit', '--output', 'result.json', '--force']), {
      action: 'lookup', query: 'example.test', output: 'terminal', deep: false, detail: 'standard', strictExit: true,
      events: false, quiet: false, color: true, destination: 'result.json', force: true,
    });
    assert.deepEqual(parseCliArguments(['bulk', '--checkpoint', 'bulk.json', '--resume', '--events']), {
      action: 'bulk', source: null, output: 'terminal', deep: false, quiet: false, color: true, concurrency: 4,
      checkpoint: 'bulk.json', resume: true, events: true,
    });
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--events', '--output', 'result.json']), /cannot be combined/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--force']), /requires --output/u);
    assert.throws(() => parseCliArguments(['bulk', '--resume']), /requires --checkpoint/u);
    assert.throws(() => parseCliArguments(['diff', 'same.json', 'same.json']), /two different input files/u);
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
});

describe('direct reports and saved Lookup diff', () => {
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
      assert.doesNotMatch(stdout.value(), /raw response|authorization header/iu);
    }
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
