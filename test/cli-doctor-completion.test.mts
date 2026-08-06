import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { parseCliArguments } from '../cli/arguments.mts';
import { buildShellCompletion } from '../cli/completion.mts';
import { buildDoctorReport, formatDoctorReport } from '../cli/doctor.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';

function capture() {
  let value = '';
  return {
    stream: { write(chunk: string) { value += chunk; } },
    value: () => value,
  };
}

describe('CLI shell completion', () => {
  test('generates bounded static scripts for each supported shell', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'powershell'] as const) {
      const script = buildShellCompletion(shell);
      assert.ok(script.length > 100 && script.length < 30_000);
      assert.match(script, /whoisleuth/u);
      assert.match(script, /lookup/u);
      assert.match(script, /doctor/u);
      assert.match(script, /manual/u);
      assert.match(script, /commands/u);
      assert.match(script, /diff/u);
      assert.match(script, /timeline/u);
      assert.match(script, /domain-triage/u);
      assert.match(script, /(?:--checkpoint|-l checkpoint)/u);
      assert.match(script, /(?:--output|-l output)/u);
      assert.match(script, /(?:--summary|-l summary)/u);
      assert.match(script, /(?:--expect-content-digest|-l expect-content-digest)/u);
      assert.doesNotMatch(script, /https?:\/\//u);
    }
    const bash = buildShellCompletion('bash');
    const syntax = spawnSync('bash', ['-n'], { input: bash, encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    assert.doesNotMatch(bash, /--preset\) COMPREPLY=.*custom/u);
    assert.equal((bash.match(/command.*completion.*COMP_CWORD.*-eq 2/gu) || []).length, 1);
    assert.doesNotMatch(bash, /^\s+completion\) COMPREPLY/gmu);
    const zsh = buildShellCompletion('zsh');
    assert.match(zsh, /funcstack\[1\].*_whoisleuth/u);
    assert.doesNotMatch(zsh, /--preset\) compadd -- .*custom/u);
    assert.match(buildShellCompletion('fish'), /-l output -r -F/u);
    assert.match(buildShellCompletion('fish'), /__fish_seen_subcommand_from completion.*bash zsh fish powershell/u);
    const powershell = buildShellCompletion('powershell');
    assert.match(powershell, /Register-ArgumentCompleter -Native -CommandName whoisleuth/u);
    const powershellSyntax = spawnSync('pwsh', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$code = [Console]::In.ReadToEnd(); [void][scriptblock]::Create($code)',
    ], { input: powershell, encoding: 'utf8' });
    assert.equal(powershellSyntax.status, 0, powershellSyntax.stderr);
  });

  test('offers only discover preset values accepted by the argument parser', () => {
    for (const preset of ['common', 'impersonation', 'all']) {
      const parsed = parseCliArguments(['discover', 'example.test', '--preset', preset]);
      assert.equal(parsed.action, 'discover');
      if (parsed.action === 'discover') assert.equal(parsed.preset, preset);
    }
    for (const shell of ['bash', 'zsh', 'fish', 'powershell'] as const) {
      assert.doesNotMatch(buildShellCompletion(shell), /(?:--preset|-a) ['"]?custom/u);
    }
  });

  test('runner writes only the selected script to stdout', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['completion', 'bash'], { stdout: stdout.stream, stderr: stderr.stream });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.match(stdout.value(), /complete -F _whoisleuth_completion whoisleuth/u);
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
      presentation: { interactive: false, color: false, width: null },
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
      presentation: { interactive: true, color: false, width: 80 },
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
      presentation: { interactive: false, color: false, width: null },
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
