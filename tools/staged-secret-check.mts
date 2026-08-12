import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_STAGED_DIFF_BYTES = 4 * 1024 * 1024;
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

const ASSIGNED_PLACEHOLDER_VALUE_RE = /^(?:example|fixture|placeholder|redacted|replace[_ -]?me|your[_ -]?(?:api[_ -]?key|auth[_ -]?key|client[_ -]?secret|password|private[_ -]?key|secret|token)|test-only-(?:secret|session-signing-secret)|<[^>]+>)$/iu;
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

function scanAddedDiff(diff: string): SecretFinding[] {
  if (Buffer.byteLength(diff, 'utf8') > MAX_STAGED_DIFF_BYTES) {
    throw new Error(`Staged diff exceeds the ${MAX_STAGED_DIFF_BYTES}-byte secret-scan boundary.`);
  }
  const findings: SecretFinding[] = [];
  let file = '';
  let addedLine = 0;
  let insideHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = '';
      insideHunk = false;
      continue;
    }
    if (!insideHunk && line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (!insideHunk && line === '+++ /dev/null') {
      file = '';
      continue;
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
      continue;
    }
    if (!file || !line.startsWith('+')) continue;
    const value = line.slice(1);
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      const matches = [...value.matchAll(rule.pattern)].map((match) => match[0]);
      if (!matches.some((matched) => rule.id !== 'assigned-secret' || !isAssignedPlaceholder(matched))) continue;
      findings.push({ file, addedLine, rule: rule.id });
      if (findings.length >= MAX_FINDINGS) return findings;
      break;
    }
    addedLine += 1;
  }
  return findings;
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

function main(): void {
  const gitArguments = gitDiffArguments(process.argv.slice(2));
  const diff = execFileSync(
    'git',
    gitArguments,
    { encoding: 'utf8', maxBuffer: MAX_STAGED_DIFF_BYTES },
  );
  const findings = scanAddedDiff(diff);
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
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) main();

export { MAX_STAGED_DIFF_BYTES, gitDiffArguments, scanAddedDiff };
export type { SecretFinding };
