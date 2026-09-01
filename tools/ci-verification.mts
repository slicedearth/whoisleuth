#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL_SHA = /^[a-f0-9]{40}$/u;

export const CI_QUALITY_SCRIPTS = Object.freeze([
  'toolchain:check',
  'release:check',
  'verification:timing:check',
  'verification:ownership:check',
  'verification:journeys:check',
  'capabilities:check',
  'privacy:check',
  'schema:inventory',
  'test:mutation',
  'licenses:check',
  'providers:policy-check',
  'technology:coverage-check',
  'cli:package:check',
  'architecture:check',
  'dependencies:audit',
  'typecheck',
  'check',
] as const);

export const CI_UNIT_SCRIPTS = Object.freeze([
  'test:coverage',
  'test:critical-io-coverage',
] as const);

export const CI_BROWSER_PREREQUISITE_SCRIPTS = Object.freeze([
  'build',
  'frontend:loading-report',
  'security:retire',
] as const);

function commandName(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function assertLocalCiRuntime(
  actual = process.versions.node,
  expected = readFileSync(path.join(REPOSITORY_ROOT, '.nvmrc'), 'utf8').trim(),
): void {
  if (!/^\d+\.\d+\.\d+$/u.test(expected) || actual !== expected) {
    throw new Error(`Local CI requires Node.js ${expected || 'from .nvmrc'}; running ${actual}.`);
  }
}

function gitOutput(args: readonly string[]): string {
  const child = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`Git preflight failed: ${child.stderr.trim() || `exit ${child.status ?? 2}`}.`);
  }
  return child.stdout.trim();
}

export function localCiRevisionRange(): string {
  const head = gitOutput(['rev-parse', '--verify', 'HEAD']);
  const base = gitOutput(['merge-base', 'HEAD', 'refs/remotes/origin/main']);
  if (!FULL_SHA.test(base) || !FULL_SHA.test(head)) throw new TypeError('Local CI requires full Git revision identities.');
  return `${base}..${head}`;
}

function run(command: string, args: readonly string[]): void {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  const child = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Local CI command failed with exit code ${child.status ?? 2}.`);
}

function npmRun(script: string, extra: readonly string[] = []): void {
  run(commandName(), ['run', script, ...extra]);
}

export function formatLocalCiPlan(): string {
  return [
    'locked install',
    'changed-line secret scan',
    ...CI_QUALITY_SCRIPTS,
    ...CI_UNIT_SCRIPTS,
    ...CI_BROWSER_PREREQUISITE_SCRIPTS,
    'test:e2e:install',
    'test:e2e:built',
  ].join('\n');
}

export function main(args = process.argv.slice(2)): number {
  try {
    if (args.length === 1 && args[0] === '--list') {
      process.stdout.write(`${formatLocalCiPlan()}\n`);
      return 0;
    }
    if (args.length) throw new TypeError('Usage: node tools/ci-verification.mts [--list]');
    assertLocalCiRuntime();
    if (gitOutput(['status', '--porcelain=v1', '--untracked-files=all'])) {
      throw new Error('Local CI requires a clean worktree so it verifies the exact commit that would be pushed.');
    }
    const range = localCiRevisionRange();
    run(commandName(), ['ci', '--include=optional', '--ignore-scripts']);
    npmRun('security:staged', ['--', '--range', range]);
    for (const script of CI_QUALITY_SCRIPTS) npmRun(script);
    for (const script of CI_UNIT_SCRIPTS) npmRun(script);
    for (const script of CI_BROWSER_PREREQUISITE_SCRIPTS) npmRun(script);
    npmRun('test:e2e:install');
    npmRun('test:e2e:built');
    process.stdout.write('\nLocal CI matched every maintained quality, unit and browser gate.\n');
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Local CI verification failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
