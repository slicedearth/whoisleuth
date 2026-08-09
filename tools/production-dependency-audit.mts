#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  assessProductionDependencyAudit,
  PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES,
} from '../lib/production-dependency-audit-policy.mts';

export const PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS = 60_000;

type WritableLike = Readonly<{ write(value: string): unknown }>;
type AuditCommandResult = Readonly<{
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: Error;
}>;

function runNpmAudit(): AuditCommandResult {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: path.resolve(fileURLToPath(new URL('..', import.meta.url))),
    encoding: 'utf8',
    maxBuffer: PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES,
    timeout: PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    shell: false,
  });
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut,
    ...(result.error ? { error: result.error } : {}),
  };
}

function boundedError(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length > 2000 ? `${normalized.slice(0, 2000)}…` : normalized;
}

export function formatProductionDependencyAuditAssessment(
  assessment: ReturnType<typeof assessProductionDependencyAudit>,
): string {
  const advisorySummary = assessment.reviewedAdvisoryIds.length
    ? assessment.reviewedAdvisoryIds.join(', ')
    : 'none';
  const lines = [
    'WHOISleuth production dependency audit policy',
    `Status: ${assessment.status}`,
    `Vulnerable package entries: ${assessment.vulnerablePackageEntries}`,
    `Reviewed advisory IDs present: ${advisorySummary}`,
    `Exception review: ${assessment.reviewedAt}; expires: ${assessment.expiresAt}`,
  ];
  for (const item of assessment.findings) lines.push(`BLOCKED ${item.code}: ${item.message}`);
  return `${lines.join('\n')}\n`;
}

export function main(options: Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
  now?: () => Date;
  runAudit?: () => AuditCommandResult;
  readLockfile?: () => string;
}> = {}): number {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const result = (options.runAudit ?? runNpmAudit)();

  if (result.stdout) stdout.write(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
  if (result.timedOut) {
    stderr.write(`Production dependency audit timed out after ${PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS}ms.\n`);
    return 2;
  }
  if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) {
    const detail = boundedError(result.stderr);
    stderr.write(`Production dependency audit could not complete${detail ? `: ${detail}` : '.'}\n`);
    return 2;
  }

  let lockfileJson = '';
  try {
    lockfileJson = (options.readLockfile ?? (() => readFileSync(
      fileURLToPath(new URL('../package-lock.json', import.meta.url)),
      'utf8',
    )))();
  } catch (cause) {
    stderr.write(`Production dependency audit could not read package-lock.json: ${cause instanceof Error ? cause.message : 'unknown error'}\n`);
    return 2;
  }
  const assessment = assessProductionDependencyAudit({
    auditJson: result.stdout,
    lockfileJson,
    ...(options.now ? { now: options.now } : {}),
  });
  const formatted = formatProductionDependencyAuditAssessment(assessment);
  (assessment.status === 'accepted' ? stdout : stderr).write(formatted);
  return assessment.status === 'accepted' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
