#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseBoundedJsonObject } from '../lib/bounded-json.mts';
import { requireJsonRecord } from './maintainer-tool-helpers.mts';
import { productionDependencyInstallPaths } from './third-party-notices.mts';
import { candidateDependencyAuditInput } from './installed-dependency-evidence.mts';

import {
  assessProductionDependencyAudit,
  PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES,
} from '../lib/production-dependency-audit-policy.mts';

export const PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS = 300_000;
const MAX_LOCKFILE_BYTES = 5 * 1024 * 1024;

/** Audit optional package runtimes without installing them into the application. */
export function productionAuditLockfile(value: unknown, companions: readonly unknown[]): Record<string, unknown> {
  if (companions.length > 64) throw new Error('Too many optional package manifests.');
  const lock = structuredClone(requireJsonRecord(value, 'Lockfile'));
  const packages = requireJsonRecord(lock.packages, 'Locked packages');
  const root = requireJsonRecord(packages[''], 'Root package');
  const dependencies = { ...requireJsonRecord(root.dependencies, 'Root dependencies') };
  for (const value of companions) {
    const manifest = requireJsonRecord(value, 'Optional package');
    const runtime = requireJsonRecord(manifest.dependencies, 'Optional runtime dependencies');
    const names = Object.keys(runtime);
    if (!names.length) continue;
    for (const location of productionDependencyInstallPaths(lock, names)) {
      const entry = requireJsonRecord(packages[location], 'Optional runtime package');
      delete entry.dev;
      delete entry.devOptional;
    }
    for (const name of names) {
      const entry = requireJsonRecord(packages[`node_modules/${name}`], 'Locked optional dependency');
      // The audit uses the reviewed lockfile, not a fresh range resolution.
      dependencies[name] = entry.version;
    }
  }
  root.dependencies = dependencies;
  return lock;
}

function readAuditInput(file: string): Record<string, unknown> {
  const identity = lstatSync(file);
  if (!identity.isFile() || identity.size < 1 || identity.size > MAX_LOCKFILE_BYTES) throw new Error('Invalid dependency-audit input.');
  return parseBoundedJsonObject(readFileSync(file, 'utf8'), { label: 'Dependency audit input', maximumBytes: MAX_LOCKFILE_BYTES });
}

type WritableLike = Readonly<{ write(value: string): unknown }>;
type AuditCommandResult = Readonly<{
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: Error;
}>;

export function productionDependencyAuditArguments(): readonly string[] {
  return Object.freeze([
    'audit',
    '--package-lock-only',
    '--omit=dev',
    '--json',
    '--registry=https://registry.npmjs.org',
    '--offline=false',
    '--prefer-online',
  ]);
}

function commandError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Unknown production dependency audit command error.');
}

function runNpmAudit(installedLockfile?: Record<string, unknown>): AuditCommandResult {
  let directory: string | undefined;
  try {
    let lock = installedLockfile;
    if (!lock) {
      const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
      const packageDirectories = readdirSync(path.join(root, 'packages'), { withFileTypes: true });
      if (packageDirectories.length > 64) throw new Error('Too many package directories for the dependency audit.');
      const companions = packageDirectories.filter(entry => entry.isDirectory()).flatMap(entry => {
        const file = path.join(root, 'packages', entry.name, 'package.json');
        if (!existsSync(file)) return [];
        const manifest = readAuditInput(file);
        return manifest.dependencies ? [manifest] : [];
      });
      lock = productionAuditLockfile(readAuditInput(path.join(root, 'package-lock.json')), companions);
    }
    const packages = requireJsonRecord(lock.packages, 'Locked packages');
    directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-production-audit-'));
    writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify(lock), { mode: 0o600 });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify(packages['']), { mode: 0o600 });
    if (packages.frontend) {
      mkdirSync(path.join(directory, 'frontend'));
      writeFileSync(path.join(directory, 'frontend/package.json'), JSON.stringify(packages.frontend), { mode: 0o600 });
    }
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', productionDependencyAuditArguments(), {
      cwd: directory,
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
  } catch (cause) {
    return { status: null, signal: null, stdout: '', stderr: '', error: commandError(cause) };
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
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
  installedCandidate?: string;
  runAudit?: (installedLockfile?: Record<string, unknown>) => AuditCommandResult;
}> = {}): number {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let candidate: ReturnType<typeof candidateDependencyAuditInput> | undefined;
  try {
    if (options.installedCandidate) candidate = candidateDependencyAuditInput(readAuditInput(options.installedCandidate));
  } catch {
    stderr.write('Installed candidate dependency evidence is unavailable or invalid.\n');
    return 2;
  }
  if (candidate) stdout.write(`Installed candidate archive SHA-256: ${candidate.archiveSha256}\n`);
  const result = (options.runAudit ?? runNpmAudit)(candidate?.lockfile);

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
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--installed-candidate' || !args[1])) {
    process.stderr.write('Usage: dependencies:audit [--installed-candidate <installed-dependencies.json>]\n');
    process.exitCode = 2;
  } else process.exitCode = main(args[1] ? { installedCandidate: args[1] } : {});
}
