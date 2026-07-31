#!/usr/bin/env node

// Offline verifier for two operator-produced staging evidence summaries. It
// never performs a request and rejects extra fields that could retain targets.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  qualifyLookupProgressStagingEvidence,
} from '../lib/lookup-progress-staging-evidence.mts';

type WritableLike = { write(value: string): unknown };

export const MAX_LOOKUP_PROGRESS_STAGING_FILE_BYTES = 64 * 1024;

async function readEvidence(file: string): Promise<unknown> {
  const content = await readFile(file);
  if (content.byteLength === 0 || content.byteLength > MAX_LOOKUP_PROGRESS_STAGING_FILE_BYTES) {
    throw new TypeError(`Staging evidence files must be between 1 and ${MAX_LOOKUP_PROGRESS_STAGING_FILE_BYTES} bytes.`);
  }
  try {
    return JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Staging evidence must be valid JSON.');
  }
}

export async function main(
  args = process.argv.slice(2),
  options: Readonly<{
    stdout?: WritableLike;
    stderr?: WritableLike;
    now?: () => Date;
  }> = {},
): Promise<number> {
  try {
    if (args.length !== 2 || args.some((arg) => !arg || arg.startsWith('-'))) {
      throw new TypeError('Usage: node tools/incremental-lookup-staging-evidence.mts EXPRESS.json NETLIFY.json');
    }
    const report = qualifyLookupProgressStagingEvidence(
      await Promise.all(args.map(readEvidence)),
      options.now ? { now: options.now } : {},
    );
    (options.stdout ?? process.stdout).write(`${JSON.stringify(report, null, 2)}\n`);
    return report.stagingEvidenceComplete ? 0 : 1;
  } catch (error) {
    (options.stderr ?? process.stderr).write(
      `${error instanceof Error ? error.message : 'Staging evidence qualification failed.'}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
