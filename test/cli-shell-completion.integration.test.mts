import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_COMMANDS } from '../cli/arguments.mts';
import { RUNNABLE_INVESTIGATION_PLAN_RECIPES } from '../cli/command-reference.mts';
import { buildShellCompletion } from '../cli/completion.mts';
import { quoteCommandArgument } from '../packages/analysis/cli-command-builder.mts';
import { unitTestExecutablePath } from '../tools/toolchain-compatibility.mts';
import {
  SHELL_COMPLETION_PROCESS_OPTIONS,
  assertSuccessfulShellProcess,
  prepareBashCompletionBatch,
  prepareFishCompletionBatch,
  preparePowerShellCompletionBatch,
  prepareZshCompletionBatch,
} from './support/shell-completion-harness.mts';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('CLI shell completion integration', () => {
  test('the native parser keeps every command-builder apostrophe form within one literal argument', () => {
    const values = ["'", '\u2018', '\u2019', '\u201a', '\u201b'].flatMap(quote => [
      `Example${quote}s Shop`, `x${quote}; Write-Output sentinel; ${quote}`, `x${quote}$(sentinel)${quote}`,
    ]);
    const cases = values.map(value => ({ value, literal: quoteCommandArgument(value, 'powershell') }));
    const probe = spawnSync(unitTestExecutablePath('pwsh'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference = 'Stop'
      $items = [Console]::In.ReadToEnd() | ConvertFrom-Json
      foreach ($item in $items) {
        $native = "'" + [System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($item.value) + "'"
        if ($native -cne $item.literal) { throw 'Escaping differs from the native literal escaper.' }
        $tokens = $null; $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput(('& whoisleuth ''lookup'' ' + $item.literal), [ref]$tokens, [ref]$errors)
        if ($errors.Count -ne 0 -or $ast.EndBlock.Statements.Count -ne 1) { throw 'Expected one valid statement.' }
        $pipeline = $ast.EndBlock.Statements[0]
        if ($pipeline.PipelineElements.Count -ne 1) { throw 'Expected one command.' }
        $elements = $pipeline.PipelineElements[0].CommandElements
        if ($elements.Count -ne 3 -or $elements[2].GetType().Name -ne 'StringConstantExpressionAst' -or $elements[2].Value -cne $item.value) { throw 'Input did not remain one unchanged literal argument.' }
      }
      [Console]::Out.Write($items.Count)
    `], { ...SHELL_COMPLETION_PROCESS_OPTIONS, input: JSON.stringify(cases) });
    assertSuccessfulShellProcess(probe, 'Command-builder literal parsing');
    assert.equal(Number(probe.stdout), cases.length);
  });
  test('reports an unavailable shell with its bounded process diagnostic', () => {
    const unavailable = spawnSync(
      'whoisleuth-unavailable-shell-fixture',
      [],
      SHELL_COMPLETION_PROCESS_OPTIONS,
    );
    assert.throws(
      () => assertSuccessfulShellProcess(unavailable, 'Fixture shell'),
      /Fixture shell failed to start: .*ENOENT/u,
    );
  });

  test('terminates a hanging process and distinguishes its deadline from a failed launch', () => {
    const hanging = spawnSync(process.execPath, ['--eval', 'setInterval(() => {}, 1_000)'], {
      ...SHELL_COMPLETION_PROCESS_OPTIONS,
      timeout: 25,
    });
    assert.equal((hanging.error as NodeJS.ErrnoException | undefined)?.code, 'ETIMEDOUT');
    assert.equal(hanging.status, null);
    assert.equal(hanging.signal, 'SIGKILL');
    assert.throws(
      () => assertSuccessfulShellProcess(hanging, 'Fixture process'),
      /Fixture process exceeded its process deadline/u,
    );
  });

  test('reports a completed failure without accepting or exposing unbounded stderr', () => {
    const failed = spawnSync(
      process.execPath,
      ['--eval', "process.stderr.write('x'.repeat(3_000)); process.exitCode = 7"],
      SHELL_COMPLETION_PROCESS_OPTIONS,
    );
    assert.equal(failed.status, 7);
    assert.throws(
      () => assertSuccessfulShellProcess(failed, 'Fixture process'),
      (error: unknown) =>
        error instanceof assert.AssertionError &&
        error.message.includes('Fixture process exited with status 7') &&
        error.message.includes('x'.repeat(2_048)) &&
        !error.message.includes('x'.repeat(2_049)),
    );
  });

  test('executes native syntax and candidate behaviour', () => {
    const bash = buildShellCompletion('bash');
    const syntax = spawnSync(unitTestExecutablePath('bash'), ['-n'], {
      ...SHELL_COMPLETION_PROCESS_OPTIONS,
      input: bash,
    });
    assertSuccessfulShellProcess(syntax, 'Bash completion syntax check');
    const completionSpec = spawnSync(
      unitTestExecutablePath('bash'),
      ['--noprofile', '--norc', '-c', `${bash}\ncomplete -p whoisleuth`],
      SHELL_COMPLETION_PROCESS_OPTIONS,
    );
    assertSuccessfulShellProcess(completionSpec, 'Bash filename completion registration');
    assert.match(completionSpec.stdout, /-o filenames\b/u);
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
    const directTargetCases = [...acceptedTargets, ...rejectedTargets].map(
      (target) => ['whoisleuth', target, '--de'] as const,
    );
    const bashCandidates = prepareBashCompletionBatch(bash, directTargetCases, REPOSITORY_ROOT);
    for (const target of acceptedTargets) {
      assert.deepEqual(bashCandidates(['whoisleuth', target, '--de']), ['--deep'], target);
    }
    for (const target of rejectedTargets) {
      assert.equal(
        bashCandidates(['whoisleuth', target, '--de']).includes('--deep'),
        false,
        target,
      );
    }
    const zsh = buildShellCompletion('zsh');
    const zshSyntax = spawnSync(unitTestExecutablePath('zsh'), ['-n'], {
      ...SHELL_COMPLETION_PROCESS_OPTIONS,
      input: zsh,
    });
    assertSuccessfulShellProcess(zshSyntax, 'Zsh completion syntax check');
    const zshCandidates = prepareZshCompletionBatch(
      zsh,
      [
        ['whoisleuth', 'example.test', '--de'],
        ['whoisleuth', 'report.json', '--de'],
      ],
      REPOSITORY_ROOT,
    );
    assert.equal(zshCandidates(['whoisleuth', 'example.test', '--de']).includes('--deep'), true);
    assert.equal(zshCandidates(['whoisleuth', 'report.json', '--de']).includes('--deep'), false);
    const powershell = buildShellCompletion('powershell');
    const powershellSyntax = spawnSync(
      unitTestExecutablePath('pwsh'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$code = [Console]::In.ReadToEnd(); [void][scriptblock]::Create($code)',
      ],
      { ...SHELL_COMPLETION_PROCESS_OPTIONS, input: powershell },
    );
    assertSuccessfulShellProcess(powershellSyntax, 'PowerShell completion syntax check');
    const powershellExpectedCases = [
      ['whoisleuth example.test --de', ['--deep']],
      ['whoisleuth lookup --h', ['--help', '--html']],
      ['whoisleuth lookup --observer ', []],
      ['whoisleuth report.json --de', []],
      ['whoisleuth case-pack package.json --audience ', ['internal', 'trusted', 'public']],
      [
        'whoisleuth sharing-review package.json --marking ',
        ['clear', 'green', 'amber', 'amber-strict', 'red'],
      ],
      [
        'whoisleuth sharing-review package.json --recipient-scope ',
        ['public', 'community', 'organization', 'named-recipients'],
      ],
      ['whoisleuth case-pack package.json --palette ', ['auto', 'light', 'dark']],
      ['whoisleuth bulk package.json --concurrency ', ['1', '2', '3', '4', '5', '6', '7', '8']],
      [
        'whoisleuth workflow-plan ',
        [
          'domain-triage',
          'lookalike-review',
          'owned-domain-review',
          'historical-comparison',
          'campaign-review',
          'certificate-anomaly',
          'registry-disagreement',
          'evidence-handoff',
          'planned-domain-change',
          'post-change-verification',
        ],
      ],
      ['whoisleuth workflow-run ', RUNNABLE_INVESTIGATION_PLAN_RECIPES],
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
      assert.equal(
        candidates.some((candidate) => /[/\\]package\.json'?$/u.test(candidate)),
        false,
        line,
      );
    }
    for (const line of [
      'whoisleuth verify-artifact package.json --manifest ',
      'whoisleuth verify-artifact ',
    ]) {
      assert.ok(
        completePowerShell(line).some((candidate) => /[/\\]package\.json'?$/u.test(candidate)),
        line,
      );
    }
  });

  test('Fish dispatches command, option-value and direct-target completions natively', () => {
    const script = buildShellCompletion('fish');
    // Older Fish readers misclassify socket-backed stdin as a directory.
    // Pass source explicitly while retaining the shell's native syntax check.
    const syntaxArguments = ['--no-config', '--private', '--no-execute', '-c'];
    const syntax = spawnSync(
      unitTestExecutablePath('fish'),
      [...syntaxArguments, `${script}\necho syntax-must-not-execute`],
      SHELL_COMPLETION_PROCESS_OPTIONS,
    );
    assertSuccessfulShellProcess(syntax, 'Fish completion syntax');
    assert.equal(syntax.stdout, '');
    const malformed = spawnSync(
      unitTestExecutablePath('fish'),
      [...syntaxArguments, 'function missing_end\n'],
      SHELL_COMPLETION_PROCESS_OPTIONS,
    );
    assert.equal(malformed.error, undefined);
    assert.equal(malformed.signal, null);
    assert.ok(Number.isInteger(malformed.status) && malformed.status! > 0);
    assert.notEqual(malformed.stderr.trim(), '');
    const cases = [
      ['whoisleuth completion ', ['bash', 'zsh', 'fish', 'powershell']],
      ['whoisleuth lookup --h', ['--help', '--html']],
      ['whoisleuth lookup --observer ', []],
      ['whoisleuth case-pack package.json --audience ', ['internal', 'trusted', 'public']],
      ['whoisleuth lookup --palette ', ['auto', 'light', 'dark']],
      ['whoisleuth example.test --palette ', ['auto', 'light', 'dark']],
      ['whoisleuth bulk package.json --concurrency ', ['1', '2', '3', '4', '5', '6', '7', '8']],
      ['whoisleuth bulk package.json --deep --concurrency ', ['1', '2', '3']],
      ['whoisleuth example.test --de', ['--deep']],
      ['whoisleuth report.json --de', []],
      ['whoisleuth http --scenario ', []],
    ] as const;
    const ranges = [
      ['whoisleuth discover-scan example.test --scan-limit ', 500],
      ['whoisleuth discover-scan example.test --deep --scan-limit ', 50],
      ['whoisleuth discover-scan example.test --tlds --deep --scan-limit ', 500],
      ['whoisleuth discover-scan example.test --chunk-size ', 100],
      ['whoisleuth monitor-once --limit ', 20],
    ] as const;
    const complete = prepareFishCompletionBatch(
      script,
      ['whoisleuth ', 'whoisleuth registry-scaffold --', ...cases.map(([line]) => line),
        ...ranges.map(([line]) => line)],
      REPOSITORY_ROOT,
    );
    for (const command of CLI_COMMANDS)
      assert.ok(complete('whoisleuth ').includes(command), command);
    for (const [line, expected] of cases)
      assert.deepEqual([...complete(line)].sort(), [...expected].sort(), line);
    const scaffold = complete('whoisleuth registry-scaffold --');
    assert.equal(scaffold.includes('--config'), false);
    assert.equal(scaffold.filter(option => option === '--profile').length, 1);
    for (const [line, maximum] of ranges) {
      assert.deepEqual([...complete(line)].map(Number).sort((left, right) => left - right),
        Array.from({ length: maximum }, (_, index) => index + 1), line);
    }
  });

  test('completes ordinary filenames as one literal argument, including spaces, quotes and metacharacters', () => {
    const directory = mkdtempSync(join(tmpdir(), 'whoisleuth-completion-'));
    try {
      const names = [
        'My Evidence.json',
        "Single 'quote'.json",
        'Dollar $(printf not-executed).json',
        'Ampersand & semi;.json',
        'Bracket [literal].json',
        ...(process.platform === 'win32' ? [] : ['Double "quote".json', 'Glob *?.json']),
      ];
      for (const name of names) writeFileSync(join(directory, name), '{}\n');
      mkdirSync(join(directory, 'Nested Evidence'));
      const positions = [
        ['whoisleuth', 'verify-artifact'],
        ['whoisleuth', 'lookup', 'example.test', '--save-lookup'],
      ] as const;
      const cases = positions.flatMap((position) =>
        names.map((name) => [...position, join(directory, name.split(' ')[0]!)]),
      );
      const completeBash = prepareBashCompletionBatch(
        buildShellCompletion('bash'),
        cases,
        REPOSITORY_ROOT,
      );
      for (const position of positions) {
        for (const name of names) {
          const candidates = completeBash([...position, join(directory, name.split(' ')[0]!)]);
          assert.deepEqual(candidates, [join(directory, name)], name);
        }
      }
      const lines = positions.flatMap((position) =>
        names.map((name) => `${position.join(' ')} ${join(directory, name.split(' ')[0]!)}`),
      );
      const directoryLine = `whoisleuth verify-artifact ${join(directory, 'Nested')}`;
      const completeFish = prepareFishCompletionBatch(
        buildShellCompletion('fish'),
        [...lines, directoryLine],
        REPOSITORY_ROOT,
      );
      assert.deepEqual(
        lines.flatMap((line) => {
          const matches = completeFish(line);
          assert.equal(matches.length, 1, line);
          return matches;
        }),
        positions.flatMap(() => names.map((name) => join(directory, name))),
      );
      assert.deepEqual(completeFish(directoryLine), [`${join(directory, 'Nested Evidence')}/`]);
      const completePowerShell = preparePowerShellCompletionBatch(
        buildShellCompletion('powershell'),
        [...lines, directoryLine],
        REPOSITORY_ROOT,
      );
      const candidates = lines.map((line) => {
        const matches = completePowerShell(line);
        assert.equal(matches.length, 1, line);
        return matches[0]!;
      });
      const parsed = spawnSync(
        unitTestExecutablePath('pwsh'),
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `
$candidates = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = foreach ($candidate in $candidates) {
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput('whoisleuth verify-artifact ' + $candidate, [ref]$tokens, [ref]$errors)
  $commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true))
  if ($errors.Count -ne 0 -or $commands.Count -ne 1 -or $commands[0].CommandElements.Count -ne 3) { throw 'Completion is not one argument.' }
  $argument = $commands[0].CommandElements[2]
  if ($argument -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) { throw 'Completion is not a literal argument.' }
  $argument.Value
}
$results | ConvertTo-Json -Compress -AsArray`,
        ],
        { ...SHELL_COMPLETION_PROCESS_OPTIONS, input: JSON.stringify(candidates) },
      );
      assertSuccessfulShellProcess(parsed, 'PowerShell completed-argument parsing');
      assert.deepEqual(
        JSON.parse(parsed.stdout),
        positions.flatMap(() => names.map((name) => join(directory, name))),
      );
      assert.equal(
        completePowerShell(directoryLine).length,
        1,
        'Directories must remain navigable.',
      );
      assert.match(completePowerShell(directoryLine)[0]!, /Nested Evidence/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('omits supplied and incompatible options while retaining repeatable selections and valid enum alternatives', () => {
    const cases = [
      {
        args: ['discover', '--preset', ''],
        absent: ['custom'],
        present: ['common', 'impersonation', 'all'],
      },
      {
        args: ['lookup', '--json', '--'],
        absent: ['--json', '--junit', '--quiet', '--summary', '--help', '--no-attribution'],
        present: ['--deep', '--observer'],
      },
      {
        args: ['lookup', '--quiet', '--'],
        absent: ['--output', '--force', '--json'],
        present: ['--deep'],
      },
      {
        args: ['lookup', '--force', '--'],
        absent: ['--quiet', '--events', '--browse'],
        present: ['--output'],
      },
      {
        args: ['bulk', '--plan', '--'],
        absent: ['--csv', '--resume', '--checkpoint', '--events', '--plan'],
        present: ['--json', '--deep'],
      },
      {
        args: ['discover', '--preset', 'common', '--'],
        absent: ['--preset', '--dictionary', '--families'],
        present: ['--json'],
      },
      {
        args: ['discover', '--dictionary', 'words.txt', '--preset', ''],
        absent: ['common'],
        present: ['impersonation', 'all'],
      },
      {
        args: ['workflow-run', '--select', 'collect=example.test', '--'],
        absent: ['--help'],
        present: ['--select', '--resume'],
      },
      {
        args: ['verify-artifact', '--', '--help', '--'],
        absent: ['--json', '--help', '--output'],
        present: [],
      },
      {
        args: ['lookup', '--', '--plan', '--'],
        absent: ['--json', '--deep', '--help'],
        present: [],
      },
    ];
    const words = cases.map(({ args }) => ['whoisleuth', ...args]);
    const bash = prepareBashCompletionBatch(buildShellCompletion('bash'), words, REPOSITORY_ROOT);
    const zsh = prepareZshCompletionBatch(buildShellCompletion('zsh'), words, REPOSITORY_ROOT);
    const lines = words.map((tokens) => tokens.join(' '));
    const powershell = preparePowerShellCompletionBatch(
      buildShellCompletion('powershell'),
      lines,
      REPOSITORY_ROOT,
    );
    const fish = prepareFishCompletionBatch(buildShellCompletion('fish'), lines, REPOSITORY_ROOT);
    for (const [index, entry] of cases.entries()) {
      for (const [shell, candidates] of [
        ['bash', bash(words[index]!)],
        ['zsh', zsh(words[index]!)],
        ['powershell', powershell(lines[index]!)],
        ['fish', fish(lines[index]!)],
      ] as const) {
        for (const value of entry.present)
          assert.ok(candidates.includes(value), `${shell}: ${lines[index]} must include ${value}`);
        for (const value of entry.absent)
          assert.ok(!candidates.includes(value), `${shell}: ${lines[index]} must omit ${value}`);
      }
    }
  });

  test('offers ordinary files for supported positional commands without depending on generated helper names', () => {
    const directory = mkdtempSync(join(tmpdir(), 'whoisleuth-completion-positions-'));
    try {
      const file = join(directory, 'evidence.json');
      writeFileSync(file, '{}\n');
      const commands = [
        'manifest',
        'map-observations',
        'oam-export',
        'bulk',
        'ct-intake',
        'mail-transport',
        'registry-doctor',
        'registry-cohort',
        'risk-calibrate',
        'lookalike-calibrate',
        'verify-artifact',
        'interchange-report',
        'inspect-archive',
        'sign-artifact',
        'verify-signature',
        'source-report',
        'compare',
        'page-compare',
        'mail-review',
        'mail-headers',
        'review-evidence',
        'brief',
        'case-pack',
        'domain-control',
        'monitor-once',
        'assurance',
        'change-packet',
        'sharing-review',
        'diff',
        'reconcile',
        'timeline',
        'export',
      ];
      const words = commands.map((command) => ['whoisleuth', command, join(directory, 'evi')]);
      const lines = words.map((tokens) => tokens.join(' '));
      const bash = prepareBashCompletionBatch(buildShellCompletion('bash'), words, REPOSITORY_ROOT);
      const zsh = prepareZshCompletionBatch(buildShellCompletion('zsh'), words, REPOSITORY_ROOT);
      const fish = prepareFishCompletionBatch(buildShellCompletion('fish'), lines, REPOSITORY_ROOT);
      const powershell = preparePowerShellCompletionBatch(
        buildShellCompletion('powershell'),
        lines,
        REPOSITORY_ROOT,
      );
      for (const [index, command] of commands.entries()) {
        assert.deepEqual(bash(words[index]!), [file], command);
        assert.deepEqual(zsh(words[index]!), ['__FILES__'], command);
        assert.deepEqual(fish(lines[index]!), [file], command);
        assert.equal(powershell(lines[index]!).length, 1, command);
        assert.match(powershell(lines[index]!)[0]!, /[/\\]evidence\.json'?$/u, command);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('keeps option-like filenames literal and excludes flag suggestions at the positional boundary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'whoisleuth-completion-separator-'));
    try {
      writeFileSync(join(directory, '-evidence.json'), '{}\n');
      const separated = ['whoisleuth', 'verify-artifact', '--', '-evidence'];
      const ordinary = ['whoisleuth', 'verify-artifact', '-evidence'];
      const bash = prepareBashCompletionBatch(
        buildShellCompletion('bash'),
        [separated, ordinary],
        directory,
      );
      assert.deepEqual(bash(separated), ['-evidence.json']);
      assert.deepEqual(bash(ordinary), []);
      const zsh = prepareZshCompletionBatch(
        buildShellCompletion('zsh'),
        [separated, ordinary],
        directory,
      );
      assert.deepEqual(zsh(separated), ['__FILES__']);
      assert.ok(!zsh(ordinary).includes('__FILES__'));
      const fish = prepareFishCompletionBatch(
        buildShellCompletion('fish'),
        [separated.join(' '), ordinary.join(' ')],
        directory,
      );
      assert.deepEqual(fish(separated.join(' ')), ['-evidence.json']);
      assert.deepEqual(fish(ordinary.join(' ')), []);
      const powershellPath = 'whoisleuth verify-artifact -- ./-evidence';
      const powershell = preparePowerShellCompletionBatch(
        buildShellCompletion('powershell'),
        [powershellPath, separated.join(' '), ordinary.join(' ')],
        directory,
      );
      // PowerShell can use its own filename fallback for a dash-prefixed word after --.
      assert.equal(powershell(powershellPath).length, 1);
      assert.match(powershell(powershellPath)[0]!, /-evidence\.json/u);
      for (const candidate of powershell(separated.join(' ')))
        assert.match(candidate, /(?:^|[/\\])-evidence\.json'?$/u);
      for (const candidate of powershell(ordinary.join(' ')))
        assert.match(candidate, /^(?:'?[./]|'?[A-Za-z]:[/\\]).*-evidence\.json'?$/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
