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
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { id: 'github-token', pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{36,255}\b/u },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/u },
  { id: 'assigned-secret', pattern: /\b(?:api[_-]?key|client[_-]?secret|password|private[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{12,}["']/iu },
]);

const PLACEHOLDER_RE = /(?:example|fixture|placeholder|replace[_ -]?me|redacted|your[_ -]?|<[^>]+>)/iu;

function scanAddedDiff(diff: string): SecretFinding[] {
  if (Buffer.byteLength(diff, 'utf8') > MAX_STAGED_DIFF_BYTES) {
    throw new Error(`Staged diff exceeds the ${MAX_STAGED_DIFF_BYTES}-byte secret-scan boundary.`);
  }
  const findings: SecretFinding[] = [];
  let file = '';
  let addedLine = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      const firstAddedLine = hunk[1];
      if (firstAddedLine === undefined) throw new Error('Could not parse a staged diff hunk boundary.');
      addedLine = Number(firstAddedLine);
      continue;
    }
    if (!file || !line.startsWith('+') || line.startsWith('+++')) continue;
    const value = line.slice(1);
    if (!PLACEHOLDER_RE.test(value)) {
      for (const rule of RULES) {
        if (!rule.pattern.test(value)) continue;
        findings.push({ file, addedLine, rule: rule.id });
        if (findings.length >= MAX_FINDINGS) return findings;
        break;
      }
    }
    addedLine += 1;
  }
  return findings;
}

function main(): void {
  const diff = execFileSync(
    'git',
    ['diff', '--cached', '--unified=0', '--no-color', '--diff-filter=ACMR'],
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

export { MAX_STAGED_DIFF_BYTES, scanAddedDiff };
export type { SecretFinding };
