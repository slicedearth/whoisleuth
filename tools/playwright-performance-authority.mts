#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { playwrightPerformanceAuthorityArguments } from './playwright-execution-contract.mts';
import { assertFrontendBuildIntegrity } from './frontend-build-integrity.mts';
import { playwrightJsonReporterEnvironment } from './playwright-run-artifacts.mts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_CLI = path.join(REPOSITORY_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

export function main(args = process.argv.slice(2)): number {
  try {
    if (args.length) throw new TypeError('Usage: node tools/playwright-performance-authority.mts');
    if (process.env.CI || process.env.WHOISLEUTH_E2E_USE_BUILD === '1') {
      assertFrontendBuildIntegrity(REPOSITORY_ROOT);
    }
    const childEnvironment = {
      ...process.env,
      WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance',
      WHOISLEUTH_E2E_PERFORMANCE_FIRST: '1',
    };
    const child = spawnSync(process.execPath, playwrightPerformanceAuthorityArguments(PLAYWRIGHT_CLI), {
      cwd: REPOSITORY_ROOT,
      env: {
        ...childEnvironment,
        ...playwrightJsonReporterEnvironment(REPOSITORY_ROOT, childEnvironment),
      },
      stdio: 'inherit',
    });
    if (child.error) throw child.error;
    return child.status ?? 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Playwright performance authority failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
