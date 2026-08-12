import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_STAGED_DIFF_BYTES, gitDiffArguments, scanAddedDiff } from '../tools/staged-secret-check.mts';

describe('staged secret check', () => {
  const genericKey = ['to', 'ken'].join('');

  test('reports only the location and rule for high-confidence staged additions', () => {
    const fixtureCredential = ['npm_', '1'.repeat(36)].join('');
    const value = ['diff --git a/config.txt b/config.txt', '+++ b/config.txt', '@@ -0,0 +1,2 @@', '+mode=private', `+${genericKey}="${fixtureCredential}"`].join('\n');
    assert.deepEqual(scanAddedDiff(value), [{ file: 'config.txt', addedLine: 2, rule: 'npm-token' }]);
  });

  test('detects encrypted private-key headers without exposing key material', () => {
    const privateKeyHeader = ['-----BEGIN ENCRYPTED ', 'PRIVATE KEY-----'].join('');
    const value = ['+++ b/private.pem', '@@ -0,0 +1 @@', `+${privateKeyHeader}`].join('\n');
    assert.deepEqual(scanAddedDiff(value), [{ file: 'private.pem', addedLine: 1, rule: 'private-key' }]);
  });

  test('allows documented placeholders and ignores removed values', () => {
    const fixtureCredential = ['npm_', '1'.repeat(36)].join('');
    const value = ['diff --git a/.env.example b/.env.example', '+++ b/.env.example', '@@ -1 +1 @@', `-${genericKey}="${fixtureCredential}"`, `+${genericKey}="replace_me"`].join('\n');
    assert.deepEqual(scanAddedDiff(value), []);
  });

  test('does not let unrelated placeholder prose suppress a real token on the same line', () => {
    const credential = ['npm_', '2'.repeat(36)].join('');
    const value = ['+++ b/config.txt', '@@ -0,0 +1 @@', `+fixture_note="documentation only" ${genericKey}="${credential}"`].join('\n');
    assert.deepEqual(scanAddedDiff(value), [{ file: 'config.txt', addedLine: 1, rule: 'npm-token' }]);
  });

  test('does not suppress provider tokens that contain placeholder words', () => {
    const npmCredential = ['npm_example', 'A'.repeat(29)].join('');
    const githubCredential = ['github_pat_', 'fixture', 'B'.repeat(20)].join('');
    const value = [
      '+++ b/.npmrc',
      '@@ -0,0 +1,2 @@',
      `+//registry.npmjs.org/:_authToken=${npmCredential}`,
      `+${genericKey}=${githubCredential}`,
    ].join('\n');
    assert.deepEqual(scanAddedDiff(value), [
      { file: '.npmrc', addedLine: 1, rule: 'npm-token' },
      { file: '.npmrc', addedLine: 2, rule: 'github-fine-grained-token' },
    ]);
  });

  test('continues past assigned placeholders on the same added line', () => {
    const placeholder = `${['SESSION', 'SECRET'].join('_')}="test-only-session-signing-secret"`;
    const credential = `${['URLSCAN', 'API', 'KEY'].join('_')}="correct-horse-battery!staple."`;
    for (const line of [
      `+${placeholder}; ${credential}`,
      `+${credential}; ${placeholder}`,
      `+${['SITE', 'PASSWORD'].join('_')}=replace_me; ${placeholder}; ${credential}`,
    ]) {
      assert.deepEqual(scanAddedDiff(['+++ b/config.mts', '@@ -0,0 +1 @@', line].join('\n')), [
        { file: 'config.mts', addedLine: 1, rule: 'assigned-secret' },
      ]);
    }
  });

  test('covers configured credential names, quoted punctuation, and unquoted env values', () => {
    const credential = ['correct-horse-', 'battery!staple.'].join('');
    const keys = [
      'SITE_PASSWORD',
      'SESSION_SECRET',
      'TURNSTILE_SECRET_KEY',
      'URLSCAN_API_KEY',
      'THREATFOX_AUTH_KEY',
      'URLHAUS_AUTH_KEY',
    ];
    const additions = keys.map((key, index) => index % 2
      ? `+${key}=${credential}`
      : `+${key}="${credential}"`);
    const value = [
      '+++ b/.env',
      `@@ -0,0 +1,${additions.length} @@`,
      ...additions,
    ].join('\n');
    assert.deepEqual(scanAddedDiff(value), keys.map((_, index) => ({
      file: '.env',
      addedLine: index + 1,
      rule: 'assigned-secret',
    })));
  });

  test('detects fine-grained GitHub tokens while retaining placeholder examples', () => {
    const credential = ['github_', 'pat_', 'A'.repeat(24)].join('');
    assert.deepEqual(scanAddedDiff([
      '+++ b/config.txt',
      '@@ -0,0 +1,3 @@',
      `+${genericKey}=${credential}`,
      `+${['SITE', 'PASSWORD'].join('_')}=replace_me`,
      `+${['URLSCAN', 'API', 'KEY'].join('_')}=<your_api_key>`,
      `+${['SESSION', 'SECRET'].join('_')}=test-only-session-signing-secret`,
    ].join('\n')), [{ file: 'config.txt', addedLine: 1, rule: 'github-fine-grained-token' }]);
  });

  test('scans added source text beginning with two plus signs', () => {
    const value = ['+++ b/config.txt', '@@ -0,0 +1 @@', `+++${['pass', 'word'].join('')}="abcdefghijklmnop"`].join('\n');
    assert.deepEqual(scanAddedDiff(value), [{ file: 'config.txt', addedLine: 1, rule: 'assigned-secret' }]);
  });

  test('does not reinterpret header-like additions inside a hunk', () => {
    const value = [
      'diff --git a/config.txt b/config.txt',
      '+++ b/config.txt',
      '@@ -0,0 +1,3 @@',
      `+++ b/${['pass', 'word'].join('')}="abcdefghijklmnop"`,
      '+++ /dev/null',
      `+${genericKey}="qrstuvwxyzabcdef"`,
    ].join('\n');
    assert.deepEqual(scanAddedDiff(value), [
      { file: 'config.txt', addedLine: 1, rule: 'assigned-secret' },
      { file: 'config.txt', addedLine: 3, rule: 'assigned-secret' },
    ]);
  });

  test('accepts unquoted Unicode paths and fails closed on quoted destination headers', () => {
    const credential = ['npm_', '3'.repeat(36)].join('');
    assert.deepEqual(scanAddedDiff([
      '+++ b/réview.txt',
      '@@ -0,0 +1 @@',
      `+${genericKey}="${credential}"`,
    ].join('\n')), [{ file: 'réview.txt', addedLine: 1, rule: 'npm-token' }]);
    assert.throws(() => scanAddedDiff([
      '+++ "b/r\\303\\251view.txt"',
      '@@ -0,0 +1 @@',
      `+${genericKey}="${credential}"`,
    ].join('\n')), /unsupported quoted or non-repository destination path/u);
  });

  test('builds bounded staged and CI revision diff arguments', () => {
    const base = '1'.repeat(40);
    const head = '2'.repeat(40);
    assert.deepEqual(gitDiffArguments([]), ['-c', 'core.quotePath=false', 'diff', '--cached', '--text', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color', '--diff-filter=ACMRT']);
    assert.deepEqual(gitDiffArguments(['--range', `${base}..${head}`]), [
      '-c', 'core.quotePath=false', 'diff', '--text', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color', '--diff-filter=ACMRT', `${base}..${head}`,
    ]);
    assert.deepEqual(gitDiffArguments(['--range', `${'0'.repeat(40)}..${head}`]), [
      '-c', 'core.quotePath=false', 'diff-tree', '--root', '-r', '--text', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color', '--diff-filter=ACMRT', head,
    ]);
    assert.throws(() => gitDiffArguments(['--range', 'main..HEAD']), /Usage/u);
  });

  test('rejects an oversized staged diff before scanning it', () => {
    assert.throws(() => scanAddedDiff('x'.repeat(MAX_STAGED_DIFF_BYTES + 1)), /secret-scan boundary/u);
  });
});
