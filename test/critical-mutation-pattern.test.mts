import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertUniqueCriticalMutationPattern, isCriticalMutationSource } from '../tools/critical-mutation-manifest.mts';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('a mutation remains located by its unique statement after unrelated lines are inserted', () => {
  const statement = 'if (!complete) return "unknown";';
  for (const prefix of ['', '\n\n', '// A nearby helper was extracted.\n\nfunction helper() {}\n']) {
    assert.doesNotThrow(() => assertUniqueCriticalMutationPattern(`${prefix}${statement}\nreturn "ready";`, statement));
  }
});

test('mutation discovery excludes tests, dependencies and paths outside source ownership', () => {
  for (const file of ['lib/extracted/helper.mts', 'packages/cases/new-helper.mts', 'frontend/src/lib/controller.ts', 'tools/helper.mts']) {
    assert.equal(isCriticalMutationSource(file), true, file);
  }
  for (const file of ['../lib/helper.mts', 'lib/../test/helper.mts', 'test/helper.mts', 'e2e/helper.ts', 'lib/helper.test.mts', 'frontend/src/lib/helper.test.ts', 'cli/helper.spec.ts', 'node_modules/helper.mts', '/lib/helper.mts']) {
    assert.equal(isCriticalMutationSource(file), false, file);
  }
});

test('the real mutation loader follows an extracted helper and rejects absent or duplicate applications', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'whoisleuth-mutation-location-'));
  try {
    for (const directory of ['tools', 'lib/extracted']) mkdirSync(path.join(root, directory), { recursive: true });
    for (const name of ['critical-mutation-loader.mts', 'critical-mutation-manifest.mts']) {
      cpSync(new URL(`../tools/${name}`, import.meta.url), path.join(root, 'tools', name));
    }
    const source = 'export function available(rdapFound, hasWhoisRegistrationData, dnsDelegated) { if (!rdapFound && !hasWhoisRegistrationData && !dnsDelegated) { return false; } return true; }';
    writeFileSync(path.join(root, 'lib', 'extracted', 'authority.mts'), source);
    writeFileSync(path.join(root, 'lib', 'extracted', 'other.mts'), source);
    for (const [name, imports, applications] of [
      ['moved', "import { available } from './lib/extracted/authority.mts'; if (available(false, false, true)) throw new Error('Mutation was not applied');", 1],
      ['absent', '', 0],
      ['ambiguous', "import './lib/extracted/authority.mts'; import './lib/extracted/other.mts';", 2],
    ] as const) {
      const entry = path.join(root, `${name}.mts`);
      writeFileSync(entry, imports);
      const result = spawnSync(process.execPath, ['--import', path.join(root, 'tools', 'critical-mutation-loader.mts'), entry], {
        encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
        env: { ...process.env, WHOISLEUTH_CRITICAL_MUTANT_ID: 'authority-dns-delegation-required' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, applications === 1 ? 0 : 97, result.stderr);
      assert.match(result.stderr, new RegExp(`WHOISLEUTH_MUTATION_APPLICATION authority-dns-delegation-required ${applications}`));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing, empty and ambiguous mutation patterns fail before a test can be counted as a kill', () => {
  for (const [source, search] of [
    ['return "ready";', 'return "unknown";'],
    ['return "ready";', ''],
    ['return value;\nreturn value;', 'return value;'],
    ['aaa', 'aa'],
  ]) {
    assert.throws(() => assertUniqueCriticalMutationPattern(source!, search!), /one unique source pattern/u);
  }
});
