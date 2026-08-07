import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import * as retire from 'retire';

const SOURCE_VERSION = '5.4.3';
const SOURCE_REVISION = '56ea22d889656f4fbfe47b7df58d410a06ea59b7';
const SOURCE_SHA256 = 'afc0e9596a7ace01e81eab25aa26b622817461610199b03a173097a69f7526cc';
const SOURCE_URL = `https://github.com/RetireJS/retire.js/blob/${SOURCE_REVISION}/repository/jsrepository.json`;
const OUTPUT_PATH = 'lib/generated/retire-browser-catalog.mts';
const OUTPUT_DIGEST_PATH = 'lib/generated/retire-browser-catalog.sha256';
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const EXPRESSION_QUALIFICATION_MS = 1_500;
const EXPRESSION_QUALIFICATION_INPUT_CHARS = 4_096;
const EXTRACTOR_NAMES = Object.freeze(['uri', 'filename', 'filecontent', 'filecontentreplace', 'hashes']);
const SEVERITIES = new Set(['none', 'low', 'medium', 'high', 'critical']);
const VERSION_RE = /^[0-9][0-9.a-z_-]{0,63}$/i;
const CVE_RE = /^CVE-[0-9X-]+$/;
const GHSA_RE = /^GHSA-[A-Z0-9-]+$/i;
const CWE_RE = /^CWE-[0-9]+$/;

type UnknownRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type CatalogMode = 'check' | 'write';
type MainOptions = Readonly<{
  repositoryRoot?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function stringArray(value: unknown, limit: number, pattern?: RegExp): string[] {
  const output: string[] = [];
  for (const item of (Array.isArray(value) ? value : []).slice(0, limit)) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 2_048) continue;
    if (pattern && !pattern.test(item)) continue;
    output.push(item);
  }
  return output;
}

function boundedVersion(value: unknown): string | undefined {
  return typeof value === 'string' && VERSION_RE.test(value) ? value : undefined;
}

function projectVulnerability(value: unknown): UnknownRecord | null {
  const vulnerability = record(value);
  const below = boundedVersion(vulnerability.below);
  const severity = typeof vulnerability.severity === 'string' && SEVERITIES.has(vulnerability.severity)
    ? vulnerability.severity
    : null;
  if (!below || !severity) return null;

  const projected: UnknownRecord = { below, severity };
  const atOrAbove = boundedVersion(vulnerability.atOrAbove);
  const excludes = stringArray(vulnerability.excludes, 32, VERSION_RE);
  const cwe = stringArray(vulnerability.cwe, 16, CWE_RE);
  const identifiers = record(vulnerability.identifiers);
  const cve = stringArray(identifiers.CVE, 32, CVE_RE);
  const githubId = typeof identifiers.githubID === 'string' && GHSA_RE.test(identifiers.githubID)
    ? identifiers.githubID.toUpperCase()
    : null;

  if (atOrAbove) projected.atOrAbove = atOrAbove;
  if (excludes.length) projected.excludes = excludes;
  if (cwe.length) projected.cwe = cwe;
  if (cve.length || githubId) {
    projected.identifiers = {
      ...(cve.length ? { CVE: cve } : {}),
      ...(githubId ? { githubID: githubId } : {}),
    };
  }
  return projected;
}

function projectRepository(source: unknown): UnknownRecord {
  const sourceRepository = record(source);
  const projected: UnknownRecord = {};
  const entries = Object.entries(sourceRepository);
  if (entries.length === 0 || entries.length > 100) {
    throw new Error(`Expected between 1 and 100 Retire.js catalogue components; received ${entries.length}.`);
  }

  for (const [component, rawValue] of entries) {
    if (component === 'retire-example') continue;
    if (!/^[a-z0-9._-]{1,80}$/i.test(component)) continue;
    const value = record(rawValue);
    const sourceExtractors = record(value.extractors);
    const extractors: UnknownRecord = {};

    for (const extractorName of EXTRACTOR_NAMES) {
      const sourceExtractor = sourceExtractors[extractorName];
      if (extractorName === 'hashes') {
        const hashes: UnknownRecord = {};
        for (const [hash, version] of Object.entries(record(sourceExtractor)).slice(0, 4_096)) {
          if (/^[a-f0-9]{40}$/i.test(hash) && boundedVersion(version)) hashes[hash.toLowerCase()] = version;
        }
        if (Object.keys(hashes).length) extractors.hashes = hashes;
        continue;
      }

      const patterns = stringArray(sourceExtractor, 64);
      for (const pattern of patterns) {
        if (extractorName === 'filecontentreplace') {
          if (!/^\/(.*[^\\])\/([^/]+)\/$/.test(pattern)) {
            throw new Error(`Invalid ${extractorName} expression for ${component}.`);
          }
        } else {
          // The source catalogue is trusted only after every retained
          // expression compiles locally.
          new RegExp(pattern, 'g');
        }
      }
      if (patterns.length) extractors[extractorName] = patterns;
    }

    if (!Object.keys(extractors).length) continue;
    const vulnerabilities = (Array.isArray(value.vulnerabilities) ? value.vulnerabilities : [])
      .slice(0, 128)
      .map(projectVulnerability)
      .filter((item): item is UnknownRecord => item !== null);
    projected[component] = { extractors, vulnerabilities };
  }

  if (Object.keys(projected).length === 0) throw new Error('The projected Retire.js catalogue is empty.');
  return projected;
}

function qualifyRepositoryExpressions(
  components: UnknownRecord,
  options: Readonly<{ timeoutMs?: number; inputChars?: number }> = {},
): void {
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && Number(options.timeoutMs) >= 50
    ? Math.min(EXPRESSION_QUALIFICATION_MS, Number(options.timeoutMs))
    : EXPRESSION_QUALIFICATION_MS;
  const inputChars = Number.isSafeInteger(options.inputChars) && Number(options.inputChars) >= 256
    ? Math.min(EXPRESSION_QUALIFICATION_INPUT_CHARS, Number(options.inputChars))
    : EXPRESSION_QUALIFICATION_INPUT_CHARS;
  const patterns: string[] = [];
  for (const component of Object.values(components)) {
    const extractors = record(record(component).extractors);
    for (const name of ['uri', 'filename', 'filecontent']) {
      patterns.push(...stringArray(extractors[name], 64));
    }
    for (const descriptor of stringArray(extractors.filecontentreplace, 64)) {
      const match = /^\/(.*[^\\])\/([^/]+)\/$/u.exec(descriptor);
      if (match?.[1]) patterns.push(match[1]);
    }
  }
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const control = new Int32Array(controlBuffer);
  const worker = new Worker(String.raw`
    const { parentPort, workerData } = require('node:worker_threads');
    try {
      for (const pattern of workerData.patterns) {
        const expression = new RegExp(pattern, 'g');
        for (const value of workerData.inputs) {
          expression.lastIndex = 0;
          expression.exec(value);
        }
      }
      Atomics.store(new Int32Array(workerData.control), 0, 1);
    } catch {
      Atomics.store(new Int32Array(workerData.control), 0, -1);
    }
    Atomics.notify(new Int32Array(workerData.control), 0);
  `, {
    eval: true,
    workerData: {
      patterns,
      inputs: [
        '/'.repeat(inputChars),
        'a'.repeat(inputChars),
        `${'a'.repeat(inputChars - 1)}!`,
        '0.'.repeat(inputChars / 2),
      ],
      control: controlBuffer,
    },
  });
  worker.unref();
  const state = Atomics.wait(control, 0, 0, timeoutMs);
  void worker.terminate();
  if (state === 'timed-out') {
    throw new Error('Retire.js catalogue expression qualification exceeded its isolated time limit.');
  }
  if (Atomics.load(control, 0) !== 1) {
    throw new Error('Retire.js catalogue expression qualification failed.');
  }
}

function renderModule(components: UnknownRecord): string {
  return `// Generated by tools/retire-browser-catalog.mts from the pinned Retire.js\n`
    + `// browser-library catalogue. Apache-2.0 licensed source; do not edit by hand.\n\n`
    + `const RETIRE_BROWSER_CATALOG = Object.freeze({\n`
    + `  catalogVersion: ${JSON.stringify(`retire.js-${SOURCE_VERSION}`)},\n`
    + `  sourceRevision: ${JSON.stringify(SOURCE_REVISION)},\n`
    + `  sourceSha256: ${JSON.stringify(SOURCE_SHA256)},\n`
    + `  sourceUrl: ${JSON.stringify(SOURCE_URL)},\n`
    + `  components: ${JSON.stringify(components, null, 2)},\n`
    + `});\n\n`
    + `export { RETIRE_BROWSER_CATALOG };\n`;
}

function parseArguments(args: readonly string[]): { mode: CatalogMode; source: string } {
  const sourceIndex = args.indexOf('--source');
  const modes = (['--check', '--write'] as const).filter((mode) => args.includes(mode));
  if (
    modes.length !== 1
    || sourceIndex === -1
    || !args[sourceIndex + 1]
    || args.length !== 3
  ) {
    throw new TypeError('Usage: npm run catalog:retire -- --source <pinned-jsrepository.json> <--check|--write>');
  }
  const mode = modes[0];
  const source = args[sourceIndex + 1];
  if (!mode || !source) throw new TypeError('The catalogue mode and source are required.');
  return {
    mode: mode.slice(2) as CatalogMode,
    source,
  };
}

async function readBoundedText(filename: string, maxBytes: number): Promise<string> {
  const metadata = await stat(filename);
  if (!metadata.isFile() || metadata.size > maxBytes) {
    throw new TypeError(`${filename} is missing or exceeds its byte limit.`);
  }
  return readFile(filename, 'utf8');
}

function projectSource(sourceText: string): UnknownRecord {
  const sourceHash = createHash('sha256').update(sourceText).digest('hex');
  if (sourceHash !== SOURCE_SHA256) {
    throw new Error(`Retire.js catalogue digest mismatch: expected ${SOURCE_SHA256}, received ${sourceHash}.`);
  }

  const parsed = JSON.parse(retire.replaceVersion(sourceText));
  return projectRepository(parsed);
}

function buildModule(sourceText: string): string {
  return renderModule(projectSource(sourceText));
}

function moduleDigest(moduleText: string): string {
  return createHash('sha256').update(moduleText).digest('hex');
}

async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    const parsed = parseArguments(args);
    const repositoryRoot = resolve(options.repositoryRoot || process.cwd());
    const sourcePath = resolve(repositoryRoot, parsed.source);
    const outputPath = resolve(repositoryRoot, OUTPUT_PATH);
    const outputDigestPath = resolve(repositoryRoot, OUTPUT_DIGEST_PATH);
    const sourceText = await readBoundedText(sourcePath, MAX_SOURCE_BYTES);
    const components = projectSource(sourceText);
    qualifyRepositoryExpressions(components);
    const expected = renderModule(components);
    if (Buffer.byteLength(expected, 'utf8') > MAX_OUTPUT_BYTES) {
      throw new RangeError('Projected Retire.js catalogue exceeds its output byte limit.');
    }

    if (parsed.mode === 'check') {
      const current = await readBoundedText(outputPath, MAX_OUTPUT_BYTES);
      const currentDigest = (await readBoundedText(outputDigestPath, 80)).trim();
      if (current !== expected) {
        throw new Error('Generated Retire.js catalogue is stale. Re-run the catalogue command with --write.');
      }
      if (currentDigest !== moduleDigest(current)) {
        throw new Error('Generated Retire.js catalogue digest is stale. Re-run the catalogue command with --write.');
      }
      stdout.write(`Retire.js browser catalogue: pass (${Object.keys(components).length} components)\n`);
      return 0;
    }

    await writeFile(outputPath, expected, 'utf8');
    await writeFile(outputDigestPath, `${moduleDigest(expected)}\n`, 'utf8');
    stdout.write(`Wrote Retire.js browser catalogue to ${OUTPUT_PATH}.\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Retire.js catalogue maintenance failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();

export {
  MAX_OUTPUT_BYTES,
  MAX_SOURCE_BYTES,
  OUTPUT_DIGEST_PATH,
  OUTPUT_PATH,
  SOURCE_REVISION,
  SOURCE_SHA256,
  SOURCE_URL,
  SOURCE_VERSION,
  buildModule,
  main,
  moduleDigest,
  parseArguments,
  projectRepository,
  qualifyRepositoryExpressions,
  projectSource,
  renderModule,
};
