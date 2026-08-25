import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WORKFLOW = readFileSync(new URL('../.github/workflows/cli-published-check.yml', import.meta.url), 'utf8');
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BLOCK_COMPILER_LOADER = `data:text/javascript,${encodeURIComponent(`
  import { registerHooks } from 'node:module';
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'typescript') throw new Error('The compiler was loaded by the post-publication verifier.');
      return nextResolve(specifier, context);
    },
  });
`)}`;

describe('published CLI verification workflow', () => {
  test('is explicit, read-only, secret-free, and does not install the repository dependency tree', () => {
    assert.match(WORKFLOW, /^on:\s*\n\s{2}workflow_dispatch:/mu);
    assert.doesNotMatch(WORKFLOW, /^\s{2}(?:push|pull_request|schedule|repository_dispatch):/mu);
    assert.match(WORKFLOW, /^permissions:\s*\n\s{2}actions: read\n\s{2}contents: read$/mu);
    assert.doesNotMatch(WORKFLOW, /\b(?:contents|actions|packages|security-events|id-token): write\b/u);
    assert.doesNotMatch(WORKFLOW, /\b(?:secrets\.|npm ci|npm install)\b/u);
  });

  test('pins its actions and passes the untrusted input through an environment variable', () => {
    const revisions = [...WORKFLOW.matchAll(/^\s+uses: [^@\s]+@([^\s#]+)/gmu)].map((match) => match[1]);
    assert.equal(revisions.length, 3);
    for (const revision of revisions) assert.match(revision || '', /^[a-f0-9]{40}$/u);
    assert.match(WORKFLOW, /^\s{10}persist-credentials: false$/mu);
    assert.match(WORKFLOW, /^\s{10}RELEASE_VERSION: \$\{\{ inputs\.version \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}run-id: \$\{\{ inputs\.release_run_id \}\}$/mu);
    assert.match(WORKFLOW, /^\s{8}run: node tools\/published-cli-check\.mts "\$RELEASE_VERSION" --candidate-report "\$RELEASE_DIRECTORY\/cli-package-report\.json" --candidate-archive "\$RELEASE_DIRECTORY\/whoisleuth-cli-\$RELEASE_VERSION\.tgz" --json$/mu);
    assert.doesNotMatch(WORKFLOW, /run:[^\n]*\$\{\{ inputs\.version \}\}/u);
    assert.doesNotMatch(WORKFLOW, /(?:npm exec|npx|whoisleuth --version|whoisleuth doctor)/u);
  });

  test('loads its verifier without resolving the compiler dependency', () => {
    const result = spawnSync(process.execPath, [
      '--import',
      BLOCK_COMPILER_LOADER,
      '--input-type=module',
      '--eval',
      'await import("./tools/published-cli-check.mts");',
    ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
