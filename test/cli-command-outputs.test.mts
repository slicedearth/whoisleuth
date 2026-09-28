import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliArguments } from '../cli/arguments.mts';
import { CLI_OPTION_DEFINITIONS, commandSeed, file } from '../cli/command-definition.mts';
import { COLLECTION_COMMAND_DEFINITIONS } from '../cli/collection-command-definitions.mts';

test('presentation flags retain their command-specific executable meaning', () => {
  const examples: Array<{ command: string; formats: Record<string, string> }> = [
    {
      command: 'lookup',
      formats: { '--json': 'json', '--junit': 'junit', '--markdown': 'markdown', '--html': 'html' },
    },
    {
      command: 'bulk',
      formats: {
        '--json': 'json',
        '--jsonl': 'jsonl',
        '--junit': 'junit',
        '--csv': 'csv',
        '--csv-with-metadata': 'csv_metadata',
        '--domains': 'domains',
        '--queries': 'queries',
      },
    },
    {
      command: 'discover',
      formats: { '--json': 'json', '--jsonl': 'jsonl', '--domains': 'domains' },
    },
    {
      command: 'discover-scan',
      formats: {
        '--json': 'json',
        '--jsonl': 'jsonl',
        '--csv': 'csv',
        '--csv-with-metadata': 'csv_metadata',
        '--domains': 'domains',
      },
    },
    { command: 'posture', formats: { '--json': 'json', '--sarif': 'sarif' } },
    { command: 'monitor-once', formats: { '--json': 'json', '--junit': 'junit' } },
  ];
  for (const { command, formats } of examples) {
    const invocation = [
      command,
      'example.test',
      ...(command === 'posture' ? ['--owned-domain'] : []),
    ];
    const baseline = parseCliArguments(invocation);
    assert.equal('output' in baseline && baseline.output, 'terminal', command);
    for (const [flag, output] of Object.entries(formats)) {
      const parsed = parseCliArguments([...invocation, flag]);
      assert.equal('output' in parsed && parsed.output, output, `${command} ${flag}`);
    }
    assert.throws(
      () => parseCliArguments([...invocation, ...Object.keys(formats)]),
      /mutually exclusive/u,
    );
  }
  assert.throws(() => parseCliArguments(['lookup', 'example.test', '--sarif']), /Unknown option/u);
});

test('catalogue collection labels derive from execution effects without changing scope text', () => {
  for (const [networkEffect, expected] of [
    ['offline', 'offline'], ['always_network', 'network'], ['conditional_network', 'network'],
  ] as const) {
    const seed = commandSeed({
      ...COLLECTION_COMMAND_DEFINITIONS.lookup,
      collection: { scope: 'The fixture scope remains independently authored.' },
      networkEffect,
    });
    assert.deepEqual(seed.collection, {
      mode: expected, scope: 'The fixture scope remains independently authored.',
    });
    assert.ok(Object.isFrozen(seed.collection));
  }
});

test('option variants remain local and reject undeclared flags before registry construction', () => {
  const variant = commandSeed({
    ...COLLECTION_COMMAND_DEFINITIONS.lookup,
    options: ['--json'],
    optionOverrides: { '--json': file('Read the fixture input.') },
  });
  assert.equal(variant.optionOverrides?.['--json']?.valueKind('lookup'), 'file');
  assert.equal(CLI_OPTION_DEFINITIONS['--json'].valueKind('lookup'), 'flag');
  assert.ok(Object.isFrozen(variant.optionOverrides));
  assert.throws(
    () =>
      commandSeed({
        ...COLLECTION_COMMAND_DEFINITIONS.lookup,
        options: ['--json'],
        optionOverrides: {
          // @ts-expect-error A variant cannot silently add a flag to the command.
          '--resume': file('Read the fixture checkpoint.'),
        },
      }),
    /Cannot override an undeclared command option: --resume\./u,
  );
});
