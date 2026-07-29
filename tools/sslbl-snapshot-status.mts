#!/usr/bin/env node

// Reports the bounded health of the checked-in SSLBL certificate snapshot.
// This command is local-only and never downloads or queries provider data.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sslblSnapshotHealth,
  type SslblSnapshotHealth,
} from '../lib/sslbl-intelligence.mts';

type WritableLike = { write(value: string): unknown };
type StatusOptions = Readonly<{
  snapshot?: unknown;
  now?: string | number | Date;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export function formatSslblSnapshotHealth(health: SslblSnapshotHealth): string {
  return [
    'WHOISleuth SSLBL snapshot health',
    `State: ${health.state}`,
    `Source updated: ${health.sourceUpdatedAt ?? 'unavailable'}`,
    `Generated: ${health.generatedAt ?? 'unavailable'}`,
    `Age: ${health.ageSeconds === null ? 'unavailable' : `${health.ageSeconds} seconds`}`,
    `Entries: ${health.entryCount ?? 'unavailable'}`,
    `Digest: ${health.digestSha256 ? `sha256:${health.digestSha256}` : 'unavailable'}`,
    `Detail: ${health.detail}`,
    'Network requests: 0',
  ].join('\n').concat('\n');
}

export function main(
  args = process.argv.slice(2),
  options: StatusOptions = {},
): number {
  try {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
      throw new TypeError('Usage: node tools/sslbl-snapshot-status.mts [--json]');
    }
    const health = sslblSnapshotHealth({
      ...(options.snapshot !== undefined ? { snapshot: options.snapshot } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
    (options.stdout ?? process.stdout).write(
      args[0] === '--json'
        ? `${JSON.stringify(health, null, 2)}\n`
        : formatSslblSnapshotHealth(health),
    );
    return health.state === 'current' ? 0 : health.state === 'stale' ? 1 : 2;
  } catch (error) {
    (options.stderr ?? process.stderr).write(
      `${error instanceof Error ? error.message : 'SSLBL snapshot health check failed.'}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
