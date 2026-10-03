#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abortable } from '../lib/abort.mts';
import { normalizeBoundedStableSemanticVersion } from '../packages/analysis/semantic-version.mts';
import { optionalJsonRecord, readBoundedStableRegularFileSync } from './maintainer-tool-helpers.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// One API page is bounded independently of the number/size of current runs.
// These are allocation and hang guards, not historical inventory baselines.
export const MAX_RELEASE_PROVENANCE_BYTES = 8 * 1024 * 1024;
const MAX_RUNS = 100;
const REQUEST_TIMEOUT_MS = 30_000;

type VerificationOptions = Readonly<{
  fetcher?: typeof fetch;
  isAncestor?: (sha: string) => boolean;
}>;

export function releaseProvenanceIdentity(environment: NodeJS.ProcessEnv, manifest: unknown) {
  const expected = normalizeBoundedStableSemanticVersion(environment.EXPECTED_VERSION, 'Selected release');
  const root = optionalJsonRecord(manifest);
  if (root?.version !== expected || root.private !== true) {
    throw new Error('The selected version must match the private root manifest.');
  }
  if (environment.GITHUB_REF !== `refs/tags/v${expected}`) {
    throw new Error('Run the workflow from the exact semantic release tag.');
  }
  const repository = environment.GITHUB_REPOSITORY || '';
  const sha = environment.GITHUB_SHA || '';
  if (repository.length > 255 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
    || repository.split('/').some(part => part === '.' || part === '..')
    || !/^[a-f0-9]{40}$/u.test(sha)) {
    throw new Error('Release CI provenance inputs are unavailable.');
  }
  return Object.freeze({ repository, sha });
}

export function assertSuccessfulReleaseCi(sha: string, payload: unknown): void {
  const runs = optionalJsonRecord(payload)?.workflow_runs;
  if (!Array.isArray(runs) || runs.length > MAX_RUNS) {
    throw new Error('Release CI provenance did not return one bounded run page.');
  }
  if (!runs.some(value => {
    const run = optionalJsonRecord(value);
    return run?.head_sha === sha && run.event === 'push'
      && run.status === 'completed' && run.conclusion === 'success';
  })) {
    throw new Error('The exact tagged commit must have a successful completed push run of ci.yml.');
  }
}

function isAncestorOfMain(sha: string): boolean {
  const child = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], {
    cwd: ROOT, encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024,
  });
  return !child.error && child.status === 0;
}

async function readRunPage(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !response.body) {
    throw new Error(`Could not verify release CI provenance (${response.status}).`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await abortable(() => reader.read(), signal);
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_RELEASE_PROVENANCE_BYTES) {
        throw new Error('Release CI provenance exceeded its response byte bound.');
      }
      chunks.push(result.value);
    }
    try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
    catch { throw new Error('Release CI provenance returned invalid JSON.'); }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export async function verifyReleaseProvenance(
  environment: NodeJS.ProcessEnv,
  manifest: unknown,
  options: VerificationOptions = {},
): Promise<void> {
  const { repository, sha } = releaseProvenanceIdentity(environment, manifest);
  const credential = environment.GITHUB_TOKEN;
  if (!credential) throw new Error('Release CI provenance credential is unavailable.');
  if (!(options.isAncestor ?? isAncestorOfMain)(sha)) {
    throw new Error('The exact tagged commit must be reachable from origin/main.');
  }
  const endpoint = new URL(`https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs`);
  endpoint.searchParams.set('head_sha', sha);
  endpoint.searchParams.set('status', 'completed');
  endpoint.searchParams.set('per_page', String(MAX_RUNS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Release CI provenance request timed out.')), REQUEST_TIMEOUT_MS);
  try {
    const response = await abortable(() => (options.fetcher ?? fetch)(endpoint, {
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${credential}`,
        'x-github-api-version': '2022-11-28',
      },
    }), controller.signal);
    assertSuccessfulReleaseCi(sha, await readRunPage(response, controller.signal));
  } finally {
    clearTimeout(timer);
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    if (args.length) throw new Error('Usage: node tools/release-provenance.mts');
    const manifest = JSON.parse(readBoundedStableRegularFileSync(
      path.join(ROOT, 'package.json'), 512 * 1024, 'Root package manifest',
    ).toString('utf8'));
    await verifyReleaseProvenance(process.env, manifest);
    process.stdout.write('Exact release selection, main ancestry and completed push CI verified.\n');
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Release provenance verification failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
