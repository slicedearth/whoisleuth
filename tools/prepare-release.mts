#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSemanticVersion } from './release-version-check.mts';
import { npmExecutableName } from './maintainer-tool-helpers.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Compose existing writers; do not maintain another release metadata table. */
export function releasePreparationCommands(version: string, current: string): readonly (readonly string[])[] {
  normalizeSemanticVersion(version);
  normalizeSemanticVersion(current);
  return [
    ...(version === current ? [] : [[npmExecutableName(), 'version', version, '--no-git-tag-version', '--ignore-scripts']]),
    [process.execPath, 'tools/public-product-catalogue.mts', '--write'],
    [process.execPath, 'tools/release-version-check.mts'],
  ];
}

export function main(args = process.argv.slice(2)): number {
  try {
    if (args.length !== 1) throw new TypeError('Usage: npm run release:prepare -- <approved-version>');
    const version = normalizeSemanticVersion(args[0]);
    const tag = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/v${version}^{commit}`], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    if (tag.error) throw tag.error;
    if (tag.status !== 1) throw new Error(tag.status === 0
      ? 'That release tag already exists. Published versions are immutable.'
      : 'Could not establish the local release-tag boundary.');
    const current = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string;
    for (const [command, ...commandArgs] of releasePreparationCommands(version, current)) {
      const result = spawnSync(command!, commandArgs, { cwd: ROOT, stdio: 'inherit', timeout: 120_000 });
      if (result.error || result.status !== 0) {
        process.stderr.write(`Release preparation stopped at ${commandArgs.join(' ')}. Earlier edits remain in the working tree.\n`);
        process.stderr.write(`Inspect the diff, correct the reported cause, then rerun npm run release:prepare -- ${version}.\n`);
        if (result.error) throw result.error;
        return 2;
      }
    }
    process.stdout.write(`Prepared ${version} locally. Review, verification and commit remain separate; no tag or publication was created.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Release preparation failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
