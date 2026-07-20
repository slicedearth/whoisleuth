#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ProcessResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;
type ProcessOptions = Readonly<{
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}>;
type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: ProcessOptions,
) => Promise<ProcessResult>;
type CodeqlFinding = Readonly<{
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: string;
  file: string | null;
  line: number | null;
  primaryLocationLineHash: string | null;
  primaryLocationStartColumnFingerprint: string | null;
}>;
type ParsedCodeqlFindings = Readonly<{
  total: number;
  findings: readonly CodeqlFinding[];
  truncated: boolean;
}>;
type KnownCodeqlFinding = Readonly<{
  ruleId: string;
  file: string;
  primaryLocationLineHash: string;
  primaryLocationStartColumnFingerprint: string;
  reason: 'false_positive' | 'used_in_tests' | 'accepted_behavior';
}>;
type CodeqlFindings = Readonly<{
  total: number;
  known: number;
  new: number;
  displayed: readonly CodeqlFinding[];
  staleBaseline: readonly KnownCodeqlFinding[];
  truncated: boolean;
}>;
type LocalCodeqlReport = Readonly<{
  status: 'pass' | 'findings' | 'baseline_drift';
  codeqlVersion: string;
  language: 'javascript-typescript';
  querySuite: typeof CODEQL_QUERY_SUITE;
  findings: CodeqlFindings;
}>;
type LocalCodeqlOptions = Readonly<{
  repositoryRoot?: string;
  codeqlCommand?: string;
  runProcess?: ProcessRunner;
  makeTemporaryDirectory?: (prefix: string) => Promise<string>;
  removeTemporaryDirectory?: (directory: string) => Promise<void>;
  knownFindings?: readonly KnownCodeqlFinding[];
}>;

const CODEQL_QUERY_SUITE = 'javascript-code-scanning.qls';
const CODEQL_LANGUAGE = 'javascript-typescript' as const;
const CODEQL_PROCESS_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_CODEQL_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_CODEQL_SARIF_BYTES = 16 * 1024 * 1024;
const MAX_CODEQL_FINDINGS = 1000;
const MAX_DISPLAYED_FINDINGS = 100;
const MAX_FINDING_TEXT_LENGTH = 500;
const MAX_FINDING_PATH_LENGTH = 1000;
const MAX_CODEQL_COMMAND_LENGTH = 4096;
const MIN_CODEQL_RAM_MB = 1024;
const MAX_CODEQL_RAM_MB = 4096;
const CODEQL_THREADS = 2;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// These exact SARIF identities correspond to reviewed hosted dismissals. A new
// location, changed fingerprint, duplicate occurrence, or removed result causes
// review instead of suppressing an entire rule or file.
const KNOWN_CODEQL_FINDINGS: readonly KnownCodeqlFinding[] = Object.freeze([
  Object.freeze({ ruleId: 'js/request-forgery', file: 'lib/safe-fetch.mts', primaryLocationLineHash: 'fec0b1d981cb94bf:1', primaryLocationStartColumnFingerprint: '17', reason: 'false_positive' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/case-report.test.js', primaryLocationLineHash: '1beaf56a554ac9e4:1', primaryLocationStartColumnFingerprint: '13', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/case-report.test.js', primaryLocationLineHash: '49fe07e43d4a51e4:1', primaryLocationStartColumnFingerprint: '10', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/ct-search.test.js', primaryLocationLineHash: '87440f158d857689:1', primaryLocationStartColumnFingerprint: '10', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/ct-search.test.js', primaryLocationLineHash: 'e1adbaf9d2d01b06:1', primaryLocationStartColumnFingerprint: '10', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/ct-search.test.js', primaryLocationLineHash: '63133cb78baecb59:1', primaryLocationStartColumnFingerprint: '10', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/ct-search.test.js', primaryLocationLineHash: 'f8a646c95a35d1c8:1', primaryLocationStartColumnFingerprint: '11', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/ct-search.test.js', primaryLocationLineHash: '6456a8f043208483:1', primaryLocationStartColumnFingerprint: '10', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/ct-search.test.js', primaryLocationLineHash: '71a5d98ca5aaf83a:1', primaryLocationStartColumnFingerprint: '69', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/ct-search.test.js', primaryLocationLineHash: '5c4c60322ce69230:1', primaryLocationStartColumnFingerprint: '10', reason: 'used_in_tests' as const }),
  Object.freeze({ ruleId: 'js/disabling-certificate-validation', file: 'lib/tls-intelligence.mts', primaryLocationLineHash: 'bb6b221105506c3:1', primaryLocationStartColumnFingerprint: '0', reason: 'accepted_behavior' as const }),
  Object.freeze({ ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'c95b56b6acb3e65b:1', primaryLocationStartColumnFingerprint: '23', reason: 'false_positive' as const }),
]);

function boundedText(value: unknown, maximum: number, fallback: string): string {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
  return (text || fallback).slice(0, maximum);
}

function resolveCodeqlCommand(value: unknown = process.env.CODEQL_PATH): string {
  if (value === undefined || value === null || value === '') return 'codeql';
  if (
    typeof value !== 'string'
    || value.length > MAX_CODEQL_COMMAND_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)
    || !path.isAbsolute(value)
  ) {
    throw new TypeError('CODEQL_PATH must be a bounded absolute path to the CodeQL executable.');
  }
  return path.normalize(value);
}

async function findCodeqlCommand(value: unknown = process.env.CODEQL_PATH): Promise<string> {
  const command = resolveCodeqlCommand(value);
  if (command !== 'codeql') return command;
  const userLocalCommand = path.join(homedir(), '.local', 'bin', 'codeql');
  try {
    await access(userLocalCommand, fsConstants.X_OK);
    return userLocalCommand;
  } catch {
    return command;
  }
}

function appendBounded(chunks: Buffer[], chunk: Buffer, state: { bytes: number }, maximum: number): boolean {
  if (state.bytes >= maximum) return false;
  const remaining = maximum - state.bytes;
  const kept = chunk.subarray(0, remaining);
  chunks.push(kept);
  state.bytes += kept.byteLength;
  return chunk.byteLength <= remaining;
}

async function runProcessBounded(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const stdoutState = { bytes: 0 };
    const stderrState = { bytes: 0 };
    let settled = false;
    let exceededOutput = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const terminate = (): void => {
      child.kill('SIGTERM');
      const forceTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      forceTimer.unref();
    };
    const timeout = setTimeout(() => {
      terminate();
      finish(() => reject(new Error(`CodeQL exceeded its ${options.timeoutMs} ms process deadline.`)));
    }, options.timeoutMs);

    child.stdout.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (!appendBounded(stdout, chunk, stdoutState, options.maxOutputBytes) && !exceededOutput) {
        exceededOutput = true;
        terminate();
      }
    });
    child.stderr.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (!appendBounded(stderr, chunk, stderrState, options.maxOutputBytes) && !exceededOutput) {
        exceededOutput = true;
        terminate();
      }
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => finish(() => {
      if (exceededOutput) {
        reject(new Error(`CodeQL process output exceeded ${options.maxOutputBytes} bytes.`));
        return;
      }
      resolve({
        exitCode: Number.isInteger(code) ? Number(code) : 2,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    }));
  });
}

function parseCodeqlVersion(stdout: string): string {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>).version;
      if (typeof value === 'string') return boundedText(value, 100, 'unknown');
    }
  } catch {
    // Older bundles may not produce JSON for this command; keep the fallback bounded.
  }
  return boundedText(stdout.split(/\r?\n/u)[0], 100, 'unknown');
}

function codeqlRamMegabytes(systemMemoryBytes = totalmem()): number {
  const halfSystemMemory = Math.floor(systemMemoryBytes / (2 * 1024 * 1024));
  return Math.max(MIN_CODEQL_RAM_MB, Math.min(MAX_CODEQL_RAM_MB, halfSystemMemory));
}

function boundedDiagnostic(value: unknown, maximum = 1000): string {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
  if (!text) return 'No diagnostic output was returned.';
  if (text.length <= maximum) return text;
  const separator = ' ... ';
  const headLength = Math.floor((maximum - separator.length) * 0.35);
  const tailLength = maximum - separator.length - headLength;
  return `${text.slice(0, headLength)}${separator}${text.slice(-tailLength)}`;
}

function findingLocation(result: Record<string, unknown>): { file: string | null; line: number | null } {
  const locations = Array.isArray(result.locations) ? result.locations : [];
  const location = locations[0];
  if (!location || typeof location !== 'object' || Array.isArray(location)) return { file: null, line: null };
  const physical = (location as Record<string, unknown>).physicalLocation;
  if (!physical || typeof physical !== 'object' || Array.isArray(physical)) return { file: null, line: null };
  const physicalRecord = physical as Record<string, unknown>;
  const artifact = physicalRecord.artifactLocation;
  const region = physicalRecord.region;
  const uri = artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? (artifact as Record<string, unknown>).uri
    : null;
  const startLine = region && typeof region === 'object' && !Array.isArray(region)
    ? (region as Record<string, unknown>).startLine
    : null;
  return {
    file: typeof uri === 'string' ? boundedText(uri.split(/[?#]/u)[0], MAX_FINDING_PATH_LENGTH, 'unknown') : null,
    line: Number.isSafeInteger(startLine) && Number(startLine) > 0 ? Number(startLine) : null,
  };
}

function normalizeFinding(value: unknown): CodeqlFinding {
  const result = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const message = result.message && typeof result.message === 'object' && !Array.isArray(result.message)
    ? (result.message as Record<string, unknown>).text
    : null;
  const allowedLevels = new Set(['error', 'warning', 'note', 'none']);
  const level = typeof result.level === 'string' && allowedLevels.has(result.level)
    ? result.level as CodeqlFinding['level']
    : 'warning';
  const partialFingerprints = result.partialFingerprints
    && typeof result.partialFingerprints === 'object'
    && !Array.isArray(result.partialFingerprints)
    ? result.partialFingerprints as Record<string, unknown>
    : {};
  return Object.freeze({
    ruleId: boundedText(result.ruleId, 200, 'unknown-rule'),
    level,
    message: boundedText(message, MAX_FINDING_TEXT_LENGTH, 'CodeQL reported a finding.'),
    ...findingLocation(result),
    primaryLocationLineHash: typeof partialFingerprints.primaryLocationLineHash === 'string'
      ? boundedText(partialFingerprints.primaryLocationLineHash, 200, 'unknown')
      : null,
    primaryLocationStartColumnFingerprint: typeof partialFingerprints.primaryLocationStartColumnFingerprint === 'string'
      ? boundedText(partialFingerprints.primaryLocationStartColumnFingerprint, 200, 'unknown')
      : null,
  });
}

function parseCodeqlSarif(value: string | Buffer): ParsedCodeqlFindings {
  const bytes = Buffer.isBuffer(value) ? value.byteLength : Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_CODEQL_SARIF_BYTES) {
    throw new RangeError(`CodeQL SARIF output exceeded ${MAX_CODEQL_SARIF_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
  } catch {
    throw new TypeError('CodeQL produced malformed SARIF JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('CodeQL produced an unexpected SARIF document.');
  }
  const runs = (parsed as Record<string, unknown>).runs;
  if (!Array.isArray(runs)) throw new TypeError('CodeQL SARIF output is missing its runs array.');

  const findings: CodeqlFinding[] = [];
  let total = 0;
  let truncated = false;
  for (const run of runs) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) continue;
    const results = (run as Record<string, unknown>).results;
    if (!Array.isArray(results)) continue;
    total += results.length;
    if (total > MAX_CODEQL_FINDINGS) truncated = true;
    for (const result of results) {
      if (findings.length >= MAX_CODEQL_FINDINGS) {
        truncated = true;
        break;
      }
      findings.push(normalizeFinding(result));
    }
  }
  return Object.freeze({ total, findings: Object.freeze(findings), truncated });
}

function findingIdentity(finding: Pick<CodeqlFinding, 'ruleId' | 'file' | 'primaryLocationLineHash' | 'primaryLocationStartColumnFingerprint'>): string | null {
  if (!finding.file || !finding.primaryLocationLineHash || !finding.primaryLocationStartColumnFingerprint) return null;
  return JSON.stringify([
    finding.ruleId,
    finding.file,
    finding.primaryLocationLineHash,
    finding.primaryLocationStartColumnFingerprint,
  ]);
}

function classifyCodeqlFindings(
  parsed: ParsedCodeqlFindings,
  baseline: readonly KnownCodeqlFinding[] = KNOWN_CODEQL_FINDINGS,
): CodeqlFindings {
  const availableBaseline = new Map<string, KnownCodeqlFinding[]>();
  for (const entry of baseline) {
    const identity = findingIdentity(entry);
    if (!identity) throw new TypeError('The local CodeQL baseline contains an incomplete identity.');
    const entries = availableBaseline.get(identity) ?? [];
    entries.push(entry);
    availableBaseline.set(identity, entries);
  }

  const newFindings: CodeqlFinding[] = [];
  let known = 0;
  for (const finding of parsed.findings) {
    const identity = findingIdentity(finding);
    const matches = identity ? availableBaseline.get(identity) : null;
    if (matches?.length) {
      matches.pop();
      known += 1;
    } else {
      newFindings.push(finding);
    }
  }
  const staleBaseline = [...availableBaseline.values()].flat();
  return Object.freeze({
    total: parsed.total,
    known,
    new: Math.max(parsed.total - known, newFindings.length),
    displayed: Object.freeze(newFindings.slice(0, MAX_DISPLAYED_FINDINGS)),
    staleBaseline: Object.freeze(staleBaseline),
    truncated: parsed.truncated || newFindings.length > MAX_DISPLAYED_FINDINGS,
  });
}

function processFailure(command: string, result: ProcessResult): Error {
  const detail = boundedDiagnostic(result.stderr || result.stdout);
  return new Error(`${command} failed with exit status ${result.exitCode}: ${detail}`);
}

async function runLocalCodeql(options: LocalCodeqlOptions = {}): Promise<LocalCodeqlReport> {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? PROJECT_ROOT);
  const codeqlCommand = await findCodeqlCommand(options.codeqlCommand);
  const runProcess = options.runProcess ?? runProcessBounded;
  const makeTemporaryDirectory = options.makeTemporaryDirectory ?? mkdtemp;
  const removeTemporaryDirectory = options.removeTemporaryDirectory
    ?? ((directory: string) => rm(directory, { recursive: true, force: true }));
  await access(repositoryRoot);

  const temporaryDirectory = await makeTemporaryDirectory(path.join(tmpdir(), 'whoisleuth-codeql-'));
  const databasePath = path.join(temporaryDirectory, 'database');
  const sarifPath = path.join(temporaryDirectory, 'results.sarif');
  const processOptions = {
    cwd: repositoryRoot,
    timeoutMs: CODEQL_PROCESS_TIMEOUT_MS,
    maxOutputBytes: MAX_CODEQL_OUTPUT_BYTES,
  } as const;

  try {
    const versionResult = await runProcess(codeqlCommand, ['version', '--format=json'], processOptions);
    if (versionResult.exitCode !== 0) throw processFailure('CodeQL version check', versionResult);

    const createResult = await runProcess(codeqlCommand, [
      'database', 'create', databasePath,
      `--language=${CODEQL_LANGUAGE}`,
      `--source-root=${repositoryRoot}`,
    ], processOptions);
    if (createResult.exitCode !== 0) throw processFailure('CodeQL database creation', createResult);

    const analyzeResult = await runProcess(codeqlCommand, [
      'database', 'analyze', databasePath,
      CODEQL_QUERY_SUITE,
      '--format=sarif-latest',
      '--sarif-category=javascript-typescript',
      `--output=${sarifPath}`,
      `--threads=${CODEQL_THREADS}`,
      `--ram=${codeqlRamMegabytes()}`,
    ], processOptions);
    if (analyzeResult.exitCode !== 0) throw processFailure('CodeQL analysis', analyzeResult);

    const metadata = await stat(sarifPath);
    if (!metadata.isFile()) throw new TypeError('CodeQL did not create a SARIF result file.');
    if (metadata.size > MAX_CODEQL_SARIF_BYTES) {
      throw new RangeError(`CodeQL SARIF output exceeded ${MAX_CODEQL_SARIF_BYTES} bytes.`);
    }
    const findings = classifyCodeqlFindings(
      parseCodeqlSarif(await readFile(sarifPath)),
      options.knownFindings ?? KNOWN_CODEQL_FINDINGS,
    );
    const status = findings.new > 0
      ? 'findings'
      : findings.staleBaseline.length > 0
        ? 'baseline_drift'
        : 'pass';
    return Object.freeze({
      status,
      codeqlVersion: parseCodeqlVersion(versionResult.stdout),
      language: CODEQL_LANGUAGE,
      querySuite: CODEQL_QUERY_SUITE,
      findings,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error('CodeQL CLI was not found. Install the official CodeQL bundle and add its codeql directory to PATH, or set CODEQL_PATH to its absolute executable path.');
    }
    throw error;
  } finally {
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

function formatLocalCodeqlReport(report: LocalCodeqlReport): string {
  const lines = [
    'WHOISleuth local CodeQL check',
    `CodeQL: ${report.codeqlVersion}`,
    `Suite: ${report.querySuite}`,
    `Result: ${report.status === 'pass' ? 'PASS' : report.status === 'findings' ? 'NEW FINDINGS' : 'BASELINE DRIFT'}`,
    `Findings: ${report.findings.total} total, ${report.findings.known} reviewed, ${report.findings.new} new`,
  ];
  for (const finding of report.findings.displayed) {
    const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : 'unknown location';
    lines.push('', `${finding.level.toUpperCase()} ${finding.ruleId} at ${location}`, `  ${finding.message}`);
  }
  if (report.findings.truncated) {
    lines.push('', `Output was truncated after ${report.findings.displayed.length} displayed findings.`);
  }
  for (const finding of report.findings.staleBaseline) {
    lines.push('', `STALE BASELINE ${finding.ruleId} at ${finding.file}`, `  Review or remove this ${finding.reason.replaceAll('_', ' ')} entry.`);
  }
  return `${lines.join('\n')}\n`;
}

function parseArguments(args: readonly string[]): void {
  if (args.length > 0) throw new TypeError('Usage: npm run security:codeql');
}

async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    parseArguments(args);
    const report = await runLocalCodeql();
    process.stdout.write(formatLocalCodeqlReport(report));
    return report.status === 'pass' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${boundedText(error instanceof Error ? error.message : error, 1200, 'Local CodeQL check failed.')}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export {
  CODEQL_LANGUAGE,
  CODEQL_PROCESS_TIMEOUT_MS,
  CODEQL_QUERY_SUITE,
  CODEQL_THREADS,
  MAX_CODEQL_RAM_MB,
  MAX_CODEQL_FINDINGS,
  MAX_CODEQL_OUTPUT_BYTES,
  MAX_CODEQL_SARIF_BYTES,
  MAX_DISPLAYED_FINDINGS,
  MIN_CODEQL_RAM_MB,
  KNOWN_CODEQL_FINDINGS,
  boundedDiagnostic,
  classifyCodeqlFindings,
  codeqlRamMegabytes,
  findCodeqlCommand,
  formatLocalCodeqlReport,
  main,
  parseArguments,
  parseCodeqlSarif,
  parseCodeqlVersion,
  resolveCodeqlCommand,
  runLocalCodeql,
  runProcessBounded,
};
export type { CodeqlFinding, CodeqlFindings, KnownCodeqlFinding, LocalCodeqlOptions, LocalCodeqlReport, ParsedCodeqlFindings, ProcessResult };
