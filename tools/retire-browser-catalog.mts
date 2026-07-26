import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import * as retire from 'retire';

const SOURCE_VERSION = '5.4.3';
const SOURCE_REVISION = '56ea22d889656f4fbfe47b7df58d410a06ea59b7';
const SOURCE_SHA256 = 'afc0e9596a7ace01e81eab25aa26b622817461610199b03a173097a69f7526cc';
const SOURCE_URL = `https://github.com/RetireJS/retire.js/blob/${SOURCE_REVISION}/repository/jsrepository.json`;
const OUTPUT_PATH = resolve('lib/generated/retire-browser-catalog.mts');
const EXTRACTOR_NAMES = Object.freeze(['uri', 'filename', 'filecontent', 'filecontentreplace', 'hashes']);
const SEVERITIES = new Set(['none', 'low', 'medium', 'high', 'critical']);
const VERSION_RE = /^[0-9][0-9.a-z_-]{0,63}$/i;
const CVE_RE = /^CVE-[0-9X-]+$/;
const GHSA_RE = /^GHSA-[A-Z0-9-]+$/i;
const CWE_RE = /^CWE-[0-9]+$/;

type UnknownRecord = Record<string, unknown>;

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  if (!args.includes('--write') || sourceIndex === -1 || !args[sourceIndex + 1]) {
    throw new TypeError('Usage: node tools/retire-browser-catalog.mts --source <pinned-jsrepository.json> --write');
  }

  const sourcePath = resolve(args[sourceIndex + 1]);
  const sourceText = await readFile(sourcePath, 'utf8');
  const sourceHash = createHash('sha256').update(sourceText).digest('hex');
  if (sourceHash !== SOURCE_SHA256) {
    throw new Error(`Retire.js catalogue digest mismatch: expected ${SOURCE_SHA256}, received ${sourceHash}.`);
  }

  const parsed = JSON.parse(retire.replaceVersion(sourceText));
  const components = projectRepository(parsed);
  await writeFile(OUTPUT_PATH, renderModule(components), 'utf8');
  process.stdout.write(
    `Wrote ${Object.keys(components).length} bounded Retire.js components to ${OUTPUT_PATH}.\n`,
  );
}

await main();
