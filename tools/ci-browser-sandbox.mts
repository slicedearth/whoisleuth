import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwrightBrowserCacheDirectory } from './ci-verification.mts';

/** One pinned executable, not a cache-directory wildcard or global exception. */
export function chromiumUserNamespaceProfile(executable: string): string {
  if (!/^\/[A-Za-z0-9_./-]+\/chrome-headless-shell$/u.test(executable)
    || executable.includes('/../') || executable.includes('//')) {
    throw new TypeError('The browser sandbox profile requires one literal absolute executable path.');
  }
  return `abi <abi/4.0>,\nprofile whoisleuth-ci-chromium "${executable}" flags=(unconfined) {\n  userns,\n}\n`;
}

export function pinnedHeadlessShellPath(cache: string, metadata: unknown): string {
  const browsers = (metadata as { browsers?: unknown } | null)?.browsers;
  if (!Array.isArray(browsers)) throw new TypeError('Pinned browser metadata is unavailable.');
  const matches = browsers.filter(value => value?.name === 'chromium-headless-shell');
  if (matches.length !== 1 || typeof matches[0]?.revision !== 'string' || !/^\d{1,8}$/u.test(matches[0].revision)) {
    throw new TypeError('Pinned headless browser revision is missing or ambiguous.');
  }
  return path.join(cache, `chromium_headless_shell-${matches[0].revision}`, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Sandbox profile generation is restricted to disposable Linux x64 CI runners.');
  }
  const require = createRequire(import.meta.url);
  const metadata = JSON.parse(readFileSync(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json'), 'utf8'));
  const executable = realpathSync(pinnedHeadlessShellPath(playwrightBrowserCacheDirectory(), metadata));
  if (!statSync(executable).isFile()) throw new Error('The pinned headless browser is not an installed regular file.');
  process.stdout.write(chromiumUserNamespaceProfile(executable));
}
