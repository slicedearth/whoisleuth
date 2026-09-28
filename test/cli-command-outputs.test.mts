import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliArguments } from '../cli/arguments.mts';

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
