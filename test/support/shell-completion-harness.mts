import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

type CompletionResult = Readonly<{
  key: string;
  candidates: readonly string[];
}>;

const START_MARKER = '__WHOISLEUTH_COMPLETION_START_';
const END_MARKER = '__WHOISLEUTH_COMPLETION_END_';

export function assertSuccessfulShellProcess(child: SpawnSyncReturns<string>, label: string): void {
  const detail = typeof child.stderr === 'string' ? child.stderr.trim().slice(0, 2_048) : '';
  const outcome = child.error
    ? `failed to start: ${child.error.message.slice(0, 512)}`
    : child.signal
      ? `terminated by ${child.signal}`
      : `exited with status ${String(child.status)}`;
  assert.equal(child.status, 0, `${label} ${outcome}${detail ? `: ${detail}` : ''}`);
}

function completionKey(words: readonly string[]): string {
  return JSON.stringify(words);
}

function parseMarkedResults(stdout: string, expected: readonly (readonly string[])[]): ReadonlyMap<string, readonly string[]> {
  const lines = stdout.split(/\r?\n/gu);
  const results = new Map<string, readonly string[]>();
  let index = 0;
  while (index < lines.length) {
    const match = new RegExp(`^${START_MARKER}(\\d+)__$`, 'u').exec(lines[index] ?? '');
    if (!match) {
      index += 1;
      continue;
    }
    const caseIndex = Number(match[1]);
    assert.ok(Number.isSafeInteger(caseIndex) && caseIndex >= 0 && caseIndex < expected.length);
    const candidates: string[] = [];
    index += 1;
    while (index < lines.length && lines[index] !== `${END_MARKER}${caseIndex}__`) {
      if (lines[index]) candidates.push(lines[index]!);
      index += 1;
    }
    assert.equal(lines[index], `${END_MARKER}${caseIndex}__`, `Completion batch ${caseIndex} did not terminate.`);
    const key = completionKey(expected[caseIndex]!);
    assert.equal(results.has(key), false, `Completion input is duplicated: ${key}`);
    results.set(key, Object.freeze(candidates));
    index += 1;
  }
  assert.equal(results.size, expected.length, 'Completion batch did not return every requested case.');
  return results;
}

function lookupResult(
  results: ReadonlyMap<string, readonly string[]>,
  input: readonly string[],
): readonly string[] {
  const key = completionKey(input);
  const result = results.get(key);
  assert.ok(result, `Completion input was not included in the prepared batch: ${key}`);
  return result;
}

export function prepareBashCompletionBatch(
  script: string,
  cases: readonly (readonly string[])[],
  repositoryRoot: string,
): (words: readonly string[]) => readonly string[] {
  const invocations = cases.map((words, index) => `
COMP_WORDS=(${words.map((word) => JSON.stringify(word)).join(' ')})
COMP_CWORD=${words.length - 1}
printf '${START_MARKER}${index}__\\n'
_whoisleuth_completion
printf '%s\\n' "\${COMPREPLY[@]}"
printf '${END_MARKER}${index}__\\n'
`).join('\n');
  const harness = `whoisleuth() { "$WHOISLEUTH_TEST_NODE" bin/whoisleuth.mts "$@"; }\n${script}\n${invocations}`;
  const child = spawnSync('bash', ['-c', harness], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, WHOISLEUTH_TEST_NODE: process.execPath },
  });
  assertSuccessfulShellProcess(child, 'Bash completion batch');
  const results = parseMarkedResults(child.stdout, cases);
  return (words) => lookupResult(results, words);
}

export function prepareZshCompletionBatch(
  script: string,
  cases: readonly (readonly string[])[],
  repositoryRoot: string,
): (words: readonly string[]) => readonly string[] {
  const invocations = cases.map((words, index) => `
words=(${words.map((word) => JSON.stringify(word)).join(' ')})
CURRENT=${words.length}
printf '${START_MARKER}${index}__\\n'
_whoisleuth
printf '${END_MARKER}${index}__\\n'
`).join('\n');
  const harness = `
whoisleuth() { "$WHOISLEUTH_TEST_NODE" bin/whoisleuth.mts "$@"; }
compdef() { :; }
_describe() { :; }
_files() { print -r -- __FILES__; }
_message() { print -r -- __MESSAGE__; }
compadd() {
  local after_separator=0 value
  for value in "$@"; do
    if [[ "$value" == "--" ]]; then after_separator=1; continue; fi
    (( after_separator )) && print -r -- "$value"
  done
}
${script}
${invocations}`;
  const child = spawnSync('zsh', ['-c', harness], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, WHOISLEUTH_TEST_NODE: process.execPath },
  });
  assertSuccessfulShellProcess(child, 'Zsh completion batch');
  const results = parseMarkedResults(child.stdout, cases);
  return (words) => lookupResult(results, words);
}

function parsePowerShellResults(stdout: string, expected: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(Array.isArray(parsed), 'PowerShell completion batch must return an array.');
  const results = new Map<string, readonly string[]>();
  for (const value of parsed) {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    const record = value as Partial<CompletionResult>;
    if (typeof record.key !== 'string' || !Array.isArray(record.candidates)) {
      throw new TypeError('PowerShell completion batch returned a malformed result.');
    }
    assert.equal(results.has(record.key), false, `PowerShell completion input is duplicated: ${record.key}`);
    if (!record.candidates.every((candidate) => typeof candidate === 'string')) {
      throw new TypeError('PowerShell completion batch returned a non-string candidate.');
    }
    results.set(record.key, Object.freeze(record.candidates.filter((candidate) => candidate.trim().length > 0)));
  }
  assert.equal(results.size, expected.length, 'PowerShell completion batch did not return every requested case.');
  return results;
}

export function preparePowerShellCompletionBatch(
  script: string,
  lines: readonly string[],
  repositoryRoot: string,
): (line: string) => readonly string[] {
  const invocation = `${script}
function global:whoisleuth { & $env:WHOISLEUTH_TEST_NODE bin/whoisleuth.mts @args }
$lines = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = foreach ($lineValue in $lines) {
  $line = [string]$lineValue
  $completion = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $line.Length, $null)
  [pscustomobject]@{
    key = $line
    candidates = @($completion.CompletionMatches | ForEach-Object { $_.CompletionText })
  }
}
$results | ConvertTo-Json -Compress -Depth 4 -AsArray`;
  const child = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', invocation], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: JSON.stringify(lines),
    env: { ...process.env, WHOISLEUTH_TEST_NODE: process.execPath },
  });
  assertSuccessfulShellProcess(child, 'PowerShell completion batch');
  const results = parsePowerShellResults(child.stdout, lines);
  return (line) => {
    const result = results.get(line);
    assert.ok(result, `PowerShell completion input was not included in the prepared batch: ${line}`);
    return result;
  };
}
