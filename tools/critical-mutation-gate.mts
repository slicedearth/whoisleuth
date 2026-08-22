#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRITICAL_MUTATION_MANIFEST,
  CRITICAL_MUTATION_MANIFEST_VERSION,
  MAX_CRITICAL_MUTANTS,
  MAX_CRITICAL_MUTATION_OUTPUT_BYTES,
  MAX_CRITICAL_MUTATION_TEXT_BYTES,
  MAX_CRITICAL_MUTATION_TIMEOUT_MS,
  type CriticalMutant,
} from './critical-mutation-manifest.mts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOADER = path.join(REPOSITORY_ROOT, 'tools', 'critical-mutation-loader.mts');
const REPORTER = path.join(REPOSITORY_ROOT, 'tools', 'mutation-test-reporter.mts');
const SAFE_PATH = /^(?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+$/u;

type MutationOutcome = Readonly<{
  id: string;
  area: CriticalMutant['area'];
  status: 'killed' | 'survived' | 'error';
  durationMs: number;
  tests: number;
  assertionFailures: number;
  detail: string;
}>;

function validateManifest(): void {
  if (CRITICAL_MUTATION_MANIFEST.length < 5 || CRITICAL_MUTATION_MANIFEST.length > MAX_CRITICAL_MUTANTS
    || new Set(CRITICAL_MUTATION_MANIFEST.map((item) => item.id)).size !== CRITICAL_MUTATION_MANIFEST.length
    || new Set(CRITICAL_MUTATION_MANIFEST.map((item) => item.area)).size !== CRITICAL_MUTATION_MANIFEST.length) {
    throw new TypeError('Critical mutation manifest must cover each reviewed area exactly once within its bound.');
  }
  for (const mutant of CRITICAL_MUTATION_MANIFEST) {
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/u.test(mutant.id) || !SAFE_PATH.test(mutant.file)
      || !Number.isSafeInteger(mutant.line) || mutant.line < 1
      || !Number.isSafeInteger(mutant.timeoutMs) || mutant.timeoutMs < 1_000 || mutant.timeoutMs > MAX_CRITICAL_MUTATION_TIMEOUT_MS
      || mutant.focusedTests.length < 1 || mutant.focusedTests.length > 8
      || mutant.focusedTests.some((file) => !/^test\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.test\.mts$/u.test(file))
      || Buffer.byteLength(mutant.search, 'utf8') < 1 || Buffer.byteLength(mutant.search, 'utf8') > MAX_CRITICAL_MUTATION_TEXT_BYTES
      || Buffer.byteLength(mutant.replacement, 'utf8') > MAX_CRITICAL_MUTATION_TEXT_BYTES) {
      throw new TypeError(`Critical mutant ${mutant.id} is malformed or unbounded.`);
    }
    const absolute = path.resolve(REPOSITORY_ROOT, mutant.file);
    if (!absolute.startsWith(`${REPOSITORY_ROOT}${path.sep}`) || !statSync(absolute).isFile()) throw new TypeError(`Critical mutant ${mutant.id} target is unavailable.`);
    const source = readFileSync(absolute, 'utf8');
    if (source.split(mutant.search).length !== 2 || source.split('\n')[mutant.line - 1]?.includes(mutant.search.trim()) !== true) {
      throw new TypeError(`Critical mutant ${mutant.id} source location or pattern drifted.`);
    }
    for (const test of mutant.focusedTests) if (!statSync(path.join(REPOSITORY_ROOT, test)).isFile()) throw new TypeError(`Critical mutant ${mutant.id} focused test is unavailable.`);
  }
}

function parseReporterOutput(value: string): Record<string, unknown> | null {
  const line = value.trim().split('\n').at(-1);
  if (!line || Buffer.byteLength(line, 'utf8') > 4_096) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function runMutant(mutant: CriticalMutant): MutationOutcome {
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [
    '--import', LOADER,
    '--test',
    '--test-isolation=none',
    `--test-reporter=${REPORTER}`,
    ...mutant.focusedTests,
  ], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, WHOISLEUTH_CRITICAL_MUTANT_ID: mutant.id },
    encoding: 'utf8',
    timeout: mutant.timeoutMs,
    maxBuffer: MAX_CRITICAL_MUTATION_OUTPUT_BYTES,
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const report = parseReporterOutput(result.stdout ?? '');
  const marker = new RegExp(`^WHOISLEUTH_MUTATION_APPLICATION ${mutant.id} (\\d+)$`, 'mu').exec(result.stderr ?? '');
  const applications = marker ? Number(marker[1]) : -1;
  const tests = Number(report?.tests ?? 0);
  const assertionFailures = Number(report?.assertionFailures ?? 0);
  const nonAssertionFailures = Number(report?.nonAssertionFailures ?? 0);
  const cancelled = Number(report?.cancelled ?? 0);
  const skipped = Number(report?.skipped ?? 0);
  const todo = Number(report?.todo ?? 0);
  if (result.error || result.signal || applications !== 1 || !Number.isSafeInteger(tests) || tests < 1
    || !Number.isSafeInteger(assertionFailures) || !Number.isSafeInteger(nonAssertionFailures)
    || cancelled !== 0 || skipped !== 0 || todo !== 0 || nonAssertionFailures !== 0) {
    return Object.freeze({
      id: mutant.id, area: mutant.area, status: 'error', durationMs, tests: Number.isSafeInteger(tests) ? tests : 0,
      assertionFailures: Number.isSafeInteger(assertionFailures) ? assertionFailures : 0,
      detail: result.error ? 'bounded runner error' : result.signal ? 'hard timeout' : 'ambiguous or invalid mutation result',
    });
  }
  if (result.status === 0) {
    return Object.freeze({ id: mutant.id, area: mutant.area, status: 'survived', durationMs, tests, assertionFailures, detail: 'selected regressions passed' });
  }
  if (assertionFailures < 1 || Number(report?.failed ?? 0) < 1) {
    return Object.freeze({ id: mutant.id, area: mutant.area, status: 'error', durationMs, tests, assertionFailures, detail: 'non-zero result was not an assertion kill' });
  }
  return Object.freeze({ id: mutant.id, area: mutant.area, status: 'killed', durationMs, tests, assertionFailures, detail: 'killed by declared focused regressions' });
}

export function runCriticalMutationGate() {
  validateManifest();
  const outcomes = CRITICAL_MUTATION_MANIFEST.map(runMutant);
  return Object.freeze({
    version: CRITICAL_MUTATION_MANIFEST_VERSION,
    total: outcomes.length,
    killed: outcomes.filter((item) => item.status === 'killed').length,
    survived: outcomes.filter((item) => item.status === 'survived').length,
    errors: outcomes.filter((item) => item.status === 'error').length,
    durationMs: outcomes.reduce((sum, item) => sum + item.durationMs, 0),
    outcomes: Object.freeze(outcomes),
  });
}

export function main(args = process.argv.slice(2)): number {
  try {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) throw new TypeError('Usage: node tools/critical-mutation-gate.mts [--json]');
    const result = runCriticalMutationGate();
    if (args[0] === '--json') process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`Critical mutation gate v${result.version}: ${result.killed} killed, ${result.survived} survived, ${result.errors} errors in ${result.durationMs} ms.\n`);
      for (const item of result.outcomes) process.stdout.write(`${item.id}: ${item.status}; ${item.tests} tests; ${item.durationMs} ms.\n`);
    }
    return result.killed === result.total && result.survived === 0 && result.errors === 0 ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Critical mutation gate failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
