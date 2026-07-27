import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
const MAX_TRACKED_FILE_LIST_BYTES = 2 * 1024 * 1024;
const JAVASCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs']);
const TYPESCRIPT_CONFIGS = [
  'tsconfig.json',
  'e2e/tsconfig.json',
  'frontend/analysis-tsconfig.json',
  'frontend/tsconfig.json',
  'test/tsconfig.json',
] as const;

type TypeScriptConfig = Readonly<{
  include?: readonly unknown[];
  compilerOptions?: Readonly<{
    allowJs?: unknown;
    checkJs?: unknown;
    strict?: unknown;
  }>;
}>;

async function authoredJavaScriptFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_TRACKED_FILE_LIST_BYTES,
  });
  return stdout
    .split('\0')
    .filter((entry) => entry && JAVASCRIPT_EXTENSIONS.has(path.extname(entry)))
    .sort();
}

async function readTypeScriptConfig(relativePath: string): Promise<TypeScriptConfig> {
  const source = await readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
  return JSON.parse(source) as TypeScriptConfig;
}

describe('repository TypeScript boundary', () => {
  test('keeps tracked hand-authored JavaScript out of the source tree', async () => {
    assert.deepEqual(await authoredJavaScriptFiles(), []);
  });

  test('keeps every maintained TypeScript project in strict mode', async () => {
    for (const configPath of TYPESCRIPT_CONFIGS) {
      const config = await readTypeScriptConfig(configPath);
      assert.equal(config.compilerOptions?.strict, true, `${configPath} must keep strict mode enabled`);
    }

    const rootConfig = await readTypeScriptConfig('tsconfig.json');
    assert.ok(rootConfig.include?.includes('server.mts'), 'the Express runtime entry point must be checked directly');
    assert.ok(rootConfig.include?.includes('frontend/svelte.config.ts'), 'the Svelte configuration must be checked directly');

    const frontendConfig = await readTypeScriptConfig('frontend/tsconfig.json');
    assert.equal(frontendConfig.compilerOptions?.allowJs, true);
    assert.equal(
      frontendConfig.compilerOptions?.checkJs,
      true,
      'Svelte component virtual modules must remain checked while the tracked authored tree stays TypeScript-only',
    );
  });
});
