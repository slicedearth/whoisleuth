import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCliCommand, isBuildableCliOption, quoteCommandArgument } from '../packages/analysis/cli-command-builder.mts';
import { commandDefinition } from '../cli/command-reference.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { lookupCliBridge } from '../frontend/src/lib/analysis/lookup-cli-bridge.ts';

test('browser bridge preserves explicit target/depth and starts with an offline plan', () => {
  const input = { query: 'https://login.example.test/private?token=selected#not-sent', mode: 'deep' as const, selectedUrl: false };
  const ordinary = lookupCliBridge(input);
  assert.deepEqual(ordinary.initialPositionals, ['login.example.test']);
  const built = buildCliCommand('lookup', commandDefinition('lookup').grammar, { positionals: ordinary.initialPositionals, options: ordinary.initialOptions, shell: 'posix' });
  const parsed = parseCliArguments(['lookup', ...built.args]);
  assert.equal(parsed.action, 'lookup');
  if (parsed.action !== 'lookup') throw new Error('Unexpected fixture action.');
  assert.equal(parsed.plan, true);
  assert.doesNotMatch(built.command, /private|token|not-sent/u);
  assert.deepEqual(lookupCliBridge({ ...input, selectedUrl: true }).initialPositionals, ['https://login.example.test/private?token=selected']);
  assert.throws(() => lookupCliBridge({ ...input, selectedUrl: true, mode: 'fast' }), /Deep/u);
  assert.throws(() => lookupCliBridge({ ...input, query: 'https://person:secret@example.test/' }), /credentials/u);
});

test('literal command quoting prevents shell interpolation while the installed grammar stays authoritative', () => {
  const target = 'https://example.test/\'$(touch marker)&x=1';
  assert.equal(quoteCommandArgument("a'b", 'posix'), "'a'\"'\"'b'");
  assert.equal(quoteCommandArgument("a'b", 'powershell'), "'a''b'");
  for (const shell of ['posix', 'powershell'] as const) {
    const built = buildCliCommand('lookup', commandDefinition('lookup').grammar, { positionals: [target], options: { '--deep': [''], '--plan': [''], '--json': [''] }, shell });
    assert.equal(built.parsed.positionalValue('target'), target);
    assert.equal(parseCliArguments(['lookup', ...built.args]).action, 'lookup');
  }
  assert.throws(() => quoteCommandArgument('value\ncommand', 'posix'), /line breaks/u);
  assert.throws(() => quoteCommandArgument('value\u202e', 'posix'), /visible/u);
  assert.throws(() => buildCliCommand('lookup', commandDefinition('lookup').grammar, { positionals: ['example.test'], options: { '--fast': [''], '--deep': [''] }, shell: 'posix' }), /mutually exclusive/u);
  assert.throws(() => buildCliCommand('lookup', commandDefinition('lookup').grammar, { positionals: [], options: { '--config': ['private.json'] }, shell: 'posix' }), /not supported/u);
});

test('the fixture builder exposes a command-owned profile without enabling bootstrap configuration', () => {
  const grammar = commandDefinition('registry-scaffold').grammar;
  assert.ok(grammar.options.filter(isBuildableCliOption).some(option => option.option === '--profile'));
  const built = buildCliCommand('registry-scaffold', grammar, {
    positionals: [], options: { '--profile': ['example-profile'], '--suffix': ['test'], '--scenario': ['registered'] }, shell: 'posix',
  });
  assert.equal(parseCliArguments(['registry-scaffold', ...built.args]).action, 'registry-scaffold');
  for (const option of ['--profile', '--config']) {
    const ordinary = commandDefinition('lookup').grammar;
    assert.ok(!ordinary.options.filter(isBuildableCliOption).some(item => item.option === option));
    assert.throws(() => buildCliCommand('lookup', ordinary, { positionals: ['example.test'], options: { [option]: ['private'] }, shell: 'posix' }), /not supported/u);
  }
});
