import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { CLI_COMMANDS, parseCliArguments } from '../cli/arguments.mts';
import { boundedCliErrorMessage } from '../cli/errors.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildCliLookupDocument } from '../cli/formatters/json.mts';
import { formatTerminalLookup, safeTerminalValue } from '../cli/formatters/terminal.mts';
import { MAX_STDIN_BYTES, readStdinBounded, runCli } from '../cli/runner.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import type { LookupSourceSettlement } from '../lib/lookup.mts';
import {
  httpDeliveryMetadataFixture,
  pagePublicationMetadataFixture,
} from './homepage-metadata-fixtures.mts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function capture() {
  let value = '';
  return { stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }), value: () => value };
}

function lookupResult(overrides = {}) {
  return {
    rdap: { parsed: { domain: 'EXAMPLE.COM' } },
    whois: { skipped: true, detail: 'WHOIS is omitted in fast mode.' },
    availability: { applicable: true, domain: 'example.com', state: 'registered', confidence: 'high' },
    diagnostics: { version: 4, rdap: { status: 'success', endpoint: 'https://rdap.invalid/domain/example.com' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    ...overrides,
  };
}

function classifiedDomain(value: string, inputHostname = value): ClassifiedQuery {
  return {
    type: 'domain',
    value,
    inputHostname,
    registrableDomain: value,
    isSubdomain: inputHostname !== value,
  };
}

describe('CLI argument parsing', () => {
  test('defaults lookup to fast terminal output', () => {
    assert.deepEqual(parseCliArguments(['lookup', 'example.com']), { action: 'lookup', query: 'example.com', output: 'terminal', deep: false, detail: 'standard', strictExit: false, events: false, plan: false, includeAttribution: true, observerLabel: null, vantageLabel: null, quiet: false, color: true });
  });

  test('delegates strict direct targets to the unchanged Lookup argument parser', () => {
    for (const target of [
      'example.com',
      'login.example.com',
      'example.com.',
      'münchen.example',
      '192.0.2.10',
      '2001:db8::10',
      'AS64496',
      '64496',
    ]) {
      assert.deepEqual(parseCliArguments([target]), parseCliArguments(['lookup', target]), target);
      assert.deepEqual(
        parseCliArguments([target, '--deep', '--json', '--observer', 'workstation-a', '--vantage', 'office-egress']),
        parseCliArguments(['lookup', target, '--deep', '--json', '--observer', 'workstation-a', '--vantage', 'office-egress']),
        target,
      );
    }
    assert.deepEqual(
      parseCliArguments(['example.com', '--deep', '--plan', '--json']),
      parseCliArguments(['lookup', 'example.com', '--deep', '--plan', '--json']),
    );
    assert.deepEqual(
      parseCliArguments(['example.com', '--deep', '--browse']),
      parseCliArguments(['lookup', 'example.com', '--deep', '--browse']),
    );
    assert.deepEqual(
      parseCliArguments(['example.com', '--json', '--output', 'lookup.json', '--force']),
      parseCliArguments(['lookup', 'example.com', '--json', '--output', 'lookup.json', '--force']),
    );
  });

  test('accepts explicit deep JSON output and bounded stdin mode', () => {
    assert.deepEqual(parseCliArguments(['lookup', '--deep', '--json', '--no-color']), { action: 'lookup', query: null, output: 'json', deep: true, detail: 'standard', strictExit: false, events: false, plan: false, includeAttribution: true, observerLabel: null, vantageLabel: null, quiet: false, color: false });
  });

  test('rejects unknown commands, options, conflicting modes, and multiple queries', () => {
    assert.throws(() => parseCliArguments(['unknown', 'x']), /Unknown command/);
    for (const value of [
      'not-a-command',
      'https://example.com',
      'example.com/path',
      'user@example.com',
      'example.com:443',
      '[2001:db8::10]',
      'fe80::1%en0',
      'AS4294967296',
      'report.json',
      'not.a.command',
      'typo.internal',
      'service.onion',
      'router.home.arpa',
      '1.0.0.127.in-addr.arpa',
    ]) {
      assert.throws(() => parseCliArguments([value]), /Unknown command/, value);
    }
    assert.throws(() => parseCliArguments(['lookup', '--wat']), /Unknown option/);
    assert.throws(() => parseCliArguments(['lookup', '--deep', '--fast']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['lookup', '--fast', '--deep']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['lookup', '--fast', '--fast']), /only once/);
    assert.throws(() => parseCliArguments(['lookup', 'one.com', 'two.com']), /one query/);
    assert.throws(() => parseCliArguments(['lookup', 'x', '--json', '--quiet']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['lookup', 'x', '--summary', '--verbose']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['lookup', 'x', '--summary', '--json']), /terminal output/);
    for (const character of ['\u00ad', '\u034f', '\u180e', '\u200d', '\u2060', '\ufe0f']) {
      assert.throws(
        () => parseCliArguments(['lookup', `exa${character}mple.test`]),
        /bounded text without control characters/u,
      );
    }
  });

  test('parses terminal detail, completion, and offline-first doctor options', () => {
    assert.deepEqual(parseCliArguments(['lookup', 'example.test', '--summary']), {
      action: 'lookup',
      query: 'example.test',
      output: 'terminal',
      deep: false,
      detail: 'summary',
      strictExit: false,
      events: false,
      plan: false,
      includeAttribution: true,
      observerLabel: null,
      vantageLabel: null,
      quiet: false,
      color: true,
    });
    assert.deepEqual(parseCliArguments(['lookup', 'example.test', '--verbose']), {
      action: 'lookup',
      query: 'example.test',
      output: 'terminal',
      deep: false,
      detail: 'verbose',
      strictExit: false,
      events: false,
      plan: false,
      includeAttribution: true,
      observerLabel: null,
      vantageLabel: null,
      quiet: false,
      color: true,
    });
    assert.deepEqual(parseCliArguments(['completion', 'zsh']), { action: 'completion', shell: 'zsh' });
    assert.deepEqual(parseCliArguments(['completion', 'powershell']), { action: 'completion', shell: 'powershell' });
    assert.deepEqual(parseCliArguments(['doctor']), {
      action: 'doctor', network: false, output: 'terminal', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['doctor', '--network', '--json']), {
      action: 'doctor', network: true, output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['commands', '--json']), {
      action: 'commands', output: 'json', common: false, group: null, mode: null, quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['commands', '--common', '--group', 'respond', '--mode', 'offline']), {
      action: 'commands', output: 'terminal', common: true, group: 'respond', mode: 'offline', quiet: false, color: true,
    });
    assert.throws(() => parseCliArguments(['completion', 'nushell']), /bash, zsh, fish, or powershell/u);
    assert.throws(() => parseCliArguments(['doctor', '--network', '--network']), /only once/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--plan', '--events']), /cannot be combined/u);
  });

  test('parses explicit terminal palettes and browser-only private Lookup saves', () => {
    assert.deepEqual(parseCliArguments(['lookup', 'example.test', '--deep', '--browse', '--palette', 'dark', '--save-lookup', 'review.json']), {
      action: 'lookup',
      query: 'example.test',
      output: 'terminal',
      deep: true,
      detail: 'standard',
      strictExit: false,
      events: false,
      plan: false,
      includeAttribution: true,
      observerLabel: null,
      vantageLabel: null,
      quiet: false,
      color: true,
      browse: true,
      saveLookup: 'review.json',
      palette: 'dark',
    });
    assert.equal(parseCliArguments(['commands', '--palette', 'light']).palette, 'light');
    assert.throws(() => parseCliArguments(['--palette', 'light', 'commands']), /Unknown command/u);
    assert.throws(() => parseCliArguments(['commands', '--palette', 'sepia']), /auto, light, or dark/u);
    assert.throws(() => parseCliArguments(['commands', '--palette', 'dark', '--palette', 'light']), /only once/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--save-lookup', 'review.json']), /requires --browse/u);
    assert.throws(() => parseCliArguments(['lookup', '--browse']), /requires a positional target/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--browse', '--save-lookup']), /bounded file path/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--browse', '--save-lookup', '-']), /bounded file path/u);
  });

  test('help and version actions never require a command', () => {
    assert.deepEqual(parseCliArguments([]), { action: 'help' });
    assert.deepEqual(parseCliArguments(['lookup', '--help']), { action: 'help', command: 'lookup' });
    assert.deepEqual(parseCliArguments(['registry-support', '-h']), { action: 'help', command: 'registry-support' });
    assert.throws(() => parseCliArguments(['lookup', 'example.com', '--help']), /Help accepts/);
    assert.deepEqual(parseCliArguments(['--version']), { action: 'version' });
  });

  test('launches only zero-argument capable terminals and preserves explicit help', async () => {
    const stdout = capture();
    const stderr = capture();
    let launches = 0;
    assert.equal(await runCli([], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      canLaunchInteractiveCli: () => true,
      launchInteractiveCli: async () => {
        launches += 1;
        return ['commands', '--json'];
      },
    }), EXIT_CODES.SUCCESS);
    assert.equal(launches, 1);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.cli.command-catalogue');

    const helpStdout = capture();
    assert.equal(await runCli(['--help'], {
      stdout: helpStdout.stream,
      stderr: capture().stream,
      canLaunchInteractiveCli: () => true,
      launchInteractiveCli: async () => {
        launches += 1;
        return ['commands'];
      },
    }), EXIT_CODES.SUCCESS);
    assert.equal(launches, 1);
    assert.match(helpStdout.value(), /WHOISleuth CLI/u);
  });

  test('maps interactive cancellation and failures before any command execution', async () => {
    let launchedCommands = 0;
    const cancelledStderr = capture();
    assert.equal(await runCli([], {
      stdout: capture().stream,
      stderr: cancelledStderr.stream,
      canLaunchInteractiveCli: () => true,
      launchInteractiveCli: async () => null,
      runUnifiedLookup: async () => { launchedCommands += 1; return lookupResult(); },
    }), EXIT_CODES.SUCCESS);
    assert.equal(launchedCommands, 0);

    const abortedStderr = capture();
    assert.equal(await runCli([], {
      stdout: capture().stream,
      stderr: abortedStderr.stream,
      canLaunchInteractiveCli: () => true,
      launchInteractiveCli: async () => { throw new DOMException('Aborted', 'AbortError'); },
      runUnifiedLookup: async () => { launchedCommands += 1; return lookupResult(); },
    }), EXIT_CODES.CANCELLED);
    assert.match(abortedStderr.value(), /Cancelled by analyst/u);
    assert.equal(launchedCommands, 0);
  });

  test('help groups commands by analyst job and gives each a purpose, example, and boundary', async () => {
    const stdout = capture();
    const stderr = capture();
    assert.equal(await runCli([], { stdout: stdout.stream, stderr: stderr.stream }), EXIT_CODES.SUCCESS);
    assert.match(stdout.value(), /Investigate:\n/u);
    assert.match(stdout.value(), /Respond:\n/u);
    assert.match(stdout.value(), /Assure:\n/u);
    assert.match(stdout.value(), /Utilities:\n/u);
    assert.match(stdout.value(), /Fast lookup is the default/u);
    assert.equal(stderr.value(), '');

    const commandStdout = capture();
    assert.equal(await runCli(['lookup', '--help'], { stdout: commandStdout.stream, stderr: stderr.stream }), EXIT_CODES.SUCCESS);
    assert.match(commandStdout.value(), /Collect registration evidence for one domain, IP, or ASN\./u);
    assert.match(commandStdout.value(), /Example:\n  whoisleuth lookup example\.test --deep/u);
    assert.match(commandStdout.value(), /Collection:\n  Network: Accepts one target\./u);
    assert.match(commandStdout.value(), /Boundary:\n  Fast is the default\./u);
    assert.match(commandStdout.value(), /fixed publication and delivery\/cache summaries/u);
    assert.match(commandStdout.value(), /without retaining raw metadata values or making another request/u);
    assert.doesNotMatch(commandStdout.value(), /whoisleuth bulk/u);

    const httpStdout = capture();
    assert.equal(await runCli(['http', '--help'], { stdout: httpStdout.stream, stderr: stderr.stream }), EXIT_CODES.SUCCESS);
    assert.match(httpStdout.value(), /excludes raw header values/u);
    assert.match(httpStdout.value(), /does not prove caching, transfer savings, performance, privacy, or safety/u);

    const exportStdout = capture();
    assert.equal(await runCli(['export', '--help'], { stdout: exportStdout.stream, stderr: stderr.stream }), EXIT_CODES.SUCCESS);
    assert.match(exportStdout.value(), /Saved Lookup versions 1 and 2/u);
    assert.match(exportStdout.value(), /Current schema-\d+ exports/u);
    assert.match(exportStdout.value(), /exact public schema \d+ remains readable/u);
    assert.match(exportStdout.value(), /other historical and unreleased shapes are unsupported/u);
    assert.equal(stderr.value(), '');
  });

  test('prints a versioned command catalogue for local tooling', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['commands', '--json'], { stdout: stdout.stream, stderr: stderr.stream });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr.value(), '');
    const catalogue = JSON.parse(stdout.value());
    assert.equal(catalogue.schema, 'whoisleuth.cli.command-catalogue');
    assert.equal(catalogue.version, 1);
    assert.equal(catalogue.commands.length, CLI_COMMANDS.length);
    for (const entry of catalogue.commands) {
      assert.deepEqual(Object.keys(entry).sort(), [
        'boundary', 'collection', 'command', 'description', 'example', 'usage',
      ]);
    }
    const lookup = catalogue.commands.find((entry: { command: string }) => entry.command === 'lookup');
    assert.equal(lookup.collection.mode, 'network');
    assert.match(lookup.usage, /--plan/u);
    assert.match(lookup.boundary, /Fast is the default/u);

    let readCalled = false;
    let collectionCalled = false;
    const filteredStdout = capture();
    assert.equal(await runCli([
      'commands', '--common', '--group', 'respond', '--mode', 'offline', '--json',
    ], {
      stdout: filteredStdout.stream,
      stderr: stderr.stream,
      readDiffInput: async () => { readCalled = true; return '{}'; },
      runUnifiedLookup: async () => { collectionCalled = true; return lookupResult(); },
    }), EXIT_CODES.SUCCESS);
    const filtered = JSON.parse(filteredStdout.value());
    assert.equal(filtered.schema, catalogue.schema);
    assert.equal(filtered.version, 1);
    assert.deepEqual(filtered.commands.map((entry: { command: string }) => entry.command), [
      'case-pack', 'export',
    ]);
    assert.ok(filtered.commands.every((entry: Record<string, unknown>) => (
      Object.keys(entry).sort().join(',') === 'boundary,collection,command,description,example,usage'
    )));
    assert.equal(readCalled, false);
    assert.equal(collectionCalled, false);

    const emptyStdout = capture();
    assert.equal(await runCli(['commands', '--common', '--group', 'investigate', '--mode', 'offline'], {
      stdout: emptyStdout.stream,
      stderr: stderr.stream,
    }), EXIT_CODES.SUCCESS);
    assert.match(emptyStdout.value(), /discover \[offline\]/u);
    assert.match(emptyStdout.value(), /review-evidence \[offline\]/u);
    assert.doesNotMatch(emptyStdout.value(), /\u001b/u);
  });

  test('parses bounded offline artifact verification inputs', () => {
    assert.deepEqual(parseCliArguments([
      'verify-artifact',
      'workspace.json',
      '--passphrase-file',
      'passphrase.txt',
      '--manifest',
      'manifest.json',
      '--manifest-entry',
      'artifact-2',
      '--json',
      '--strict-exit',
      '--no-color',
    ]), {
      action: 'verify-artifact',
      source: 'workspace.json',
      passphraseSource: 'passphrase.txt',
      manifestSource: 'manifest.json',
      manifestEntryId: 'artifact-2',
      output: 'json',
      strictExit: true,
      quiet: false,
      color: false,
    });
    assert.throws(
      () => parseCliArguments(['verify-artifact', '--passphrase-file']),
      /requires one bounded UTF-8 file/u,
    );
    assert.throws(
      () => parseCliArguments(['verify-artifact', 'one.json', 'two.json']),
      /accepts one optional JSON file/u,
    );
    assert.throws(
      () => parseCliArguments(['verify-artifact', '--strict-exit', '--strict-exit']),
      /only once/u,
    );
    assert.throws(
      () => parseCliArguments(['verify-artifact', 'report.json', '--manifest', 'manifest.json']),
      /must be supplied together/u,
    );
    assert.throws(
      () => parseCliArguments(['verify-artifact', 'report.json', '--manifest-entry', 'artifact-17']),
      /artifact-1 through artifact-16/u,
    );
  });

  test('parses metadata-only interchange fidelity inputs', () => {
    assert.deepEqual(parseCliArguments([
      'interchange-report',
      'workspace.json',
      '--passphrase-file',
      'passphrase.txt',
      '--json',
      '--no-color',
    ]), {
      action: 'interchange-report',
      source: 'workspace.json',
      passphraseSource: 'passphrase.txt',
      output: 'json',
      quiet: false,
      color: false,
    });
    assert.throws(
      () => parseCliArguments(['interchange-report', '--passphrase-file']),
      /requires one bounded UTF-8 file/u,
    );
    assert.throws(
      () => parseCliArguments(['interchange-report', 'one.json', 'two.json']),
      /accepts one optional JSON file/u,
    );
  });

  test('parses redacted archive inspection and explicit evidence-signing inputs', () => {
    assert.deepEqual(parseCliArguments([
      'inspect-archive',
      'workspace.json',
      '--passphrase-file',
      'passphrase.txt',
      '--search',
      'review-target.invalid',
      '--reveal',
      '--json',
    ]), {
      action: 'inspect-archive',
      source: 'workspace.json',
      passphraseSource: 'passphrase.txt',
      search: 'review-target.invalid',
      reveal: true,
      requireMatch: false,
      expectedContentDigest: null,
      output: 'json',
      quiet: false,
      color: true,
    });
    const expectedDigest = `sha256:${'a'.repeat(64)}`;
    assert.deepEqual(parseCliArguments([
      'inspect-archive',
      'workspace.json',
      '--expect-content-digest',
      expectedDigest,
    ]), {
      action: 'inspect-archive',
      source: 'workspace.json',
      passphraseSource: null,
      search: null,
      reveal: false,
      requireMatch: false,
      expectedContentDigest: expectedDigest,
      output: 'terminal',
      quiet: false,
      color: true,
    });
    assert.throws(
      () => parseCliArguments(['inspect-archive', '--expect-content-digest', 'sha256:nope']),
      /64 lowercase hexadecimal/iu,
    );
    assert.deepEqual(parseCliArguments([
      'sign-artifact',
      'review.json',
      '--private-key-file',
      'private.pem',
    ]), {
      action: 'sign-artifact',
      source: 'review.json',
      privateKeySource: 'private.pem',
    });
    assert.deepEqual(parseCliArguments([
      'verify-signature',
      'signed.json',
      '--public-key-file',
      'public.pem',
      '--json',
    ]), {
      action: 'verify-signature',
      source: 'signed.json',
      publicKeySource: 'public.pem',
      output: 'json',
      quiet: false,
      color: true,
    });
    assert.throws(() => parseCliArguments(['inspect-archive', '--reveal']), /requires --search/iu);
    assert.throws(() => parseCliArguments(['inspect-archive', '--require-match']), /requires --search/iu);
    assert.throws(() => parseCliArguments(['sign-artifact']), /requires --private-key-file/iu);
  });

  test('parses privacy-safe source reliability report inputs', () => {
    assert.deepEqual(parseCliArguments([
      'source-report',
      'lookups.json',
      '--json',
    ]), {
      action: 'source-report',
      source: 'lookups.json',
      output: 'json',
      quiet: false,
      color: true,
    });
    assert.throws(
      () => parseCliArguments(['source-report', 'one.json', 'two.json']),
      /accepts one optional JSON file/u,
    );
  });
});

describe('bounded CLI stdin', () => {
  test('reads one trimmed query', async () => {
    assert.equal(await readStdinBounded(Readable.from(['  example.com\n'])), 'example.com');
  });

  test('rejects multiple queries and oversized input before lookup', async () => {
    await assert.rejects(readStdinBounded(Readable.from(['one.com\ntwo.com\n'])), /one stdin line/);
    await assert.rejects(readStdinBounded(Readable.from(['x'.repeat(MAX_STDIN_BYTES + 1)])), /limited to/);
  });

  test('strictly decodes bounded stdin after joining multibyte chunks', async () => {
    await assert.rejects(
      readStdinBounded(Readable.from([Buffer.from('{"value":"'), Buffer.from([0x80]), Buffer.from('"}')])),
      /valid UTF-8/iu,
    );
    assert.equal(
      await readStdinBounded(Readable.from([Buffer.from('caf\xc3', 'latin1'), Buffer.from('\xa9.example\n', 'latin1')])),
      'caf\u00e9.example',
    );
    assert.equal(await readStdinBounded(Readable.from([Buffer.from('\ufffd.example\n', 'utf8')])), '\ufffd.example');
  });
});

describe('CLI lookup runner', () => {
  test('reuses classification and unified lookup with fast mode by default', async () => {
    const stdout = capture();
    const stderr = capture();
    let options: {
      fast?: boolean;
      compact?: boolean;
      onSourceSettled?: (settlement: LookupSourceSettlement) => void;
    } | undefined;
    const code = await runCli(['lookup', 'login.example.com', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => '2026-07-14T00:00:00.000Z',
      classifyQuery: () => ({ type: 'domain', value: 'example.com', inputHostname: 'login.example.com', registrableDomain: 'example.com', isSubdomain: true }),
      runUnifiedLookup: async (_classified, received) => { options = received; return lookupResult(); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(options, { fast: true, compact: false });
    assert.equal(stderr.value(), '');
    const output = JSON.parse(stdout.value());
    assert.equal(output.schema, 'whoisleuth.cli.lookup');
    assert.equal(output.version, 2);
    assert.equal(output.mode, 'fast');
    assert.equal(output.inputHostname, 'login.example.com');
    assert.equal(output.registrableDomain, 'example.com');
  });

  test('deep mode is explicit and stdin can provide the one query', async () => {
    const stdout = capture();
    let lookupCalled = false;
    const code = await runCli(['lookup', '--deep'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readStdin: async () => 'AS13335',
      classifyQuery: () => ({ type: 'asn', value: 'AS13335' }),
      runUnifiedLookup: async (_classified, received) => {
        lookupCalled = true;
        assert.equal(received?.fast, false);
        assert.equal(received?.compact, false);
        assert.equal(typeof received?.onSourceSettled, 'function');
        return lookupResult({ availability: { applicable: false, type: 'asn' }, diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } } });
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, true);
    assert.match(stdout.value(), /Type\s+asn/);
    assert.match(stdout.value(), /Mode\s+Deep/);
  });

  test('lookup preflight makes no network request and preserves conditional disclosures', async () => {
    const stdout = capture();
    const stderr = capture();
    let lookupCalled = false;
    const code = await runCli(['lookup', 'login.example.test', '--deep', '--plan', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      runUnifiedLookup: async () => { lookupCalled = true; return {}; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(stderr.value(), '');
    const plan = JSON.parse(stdout.value());
    assert.equal(plan.schema, 'whoisleuth.cli.lookup-plan');
    assert.equal(plan.mode, 'deep');
    assert.equal(plan.target.normalized, 'example.test');
    assert.equal(plan.target.inputHostname, 'login.example.test');
    assert.equal(plan.planning.networkRequestsMade, false);
    assert.equal(plan.planning.collectionRequiresNetwork, true);
    assert.deepEqual(plan.planning.sources.map((source: { source: string }) => source.source), [
      'rdap', 'whois', 'domain_evidence', 'registrar_rdap', 'network_context',
    ]);
    assert.equal(plan.planning.sources.find((source: { source: string }) => source.source === 'registrar_rdap').conditional, true);
  });

  test('invalid input is a usage error and never calls lookup', async () => {
    const stderr = capture();
    let called = false;
    const code = await runCli(['lookup', 'not-a-domain'], { stdout: capture().stream, stderr: stderr.stream, runUnifiedLookup: async () => { called = true; } });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.equal(called, false);
    assert.match(stderr.value(), /^Usage error:/);
  });

  test('upstream failure is bounded on stderr with a stable exit code', async () => {
    const stderr = capture();
    const code = await runCli(['lookup', 'example.com'], { stdout: capture().stream, stderr: stderr.stream, runUnifiedLookup: async () => { throw new Error(`upstream\n${'x'.repeat(500)}`); } });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.ok(stderr.value().length < 330);
    assert.doesNotMatch(stderr.value(), /\n.*\n/);
  });

  test('an upstream validation-sounding error is not misclassified as user input', async () => {
    const stderr = capture();
    const code = await runCli(['lookup', 'example.com'], { stdout: capture().stream, stderr: stderr.stream, runUnifiedLookup: async () => { throw new Error('upstream returned not a valid response'); } });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^Lookup failed:/);
  });

  test('quiet output suppresses success text but not execution', async () => {
    const stdout = capture();
    const code = await runCli(['lookup', 'example.com', '--quiet'], { stdout: stdout.stream, stderr: capture().stream, runUnifiedLookup: async () => lookupResult() });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stdout.value(), '');
  });
});

test('machine document and terminal formatter preserve explicit source states', () => {
  const document = buildCliLookupDocument('example.com', classifiedDomain('example.com'), lookupResult(), '2026-07-14T00:00:00.000Z');
  const terminal = formatTerminalLookup(document);
  assert.match(terminal, /Availability\s+Registered/);
  assert.match(terminal, /RDAP\s+Success/);
  assert.match(terminal, /WHOIS\s+Skipped/);
  assert.equal(document.generatedAt, '2026-07-14T00:00:00.000Z');
});

test('machine documents require explicit generation zones and canonicalize offsets', () => {
  assert.throws(
    () => buildCliLookupDocument('example.com', classifiedDomain('example.com'), lookupResult(), '2026-07-14T12:00:00'),
    /explicit timezone/u,
  );
  assert.equal(
    buildCliLookupDocument('example.com', classifiedDomain('example.com'), lookupResult(), '2026-07-14T12:00:00+01:00').generatedAt,
    '2026-07-14T11:00:00.000Z',
  );
});

test('machine document metadata cannot be replaced by upstream result fields', () => {
  const document = buildCliLookupDocument(
    'example.test',
    classifiedDomain('example.test'),
    lookupResult({
      schema: 'untrusted.schema',
      version: 999,
      generatedAt: 'invalid',
      query: 'different.test',
      type: 'url',
    }),
    '2026-07-14T00:00:00.000Z',
  );
  assert.equal(document.schema, 'whoisleuth.cli.lookup');
  assert.equal(document.version, 2);
  assert.equal(document.generatedAt, '2026-07-14T00:00:00.000Z');
  assert.equal(document.query, 'example.test');
  assert.equal(document.type, 'domain');
});

test('terminal lookup groups evidence and supports concise and diagnostic detail levels', () => {
  const document = buildCliLookupDocument(
    'example.test',
    classifiedDomain('example.test'),
    lookupResult({
      timing: {
        version: 1,
        totalMs: 120,
        sources: [{ source: 'rdap', outcome: 'fulfilled', durationMs: 40, completedAfterMs: 40 }],
      },
    }),
    '2026-07-14T00:00:00.000Z',
    'deep',
  );
  const standard = formatTerminalLookup(document);
  const summary = formatTerminalLookup(document, { detail: 'summary' });
  const verbose = formatTerminalLookup(document, { detail: 'verbose' });

  assert.match(standard, /^Target:\n/u);
  assert.match(standard, /\nRegistration:\n/u);
  assert.match(standard, /RDAP source\s+https:\/\/rdap\.invalid/u);
  assert.doesNotMatch(summary, /RDAP source|Generated|Total time/u);
  assert.match(verbose, /\nCollection:\n/u);
  assert.match(verbose, /Generated\s+2026-07-14T00:00:00\.000Z/u);
  assert.match(verbose, /Total time\s+120 ms/u);
  assert.match(verbose, /rdap Fulfilled · 40 ms/u);
});

test('terminal lookup separately attributes represented registrar RDAP diagnostics', () => {
  const result = lookupResult({
    rdap: {
      parsed: { domain: 'EXAMPLE.COM' },
      registrarRdap: {
        status: 'success',
        data: { privateMarker: 'raw-registrar-payload' },
        parsed: { entities: [{ contact: 'private-contact-marker' }] },
      },
    },
    diagnostics: {
      version: 4,
      rdap: {
        status: 'success',
        endpoint: 'https://registry.invalid/domain/example.com',
        registrar: {
          status: 'success',
          endpoint: 'https://registrar.invalid/domain/example.com',
        },
      },
      whois: { status: 'success' },
      availability: { status: 'complete' },
    },
  });
  const document = buildCliLookupDocument('example.com', classifiedDomain('example.com'), result, '2026-07-14T00:00:00.000Z', 'deep');
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Registrar RDAP Success/);
  assert.match(terminal, /Registrar source https:\/\/registrar\.invalid\/domain\/example\.com/);
  assert.doesNotMatch(terminal, /raw-registrar-payload|private-contact-marker/);
});

test('terminal lookup summarizes bounded registry interpretation without publishing contacts', () => {
  const result = lookupResult({
    registryInsights: {
      version: 1,
      lifecycle: { label: 'Redemption period' },
      contactDisclosure: {
        registryRdap: { state: 'privacy_proxy' },
        whois: { state: 'redacted' },
      },
      reconciliation: { state: 'source_specific' },
      publications: [
        { state: 'complete' },
        { state: 'partial' },
        { state: 'unavailable' },
      ],
      abuseRouting: [{ contact: 'private-routing-value@example.test' }],
    },
  });
  const document = buildCliLookupDocument('example.com', classifiedDomain('example.com'), result, '2026-07-14T00:00:00.000Z', 'deep');
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Lifecycle\s+Redemption period/);
  assert.match(terminal, /Disclosure\s+RDAP Privacy proxy · WHOIS Redacted/);
  assert.match(terminal, /Reconciliation\s+Source specific/);
  assert.match(terminal, /Publications\s+1 complete · 1 partial · 1 unavailable/);
  assert.doesNotMatch(terminal, /private-routing-value/);
});

test('terminal lookup preserves registrar skip states and omits absent diagnostics', () => {
  const skipped = lookupResult({
    diagnostics: {
      version: 4,
      rdap: {
        status: 'success',
        endpoint: 'https://registry.invalid/domain/example.com',
        registrar: { status: 'skipped', endpoint: null },
      },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
  });
  const skippedDocument = buildCliLookupDocument('example.com', classifiedDomain('example.com'), skipped, '2026-07-14T00:00:00.000Z');
  assert.match(formatTerminalLookup(skippedDocument), /Registrar RDAP Skipped/);

  const absentDocument = buildCliLookupDocument('AS65536', { type: 'asn', value: 'AS65536' }, lookupResult(), '2026-07-14T00:00:00.000Z');
  assert.doesNotMatch(formatTerminalLookup(absentDocument), /Registrar/);
});

test('terminal lookup presents bounded observed network registration context', () => {
  const result = lookupResult({
    networkContext: {
      contextVersion: 1,
      source: 'ip_rdap',
      status: 'success',
      complete: true,
      truncated: false,
      endpoint: { address: '93.184.216.34', family: 4, selectedFrom: 'tls_connection' },
      network: {
        handle: 'NET-EXAMPLE',
        name: 'Example edge network',
        holder: 'Example network holder',
        cidrs: ['93.184.216.0/24', '2001:db8::/32', '198.51.100.0/24', '203.0.113.0/24', '192.0.2.0/24', '192.0.2.128/25'],
        startAddress: '93.184.216.0',
        endAddress: '93.184.216.255',
        country: 'AU',
        networkType: 'DIRECT ALLOCATION',
        databaseUpdatedAt: '2026-08-01T00:00:00.000Z',
      },
      abuseRouting: [
        { channel: 'email', contact: 'must-not-render@example.test', rdapEndpoint: 'https://secret.invalid/rdap' },
        { channel: 'phone', contact: '+61 3 0000 0000' },
      ],
      limitations: ['One observed endpoint is point-in-time context.', 'two', 'three', 'four'],
      rawContact: 'must-not-render@example.test',
    },
  });
  const document = buildCliLookupDocument('example.com', classifiedDomain('example.com'), result, '2026-07-14T00:00:00.000Z', 'deep');
  const terminal = formatTerminalLookup(document);
  const verbose = formatTerminalLookup(document, { detail: 'verbose' });

  assert.match(terminal, /Network RDAP\s+Success/);
  assert.match(terminal, /Completeness\s+Complete/);
  assert.match(terminal, /Selected IP\s+93\.184\.216\.34/);
  assert.match(terminal, /Selected from\s+TLS connection/);
  assert.match(terminal, /Network\s+Example edge network/);
  assert.match(terminal, /Network handle NET-EXAMPLE/);
  assert.match(terminal, /CIDR prefixes\s+.*\+1 more/);
  assert.match(terminal, /Published routes 2 retained \(email 1 · phone 1\); values omitted/);
  assert.match(verbose, /Registry date\s+2026-08-01T00:00:00\.000Z/);
  assert.match(verbose, /Limitation\s+\+1 more retained limitation/);
  assert.doesNotMatch(`${terminal}${verbose}`, /must-not-render|secret\.invalid|\+61 3 0000 0000/);
});

test('terminal lookup bounds retained arrays before access and keeps omission counts truthful', () => {
  const cidrs = new Array(10_000);
  for (let index = 0; index < 5; index += 1) cidrs[index] = `192.0.2.${index * 32}/27`;
  Object.defineProperty(cidrs, 5, { get() { throw new Error('formatter traversed beyond CIDR display cap'); } });
  const routes = new Array(1_000);
  for (let index = 0; index < 6; index += 1) routes[index] = { channel: index % 2 ? 'phone' : 'email', contact: `private-${index}` };
  Object.defineProperty(routes, 6, { get() { throw new Error('formatter traversed beyond route display cap'); } });
  const result = lookupResult({
    networkContext: {
      contextVersion: 1, source: 'ip_rdap', status: 'success', complete: true, truncated: false,
      endpoint: { address: '192.0.2.8', family: 4, selectedFrom: 'dns_a' },
      network: { name: 'Bounded network', cidrs }, abuseRouting: routes,
    },
  });
  const output = formatTerminalLookup({
    ...result,
    schema: 'whoisleuth.cli.lookup',
    version: 2,
    generatedAt: '2026-08-13T00:00:00.000Z',
    mode: 'deep',
    query: 'example.test',
    type: 'domain',
    inputHostname: 'example.test',
    registrableDomain: 'example.test',
    isSubdomain: false,
  });
  assert.match(output, /CIDR prefixes\s+.*\+9995 more retained entries/u);
  assert.match(output, /Published routes 6 retained · \+994 more entries \(email 3 · phone 3\); values omitted/u);
  assert.doesNotMatch(output, /private-/u);
});

test('terminal deep IP lookup presents separately attributed reverse DNS names', () => {
  const result = lookupResult({
    reverseDns: {
      version: 1,
      status: 'partial',
      source: 'reverse_dns',
      complete: false,
      truncated: true,
      records: { ptr: ['edge.example.test', 'fallback.example.test', 'three.example.test', 'four.example.test', 'five.example.test', 'six.example.test'] },
      rawAnswer: 'must-not-render',
    },
  });
  const document = buildCliLookupDocument(
    '192.0.2.1',
    { type: 'ipv4', value: '192.0.2.1' },
    result,
    '2026-07-14T00:00:00.000Z',
    'deep',
  );
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Reverse DNS\s+Partial/);
  assert.match(terminal, /PTR coverage\s+Incomplete · truncated/);
  assert.match(terminal, /PTR names\s+edge\.example\.test, fallback\.example\.test.*\+1 more/);
  assert.doesNotMatch(terminal, /must-not-render/);
});

test('terminal IP and ASN registration renders only bounded normalized public fields', () => {
  const ipResult = lookupResult({
    rdap: {
      parsed: {
        handle: 'NET-192-0-2-0-1', name: 'Example Network', startAddress: '192.0.2.0', endAddress: '192.0.2.255',
        cidrs: ['192.0.2.0/24'], country: 'AU', networkType: 'DIRECT ALLOCATION', statuses: ['active'],
        lifecycle: { createdDateIso: '2001-02-03T04:05:06.000Z', updatedDateIso: '2024-05-06T07:08:09.000Z' },
        entitiesByRole: { abuse: [{ email: 'private-ip-contact@example.test' }] },
      },
      data: { privateRawPayload: 'must-not-render' },
    },
    availability: { applicable: false },
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'unsupported' }, availability: { status: 'not_applicable' } },
  });
  const ip = formatTerminalLookup(buildCliLookupDocument('192.0.2.8', { type: 'ipv4', value: '192.0.2.8' }, ipResult, '2026-08-13T00:00:00.000Z'), { detail: 'verbose' });
  assert.match(ip, /RDAP handle\s+NET-192-0-2-0-1/);
  assert.match(ip, /Address range\s+192\.0\.2\.0 to 192\.0\.2\.255/);
  assert.match(ip, /CIDR prefixes\s+192\.0\.2\.0\/24/);
  assert.match(ip, /Created\s+2001-02-03T04:05:06\.000Z/);
  assert.doesNotMatch(ip, /private-ip-contact|privateRawPayload|must-not-render/);

  const asnResult = lookupResult({
    rdap: {
      parsed: {
        handle: 'AS64496', name: 'Example Autonomous System', startAutnum: 64496, endAutnum: 64500,
        country: 'AU', autnumType: 'DIRECT ALLOCATION', statuses: ['active'],
        abuse: { email: 'private-asn-contact@example.test' },
      },
    },
    availability: { applicable: false },
    diagnostics: { rdap: { status: 'partial' }, whois: { status: 'unavailable' }, availability: { status: 'not_applicable' } },
  });
  const asn = formatTerminalLookup(buildCliLookupDocument('AS64496', { type: 'asn', value: 'AS64496' }, asnResult, '2026-08-13T00:00:00.000Z'));
  assert.match(asn, /RDAP name\s+Example Autonomous System/);
  assert.match(asn, /ASN range\s+64496 to 64500/);
  assert.match(asn, /Allocation\s+DIRECT ALLOCATION/);
  assert.doesNotMatch(asn, /Reverse DNS|private-asn-contact/);
});

test('terminal deep lookup summarizes current website evidence without exposing raw details', () => {
  const result = lookupResult({
    availability: {
      applicable: true,
      domain: 'example.com',
      state: 'registered',
      confidence: 'high',
      activityStatus: 'active',
      pageTitle: 'Example account portal',
      dns: { source: 'dns', status: 'partial', complete: false },
      http: {
        source: 'http',
        status: 'success',
        transportSecurity: 'https',
        response: { status: 200, deliveryMetadata: httpDeliveryMetadataFixture() },
      },
      tls: {
        source: 'tls', status: 'success', complete: true, truncated: false,
        connectedAddress: '192.0.2.44', protocol: 'TLSv1.3', alpnProtocol: 'h2',
        cipher: { standardName: 'TLS_AES_256_GCM_SHA384' },
        authorization: { authorized: true }, hostname: { matches: true }, validity: { status: 'valid' },
        certificate: {
          subject: { commonNames: ['example.com'] }, issuer: { commonNames: ['Fixture CA'] },
          validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
          fingerprintSha256: 'ab'.repeat(32),
          publicKey: { type: 'rsa', bits: 2048, curve: null, privateKeyBytes: 'must-not-render' },
          signature: { algorithm: 'sha256WithRSAEncryption', oid: '1.2.840.113549.1.1.11' },
          subjectAltNames: {
            dnsNames: ['example.com', 'www.example.com'], ipAddresses: ['192.0.2.44'],
            classes: { dns: 2, ip: 1 }, truncated: false,
          },
          extendedKeyUsage: { values: [{ name: 'TLS Web Server Authentication', oid: '1.3.6.1.5.5.7.3.1', secret: 'must-not-render' }], truncated: false },
          authorityInformationAccess: {
            ocsp: { total: 1, https: 1, http: 0, other: 0 },
            caIssuers: { total: 1, https: 1, http: 0, other: 0 }, unknownMethods: 0, truncated: false,
            locations: ['https://must-not-render.invalid/private'],
          },
        },
        chain: [{ subject: 'private-chain-subject-must-not-render' }, { subject: 'private-chain-issuer-must-not-render' }],
        findings: [{ label: 'Wildcard certificate', detail: 'private-tls-detail-must-not-render' }],
        limitations: ['One retained endpoint does not represent every edge.'],
      },
      pageIdentity: {
        identityVersion: 3, source: 'html', status: 'partial', complete: false, truncated: true,
        documentLanguage: 'en-AU',
        canonical: { url: 'https://example.com/private/path?token=must-not-render', queryOmitted: true, pathTruncated: false },
        openGraph: {
          title: 'Example services', siteName: 'Example publisher',
          url: { url: 'https://social.invalid/secret-path?key=must-not-render', queryOmitted: true },
        },
        generator: 'Fixture CMS',
        forms: { count: 2, postCount: 1, insecureActionCount: 1, externalActionOrigins: ['https://must-not-render.invalid'], truncated: false },
        resources: {
          count: 9, byType: { image: 3, script: 2, stylesheet: 1, frame: 1, media: 1, object: 1 },
          externalOrigins: ['https://private-resource.invalid'], truncated: true,
        },
        embeddedOrigins: ['https://private-frame.invalid'],
        contactDomains: ['private-contact.invalid'],
        downloads: { count: 2, explicitCount: 1, riskyCount: 1, riskyFileTypes: ['exe'], externalOrigins: ['https://private-download.invalid'], truncated: false },
        trackingIdentifiers: [{ type: 'tag-container', value: 'PRIVATE-TRACKING-ID-MUST-NOT-RENDER' }],
        publicationMetadata: pagePublicationMetadataFixture(),
        rawHtml: 'private-html-must-not-render',
      },
      phishingLanguageMatch: 'Account access language observed',
      pageRoleProfile: {
        source: 'derived', status: 'success', complete: true, truncated: false, primaryRole: 'authentication',
        findings: [
          { role: 'authentication', label: 'Authentication', confidence: 'high', evidence: ['private-role-evidence-must-not-render'] },
          { role: 'content', label: 'Content or publication', confidence: 'medium' },
        ],
      },
      clientBehaviorProfile: {
        source: 'derived', status: 'partial', complete: false, truncated: true,
        scriptSummary: { elementsObserved: 6, referencedScripts: 3, inlineScripts: 3, moduleScripts: 1 },
        indicators: Array.from({ length: 7 }, (_, index) => ({
          label: `Static indicator ${index + 1}${index === 0 ? '\u202e' : ''}`,
          evidenceClass: index % 2 ? 'inline_script' : 'static_markup', occurrences: index + 1,
          explanation: 'private-client-explanation-must-not-render',
        })),
      },
      credentialSurfaceProfile: {
        source: 'html',
        status: 'success',
        complete: true,
        forms: {
          count: 2,
          methods: { missing: 0, get: 1, post: 1, dialog: 0, other: 0 },
          actions: { sameOrigin: 1, external: 1, missing: 0, cleartext: 0, unclassified: 0 },
        },
        inputs: {
          count: 4,
          classifiedCount: 3,
          categories: { password: 1, email: 1, username: 1, one_time_code: 0, payment: 0 },
        },
        privateField: 'credential-private-marker-must-not-render',
      },
      structuredDataIdentity: {
        source: 'html',
        status: 'success',
        entities: [{
          types: ['Organization', 'WebSite'],
          name: 'Example publisher',
          declaredOrigin: 'https://example.com',
          sameAsHosts: ['social.example'],
          privateField: 'must-not-render',
        }],
      },
      technologyProfile: {
        source: 'derived',
        status: 'success',
        findings: [
          {
            name: 'Example Commerce',
            category: 'commerce platform',
            confidence: 'high',
            evidence: [{ description: 'private-marker-must-not-render' }],
          },
          { name: `Example Edge\n${'x'.repeat(500)}`, category: 'delivery platform', confidence: 'medium' },
        ],
        browserLibraryProfile: {
          profileVersion: 1,
          source: 'derived',
          status: 'success',
          findings: [
            { name: 'fixture library', apparentVersion: '1.2.3', advisoryCount: 1 },
            { name: 'fixture helper', apparentVersion: '2.0.0', advisoryCount: 0 },
          ],
        },
      },
      securityPosture: {
        source: 'derived',
        status: 'partial',
        summary: { observed: 3, potentialExposure: 1, observedAbsence: 2, unavailable: 1 },
        findings: Array.from({ length: 6 }, (_, index) => ({
          label: `Posture label ${index + 1}`,
          state: index % 2 ? 'observed' : 'unavailable',
          detail: 'private-posture-detail-must-not-render',
        })),
      },
    },
  });
  const document = buildCliLookupDocument(
    'example.com',
    classifiedDomain('example.com'),
    result,
    '2026-07-24T00:00:00.000Z',
    'deep',
  );
  const terminal = formatTerminalLookup(document);
  const summary = formatTerminalLookup(document, { detail: 'summary' });
  const verbose = formatTerminalLookup(document, { detail: 'verbose' });

  assert.match(terminal, /Web activity\s+Active/);
  assert.match(terminal, /Page title\s+Example account portal/);
  assert.match(terminal, /DNS:\nEvidence\s+Partial/);
  assert.match(terminal, /HTTP evidence\s+Success/);
  assert.match(terminal, /HTTP response\s+HTTP 200 · HTTPS/);
  assert.match(terminal, /TLS and certificate:\nEvidence\s+Success/);
  assert.match(terminal, /Completeness\s+Complete/);
  assert.match(terminal, /Protocol\s+TLSv1\.3/);
  assert.match(terminal, /Public key\s+rsa 2048 bits/);
  assert.match(terminal, /SAN summary\s+DNS 2, IP 1/);
  assert.match(terminal, /AIA presence\s+OCSP 1 · CA issuers 1 · unknown methods 0/);
  assert.match(terminal, /Chain\s+2 retained certificates/);
  assert.match(terminal, /Page identity\s+Partial/);
  assert.match(terminal, /Page coverage\s+Incomplete · truncated/);
  assert.match(terminal, /Language\s+en-AU/);
  assert.match(terminal, /Canonical\s+Same target host · query omitted/);
  assert.match(terminal, /Open Graph\s+Example publisher · Example services/);
  assert.match(terminal, /Page forms\s+2 total · 1 POST · 1 insecure action/);
  assert.match(terminal, /Resources\s+9 retained · image 3, script 2, stylesheet 1, frame 1, media 1, object 1 · truncated/);
  assert.match(terminal, /Relationships\s+1 embedded retained · 1 contact domain retained · 1 tracking identifier retained/);
  assert.match(terminal, /Delivery\s+Complete · encoding Observed · cache Observed/);
  assert.match(terminal, /Content coding\s+br, gzip/);
  assert.match(terminal, /Publication\s+Complete · robots Observed · card Observed/);
  assert.match(terminal, /Static page\s+headings 2 · images 2 · blocking candidates 2/);
  assert.match(terminal, /Content cue\s+Account access language observed · static review label/);
  assert.match(terminal, /Primary role\s+Authentication · High/);
  assert.match(terminal, /Scripts\s+6 elements · 3 referenced · 3 inline · 1 modules/);
  assert.match(terminal, /Credential UI\s+Success · 3 classified inputs/);
  assert.match(terminal, /Form surface\s+2 forms · 4 inputs · 1 external action/);
  assert.match(terminal, /Input purposes\s+password 1 · email 1 · username 1/);
  assert.match(terminal, /Structured ID\s+Success · 1 declared entity/);
  assert.match(terminal, /Declarations\s+Example publisher \(Organization\/WebSite\)/);
  assert.match(terminal, /Technology\s+Success · 2 indicators/);
  assert.match(terminal, /Example Commerce \(commerce platform, high signature strength\)/);
  assert.match(terminal, /JS libraries\s+Success · 2 apparent · 1 with catalogue advisory match/);
  assert.match(terminal, /Posture\s+Partial/);
  assert.match(terminal, /Posture counts 3 observed · 1 potential exposure · 2 observed absence · 1 unavailable/);
  assert.match(verbose, /Alt names\s+example\.com, www\.example\.com, 192\.0\.2\.44/);
  assert.match(verbose, /Purposes\s+TLS Web Server Authentication/);
  assert.match(verbose, /Findings\s+Wildcard certificate/);
  assert.match(verbose, /Posture labels\s+.*\+1 more/);
  assert.match(verbose, /Client labels\s+.*\+2 more/);
  assert.match(verbose, /Image alt\s+missing 1 · empty 0 · non-empty 1 · unclassified 0/);
  assert.match(verbose, /Cache timing\s+max-age 3600s · s-maxage 120s · Age 45s/);
  assert.doesNotMatch(summary, /Page title|Language\s+en-AU|Canonical|Primary role|Scripts\s+6|Public key|SAN summary/);
  assert.doesNotMatch(summary, /Publication|Delivery\s+/);
  assert.equal(formatTerminalLookup(document, { detail: 'verbose' }), verbose);
  assert.doesNotMatch(`${terminal}${verbose}`, /private-marker|private-posture-detail|credential-private-marker|must-not-render|private-resource|private-frame|private-contact|private-download|PRIVATE-TRACKING|private-html|private-role-evidence|private-client-explanation|private-tls-detail|private-chain/);
  assert.doesNotMatch(`${terminal}${verbose}`, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/);
});

test('terminal page relationships use the registrable collection target and preserve producer counts', () => {
  const result = lookupResult({
    availability: {
      applicable: true, domain: 'example.test', state: 'registered', confidence: 'high',
      pageIdentity: {
        source: 'html', status: 'success', complete: true, truncated: false,
        canonical: { url: 'https://example.test/review?private=omitted', queryOmitted: true, pathTruncated: false },
        forms: { count: 1_024, postCount: 1_000, insecureActionCount: 0, truncated: true },
        resources: { count: 1_024, byType: { image: 1_024, script: 1_000 }, truncated: true },
        downloads: { count: 1_001, riskyCount: 1_000, truncated: true },
      },
    },
  });
  const document = buildCliLookupDocument(
    'login.example.test',
    classifiedDomain('example.test', 'login.example.test'),
    result,
    '2026-08-13T00:00:00.000Z',
    'deep',
  );
  const output = formatTerminalLookup(document);
  assert.match(output, /Canonical\s+Same target host · query omitted/u);
  assert.match(output, /Page forms\s+1024 total · 1000 POST · 0 insecure action/u);
  assert.match(output, /Resources\s+1024 retained · image 1024, script 1000 · truncated/u);
  assert.match(output, /Downloads\s+1001 retained · 1000 review files · truncated/u);
  assert.doesNotMatch(output, /login\.example\.test.*Different host|private=omitted/u);

  const differentResult = lookupResult({
    availability: {
      applicable: true, domain: 'example.test', state: 'registered', confidence: 'high',
      pageIdentity: {
        source: 'html', status: 'success', complete: true, truncated: false,
        canonical: { url: 'https://different.example/review', queryOmitted: false, pathTruncated: false },
      },
    },
  });
  const different = buildCliLookupDocument(
    'login.example.test',
    classifiedDomain('example.test', 'login.example.test'),
    differentResult,
    '2026-08-13T00:00:00.000Z',
    'deep',
  );
  assert.match(formatTerminalLookup(different), /Canonical\s+Different host declared/u);
});

test('terminal TLS keeps non-positive observations explicitly inconclusive', () => {
  for (const status of ['error', 'skipped', 'unsupported']) {
    const result = lookupResult({
      availability: {
        applicable: true, domain: 'example.test', state: 'registered', confidence: 'high',
        tls: {
          source: 'tls', status,
          authorization: { authorized: true }, hostname: { matches: true }, validity: { status: 'valid' },
          certificate: { subject: { commonNames: ['must-not-render.example'] } },
        },
      },
    });
    const output = formatTerminalLookup(buildCliLookupDocument('example.test', classifiedDomain('example.test'), result, '2026-08-13T00:00:00.000Z', 'deep'));
    assert.match(output, new RegExp(`Evidence\\s+${status.charAt(0).toUpperCase()}${status.slice(1)}`));
    assert.match(output, /Chain trust\s+Unavailable/);
    assert.match(output, /Hostname\s+Unavailable/);
    assert.match(output, /Validity\s+Unavailable/);
    assert.doesNotMatch(output, /Authorised|Matched|must-not-render/);
  }
});

test('terminal lookup explains represented registry access constraints', () => {
  const restricted = lookupResult({
    diagnostics: {
      version: 5,
      registryAccess: {
        suffix: 'es',
        whoisAccessProfile: 'source-ip-authorization-required',
        rdapAccessProfile: 'no-iana-service',
        limitation: 'Registry collection requires documented source authorization.',
        authority: 'context_only',
      },
      rdap: { status: 'unsupported', endpoint: null },
      whois: { status: 'error' },
      availability: { status: 'complete' },
    },
  });
  const document = buildCliLookupDocument('restricted.invalid', classifiedDomain('restricted.invalid'), restricted, '2026-07-17T00:00:00.000Z', 'deep');
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Registry access \.es/);
  assert.match(terminal, /WHOIS access\s+Source-IP authorisation required/);
  assert.match(terminal, /RDAP access\s+No service published by IANA/);
  assert.match(terminal, /Access note\s+Registry collection requires documented source authorization\./);
});

test('terminal registry access context remains bounded and absent by default', () => {
  const constrained = lookupResult({
    diagnostics: {
      version: 5,
      registryAccess: {
        suffix: 'zz\ninvalid',
        whoisAccessProfile: 'no-iana-service',
        rdapAccessProfile: 'no-iana-service',
        limitation: `No public machine service.\n${'x'.repeat(500)}`,
        authority: 'context_only',
      },
      rdap: { status: 'unsupported', endpoint: null },
      whois: { status: 'error' },
      availability: { status: 'complete' },
    },
  });
  const constrainedDocument = buildCliLookupDocument('unpublished.invalid', classifiedDomain('unpublished.invalid'), constrained, '2026-07-17T00:00:00.000Z', 'deep');
  const constrainedTerminal = formatTerminalLookup(constrainedDocument);
  const accessNote = constrainedTerminal.split('\n').find((line) => line.startsWith('Access note'));

  assert.doesNotMatch(constrainedTerminal, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  assert.ok(accessNote);
  assert.ok(accessNote.length <= 'Access note    '.length + 240);

  const ordinaryDocument = buildCliLookupDocument('example.com', classifiedDomain('example.com'), lookupResult(), '2026-07-17T00:00:00.000Z');
  assert.doesNotMatch(formatTerminalLookup(ordinaryDocument), /Registry access|WHOIS access|RDAP access|Access note/);
});

test('terminal values strip controls and stay bounded', () => {
  const result = safeTerminalValue(`hello\nworld\u0000\u009b${'x'.repeat(500)}`);
  assert.doesNotMatch(result, /[\x00-\x1f\x7f-\x9f]/);
  assert.ok(result.length <= 240);
  const usage = boundedCliErrorMessage(new Error('unsafe\u00ad\u034f\u180e\u200d\u2060\ufe0fmessage'));
  assert.equal(usage, 'unsafemessage');
});

test('repository source exposes an executable local CLI entry point', () => {
  const root = path.join(__dirname, '..');
  const entryPoint = path.join(root, 'bin/whoisleuth.mts');
  const mode = fs.statSync(entryPoint).mode;
  assert.notEqual(mode & 0o111, 0);

  const bare = spawnSync(process.execPath, [entryPoint], { encoding: 'utf8' });
  assert.equal(bare.status, EXIT_CODES.SUCCESS);
  assert.match(bare.stdout, /WHOISleuth CLI/);
  assert.match(bare.stdout, /Investigate:\n/u);
  assert.equal(bare.stderr, '');

  const result = spawnSync(process.execPath, [entryPoint, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /WHOISleuth CLI/);
  assert.match(result.stdout, /Copyright 2026 slicedearth/);
  assert.match(result.stdout, /Licensed under AGPL-3\.0-only/);
  assert.match(result.stdout, /Source and licence: https:\/\/github\.com\/slicedearth\/whoisleuth/);
  assert.equal(result.stderr, '');

  const shortHelp = spawnSync(process.execPath, [entryPoint, '-h'], { encoding: 'utf8' });
  assert.equal(shortHelp.status, EXIT_CODES.SUCCESS);
  assert.equal(shortHelp.stdout, result.stdout);
  assert.equal(shortHelp.stderr, '');

  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  for (const alias of ['--version', '-V']) {
    const version = spawnSync(process.execPath, [entryPoint, alias], { encoding: 'utf8' });
    assert.equal(version.status, EXIT_CODES.SUCCESS);
    assert.equal(version.stdout, `${packageVersion}\n`);
    assert.equal(version.stderr, '');
  }

  const helpBeforeProfile = spawnSync(process.execPath, [
    entryPoint,
    'lookup',
    '--help',
    '--config',
    path.join(root, 'fixtures', 'missing-cli-profile.json'),
  ], { encoding: 'utf8' });
  assert.equal(helpBeforeProfile.status, EXIT_CODES.USAGE);
  assert.match(helpBeforeProfile.stderr, /Help accepts only an optional command name/u);
  assert.doesNotMatch(helpBeforeProfile.stderr, /profile|configuration could not be read/iu);

  const invalidProfile = spawnSync(process.execPath, [
    entryPoint,
    '--config',
    path.join(root, 'fixtures', 'missing-cli-profile.json'),
    'lookup',
    'example.test',
  ], { encoding: 'utf8' });
  assert.equal(invalidProfile.status, EXIT_CODES.USAGE);
  assert.match(invalidProfile.stderr, /^Usage error:/u);

  const emptyConfigHome = fs.mkdtempSync(path.join(tmpdir(), 'whoisleuth-cli-config-'));
  try {
    const scaffold = spawnSync(process.execPath, [
      entryPoint,
      'registry-scaffold',
      '--profile',
      'nic-io-colon',
      '--suffix',
      'io',
      '--scenario',
      'registered',
    ], {
      encoding: 'utf8',
      env: { ...process.env, XDG_CONFIG_HOME: emptyConfigHome },
    });
    assert.equal(scaffold.status, EXIT_CODES.SUCCESS);
    assert.match(scaffold.stdout, /EXAMPLE\.IO/u);
    assert.equal(scaffold.stderr, '');
  } finally {
    fs.rmSync(emptyConfigHome, { recursive: true, force: true });
  }
});

test('repository CLI handles service termination while waiting for standard input', async () => {
  const entryPoint = path.join(__dirname, '..', 'bin/whoisleuth.mts');
  const readinessModule = `data:text/javascript,${encodeURIComponent(`
    process.on('newListener', (event) => {
      if (event === 'SIGTERM') queueMicrotask(() => process.send?.({ type: 'ready' }));
    });
  `)}`;
  const child = spawn(process.execPath, ['--import', readinessModule, entryPoint, 'lookup'], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  assert.ok(child.stdout);
  assert.ok(child.stderr);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI did not become ready for SIGTERM.'));
    }, 15_000);
    child.once('message', (message) => {
      if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'ready') return;
      clearTimeout(timeout);
      resolve();
    });
  });
  const settled = new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI did not settle after SIGTERM.'));
    }, 3_000);
    child.once('exit', (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });
  child.kill('SIGTERM');
  const code = await settled;
  assert.equal(code, 143);
  assert.equal(stdout, '');
  assert.equal(stderr, 'Cancelled by analyst.\n');
});
