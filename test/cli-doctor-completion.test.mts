import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArguments } from '../cli/arguments.mts';
import { MAX_CLI_COMPLETION_BYTES, buildShellCompletion } from '../cli/completion.mts';
import { buildDoctorReport, formatDoctorReport } from '../cli/doctor.mts';
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
    assert.match(stdout.value(), /Saved Lookup versions 1 and 2/u);
    assert.equal(stderr.value(), '');
  });
});

describe('CLI doctor', () => {
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
