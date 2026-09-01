#!/usr/bin/env node

import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_PORT = 4173;

const GROUPS = Object.freeze({
  unit: Object.freeze(['test-coverage.lcov', 'coverage']),
  browser: Object.freeze([
    'frontend/build',
    'frontend/.svelte-kit',
    'frontend/playwright/.auth',
    'playwright/.auth',
    'playwright-report',
    'playwright-results.json',
    'playwright-results',
    'test-results',
  ]),
});

function resolveArtifact(relative: string): string {
  const absolute = path.resolve(REPOSITORY_ROOT, relative);
  if (!absolute.startsWith(`${REPOSITORY_ROOT}${path.sep}`) || path.relative(REPOSITORY_ROOT, absolute) !== relative) {
    throw new TypeError('Verification artifact target escaped the repository root.');
  }
  return absolute;
}

async function portIsFree(): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: PLAYWRIGHT_PORT });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Port ${PLAYWRIGHT_PORT} status check timed out.`));
    }, 2_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(true);
      else reject(error);
    });
  });
}

export async function inspectVerificationArtifacts(
  cleanup: 'none' | 'unit' | 'browser' | 'all' = 'none',
  checkPort = true,
) {
  const selected = cleanup === 'all'
    ? [...GROUPS.unit, ...GROUPS.browser]
    : cleanup === 'none' ? [...GROUPS.unit, ...GROUPS.browser] : [...GROUPS[cleanup]];
  const before = selected.filter((item) => existsSync(resolveArtifact(item)));
  if (cleanup !== 'none') for (const item of before) rmSync(resolveArtifact(item), { recursive: true, force: true });
  const remaining = [...GROUPS.unit, ...GROUPS.browser].filter((item) => existsSync(resolveArtifact(item)));
  return Object.freeze({
    cleanup,
    selected: selected.length,
    removed: cleanup === 'none' ? Object.freeze([]) : Object.freeze(before),
    remaining: Object.freeze(remaining),
    playwrightPort: PLAYWRIGHT_PORT,
    portFree: checkPort ? await portIsFree() : null,
  });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const cleanupOptions = args.filter((arg) => arg.startsWith('--cleanup='));
    const checks = args.filter((arg) => arg === '--check');
    const skipPortChecks = args.filter((arg) => arg === '--skip-port-check');
    const supported = args.every((arg) => arg === '--check' || arg === '--skip-port-check' || arg.startsWith('--cleanup='));
    const value = cleanupOptions.length === 1 ? cleanupOptions[0]!.slice('--cleanup='.length) : 'none';
    if (!supported || cleanupOptions.length > 1 || checks.length > 1 || skipPortChecks.length > 1
      || (checks.length && cleanupOptions.length)
      || (value !== 'none' && value !== 'unit' && value !== 'browser' && value !== 'all')) {
      throw new TypeError('Usage: node tools/verification-artifact-status.mts [--check|--cleanup=unit|browser|all] [--skip-port-check]');
    }
    const result = await inspectVerificationArtifacts(
      value as 'none' | 'unit' | 'browser' | 'all',
      skipPortChecks.length === 0,
    );
    process.stdout.write(
      `Verification artifacts: ${result.removed.length} removed, ${result.remaining.length} generated paths remain; `
      + (result.portFree === null
        ? `port ${result.playwrightPort} not checked.\n`
        : `port ${result.playwrightPort} ${result.portFree ? 'free' : 'occupied'}.\n`),
    );
    if (result.remaining.length) process.stdout.write(`Remaining generated paths: ${result.remaining.join(', ')}.\n`);
    return result.portFree === false ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Verification artifact status failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
