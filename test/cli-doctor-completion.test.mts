import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArguments } from '../cli/arguments.mts';
import { MAX_CLI_COMPLETION_BYTES, buildShellCompletion } from '../cli/completion.mts';
import { buildDoctorReport, buildDoctorSummary, formatDoctorReport } from '../cli/doctor.mts';
import { cliInvocationNetworkEffect, commandHelp } from '../cli/command-reference.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import { SHELL_COMPLETION_PROCESS_OPTIONS, shellCompletionBatchProcessOptions } from './support/shell-completion-harness.mts';

function capture() {
  let value = '';
  return {
    stream: { write(chunk: string) { value += chunk; } },
    value: () => value,
  };
}

describe('CLI static completion and manual', () => {
  test('generates bounded offline scripts for each supported shell', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'powershell'] as const) {
      const script = buildShellCompletion(shell);
      assert.ok(script.length > 0);
      assert.ok(Buffer.byteLength(script, 'utf8') <= MAX_CLI_COMPLETION_BYTES);
      assert.match(script, /whoisleuth/u);
      assert.doesNotMatch(script, /https?:\/\//u);
    }
  });

  test('keeps the per-case process watchdog independent of fixture batch size', () => {
    const single = shellCompletionBatchProcessOptions(1);
    const multiple = shellCompletionBatchProcessOptions(17);
    assert.deepEqual(single, SHELL_COMPLETION_PROCESS_OPTIONS);
    assert.equal(multiple.timeout, single.timeout * 17);
    assert.equal(multiple.killSignal, single.killSignal);
    for (const count of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => shellCompletionBatchProcessOptions(count), /positive bounded case count/u);
    }
  });

  test('offers only discover preset values accepted by the argument parser', () => {
    for (const preset of ['common', 'impersonation', 'all']) {
      const parsed = parseCliArguments(['discover', 'example.test', '--preset', preset]);
      assert.equal(parsed.action, 'discover');
      if (parsed.action === 'discover') assert.equal(parsed.preset, preset);
    }
  });

  test('runner writes only the selected script to stdout', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['completion', 'bash'], { stdout: stdout.stream, stderr: stderr.stream });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stdout.value(), buildShellCompletion('bash'));
    assert.equal(stderr.value(), '');
    assert.deepEqual(parseCliArguments(['completion', 'fish']), { action: 'completion', shell: 'fish' });
    assert.deepEqual(parseCliArguments(['completion', 'powershell']), { action: 'completion', shell: 'powershell' });
  });

  test('prints a generated manual with every supported command and stable exit statuses', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['manual'], { stdout: stdout.stream, stderr: stderr.stream });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.match(stdout.value(), /^\.TH WHOISLEUTH 1/mu);
    assert.match(stdout.value(), /\.SS lookup/u);
    assert.match(stdout.value(), /\.SS diff/u);
    assert.match(stdout.value(), /\.SS timeline/u);
    assert.match(stdout.value(), /\.SS commands/u);
    assert.match(stdout.value(), /Collection: offline\./u);
    assert.match(stdout.value(), /Collection: network\./u);
    assert.match(stdout.value(), /130 analyst cancellation/u);
    assert.match(stdout.value(), /palette auto, light, or dark/u);
    assert.match(stdout.value(), /save\\-lookup/u);
    assert.match(stdout.value(), /selected response, excludes raw header values/u);
    assert.match(stdout.value(), /Supported saved Lookups are capped at 8 MiB/u);
    assert.equal(stderr.value(), '');
  });
});

describe('CLI doctor', () => {
  test('shareable summaries project only public versions, declarations and fixed check codes', async () => {
    const fail = async () => { throw new Error('PRIVATE_DETAIL https://private.example.test/path?token=PRIVATE_TOKEN cookie=PRIVATE_COOKIE /private-folder/user'); };
    const report = await buildDoctorReport({
      version: '2.6.0+PRIVATE_VERSION', generatedAt: 'PRIVATE_TIMESTAMP', network: true,
      presentation: { interactive: false, color: false, palette: 'auto', width: null },
      nodeVersion: '24.19.0+PRIVATE_NODE', platform: 'PRIVATE_PLATFORM', architecture: 'PRIVATE_ARCH',
      resolveAddresses: fail, fetchHttps: fail, queryWhois: fail,
    });
    const original = JSON.stringify(report);
    assert.match(original, /PRIVATE_DETAIL/);
    const summary = buildDoctorSummary(report, '24.19.0+PRIVATE_NODE');
    assert.deepEqual(Object.keys(summary).sort(), [
      'schema', 'version', 'cliVersion', 'nodeVersion', 'state', 'networkRequested',
      'checkCodes', 'omittedCheckCount', 'declaredFormatIdentifiers', 'formatScope', 'omissions',
    ].sort());
    assert.equal(summary.schema, 'whoisleuth.cli.doctor-summary');
    assert.equal(summary.version, 1);
    assert.equal(summary.cliVersion, '2.6.0');
    assert.equal(summary.nodeVersion, '24.19.0');
    assert.equal(summary.networkRequested, true);
    assert.equal(summary.state, 'partial');
    assert.equal(summary.omittedCheckCount, 0);
    assert.deepEqual(summary.checkCodes, ['runtime_pass', 'platform_pass', 'terminal_pass', 'offline_features_pass', 'public_dns_partial', 'https_transport_partial', 'whois_transport_partial']);
    assert.ok(summary.declaredFormatIdentifiers.includes('whoisleuth.cli.doctor'));
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_|private\.example|private-folder|token=|cookie=/);
    assert.equal(JSON.stringify(report), original);

    const unknown = buildDoctorSummary({ ...report, cliVersion: 'PRIVATE_VERSION',
      checks: [...report.checks, { id: 'PRIVATE_CHECK' as typeof report.checks[number]['id'], label: 'PRIVATE_LABEL', state: 'pass', detail: 'PRIVATE_DETAIL' }],
    }, 'PRIVATE_NODE');
    assert.equal(unknown.cliVersion, null);
    assert.equal(unknown.nodeVersion, null);
    assert.equal(unknown.omittedCheckCount, 1);
    assert.equal(unknown.state, 'partial');
    assert.doesNotMatch(JSON.stringify(unknown), /PRIVATE_/);
  });

  test('summary output preserves explicit network selection, quiet mode and partial exits', async () => {
    assert.match(commandHelp('doctor'), /--summary-json/);
    assert.throws(() => parseCliArguments(['doctor', '--summary-json', '--json']));
    assert.throws(() => parseCliArguments(['doctor', '--summary-json', '--quiet']));
    assert.equal(cliInvocationNetworkEffect('doctor', ['--summary-json']), 'offline');
    for (const args of [['--summary-json'], ['--summary-json', '--network'], ['--network', '--quiet']]) {
      const stdout = capture(), stderr = capture();
      let calls = 0;
      const fail = async () => { calls += 1; throw new Error('PRIVATE_TRANSPORT_DETAIL'); };
      const code = await runCli(['doctor', ...args], {
        stdout: stdout.stream, stderr: stderr.stream,
        resolvePublicAddresses: fail, safeFetch: fail, whoisQuery: fail,
      });
      assert.equal(code, args.includes('--network') ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS, stderr.value());
      assert.equal(calls, args.includes('--network') ? 3 : 0);
      assert.equal(stderr.value(), '');
      assert.doesNotMatch(stdout.value(), /PRIVATE_/);
      if (args.includes('--quiet')) assert.equal(stdout.value(), '');
      else {
        const result = JSON.parse(stdout.value());
        assert.equal(result.schema, 'whoisleuth.cli.doctor-summary');
        assert.equal(result.networkRequested, args.includes('--network'));
      }
    }
  });

  test('is offline by default and makes skipped network state explicit', async () => {
    let networkCalled = false;
    const report = await buildDoctorReport({
      version: '1.2.3',
      generatedAt: '2026-08-01T00:00:00.000Z',
      network: false,
      presentation: { interactive: false, color: false, palette: 'auto', width: null },
      nodeVersion: '24.1.0',
      platform: 'fixture-os',
      architecture: 'fixture-arch',
      resolveAddresses: async () => {
        networkCalled = true;
        return [];
      },
      fetchHttps: async () => {
        networkCalled = true;
        return new Response();
      },
      queryWhois: async () => {
        networkCalled = true;
        return '';
      },
    });
    assert.equal(networkCalled, false);
    assert.equal(report.state, 'pass');
    assert.equal(report.networkRequested, false);
    assert.equal(report.checks.find((check) => check.id === 'network')?.state, 'skipped');
    assert.match(formatDoctorReport(report), /\[SKIPPED\] Network checks/u);
  });

  test('runs bounded network probes only when requested and retains no response content', async () => {
    const calls: string[] = [];
    const report = await buildDoctorReport({
      version: '1.2.3',
      generatedAt: '2026-08-01T00:00:00.000Z',
      network: true,
      presentation: { interactive: true, color: false, palette: 'auto', width: 80 },
      nodeVersion: '24.1.0',
      resolveAddresses: async (hostname) => {
        calls.push(`dns:${hostname}`);
        return [{ address: '192.0.2.10', family: 4 }];
      },
      fetchHttps: async (url, options) => {
        calls.push(`https:${url}`);
        assert.equal(options?.headers && new Headers(options.headers).get('accept'), 'application/json');
        assert.ok(options?.signal);
        return new Response('private bootstrap response must not be retained', { status: 200 });
      },
      queryWhois: async (server, query, options) => {
        assert.ok(options);
        calls.push(`whois:${server}:${query}:${options.totalDeadlineMs}`);
        return 'private diagnostic response must not be retained';
      },
    });
    assert.deepEqual(calls, [
      'dns:whois.iana.org',
      'https:https://data.iana.org/rdap/dns.json',
      'whois:whois.iana.org:example.com:6000',
    ]);
    assert.equal(report.state, 'pass');
    assert.doesNotMatch(JSON.stringify(report), /private (?:bootstrap|diagnostic) response/u);
    assert.match(JSON.stringify(report), /addresses were not retained/u);
    assert.match(JSON.stringify(report), /HTTP 200/u);
  });

  test('returns a partial result for failed explicit network diagnostics', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['doctor', '--network', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => '2026-08-01T00:00:00.000Z',
      resolvePublicAddresses: async () => { throw new Error('fixture DNS unavailable'); },
      safeFetch: async () => { throw new Error('fixture HTTPS unavailable'); },
      whoisQuery: async () => { throw new Error('fixture transport unavailable'); },
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(stderr.value(), '');
    const report = JSON.parse(stdout.value());
    assert.equal(report.schema, 'whoisleuth.cli.doctor');
    assert.equal(report.networkRequested, true);
    assert.equal(report.state, 'partial');
    assert.equal(report.checks.filter((check: { state: string }) => check.state === 'partial').length, 3);
  });

  test('runs independent bounded diagnostics without one stalled transport blocking the others', async () => {
    let whoisCalled = false;
    const startedAt = Date.now();
    const report = await buildDoctorReport({
      version: '1.2.3',
      generatedAt: '2026-08-01T00:00:00.000Z',
      network: true,
      networkTimeoutMs: 10,
      presentation: { interactive: false, color: false, palette: 'auto', width: null },
      resolveAddresses: async () => new Promise(() => {}),
      fetchHttps: async () => new Promise(() => {}),
      queryWhois: async () => {
        whoisCalled = true;
        return 'fixture response';
      },
    });
    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal(whoisCalled, true);
    assert.equal(report.state, 'partial');
    assert.match(report.checks.find((check) => check.id === 'public_dns')?.detail || '', /timed out after 10 ms/u);
    assert.match(report.checks.find((check) => check.id === 'https_transport')?.detail || '', /timed out after 10 ms/u);
  });
});
