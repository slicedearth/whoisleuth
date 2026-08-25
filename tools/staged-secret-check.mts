import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_STAGED_DIFF_LINE_BYTES = 4 * 1024 * 1024;
const MAX_GIT_STDERR_BYTES = 64 * 1024;
const MAX_FINDINGS = 50;

type SecretFinding = Readonly<{
  file: string;
  addedLine: number;
  rule: string;
}>;

const RULES = Object.freeze([
  { id: 'private-key', pattern: /-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { id: 'github-token', pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{36,255}\b/gu },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/gu },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/gu },
  {
    id: 'assigned-secret',
    pattern: /\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|auth[_-]?key|client[_-]?secret|password|private[_-]?key|secret(?:[_-]?key)?|token)\s*[:=]\s*(?:"[^"\r\n]{12,256}"|'[^'\r\n]{12,256}'|[^\s#'"`]{12,256})/giu,
  },
]);

const ASSIGNED_PLACEHOLDER_VALUE_RE = /^(?:example|fixture|placeholder|redacted|replace[_ -]?me|must[_ -]?not[_ -]?render|your[_ -]?(?:api[_ -]?key|auth[_ -]?key|client[_ -]?secret|password|private[_ -]?key|secret|token)|test-only-(?:secret|session-signing-secret)|<[^>]+>)$/iu;
const COMMIT_RANGE_RE = /^(?:[a-f0-9]{40})\.\.(?:[a-f0-9]{40})$/u;

function isAssignedPlaceholder(match: string): boolean {
  const separator = match.search(/[:=]/u);
  if (separator < 0) return false;
  let value = match.slice(separator + 1).trim();
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1);
  return ASSIGNED_PLACEHOLDER_VALUE_RE.test(value);
}

type AddedDiffScanner = Readonly<{
  findings: SecretFinding[];
  scanLine: (line: string) => void;
}>;

function createAddedDiffScanner(): AddedDiffScanner {
  const findings: SecretFinding[] = [];
  let file = '';
  let addedLine = 0;
  let insideHunk = false;
  const scanLine = (line: string): void => {
    if (Buffer.byteLength(line, 'utf8') > MAX_STAGED_DIFF_LINE_BYTES) {
      throw new Error(`Diff line exceeds the ${MAX_STAGED_DIFF_LINE_BYTES}-byte secret-scan boundary.`);
    }
    if (findings.length >= MAX_FINDINGS) return;
    if (line.startsWith('diff --git ')) {
      file = '';
      insideHunk = false;
      return;
    }
    if (!insideHunk && line.startsWith('+++ b/')) {
      file = line.slice(6);
      return;
    }
    if (!insideHunk && line === '+++ /dev/null') {
      file = '';
      return;
    }
    if (!insideHunk && line.startsWith('+++ ')) {
      throw new Error('Staged diff contains an unsupported quoted or non-repository destination path.');
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      const firstAddedLine = hunk[1];
      if (firstAddedLine === undefined) throw new Error('Could not parse a staged diff hunk boundary.');
      addedLine = Number(firstAddedLine);
      insideHunk = true;
      return;
    }
    if (!file || !line.startsWith('+')) return;
    const value = line.slice(1);
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      const matches = [...value.matchAll(rule.pattern)].map((match) => match[0]);
      if (!matches.some((matched) => rule.id !== 'assigned-secret' || !isAssignedPlaceholder(matched))) continue;
      findings.push({ file, addedLine, rule: rule.id });
      break;
    }
    addedLine += 1;
  };
  return { findings, scanLine };
}

function scanAddedDiff(diff: string): SecretFinding[] {
  const scanner = createAddedDiffScanner();
  for (const line of diff.split('\n')) scanner.scanLine(line);
  return scanner.findings;
}

async function scanAddedDiffChunks(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<SecretFinding[]> {
  const scanner = createAddedDiffScanner();
  let pending = Buffer.alloc(0);
  for await (const rawChunk of chunks) {
    const chunk = Buffer.from(rawChunk);
    let offset = 0;
    for (let newline = chunk.indexOf(0x0a, offset); newline >= 0; newline = chunk.indexOf(0x0a, offset)) {
      const fragment = chunk.subarray(offset, newline);
      if (pending.length + fragment.length > MAX_STAGED_DIFF_LINE_BYTES) {
        throw new Error(`Diff line exceeds the ${MAX_STAGED_DIFF_LINE_BYTES}-byte secret-scan boundary.`);
      }
      const line = pending.length
        ? Buffer.concat([pending, fragment], pending.length + fragment.length).toString('utf8')
        : fragment.toString('utf8');
      scanner.scanLine(line.endsWith('\r') ? line.slice(0, -1) : line);
      pending = Buffer.alloc(0);
      offset = newline + 1;
    }
    const remainder = chunk.subarray(offset);
    if (pending.length + remainder.length > MAX_STAGED_DIFF_LINE_BYTES) {
      throw new Error(`Diff line exceeds the ${MAX_STAGED_DIFF_LINE_BYTES}-byte secret-scan boundary.`);
    }
    if (remainder.length) pending = pending.length
      ? Buffer.concat([pending, remainder], pending.length + remainder.length)
      : Buffer.from(remainder);
  }
  if (pending.length) scanner.scanLine(pending.toString('utf8'));
  return scanner.findings;
}

function gitDiffArguments(args: readonly string[]): string[] {
  const safePathArguments = ['-c', 'core.quotePath=false'];
  if (!args.length) return [...safePathArguments, 'diff', '--cached', '--text', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color', '--diff-filter=ACMRT'];
  if (args.length !== 2 || args[0] !== '--range' || !COMMIT_RANGE_RE.test(args[1] ?? '')) {
    throw new TypeError('Usage: node tools/staged-secret-check.mts [--range <base-sha>..<head-sha>]');
  }
  const [base, head] = String(args[1]).split('..');
  if (/^0{40}$/u.test(base ?? '')) {
    return [...safePathArguments, 'diff-tree', '--root', '-r', '--text', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color', '--diff-filter=ACMRT', requiredSha(head)];
  }
  return [...safePathArguments, 'diff', '--text', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color', '--diff-filter=ACMRT', `${requiredSha(base)}..${requiredSha(head)}`];
}

function requiredSha(value: string | undefined): string {
  if (!value || !/^[a-f0-9]{40}$/u.test(value)) throw new TypeError('Secret-scan revision must be a full commit SHA.');
  return value;
}

async function scanGitDiff(gitArguments: readonly string[]): Promise<SecretFinding[]> {
  const child = spawn('git', gitArguments, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = Buffer.alloc(0);
  child.stderr.on('data', (rawChunk: Uint8Array) => {
    if (stderr.length >= MAX_GIT_STDERR_BYTES) return;
    const chunk = Buffer.from(rawChunk);
    const remaining = MAX_GIT_STDERR_BYTES - stderr.length;
    stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)]);
  });
  const completion = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveCompletion, rejectCompletion) => {
    child.once('error', rejectCompletion);
    child.once('close', (code, signal) => resolveCompletion({ code, signal }));
  });
  let findings: SecretFinding[];
  try {
    findings = await scanAddedDiffChunks(child.stdout);
  } catch (error) {
    child.kill();
    await completion.catch(() => undefined);
    throw error;
  }
  const result = await completion;
  if (result.code !== 0) {
    const detail = stderr.toString('utf8').trim();
    throw new Error(`Git secret-scan diff failed${result.signal ? ` with ${result.signal}` : ` with exit code ${String(result.code)}`}${detail ? `: ${detail}` : '.'}`);
  }
  return findings;
}

async function main(): Promise<void> {
  const gitArguments = gitDiffArguments(process.argv.slice(2));
  const findings = await scanGitDiff(gitArguments);
  if (!findings.length) {
    process.stdout.write('No high-confidence secrets found in staged additions.\n');
    return;
  }
  for (const finding of findings) {
    process.stderr.write(`${finding.file}:${finding.addedLine}: possible ${finding.rule}\n`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) await main();

export { MAX_STAGED_DIFF_LINE_BYTES, gitDiffArguments, scanAddedDiff, scanAddedDiffChunks };
export type { SecretFinding };
