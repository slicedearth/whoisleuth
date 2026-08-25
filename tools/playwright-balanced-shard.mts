#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBalancedBrowserShardPlan,
  readVerificationTimingProfile,
} from './verification-timing-profile.mts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_CLI = path.join(REPOSITORY_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

export function selectBalancedBrowserShard(value: string) {
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (!match) throw new TypeError('Balanced browser shard must use N/TOTAL.');
  const requested = Number(match[1]);
  const declared = Number(match[2]);
  const plan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
  if (declared !== plan.shardCount || requested < 1 || requested > plan.shardCount) {
    throw new TypeError(`Balanced browser shard must select 1/${plan.shardCount} through ${plan.shardCount}/${plan.shardCount}.`);
  }
  const shard = plan.shards.find((item) => item.shard === requested);
  if (!shard) throw new TypeError('Balanced browser shard was not found in the retained plan.');
  return Object.freeze({ plan, shard });
}

export function main(args = process.argv.slice(2)): number {
  try {
    const runOptions = args.filter((value) => value.startsWith('--run='));
    const list = args.includes('--list');
    if (runOptions.length !== 1 || args.length !== (list ? 2 : 1) || args.some((value) => value !== '--list' && !value.startsWith('--run='))) {
      throw new TypeError('Usage: node tools/playwright-balanced-shard.mts --run=N/TOTAL [--list]');
    }
    const selection = selectBalancedBrowserShard(runOptions[0]!.slice('--run='.length));
    process.stdout.write(
      `Balanced browser shard ${selection.shard.shard}/${selection.plan.shardCount}: `
      + `${selection.shard.files.length} specs, ${selection.shard.plannedWeightMs} ms planned weight; `
      + `${selection.plan.unavoidableImbalanceMs} ms projected imbalance.\n`,
    );
    const child = spawnSync(
      process.execPath,
      [
        PLAYWRIGHT_CLI,
        'test',
        ...selection.shard.files,
        '--project=chromium',
        ...(list ? ['--list'] : []),
      ],
      {
        cwd: REPOSITORY_ROOT,
        env: {
          ...process.env,
          WHOISLEUTH_PLAYWRIGHT_SHARD: `${selection.shard.shard}/${selection.plan.shardCount}`,
          WHOISLEUTH_PLAYWRIGHT_PLANNED_WEIGHT_MS: String(selection.shard.plannedWeightMs),
        },
        stdio: 'inherit',
      },
    );
    if (child.error) throw child.error;
    return child.status ?? 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Balanced browser shard failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
