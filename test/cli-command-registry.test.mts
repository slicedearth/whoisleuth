import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CLI_PARSERS, CliUsageError, parseCliArguments, type CliCommand } from '../cli/arguments.mts';
import { buildCliCommandCatalogue } from '../cli/command-catalogue.mts';
import {
  CLI_COMMAND_REGISTRY,
  CLI_COMMANDS,
  CLI_META_ACTIONS,
  COMMAND_COLLECTION,
  COMMAND_DETAILS,
  COMMAND_USAGE,
  HELP,
  HELP_COMMANDS_BY_GROUP,
  OPTIONS_BY_COMMAND,
  cliMetaActionForInvocation,
  cliInvocationNetworkEffect,
  commandOptionSpec,
  commandDefinition,
  commandPositionalSpecs,
  isCliCommand,
  metaActionDefinition,
  type CliGrammarConstraint,
  type CliHandlerOwner,
  type CliNetworkEffect,
} from '../cli/command-reference.mts';
import { buildShellCompletion } from '../cli/completion.mts';
import { buildInvestigationPlan, INVESTIGATION_PLAN_RECIPES } from '../cli/investigation-plan.mts';
import { buildCliManual } from '../cli/manual.mts';
import { INLINE_CLI_COMMANDS } from '../cli/runner.mts';

const FROZEN_COMMANDS = Object.freeze(JSON.parse(readFileSync(
  new URL('../fixtures/cli-command-inventory-v1.json', import.meta.url),
  'utf8',
)) as string[]);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

function bashCandidates(script: string, words: readonly string[]): string[] {
  const invocation = `${script}\nCOMP_WORDS=(${words.map((word) => JSON.stringify(word)).join(' ')}); COMP_CWORD=${words.length - 1}; _whoisleuth_completion; printf '%s\\n' "\${COMPREPLY[@]}"`;
  const result = spawnSync('bash', ['-c', invocation], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/gu).filter(Boolean);
}

function zshCandidates(script: string, words: readonly string[]): string[] {
  const invocation = `compdef() { :; }
_describe() { :; }
_files() { print -r -- __FILES__; }
_message() { print -r -- __MESSAGE__; }
compadd() {
  local after_separator=0 value
  for value in "$@"; do
    if [[ "$value" == "--" ]]; then after_separator=1; continue; fi
    (( after_separator )) && print -r -- "$value"
  done
}
${script}
words=(${words.map((word) => JSON.stringify(word)).join(' ')})
CURRENT=${words.length}
_whoisleuth`;
  const result = spawnSync('zsh', ['-c', invocation], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/gu).filter(Boolean);
}

function powershellCandidates(script: string, line: string): string[] {
  const invocation = `${script}
function global:whoisleuth { & node bin/whoisleuth.mts @args }
$line = ${JSON.stringify(line)}
$result = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $line.Length, $null)
$result.CompletionMatches | ForEach-Object { $_.CompletionText }`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', invocation], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/gu).filter(Boolean);
}

const MINIMUM_ARGUMENTS: Readonly<Record<CliCommand, readonly string[]>> = Object.freeze({
  completion: ['completion', 'bash'],
  doctor: ['doctor'],
  commands: ['commands'],
  manual: ['manual'],
  manifest: ['manifest', 'artefact.json', '--workflow', 'review'],
  'map-observations': ['map-observations'],
  'oam-export': ['oam-export'],
  lookup: ['lookup', 'example.test'],
  bulk: ['bulk'],
  'ct-search': ['ct-search', 'example'],
  'ct-intake': ['ct-intake'],
  discover: ['discover', 'example.test'],
  'discover-scan': ['discover-scan', 'example.test', '--plan'],
  posture: ['posture', 'example.test'],
  http: ['http', 'example.test'],
  tls: ['tls', 'example.test'],
  'dnssec-validate': ['dnssec-validate', 'example.test', '--resolver', '192.0.2.53', '--trust-anchor', 'anchor.json', '--owned-or-authorized'],
  'mail-transport': ['mail-transport', '--resolver', '192.0.2.53', '--trust-anchor', 'anchor.json', '--owned-or-authorized', '--active-probe'],
  'registry-support': ['registry-support', 'example.test'],
  'registry-doctor': ['registry-doctor'],
  'registry-cohort': ['registry-cohort'],
  'registry-scaffold': ['registry-scaffold', '--profile', 'example', '--suffix', 'test', '--scenario', 'registered'],
  'risk-calibrate': ['risk-calibrate'],
  'lookalike-calibrate': ['lookalike-calibrate'],
  'verify-artifact': ['verify-artifact'],
  'interchange-report': ['interchange-report'],
  'inspect-archive': ['inspect-archive'],
  'sign-artifact': ['sign-artifact', '--private-key-file', 'private.pem'],
  'verify-signature': ['verify-signature'],
  'source-report': ['source-report'],
  compare: ['compare'],
  'page-compare': ['page-compare', 'left.json', 'right.json'],
  'mail-review': ['mail-review'],
  'review-evidence': ['review-evidence'],
  brief: ['brief'],
  'case-pack': ['case-pack', '--audience', 'internal', '--reviewed'],
  'domain-control': ['domain-control'],
  'monitor-once': ['monitor-once'],
  assurance: ['assurance'],
  'change-packet': ['change-packet'],
  'sharing-review': ['sharing-review', '--marking', 'amber', '--recipient-scope', 'community', '--purpose', 'Reviewed handoff', '--human-reviewed', '--personal-data-reviewed', '--redactions-confirmed'],
  'workflow-plan': ['workflow-plan', 'domain-triage', 'example.test'],
  'workflow-run': ['workflow-run', 'domain-triage', 'example.test'],
  diff: ['diff', 'left.json', 'right.json'],
  reconcile: ['reconcile', 'left.json', 'right.json'],
  timeline: ['timeline', 'left.json', 'right.json'],
  export: ['export'],
});

function assertDeepFrozen(value: unknown, path = 'registry', seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, path);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${path}.${key}`, seen);
}

function withoutOption(argv: readonly string[], option: string, arity: 0 | 1): string[] {
  const retained: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === option) {
      if (arity === 1) index += 1;
      continue;
    }
    retained.push(argv[index]!);
  }
  return retained;
}

function withGrammarOption(
  command: CliCommand,
  option: string,
  value: string,
  whenOptionPresent: string | null = null,
): string[] {
  const specification = commandOptionSpec(command, option);
  assert.ok(specification && specification.arity === 1, `${command} ${option}`);
  let argv = withoutOption(MINIMUM_ARGUMENTS[command], option, 1);
  if (option === '--fail-on') argv = argv.filter((argument) => argument !== '--plan');
  if (option === '--manifest-entry' && !argv.includes('--manifest')) argv.push('--manifest', 'manifest.json');
  if (whenOptionPresent === '--deep') {
    argv = argv.filter((argument) => argument !== '--fast' && argument !== '--deep');
    argv.push('--deep');
  }
  argv.push(option, value);
  return argv;
}

function optionValue(command: CliCommand, option: string): string {
  const specification = commandOptionSpec(command, option);
  assert.ok(specification && specification.arity === 1, `${command} ${option}`);
  if (specification.values.length > 0) return specification.values[0]!;
  if (specification.valueKind === 'integer') return String(specification.integerRanges[0]!.minimum);
  if (specification.valueKind === 'file') return `${option.slice(2)}.json`;
  return option === '--configuration-digest' ? `sha256:${'a'.repeat(64)}` : 'fixture';
}

function ensureOption(argv: readonly string[], command: CliCommand, option: string, value?: string): string[] {
  const specification = commandOptionSpec(command, option);
  assert.ok(specification, `${command} ${option}`);
  const retained = withoutOption(argv, option, specification.arity);
  return specification.arity === 0
    ? [...retained, option]
    : [...retained, option, value ?? optionValue(command, option)];
}

function referencedConstraintOptions(constraint: CliGrammarConstraint): readonly string[] {
  if (constraint.kind === 'mutually_exclusive' || constraint.kind === 'required') return constraint.options;
  if (constraint.kind === 'excludes_all' || constraint.kind === 'value_excludes') {
    return [constraint.option, ...constraint.excludedOptions];
  }
  return [constraint.option, ...constraint.requiredOptions];
}

describe('canonical CLI command registry', () => {
  test('preserves the independent ordered 47-command contract and deep immutability', () => {
    assert.equal(CLI_COMMAND_REGISTRY.length, 47);
    assert.deepEqual(CLI_COMMANDS, FROZEN_COMMANDS);
    assert.equal(new Set(CLI_COMMANDS).size, 47);
    assertDeepFrozen(CLI_COMMAND_REGISTRY);
    assertDeepFrozen(INVESTIGATION_PLAN_RECIPES, 'investigationRecipes');
    for (const [order, definition] of CLI_COMMAND_REGISTRY.entries()) {
      assert.equal(definition.order, order);
      assert.equal(commandDefinition(definition.command), definition);
      assert.equal(isCliCommand(definition.command), true);
      assert.equal(definition.grammar.parserKey, definition.command);
    }
    assert.equal(isCliCommand('not-a-command'), false);

    const helpCommands = Object.values(HELP_COMMANDS_BY_GROUP).flat();
    assert.equal(helpCommands.length, 47);
    assert.deepEqual([...helpCommands].sort(), [...FROZEN_COMMANDS].sort());
    assert.equal(new Set(helpCommands).size, 47);
  });

  test('owns typed option grammar, bounded values, ranges, occurrences, and constraints', () => {
    for (const definition of CLI_COMMAND_REGISTRY) {
      const optionNames = definition.grammar.options.map((option) => option.option);
      assert.equal(new Set(optionNames).size, optionNames.length, definition.command);
      assert.deepEqual(optionNames, [
        ...definition.completion.commonOptions,
        ...definition.completion.options,
      ], definition.command);
      for (const option of definition.grammar.options) {
        assert.equal(commandOptionSpec(definition.command, option.option), option);
        assert.equal(option.arity, option.valueKind === 'flag' ? 0 : 1);
        assert.equal(option.values.length > 0, option.valueKind === 'enum' || option.valueKind === 'policy_list');
        assert.equal(option.integerRanges.length > 0, option.valueKind === 'integer');
        assert.equal(option.metaAction, option.option === '--help' ? 'help' : null);
        for (const range of option.integerRanges) {
          assert.equal(Number.isSafeInteger(range.minimum), true);
          assert.equal(Number.isSafeInteger(range.maximum), true);
          assert.ok(range.minimum >= 1 && range.maximum >= range.minimum);
          if (range.whenOptionPresent !== null) assert.equal(optionNames.includes(range.whenOptionPresent), true);
        }
      }
      assert.equal(commandPositionalSpecs(definition.command), definition.grammar.positionals);
      for (const positional of definition.grammar.positionals) {
        assert.ok(positional.minimum >= 0 && positional.maximum >= positional.minimum, definition.command);
        assert.equal(positional.values.length > 0, positional.valueKind === 'enum', `${definition.command} ${positional.name}`);
        if (positional.inputSource === 'argv_or_stdin') assert.equal(positional.minimum, 0, definition.command);
        for (const option of positional.requiredWhenOptions) {
          assert.equal(optionNames.includes(option), true, `${definition.command} ${positional.name} ${option}`);
        }
      }
      assert.deepEqual(definition.grammar.metaActions, ['help']);
      for (const constraint of definition.grammar.constraints) {
        for (const option of referencedConstraintOptions(constraint)) {
          assert.equal(optionNames.includes(option), true, `${definition.command} ${option}`);
        }
      }
    }

    assert.deepEqual(commandOptionSpec('bulk', '--concurrency')?.integerRanges, [
      { minimum: 1, maximum: 8, whenOptionPresent: null },
      { minimum: 1, maximum: 3, whenOptionPresent: '--deep' },
    ]);
    assert.deepEqual(commandOptionSpec('discover-scan', '--scan-limit')?.integerRanges, [
      { minimum: 1, maximum: 500, whenOptionPresent: null },
      { minimum: 1, maximum: 50, whenOptionPresent: '--deep' },
    ]);
    assert.deepEqual(commandOptionSpec('monitor-once', '--limit')?.integerRanges, [
      { minimum: 1, maximum: 20, whenOptionPresent: null },
    ]);
    assert.equal(commandOptionSpec('http', '--scenario'), null);
    assert.equal(commandOptionSpec('workflow-run', '--resume')?.valueKind, 'file');
    assert.equal(commandOptionSpec('bulk', '--resume')?.valueKind, 'flag');
    assert.deepEqual(commandPositionalSpecs('manifest'), [
      { name: 'artefacts', valueKind: 'file', minimum: 1, maximum: 16, values: [], inputSource: 'argv', requiredWhenOptions: [] },
    ]);
    assert.deepEqual(commandPositionalSpecs('page-compare'), [
      { name: 'sources', valueKind: 'file', minimum: 2, maximum: 2, values: [], inputSource: 'argv', requiredWhenOptions: [] },
    ]);
    assert.deepEqual(commandPositionalSpecs('workflow-run'), [
      { name: 'recipe', valueKind: 'enum', minimum: 1, maximum: 1, values: INVESTIGATION_PLAN_RECIPES, inputSource: 'argv', requiredWhenOptions: [] },
      { name: 'subject', valueKind: 'text', minimum: 1, maximum: 1, values: [], inputSource: 'argv', requiredWhenOptions: [] },
    ]);
    assert.deepEqual(commandPositionalSpecs('lookup'), [
      { name: 'target', valueKind: 'text', minimum: 0, maximum: 1, values: [], inputSource: 'argv_or_stdin', requiredWhenOptions: ['--browse'] },
    ]);
    assert.deepEqual(CLI_META_ACTIONS, [
      { id: 'help', aliases: ['--help', '-h'], scope: 'root_or_command', precedence: 'before_command_grammar', bypassesOrdinaryRequirements: true, acceptsAdditionalArguments: false },
      { id: 'version', aliases: ['--version', '-V'], scope: 'root_only', precedence: 'before_command_grammar', bypassesOrdinaryRequirements: true, acceptsAdditionalArguments: false },
    ]);
    assert.equal(metaActionDefinition('help'), CLI_META_ACTIONS[0]);
    assert.equal(metaActionDefinition('version'), CLI_META_ACTIONS[1]);
    assertDeepFrozen(CLI_META_ACTIONS, 'metaActions');
    assert.deepEqual(
      CLI_COMMAND_REGISTRY.flatMap((definition) => definition.grammar.options
        .filter((option) => option.occurrence === 'idempotent')
        .map((option) => option.option))
        .filter((option, index, values) => values.indexOf(option) === index)
        .sort(),
      ['--human-reviewed', '--no-color', '--personal-data-reviewed', '--quiet', '--redactions-confirmed'],
    );
    assert.throws(
      () => parseCliArguments(['monitor-once', '--limit', '2', '--limit', '3']),
      /--limit may be supplied only once/u,
    );
    assert.throws(
      () => parseCliArguments(['monitor-once', '--concurrency', '2', '--concurrency', '3']),
      /--concurrency may be supplied only once/u,
    );
  });

  test('binds every command to one parser and its own minimal accepted action', () => {
    assert.deepEqual(Object.keys(CLI_PARSERS), FROZEN_COMMANDS);
    assert.deepEqual(Object.keys(MINIMUM_ARGUMENTS), FROZEN_COMMANDS);
    for (const command of CLI_COMMANDS) {
      const parsed = parseCliArguments(MINIMUM_ARGUMENTS[command]);
      assert.equal(parsed.action, command, command);
    }
  });

  test('models stdin positional alternatives and pre-grammar meta actions exactly', () => {
    const stdinCommands = [
      'lookup', 'ct-search', 'discover', 'discover-scan', 'posture', 'http', 'tls', 'registry-support',
    ] as const;
    for (const command of stdinCommands) {
      assert.equal(parseCliArguments([command]).action, command);
      const [positional] = commandPositionalSpecs(command);
      assert.equal(positional?.minimum, 0, command);
      assert.equal(positional?.inputSource, 'argv_or_stdin', command);
    }
    assert.deepEqual(commandPositionalSpecs('lookup')[0]?.requiredWhenOptions, ['--browse']);
    assert.throws(
      () => parseCliArguments(['lookup', '--browse']),
      /requires a positional target/iu,
    );

    for (const command of CLI_COMMANDS) {
      assert.deepEqual(parseCliArguments([command, '--help']), { action: 'help', command });
      assert.deepEqual(parseCliArguments([command, '-h']), { action: 'help', command });
      for (const option of commandDefinition(command).grammar.options.filter((item) => item.scope === 'command')) {
        const optionArguments = option.arity === 0 ? [option.option] : [option.option, optionValue(command, option.option)];
        assert.throws(
          () => parseCliArguments([command, '--help', ...optionArguments]),
          /Help accepts only an optional command name/u,
          `${command} help with ${option.option}`,
        );
      }
    }
    assert.deepEqual(parseCliArguments(['example.test', '--help']), { action: 'help', command: 'lookup' });
    assert.deepEqual(parseCliArguments(['example.test', '-h']), { action: 'help', command: 'lookup' });
    assert.deepEqual(parseCliArguments(['--help']), { action: 'help' });
    assert.deepEqual(parseCliArguments(['-h']), { action: 'help' });
    assert.deepEqual(parseCliArguments(['--version']), { action: 'version' });
    assert.deepEqual(parseCliArguments(['-V']), { action: 'version' });

    for (const alias of metaActionDefinition('help').aliases) {
      assert.equal(cliMetaActionForInvocation(['lookup', alias])?.id, 'help');
      assert.throws(
        () => parseCliArguments(['lookup', alias, '--output', 'help.txt']),
        /Help accepts only an optional command name/u,
      );
      assert.throws(
        () => parseCliArguments(['example.test', alias, '--palette', 'dark']),
        /Help accepts only an optional command name/u,
      );
    }
    for (const alias of metaActionDefinition('version').aliases) {
      assert.equal(cliMetaActionForInvocation([alias])?.id, 'version');
      assert.throws(
        () => parseCliArguments([alias, '--output', 'version.txt', '--force']),
        /does not accept other arguments/u,
      );
    }

    for (const relativePath of ['bin/whoisleuth.mts', 'cli/completion.mts']) {
      const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /['"`]--(?:help|version)['"`]|['"`]-[hV]['"`]/u, relativePath);
    }
  });

  test('binds every declared option constraint to parser rejection', () => {
    for (const definition of CLI_COMMAND_REGISTRY) {
      const command = definition.command;
      for (const constraint of definition.grammar.constraints) {
        if (constraint.kind === 'required') {
          for (const required of constraint.options) {
            const specification = commandOptionSpec(command, required)!;
            assert.throws(
              () => parseCliArguments(withoutOption(MINIMUM_ARGUMENTS[command], required, specification.arity)),
              CliUsageError,
              `${command} requires ${required}`,
            );
          }
          continue;
        }
        if (constraint.kind === 'mutually_exclusive') {
          for (let leftIndex = 0; leftIndex < constraint.options.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < constraint.options.length; rightIndex += 1) {
              const left = constraint.options[leftIndex]!;
              const right = constraint.options[rightIndex]!;
              let argv = ensureOption(MINIMUM_ARGUMENTS[command], command, left);
              argv = ensureOption(argv, command, right);
              assert.throws(() => parseCliArguments(argv), CliUsageError, `${command} ${left} ${right}`);
            }
          }
          continue;
        }
        if (constraint.kind === 'excludes_all') {
          for (const excluded of constraint.excludedOptions) {
            let argv = ensureOption(MINIMUM_ARGUMENTS[command], command, constraint.option);
            argv = ensureOption(argv, command, excluded);
            assert.throws(() => parseCliArguments(argv), CliUsageError, `${command} ${constraint.option} ${excluded}`);
          }
          continue;
        }
        if (constraint.kind === 'value_excludes') {
          for (const excluded of constraint.excludedOptions) {
            let argv = ensureOption(MINIMUM_ARGUMENTS[command], command, constraint.option, constraint.value);
            argv = ensureOption(argv, command, excluded);
            assert.throws(() => parseCliArguments(argv), CliUsageError, `${command} ${constraint.option}=${constraint.value} ${excluded}`);
          }
          continue;
        }
        const requiredOptions = constraint.requiredOptions;
        let argv = ensureOption(MINIMUM_ARGUMENTS[command], command, constraint.option);
        for (const required of requiredOptions) {
          const specification = commandOptionSpec(command, required)!;
          argv = withoutOption(argv, required, specification.arity);
        }
        assert.throws(
          () => parseCliArguments(argv),
          CliUsageError,
          `${command} ${constraint.option} requires ${requiredOptions.join(' or ')}`,
        );
      }
    }
  });

  test('binds every declared enum, policy, and integer boundary to parser behaviour', () => {
    for (const definition of CLI_COMMAND_REGISTRY) {
      for (const option of definition.grammar.options) {
        if (option.valueKind === 'enum' || option.valueKind === 'policy_list') {
          for (const value of option.values) {
            assert.equal(
              parseCliArguments(withGrammarOption(definition.command, option.option, value)).action,
              definition.command,
              `${definition.command} ${option.option} ${value}`,
            );
          }
          assert.throws(
            () => parseCliArguments(withGrammarOption(definition.command, option.option, 'unsupported-value')),
            CliUsageError,
            `${definition.command} ${option.option}`,
          );
        }
        if (option.valueKind === 'integer') {
          for (const range of option.integerRanges) {
            for (const value of [range.minimum, range.maximum]) {
              assert.equal(
                parseCliArguments(withGrammarOption(
                  definition.command,
                  option.option,
                  String(value),
                  range.whenOptionPresent,
                )).action,
                definition.command,
                `${definition.command} ${option.option} ${value}`,
              );
            }
            assert.throws(() => parseCliArguments(withGrammarOption(
              definition.command,
              option.option,
              String(range.maximum + 1),
              range.whenOptionPresent,
            )), CliUsageError, `${definition.command} ${option.option} upper bound`);
          }
          assert.throws(() => parseCliArguments(withGrammarOption(
            definition.command,
            option.option,
            '0',
          )), CliUsageError, `${definition.command} ${option.option} lower bound`);
        }
      }
    }
  });

  test('records exact handler and network ownership without widening catalogue v1', () => {
    const owners = Object.fromEntries(CLI_COMMAND_REGISTRY.map((definition) => [
      definition.command,
      definition.execution.handlerOwner,
    ])) as Record<CliCommand, CliHandlerOwner>;
    assert.deepEqual(Object.entries(owners).filter(([, owner]) => owner === 'lookup').map(([command]) => command), ['lookup']);
    assert.deepEqual(Object.entries(owners).filter(([, owner]) => owner === 'bulk').map(([command]) => command), ['bulk']);
    assert.deepEqual(Object.entries(owners).filter(([, owner]) => owner === 'discovery').map(([command]) => command), ['discover']);
    assert.deepEqual(Object.entries(owners).filter(([, owner]) => owner === 'discovery_scan').map(([command]) => command), ['discover-scan']);
    assert.deepEqual(Object.entries(owners).filter(([, owner]) => owner === 'evidence').map(([command]) => command), ['inspect-archive', 'sign-artifact', 'verify-signature']);
    assert.deepEqual(Object.entries(owners).filter(([, owner]) => owner === 'network').map(([command]) => command), ['ct-search', 'posture', 'http', 'tls', 'dnssec-validate', 'mail-transport']);
    assert.equal(Object.values(owners).filter((owner) => owner === 'inline').length, 34);
    assert.deepEqual(
      INLINE_CLI_COMMANDS,
      CLI_COMMAND_REGISTRY.filter((definition) => definition.execution.handlerOwner === 'inline')
        .map((definition) => definition.command),
    );

    const effects = Object.fromEntries(CLI_COMMAND_REGISTRY.map((definition) => [
      definition.command,
      definition.execution.networkEffect,
    ])) as Record<CliCommand, CliNetworkEffect>;
    assert.deepEqual(Object.entries(effects).filter(([, effect]) => effect === 'conditional_network').map(([command]) => command), [
      'doctor', 'lookup', 'bulk', 'discover-scan', 'workflow-run',
    ]);
    assert.deepEqual(Object.entries(effects).filter(([, effect]) => effect === 'always_network').map(([command]) => command), [
      'ct-search', 'posture', 'http', 'tls', 'dnssec-validate', 'mail-transport', 'monitor-once',
    ]);

    const catalogue = buildCliCommandCatalogue({
      commands: CLI_COMMANDS,
      details: COMMAND_DETAILS,
      collections: COMMAND_COLLECTION,
      usage: COMMAND_USAGE,
      packageVersion: '1.47.4',
    });
    assert.deepEqual(catalogue.commands.map((entry) => entry.command), FROZEN_COMMANDS);
    for (const entry of catalogue.commands) {
      assert.deepEqual(Object.keys(entry).sort(), [
        'boundary', 'collection', 'command', 'description', 'example', 'usage',
      ]);
      assert.equal(Object.hasOwn(entry, 'grammar'), false);
      assert.equal(Object.hasOwn(entry, 'execution'), false);
    }
  });

  test('keeps fixed workflow steps aligned with invocation-level network effects', () => {
    for (const recipe of INVESTIGATION_PLAN_RECIPES) {
      const subject = recipe === 'lookalike-review' ? 'Example Brand' : 'example.test';
      const plan = buildInvestigationPlan(recipe, subject, '2026-08-16T00:00:00.000Z');
      for (const step of plan.steps) {
        assert.equal(
          step.mode,
          cliInvocationNetworkEffect(step.command, step.arguments),
          `${recipe}:${step.id}`,
        );
      }
    }
    assert.equal(cliInvocationNetworkEffect('doctor', []), 'offline');
    assert.equal(cliInvocationNetworkEffect('doctor', ['--network']), 'network');
    assert.equal(cliInvocationNetworkEffect('lookup', ['example.test', '--plan']), 'offline');
    assert.equal(cliInvocationNetworkEffect('lookup', ['example.test']), 'network');
    assert.equal(cliInvocationNetworkEffect('workflow-run', ['domain-triage', 'example.test']), 'offline');
    assert.equal(cliInvocationNetworkEffect('workflow-run', ['domain-triage', 'example.test', '--approve-network']), 'network');
    assert.equal(cliInvocationNetworkEffect('doctor', ['--profile', '--network']), 'offline');
    assert.equal(cliInvocationNetworkEffect('lookup', ['example.test', '--observer', '--plan']), 'network');
    assert.equal(cliInvocationNetworkEffect('bulk', ['--checkpoint', '--plan']), 'network');
    assert.equal(cliInvocationNetworkEffect('discover-scan', ['example.test', '--tlds', '--plan']), 'network');
    assert.equal(cliInvocationNetworkEffect('workflow-run', ['domain-triage', 'example.test', '--resume', '--approve-network']), 'offline');
    const valuedPlan = parseCliArguments(['discover-scan', 'example.test', '--tlds', '--plan']);
    assert.equal(valuedPlan.action, 'discover-scan');
    if (valuedPlan.action === 'discover-scan') assert.equal(valuedPlan.plan, false);
  });

  test('projects every command option into focused help, manual, and completion', () => {
    const manual = buildCliManual({
      commands: CLI_COMMANDS,
      details: COMMAND_DETAILS,
      collections: COMMAND_COLLECTION,
      usage: COMMAND_USAGE,
      version: '1.47.4',
    });
    const completions = (['bash', 'zsh', 'fish', 'powershell'] as const).map(buildShellCompletion);
    for (const definition of CLI_COMMAND_REGISTRY) {
      assert.match(HELP, new RegExp(`^  ${definition.command}\\s`, 'mu'), definition.command);
      assert.match(manual, new RegExp(`^\\.SS ${definition.command.replaceAll('-', '\\\\-')}$`, 'mu'), definition.command);
      for (const option of definition.completion.options) {
        assert.equal(definition.reference.usage.includes(option), true, `${definition.command} ${option}`);
        for (const completion of completions) {
          const rendered = option.startsWith('--') && completion.startsWith('# WHOISleuth fish')
            ? `-l ${option.slice(2)}`
            : option;
          assert.equal(completion.includes(rendered), true, `${definition.command} ${option}`);
        }
      }
    }
  });

  test('keeps completion values exact for bootstrap, workflow, policy, and concurrency modes', () => {
    const bash = buildShellCompletion('bash');
    const zsh = buildShellCompletion('zsh');
    const fish = buildShellCompletion('fish');
    const powershell = buildShellCompletion('powershell');
    for (const script of [bash, zsh, fish, powershell]) {
      assert.match(script, /workflow-run/u);
      for (const recipe of ['domain-triage', 'lookalike-review', 'owned-domain-review', 'historical-comparison']) {
        assert.match(script, new RegExp(recipe, 'u'));
      }
      assert.match(script, /source-failure[\s\S]*inconclusive[\s\S]*danger[\s\S]*material-drift/u);
      assert.match(script, /artifact-1[\s\S]*artifact-16/u);
      assert.match(script, /(?:--help|-l help)/u);
      assert.match(script, /(?:-h|-s h)/u);
      assert.match(script, /(?:--version|-l version)/u);
      assert.match(script, /(?:-V|-s V)/u);
    }

    const bashScaffold = bash.match(/^\s*registry-scaffold\) options="([^"]*)"/mu)?.[1] ?? '';
    const zshScaffold = zsh.match(/^\s*registry-scaffold\) options=\(([^)]*)\)/mu)?.[1] ?? '';
    const powershellScaffold = powershell.match(/^\s*'registry-scaffold' = @\(([^)]*)\)/mu)?.[1] ?? '';
    for (const options of [bashScaffold, zshScaffold, powershellScaffold]) {
      assert.doesNotMatch(options, /--config/u);
      assert.equal((options.match(/--profile/gu) || []).length, 1);
    }
    assert.equal(fish.split('\n').some((line) => line.includes('registry-scaffold') && line.includes('-l config')), false);
    assert.equal(fish.split('\n').filter((line) => line.includes('registry-scaffold') && line.includes('-l profile')).length, 1);

    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'monitor-once', '--concurrency', '']), ['1', '2', '3']);
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'bulk', '--deep', '--concurrency', '']), ['1', '2', '3']);
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'bulk', '--fast', '--concurrency', '']), ['1', '2', '3', '4', '5', '6', '7', '8']);
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'discover-scan', 'example.test', '--deep', '--scan-limit', '']).length, 50);
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'discover-scan', 'example.test', '--tlds', '--deep', '--scan-limit', '']).length, 500);
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'discover-scan', 'example.test', '--chunk-size', '']).length, 100);
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'monitor-once', '--limit', '']).length, 20);
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'workflow-run', '']), [
      'domain-triage', 'lookalike-review', 'owned-domain-review', 'historical-comparison',
    ]);
    assert.ok(bashCandidates(bash, ['whoisleuth', 'completion', '--']).includes('--help'));
    assert.ok(bashCandidates(bash, ['whoisleuth', 'workflow-plan', '--']).includes('--json'));
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'verify-artifact', '--manifest-entry', '']).length, 16);
    assert.deepEqual(bashCandidates(bash, ['whoisleuth', 'lookup', 'example.test', '--fail-on', '']), [
      'source-failure', 'inconclusive', 'danger', 'material-drift',
    ]);
    for (const [words, forbidden] of [
      [['whoisleuth', 'http', '--scenario', ''], ['registered', 'not_found', 'inconclusive']],
      [['whoisleuth', 'http', '--concurrency', ''], ['1', '2', '3', '4', '5', '6', '7', '8']],
      [['whoisleuth', 'http', '--private-key-file', ''], ['package.json']],
    ] as const) {
      const candidates = bashCandidates(bash, words);
      for (const value of forbidden) assert.equal(candidates.some((candidate) => candidate.endsWith(value)), false, `${words.join(' ')} ${value}`);
    }

    for (const [words, offersFiles] of [
      [['whoisleuth', 'verify-artifact', ''], true],
      [['whoisleuth', 'verify-artifact', '--json', ''], true],
      [['whoisleuth', 'verify-artifact', 'package.json', ''], false],
      [['whoisleuth', 'verify-artifact', '--deep', ''], false],
      [['whoisleuth', 'page-compare', 'package.json', ''], true],
      [['whoisleuth', 'page-compare', 'package.json', 'package-lock.json', ''], false],
    ] as const) {
      assert.equal(
        bashCandidates(bash, words).some((candidate) => candidate.endsWith('package.json')),
        offersFiles,
        words.join(' '),
      );
    }

    for (const [words, offersFiles] of [
      [['whoisleuth', 'verify-artifact', ''], true],
      [['whoisleuth', 'verify-artifact', '--json', ''], true],
      [['whoisleuth', 'verify-artifact', 'package.json', ''], false],
      [['whoisleuth', 'verify-artifact', '--deep', ''], false],
      [['whoisleuth', 'page-compare', 'package.json', ''], true],
      [['whoisleuth', 'page-compare', 'package.json', 'package-lock.json', ''], false],
    ] as const) {
      assert.equal(zshCandidates(zsh, words).includes('__FILES__'), offersFiles, words.join(' '));
    }
    assert.equal(zshCandidates(zsh, ['whoisleuth', 'discover-scan', 'example.test', '--deep', '--scan-limit', '']).length, 50);
    assert.equal(zshCandidates(zsh, ['whoisleuth', 'discover-scan', 'example.test', '--tlds', '--deep', '--scan-limit', '']).length, 500);
    assert.ok(zshCandidates(zsh, ['whoisleuth', 'completion', '--']).includes('--help'));
    assert.ok(zshCandidates(zsh, ['whoisleuth', 'workflow-run', '--']).includes('--json'));

    for (const [line, expectedLength, finalValue] of [
      ['whoisleuth discover-scan example.test --scan-limit ', 500, '500'],
      ['whoisleuth discover-scan example.test --deep --scan-limit ', 50, '50'],
      ['whoisleuth discover-scan example.test --tlds --deep --scan-limit ', 500, '500'],
      ['whoisleuth discover-scan example.test --chunk-size ', 100, '100'],
      ['whoisleuth monitor-once --limit ', 20, '20'],
    ] as const) {
      const candidates = powershellCandidates(powershell, line);
      assert.equal(candidates.length, expectedLength, line);
      assert.equal(candidates.at(-1), finalValue, line);
    }
    assert.deepEqual(powershellCandidates(powershell, 'whoisleuth lookup example.test --observer '), []);
    assert.deepEqual(powershellCandidates(powershell, 'whoisleuth completion --palette '), ['auto', 'light', 'dark']);
    assert.ok(powershellCandidates(powershell, 'whoisleuth completion --').includes('--help'));
    assert.ok(powershellCandidates(powershell, 'whoisleuth workflow-plan --').includes('--json'));
    assert.deepEqual(powershellCandidates(powershell, "whoisleuth 'example.test' --de"), ['--deep']);
    assert.ok(powershellCandidates(powershell, 'whoisleuth ').includes('--version'));
    assert.deepEqual(powershellCandidates(powershell, 'whoisleuth not-a-command '), ['--help', '-h']);
    assert.deepEqual(powershellCandidates(powershell, 'whoisleuth not-a-command -'), ['--help', '-h']);
    for (const [line, offersFiles] of [
      ['whoisleuth verify-artifact ', true],
      ['whoisleuth verify-artifact --json ', true],
      ['whoisleuth verify-artifact package.json ', false],
      ['whoisleuth verify-artifact --deep ', false],
      ['whoisleuth page-compare package.json ', true],
      ['whoisleuth page-compare package.json package-lock.json ', false],
    ] as const) {
      assert.equal(
        powershellCandidates(powershell, line).some((candidate) => candidate.endsWith('package.json')),
        offersFiles,
        line,
      );
    }
    for (const line of [
      'whoisleuth verify-artifact package.json p',
      'whoisleuth verify-artifact --deep p',
      'whoisleuth http example.test p',
    ]) {
      assert.deepEqual(powershellCandidates(powershell, line), [], line);
    }

    assert.match(fish, /function __whoisleuth_seen/u);
    assert.match(fish, /function __whoisleuth_command_is/u);
    assert.doesNotMatch(fish, /__fish_seen_subcommand_from/u);
    assert.match(fish, /__whoisleuth_command_is bulk[^\n]*-l concurrency/u);
    assert.doesNotMatch(fish, /__fish_seen_argument -l deep/u);
    assert.match(fish, /__whoisleuth_integer_values 1 500/u);
    assert.match(fish, /__whoisleuth_integer_values 1 100/u);
    assert.match(fish, /__whoisleuth_integer_values 1 20/u);

    for (const value of ['source-failure', 'inconclusive', 'danger', 'material-drift']) {
      assert.equal(parseCliArguments(['lookup', 'example.test', '--fail-on', value]).action, 'lookup');
    }
    for (const value of ['artifact-1', 'artifact-16']) {
      assert.equal(parseCliArguments(['verify-artifact', '--manifest', 'manifest.json', '--manifest-entry', value]).action, 'verify-artifact');
    }
  });

  test('keeps the public release inventory exact and documents the scaffold bootstrap exception', () => {
    const reference = readFileSync(new URL('../docs/cli-reference.md', import.meta.url), 'utf8');
    const supported = reference.match(/This release supports ([\s\S]*?)\. Additional command families/u)?.[1] ?? '';
    const documented = [...supported.matchAll(/`([a-z][a-z0-9-]*)`/gu)].map((match) => match[1]);
    assert.deepEqual([...documented].sort(), [...FROZEN_COMMANDS].sort());
    assert.equal(new Set(documented).size, 47);
    for (const source of [
      reference,
      readFileSync(new URL('../docs/cli.md', import.meta.url), 'utf8'),
      readFileSync(new URL('../packages/cli/README.md', import.meta.url), 'utf8'),
      HELP,
    ]) {
      assert.match(source, /registry-scaffold[\s\S]*--profile[\s\S]*--config/iu);
    }
  });
});
