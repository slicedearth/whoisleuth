import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_REPOSITORY_ENTRIES = 20_000;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.netlify',
  '.svelte-kit',
  'build',
  'coverage',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const TYPESCRIPT_CONFIGS = [
  'tsconfig.json',
  'e2e/tsconfig.json',
  'frontend/analysis-tsconfig.json',
  'frontend/tsconfig.json',
  'test/tsconfig.json',
] as const;

type TypeScriptConfig = Readonly<{
  compilerOptions?: Readonly<{
    allowJs?: unknown;
    checkJs?: unknown;
    strict?: unknown;
  }>;
}>;

async function authoredJavaScriptFiles(): Promise<string[]> {
  const pending = [REPOSITORY_ROOT];
  const matches: string[] = [];
  let visited = 0;

  while (pending.length > 0) {
    const directory = pending.pop();
    assert.ok(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    visited += entries.length;
    assert.ok(visited <= MAX_REPOSITORY_ENTRIES, 'repository source inventory exceeded its entry bound');

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(path.join(directory, entry.name));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        matches.push(path.relative(REPOSITORY_ROOT, path.join(directory, entry.name)));
      }
    }
  }

  return matches.sort();
}

async function readTypeScriptConfig(relativePath: string): Promise<TypeScriptConfig> {
  const source = await readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
  return JSON.parse(source) as TypeScriptConfig;
}

describe('repository TypeScript boundary', () => {
  test('keeps hand-authored JavaScript out of the source tree', async () => {
    assert.deepEqual(await authoredJavaScriptFiles(), []);
  });

  test('keeps every maintained TypeScript project in strict mode', async () => {
    for (const configPath of TYPESCRIPT_CONFIGS) {
      const config = await readTypeScriptConfig(configPath);
      assert.equal(config.compilerOptions?.strict, true, `${configPath} must keep strict mode enabled`);
    }

    const frontendConfig = await readTypeScriptConfig('frontend/tsconfig.json');
    assert.equal(frontendConfig.compilerOptions?.allowJs, true);
    assert.equal(
      frontendConfig.compilerOptions?.checkJs,
      true,
      'Svelte-generated JavaScript declarations must remain checked while the authored tree stays TypeScript-only',
    );
  });
});
