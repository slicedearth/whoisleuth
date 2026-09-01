import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS, parseCliArguments } from '../cli/arguments.mts';
import { MAX_CLI_COMPLETION_BYTES, buildShellCompletion } from '../cli/completion.mts';
import { buildDoctorReport, formatDoctorReport } from '../cli/doctor.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import {
  assertSuccessfulShellProcess,
  prepareBashCompletionBatch,
  preparePowerShellCompletionBatch,
  prepareZshCompletionBatch,
} from './support/shell-completion-harness.mts';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

function capture() {
  let value = '';
  return {
    stream: { write(chunk: string) { value += chunk; } },
    value: () => value,
  };
}

describe('CLI shell completion', () => {
  test('reports an unavailable shell with its bounded process diagnostic', () => {
    const unavailable = spawnSync('whoisleuth-unavailable-shell-fixture', [], { encoding: 'utf8' });
    assert.throws(
      () => assertSuccessfulShellProcess(unavailable, 'Fixture shell'),
      /Fixture shell failed to start: .*ENOENT/u,
    );
  });

  test('generates bounded static scripts for each supported shell', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'powershell'] as const) {
      const script = buildShellCompletion(shell);
      assert.ok(script.length > 100);
      assert.ok(Buffer.byteLength(script, 'utf8') <= MAX_CLI_COMPLETION_BYTES);
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
      assert.match(script, /(?:--palette|-l palette)/u);
      assert.match(script, /(?:--save-lookup|-l save-lookup)/u);
      assert.match(script, /(?:--expect-content-digest|-l expect-content-digest)/u);
      assert.doesNotMatch(script, /https?:\/\//u);
    }
    const bash = buildShellCompletion('bash');
    const syntax = spawnSync('bash', ['-n'], { input: bash, encoding: 'utf8' });
    assertSuccessfulShellProcess(syntax, 'Bash completion syntax check');
    assert.doesNotMatch(bash, /--preset\) COMPREPLY=.*custom/u);
    assert.match(bash, /--palette\) COMPREPLY=.*auto light dark/u);
    for (const pattern of ['lookup:--save-lookup', 'monitor-once:--previous', 'dnssec-validate:--trust-anchor']) {
      assert.match(bash, new RegExp(pattern, 'u'));
    }
    assert.match(bash, /COMPREPLY=.*compgen -f/u);
    assert.equal((bash.match(/completion:0\).*COMPREPLY=.*bash zsh fish powershell/gu) || []).length, 1);
    assert.doesNotMatch(bash, /^\s+completion\) COMPREPLY/gmu);
    const acceptedTargets = ['example.test', '192.0.2.10', '2001:db8::10', 'AS64496'] as const;
    const rejectedTargets = [
      'not-a-command',
      'report.json',
      'bad_label.example',
      'example..test',
      'bad-.example',
      '999.999.999.999',
      'AS4294967296',
      '2001:::1',
      'example.test/path',
      'user@example.test',
      'service.onion',
      'router.home.arpa',
      '1.0.0.127.in-addr.arpa',
    ] as const;
    const directTargetCases = [...acceptedTargets, ...rejectedTargets].map((target) => ['whoisleuth', target, '--de'] as const);
    const bashCandidates = prepareBashCompletionBatch(bash, directTargetCases, REPOSITORY_ROOT);
    for (const target of acceptedTargets) {
      assert.deepEqual(bashCandidates(['whoisleuth', target, '--de']), ['--deep'], target);
    }
    for (const target of rejectedTargets) {
      assert.equal(bashCandidates(['whoisleuth', target, '--de']).includes('--deep'), false, target);
    }
    const zsh = buildShellCompletion('zsh');
    const zshSyntax = spawnSync('zsh', ['-n'], { input: zsh, encoding: 'utf8' });
    assertSuccessfulShellProcess(zshSyntax, 'Zsh completion syntax check');
    assert.match(zsh, /funcstack\[1\].*_whoisleuth/u);
    assert.match(zsh, /command="lookup"/u);
    assert.match(zsh, /--plan --json/u);
    assert.doesNotMatch(zsh, /--preset\) compadd -- .*custom/u);
    assert.match(zsh, /--palette\) compadd -- auto light dark/u);
    for (const pattern of ['lookup:--save-lookup', 'monitor-once:--previous', 'dnssec-validate:--trust-anchor']) {
      assert.match(zsh, new RegExp(pattern, 'u'));
    }
    assert.match(zsh, /\) _files; return/u);
    const zshCandidates = prepareZshCompletionBatch(zsh, [
      ['whoisleuth', 'example.test', '--de'],
      ['whoisleuth', 'report.json', '--de'],
    ], REPOSITORY_ROOT);
    assert.equal(zshCandidates(['whoisleuth', 'example.test', '--de']).includes('--deep'), true);
    assert.equal(zshCandidates(['whoisleuth', 'report.json', '--de']).includes('--deep'), false);
    const fish = buildShellCompletion('fish');
    assert.match(fish, /-l output -r -F/u);
    assert.match(fish, /-l save-lookup -r -F/u);
    assert.match(fish, /__fish_prev_arg_in --palette.*-a 'auto light dark'/u);
    assert.match(fish, /__whoisleuth_position_is 0 completion.*bash zsh fish powershell/u);
    assert.match(fish, /__whoisleuth_direct_lookup_target/u);
    assert.match(fish, /__whoisleuth_command_is lookup; or __whoisleuth_direct_lookup_target/u);
    assert.match(fish, /--plan --json/u);
    assert.match(fish, /contains -- \$first completion doctor commands manual/u);
    assert.match(fish, /function __whoisleuth_file_position[\s\S]*complete -c whoisleuth -n '__whoisleuth_file_position' -F/u);
    for (const command of ['bulk', 'discover-scan']) {
      const line = fish.split('\n').find((candidate) => candidate.includes('-l resume')
        && new RegExp(`__whoisleuth_command_is [^']*\\b${command}\\b`, 'u').test(candidate)) ?? '';
      assert.match(line, /-l resume$/u);
      assert.doesNotMatch(line, / -r| -F/u);
    }
    const workflowResume = fish.split('\n').find((candidate) => candidate.includes('__whoisleuth_command_is workflow-run')
      && candidate.includes('-l resume')) ?? '';
    assert.match(workflowResume, /-l resume -r -F$/u);
    const powershell = buildShellCompletion('powershell');
    assert.match(powershell, /Register-ArgumentCompleter -Native -CommandName whoisleuth/u);
    assert.match(powershell, /\$directLookup/u);
    assert.match(powershell, /'--plan' '--json'/u);
    assert.match(powershell, /'--palette' = @\('auto', 'light', 'dark'\)/u);
    assert.match(powershell, /'--save-lookup'/u);
    assert.match(powershell, /\$fileOptions\[\$command\] -contains \$previous/u);
    assert.match(powershell, /'workflow-run' = @\([^\n]*'--resume'/u);
    const powershellSyntax = spawnSync('pwsh', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$code = [Console]::In.ReadToEnd(); [void][scriptblock]::Create($code)',
    ], { input: powershell, encoding: 'utf8' });
    assertSuccessfulShellProcess(powershellSyntax, 'PowerShell completion syntax check');
    const powershellExpectedCases = [
      ['whoisleuth example.test --de', ['--deep']],
      ['whoisleuth report.json --de', []],
      ['whoisleuth case-pack package.json --audience ', ['internal', 'trusted', 'public']],
      ['whoisleuth sharing-review package.json --marking ', ['clear', 'green', 'amber', 'amber-strict', 'red']],
      ['whoisleuth sharing-review package.json --recipient-scope ', ['public', 'community', 'organization', 'named-recipients']],
      ['whoisleuth case-pack package.json --palette ', ['auto', 'light', 'dark']],
      ['whoisleuth bulk package.json --concurrency ', ['1', '2', '3', '4', '5', '6', '7', '8']],
      ['whoisleuth workflow-plan ', ['domain-triage', 'lookalike-review', 'owned-domain-review', 'historical-comparison', 'campaign-review', 'certificate-anomaly', 'registry-disagreement', 'evidence-handoff', 'planned-domain-change', 'post-change-verification']],
      ['whoisleuth workflow-run ', ['domain-triage', 'lookalike-review', 'owned-domain-review', 'historical-comparison']],
      ['whoisleuth completion ', ['bash', 'zsh', 'fish', 'powershell']],
      ['whoisleuth case-pack package.json --audience p', ['public']],
      ['whoisleuth sharing-review package.json --marking am', ['amber', 'amber-strict']],
      ['whoisleuth sharing-review package.json --recipient-scope org', ['organization']],
    ] as const;
    const powershellBoundaryLines = [
      'whoisleuth http ',
      'whoisleuth http --scenario ',
      'whoisleuth http --concurrency ',
      'whoisleuth http --private-key-file ',
      'whoisleuth verify-artifact package.json --manifest ',
      'whoisleuth verify-artifact ',
    ] as const;
    const completePowerShell = preparePowerShellCompletionBatch(
      powershell,
      [...powershellExpectedCases.map(([line]) => line), ...powershellBoundaryLines],
      REPOSITORY_ROOT,
    );
    for (const [line, expected] of powershellExpectedCases) {
      assert.deepEqual(completePowerShell(line), expected, line);
    }
    const httpOptions = completePowerShell('whoisleuth http ');
    assert.ok(httpOptions.includes('--json'));
    assert.equal(httpOptions.includes('lookup'), false);
    for (const line of [
      'whoisleuth http --scenario ',
      'whoisleuth http --concurrency ',
      'whoisleuth http --private-key-file ',
    ]) {
      const candidates = completePowerShell(line);
      assert.equal(candidates.includes('registered'), false, line);
      assert.equal(candidates.includes('8'), false, line);
      assert.equal(candidates.some((candidate) => candidate.endsWith('package.json')), false, line);
    }
    for (const line of [
      'whoisleuth verify-artifact package.json --manifest ',
      'whoisleuth verify-artifact ',
    ]) {
      assert.ok(completePowerShell(line).some((candidate) => candidate.endsWith('package.json')), line);
    }
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

  test('covers every installed command and every documented positional-file command', () => {
    const scripts: readonly [string, string, string, string] = [
      buildShellCompletion('bash'),
      buildShellCompletion('zsh'),
      buildShellCompletion('fish'),
      buildShellCompletion('powershell'),
    ];
    for (const command of CLI_COMMANDS) {
      for (const script of scripts) assert.match(script, new RegExp(`\\b${command}\\b`, 'u'));
    }
    for (const command of [
      'manifest', 'map-observations', 'oam-export', 'bulk', 'ct-intake', 'mail-transport',
      'registry-doctor', 'registry-cohort', 'risk-calibrate', 'lookalike-calibrate',
      'verify-artifact', 'interchange-report', 'inspect-archive', 'sign-artifact',
      'verify-signature', 'source-report', 'compare', 'page-compare', 'mail-review',
      'review-evidence', 'brief', 'case-pack', 'domain-control', 'monitor-once',
      'assurance', 'change-packet', 'sharing-review', 'diff', 'reconcile', 'timeline', 'export',
    ]) {
      assert.match(scripts[0], new RegExp(`\\b${command}\\b`, 'u'));
      assert.match(scripts[1], new RegExp(`\\b${command}\\b`, 'u'));
      assert.match(scripts[2], new RegExp(`__whoisleuth_command_is [^\\n]*\\b${command}\\b[^\\n]*-F`, 'u'));
      assert.match(scripts[3], new RegExp(`\\b${command}\\b`, 'u'));
    }
    assert.match(scripts[0], /manifest\) options="[^"]*--workflow/u);
    assert.match(scripts[1], /manifest\) options=\([^)]*--workflow/u);
    assert.match(scripts[2], /__whoisleuth_command_is manifest[^\n]*-l workflow/u);
    assert.match(scripts[3], /'manifest' = @\([^)]*'--workflow'/u);
    assert.match(scripts[3], /\$fileLimits = @\{[\s\S]*'manifest' = 16/u);
    for (const option of [
      '--workflow', '--configuration-digest', '--scan-limit', '--chunk-size', '--suffix',
      '--manifest-entry', '--limit', '--left-session', '--right-session',
    ]) {
      assert.match(scripts[0], new RegExp(option, 'u'));
      assert.match(scripts[1], new RegExp(option, 'u'));
      assert.match(scripts[2], new RegExp(`-l ${option.slice(2)} -r`, 'u'));
      assert.match(scripts[3], new RegExp(`'${option}'`, 'u'));
    }
    assert.match(scripts[0], /--scenario\) COMPREPLY=.*registered not_found inconclusive/u);
    assert.match(scripts[1], /--scenario\) compadd -- registered not_found inconclusive/u);
    assert.match(scripts[2], /-l scenario -r/u);
    assert.match(scripts[3], /'--scenario' = @\('registered', 'not_found', 'inconclusive'\)/u);
    for (const option of ['manifest', 'mmdb']) {
      assert.match(scripts[2], new RegExp(`-l ${option} -r -F`, 'u'));
      assert.match(scripts[3], new RegExp(`'--${option}'`, 'u'));
    }
    assert.match(scripts[0], /verify-artifact/u);
    assert.match(scripts[1], /verify-artifact/u);
    assert.match(scripts[2], /__whoisleuth_command_is [^\n]*verify-artifact[^\n]*-F/u);
    assert.match(scripts[3], /\$fileLimits = @\{[\s\S]*'verify-artifact' = 1/u);
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
