#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  assessProductionDependencyAudit,
  PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES,
} from '../lib/production-dependency-audit-policy.mts';

export const PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS = 120_000;
export const PRODUCTION_DEPENDENCY_AUDIT_CACHE_PREFIX = 'whoisleuth-production-audit-';

type WritableLike = Readonly<{ write(value: string): unknown }>;
type AuditCommandResult = Readonly<{
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: Error;
}>;

export function productionDependencyAuditArguments(cacheDirectory: string): readonly string[] {
  return Object.freeze([
    'audit',
    '--package-lock-only',
    '--omit=dev',
    '--json',
    '--offline=false',
    `--cache=${cacheDirectory}`,
  ]);
}

function commandError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Unknown production dependency audit command error.');
}

function runNpmAudit(): AuditCommandResult {
  let cacheDirectory: string;
  try {
    cacheDirectory = mkdtempSync(path.join(tmpdir(), PRODUCTION_DEPENDENCY_AUDIT_CACHE_PREFIX));
  } catch (cause) {
    return { status: null, signal: null, stdout: '', stderr: '', error: commandError(cause) };
  }

  let auditResult: AuditCommandResult;
  try {
    const result = spawnSync('npm', productionDependencyAuditArguments(cacheDirectory), {
      cwd: path.resolve(fileURLToPath(new URL('..', import.meta.url))),
      encoding: 'utf8',
      maxBuffer: PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES,
      timeout: PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      shell: false,
    });
    const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    auditResult = {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      timedOut,
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (cause) {
    auditResult = { status: null, signal: null, stdout: '', stderr: '', error: commandError(cause) };
  }
  let cleanupError: Error | undefined;
  try {
    rmSync(cacheDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
  } catch (cause) {
    cleanupError = commandError(cause);
  }
  return cleanupError && !auditResult.error ? { ...auditResult, error: cleanupError } : auditResult;
}

function boundedError(value: string): string {
  const normalized = value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.length > 2000 ? `${normalized.slice(0, 2000)}…` : normalized;
}

export function formatProductionDependencyAuditAssessment(
  assessment: ReturnType<typeof assessProductionDependencyAudit>,
): string {
  const lines = [
    'WHOISleuth production dependency audit',
    `Status: ${assessment.status}`,
    `Production vulnerability entries: ${assessment.vulnerablePackageEntries}`,
  ];
  for (const item of assessment.findings) lines.push(`BLOCKED ${item.code}: ${item.message}`);
  return `${lines.join('\n')}\n`;
}

export function main(options: Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
  runAudit?: () => AuditCommandResult;
}> = {}): number {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const result = (options.runAudit ?? runNpmAudit)();

  if (result.timedOut) {
    stderr.write(`Production dependency audit timed out after ${PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS}ms.\n`);
    return 2;
  }
  if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) {
    const detail = boundedError(result.stderr);
    stderr.write(`Production dependency audit could not complete${detail ? `: ${detail}` : '.'}\n`);
    return 2;
  }

  const assessment = assessProductionDependencyAudit({
    auditJson: result.stdout,
  });
  const formatted = formatProductionDependencyAuditAssessment(assessment);
  (assessment.status === 'accepted' ? stdout : stderr).write(formatted);
  return assessment.status === 'accepted' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
