// Passive browser-library identification over the capped HTML body already
// collected by an eligible deep lookup. The matcher uses a pinned, reviewed
// projection of Retire.js's browser catalogue and never fetches referenced
// scripts. Upstream URLs, filenames, inline bodies, and catalogue expressions
// are treated as untrusted inputs and are not retained in the result.

import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

import { RETIRE_BROWSER_CATALOG } from './generated/retire-browser-catalog.mts';
import { CISA_KEV_CATALOG } from './generated/cisa-kev-catalog.mts';
import { createObservation } from '../packages/evidence/observation.mts';
import {
  BROWSER_LIBRARY_PROFILE_VERSION,
  MAX_LIBRARY_FINDINGS,
} from './lookup-child-profile-contract.mts';
import {
  MAX_INLINE_SCRIPT_CHARS,
  MAX_INLINE_SCRIPT_TOTAL_CHARS,
  MAX_SCRIPT_ELEMENTS,
  MAX_STATIC_HTML_CHARS,
  analyzeStaticHtml,
  type StaticHtmlAnalysis,
} from './static-html-analysis.mts';

type UnknownRecord = Record<string, unknown>;
type DetectionMethod = 'script URL' | 'script filename' | 'inline signature' | 'inline hash';
type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';
type BrowserLibraryFinding = {
  id: string;
  name: string;
  apparentVersion: string;
  detectionMethods: DetectionMethod[];
  advisoryCount: number;
  highestSeverity: Severity | null;
  advisoryIdentifiers: string[];
  knownExploitedCount: number;
  knownExploitedIdentifiers: string[];
  weaknessClasses: string[];
};
type BrowserLibraryProfileInput = {
  html?: unknown;
  htmlAnalysis?: StaticHtmlAnalysis;
  observedAt?: unknown;
  sourceTruncated?: unknown;
};
type CatalogVulnerability = {
  below?: unknown;
  atOrAbove?: unknown;
  excludes?: unknown;
  severity?: unknown;
  identifiers?: unknown;
  cwe?: unknown;
};
type CatalogComponent = {
  extractors?: unknown;
  vulnerabilities?: unknown;
};
type DetectedComponent = {
  component: string;
  version: string;
  detections: Set<DetectionMethod>;
};

// Catalogue expressions are reviewed third-party inputs. Keep every individual
// regular-expression evaluation and the aggregate inline-signature work small
// enough that a target-controlled script cannot monopolise the Node event loop.
// Full-content hashes still use the complete already-capped script body.
const MAX_INLINE_LIBRARY_SCAN_CHARS = 1_024;
const MAX_INLINE_LIBRARY_SCAN_TOTAL_CHARS = 4_096;
const MAX_INLINE_LIBRARY_SCAN_MS = 750;
const MAX_INLINE_LIBRARY_WORKER_BYTES = 64 * 1024;

const MAX_LIBRARY_HTML_CHARS = MAX_STATIC_HTML_CHARS;
const MAX_ADVISORY_IDENTIFIERS = 16;
const MAX_WEAKNESS_CLASSES = 12;
const MAX_MATCHES_PER_PATTERN = 4;
const MAX_VERSION_LENGTH = 64;
const COMPONENT_RE = /^[a-z0-9._-]{1,80}$/i;
const VERSION_RE = /^[0-9][0-9.a-z_-]{0,63}$/i;
const CVE_RE = /^CVE-[0-9X-]+$/;
const GHSA_RE = /^GHSA-[A-Z0-9-]+$/;
const CWE_RE = /^CWE-[0-9]+$/;
const SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});
const CATALOG_COMPONENTS = RETIRE_BROWSER_CATALOG.components as UnknownRecord;
const KNOWN_EXPLOITED_IDENTIFIERS = new Set<string>(CISA_KEV_CATALOG.identifiers);

const INLINE_EXTRACTOR_CATALOGUE = Object.freeze(Object.entries(CATALOG_COMPONENTS).map(([component, value]) => {
  const extractors = record((record(value) as CatalogComponent).extractors);
  return Object.freeze({
    component,
    patterns: Object.freeze((Array.isArray(extractors.filecontent) ? extractors.filecontent : [])
      .filter((pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0 && pattern.length <= 2_048)
      .slice(0, 64)),
    replacements: Object.freeze((Array.isArray(extractors.filecontentreplace) ? extractors.filecontentreplace : [])
      .filter((pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0 && pattern.length <= 2_048)
      .slice(0, 64)),
  });
}));

const INLINE_REGEX_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const versions = /^[0-9][0-9.a-z_-]{0,63}$/i;
parentPort.on('message', (job) => {
  const control = new Int32Array(job.control);
  const output = new Uint8Array(job.output);
  const matches = [];
  const add = (component, version) => {
    const normalized = String(version).replace(/(?:\.|-)?min$/i, '').slice(0, 64);
    if (versions.test(normalized) && matches.length < 64) matches.push([component, normalized]);
  };
  try {
    for (const entry of workerData.catalogue) {
      for (const pattern of entry.patterns) {
        let expression;
        try { expression = new RegExp(pattern, 'g'); } catch { continue; }
        let match;
        let count = 0;
        while ((match = expression.exec(job.value)) && count < 4) {
          if (typeof match[1] === 'string') add(entry.component, match[1]);
          if (match[0] === '') expression.lastIndex += 1;
          count += 1;
        }
      }
      for (const descriptorValue of entry.replacements) {
        const descriptor = /^\/(.*[^\\])\/([^/]+)\/$/.exec(descriptorValue);
        if (!descriptor || !descriptor[1]) continue;
        let expression;
        try { expression = new RegExp(descriptor[1], 'g'); } catch { continue; }
        let match;
        let count = 0;
        while ((match = expression.exec(job.value)) && count < 4) {
          let replaced = match[0];
          try { replaced = match[0].replace(new RegExp(descriptor[1]), descriptor[2]); } catch { break; }
          add(entry.component, replaced);
          if (match[0] === '') expression.lastIndex += 1;
          count += 1;
        }
      }
    }
    const encoded = Buffer.from(JSON.stringify(matches));
    if (encoded.length > output.length) Atomics.store(control, 0, -2);
    else { output.set(encoded); Atomics.store(control, 0, encoded.length); }
  } catch {
    Atomics.store(control, 0, -1);
  }
  Atomics.notify(control, 0);
});
`;

let inlineRegexWorker: Worker | null = null;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function boundedStringArray(value: unknown, limit: number, pattern: RegExp): string[] {
  const output: string[] = [];
  for (const item of (Array.isArray(value) ? value : []).slice(0, limit)) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 80 || !pattern.test(item)) continue;
    output.push(item);
  }
  return output;
}

function comparableVersionPart(value: string | undefined): number | string {
  if (value === undefined) return 0;
  return /^[0-9]+$/.test(value) ? Number.parseInt(value, 10) : value;
}

// Retire.js uses a deliberately small dotted/dashed version comparator rather
// than a package-manager-specific semantic-version parser. Keeping the same
// comparison contract makes the pinned catalogue thresholds deterministic.
function isAtOrAbove(left: string, right: string): boolean {
  const leftParts = left.split(/[.-]/g);
  const rightParts = right.split(/[.-]/g);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = comparableVersionPart(leftParts[index]);
    const rightPart = comparableVersionPart(rightParts[index]);
    if (typeof leftPart !== typeof rightPart) return typeof leftPart === 'number';
    if (leftPart > rightPart) return true;
    if (leftPart < rightPart) return false;
  }
  return true;
}

function matchingVulnerabilities(component: CatalogComponent, version: string): CatalogVulnerability[] {
  const vulnerabilities = Array.isArray(component.vulnerabilities) ? component.vulnerabilities : [];
  const matched: CatalogVulnerability[] = [];
  for (const rawVulnerability of vulnerabilities) {
    const vulnerability = record(rawVulnerability) as CatalogVulnerability;
    if (typeof vulnerability.below !== 'string' || !VERSION_RE.test(vulnerability.below)) continue;
    if (isAtOrAbove(version, vulnerability.below)) continue;
    if (
      typeof vulnerability.atOrAbove === 'string'
      && VERSION_RE.test(vulnerability.atOrAbove)
      && !isAtOrAbove(version, vulnerability.atOrAbove)
    ) continue;
    if (Array.isArray(vulnerability.excludes) && vulnerability.excludes.includes(version)) continue;
    matched.push(vulnerability);
  }
  return matched;
}

function matchPattern(pattern: unknown, value: string): string[] {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 2_048) return [];
  let expression: RegExp;
  try {
    expression = new RegExp(pattern, 'g');
  } catch {
    return [];
  }
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(value)) && matches.length < MAX_MATCHES_PER_PATTERN) {
    if (typeof match[1] === 'string' && VERSION_RE.test(match[1])) matches.push(match[1]);
    if (match[0] === '') expression.lastIndex += 1;
  }
  return matches;
}

function addDetected(
  detected: Map<string, DetectedComponent>,
  component: string,
  version: string,
  method: DetectionMethod,
): void {
  const normalizedVersion = version.replace(/(?:\.|-)?min$/i, '').slice(0, MAX_VERSION_LENGTH);
  if (!COMPONENT_RE.test(component) || !VERSION_RE.test(normalizedVersion)) return;
  const key = `${component}\u0000${normalizedVersion}`;
  const existing = detected.get(key);
  if (existing) {
    existing.detections.add(method);
    return;
  }
  if (detected.size >= MAX_LIBRARY_FINDINGS * 4) return;
  detected.set(key, { component, version: normalizedVersion, detections: new Set([method]) });
}

function scanExtractor(
  detected: Map<string, DetectedComponent>,
  extractorName: 'uri' | 'filename',
  value: string,
  method: DetectionMethod,
): void {
  for (const [componentName, rawComponent] of Object.entries(CATALOG_COMPONENTS)) {
    const component = record(rawComponent) as CatalogComponent;
    const extractors = record(component.extractors);
    const patterns = Array.isArray(extractors[extractorName]) ? extractors[extractorName] : [];
    for (const pattern of patterns.slice(0, 64)) {
      for (const version of matchPattern(pattern, value)) addDetected(detected, componentName, version, method);
    }
  }
}

function scanFilename(
  detected: Map<string, DetectedComponent>,
  reference: string,
): void {
  const filename = (reference.replace(/\\/g, '/').split('/').pop() || '').split(/[?#]/, 1)[0];
  if (!filename) return;
  for (const [componentName, rawComponent] of Object.entries(CATALOG_COMPONENTS)) {
    const component = record(rawComponent) as CatalogComponent;
    const extractors = record(component.extractors);
    const patterns = Array.isArray(extractors.filename) ? extractors.filename : [];
    for (const pattern of patterns.slice(0, 64)) {
      if (typeof pattern !== 'string' || pattern.length > 2_048) continue;
      for (const version of matchPattern(`^(?:${pattern})$`, filename)) {
        addDetected(detected, componentName, version, 'script filename');
      }
    }
  }
}

function scanInlineSignatures(
  detected: Map<string, DetectedComponent>,
  value: string,
): Readonly<{ timedOut: boolean; unavailable: boolean }> {
  if (!value) return { timedOut: false, unavailable: false };
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const outputBuffer = new SharedArrayBuffer(MAX_INLINE_LIBRARY_WORKER_BYTES);
  const control = new Int32Array(controlBuffer);
  try {
    if (!inlineRegexWorker) {
      const createdWorker = new Worker(INLINE_REGEX_WORKER_SOURCE, {
        eval: true,
        workerData: { catalogue: INLINE_EXTRACTOR_CATALOGUE },
      });
      inlineRegexWorker = createdWorker;
      createdWorker.unref();
      createdWorker.once('exit', () => {
        if (inlineRegexWorker === createdWorker) inlineRegexWorker = null;
      });
      createdWorker.once('error', () => {
        if (inlineRegexWorker === createdWorker) inlineRegexWorker = null;
      });
    }
    inlineRegexWorker.postMessage({ value, control: controlBuffer, output: outputBuffer });
  } catch {
    void inlineRegexWorker?.terminate().catch(() => {});
    inlineRegexWorker = null;
    return { timedOut: false, unavailable: true };
  }

  const wait = Atomics.wait(control, 0, 0, MAX_INLINE_LIBRARY_SCAN_MS);
  const length = Atomics.load(control, 0);
  if (wait === 'timed-out') {
    void inlineRegexWorker?.terminate().catch(() => {});
    inlineRegexWorker = null;
    return { timedOut: true, unavailable: false };
  }
  if (length < 1 || length > MAX_INLINE_LIBRARY_WORKER_BYTES) {
    return { timedOut: false, unavailable: true };
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(
      new Uint8Array(outputBuffer, 0, length),
    ).toString('utf8'));
    if (!Array.isArray(parsed)) return { timedOut: false, unavailable: true };
    for (const item of parsed.slice(0, MAX_LIBRARY_FINDINGS * 4)) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const [component, version] = item;
      if (typeof component === 'string' && typeof version === 'string') {
        addDetected(detected, component, version, 'inline signature');
      }
    }
    return { timedOut: false, unavailable: false };
  } catch {
    return { timedOut: false, unavailable: true };
  }
}

function scanInlineContent(
  detected: Map<string, DetectedComponent>,
  content: string,
  maximumSignatureCharacters: number,
): Readonly<{
  charactersExamined: number;
  truncated: boolean;
  signatureContent: string;
}> {
  const normalized = content.replace(/\r\n?|\n/g, '\n');
  const digest = createHash('sha1').update(normalized).digest('hex');
  const retainedCharacters = Math.max(0, Math.min(
    MAX_INLINE_LIBRARY_SCAN_CHARS,
    maximumSignatureCharacters,
    normalized.length,
  ));
  const headCharacters = Math.ceil(retainedCharacters / 2);
  const tailCharacters = retainedCharacters - headCharacters;
  const signatureContent = retainedCharacters === 0
    ? ''
    : normalized.length <= retainedCharacters
      ? normalized
      : `${normalized.slice(0, headCharacters)}${tailCharacters ? normalized.slice(-tailCharacters) : ''}`;
  for (const [componentName, rawComponent] of Object.entries(CATALOG_COMPONENTS)) {
    const extractors = record((record(rawComponent) as CatalogComponent).extractors);
    const hashes = record(extractors.hashes);
    const version = hashes[digest];
    if (typeof version === 'string') addDetected(detected, componentName, version, 'inline hash');
  }
  return {
    charactersExamined: retainedCharacters,
    truncated: retainedCharacters < normalized.length,
    signatureContent,
  };
}

function severity(value: unknown): Severity | null {
  return typeof value === 'string' && Object.hasOwn(SEVERITY_WEIGHT, value)
    ? value as Severity
    : null;
}

function findingFromDetection(detected: DetectedComponent): BrowserLibraryFinding {
  const component = record(CATALOG_COMPONENTS[detected.component]) as CatalogComponent;
  const vulnerabilities = matchingVulnerabilities(component, detected.version);
  let highestSeverity: Severity | null = null;
  const identifiers = new Set<string>();
  const weaknesses = new Set<string>();

  for (const vulnerability of vulnerabilities) {
    const candidateSeverity = severity(vulnerability.severity);
    if (
      candidateSeverity
      && (!highestSeverity || SEVERITY_WEIGHT[candidateSeverity] > SEVERITY_WEIGHT[highestSeverity])
    ) highestSeverity = candidateSeverity;

    const vulnerabilityIdentifiers = record(vulnerability.identifiers);
    for (const cve of boundedStringArray(vulnerabilityIdentifiers.CVE, 16, CVE_RE)) {
      if (identifiers.size < MAX_ADVISORY_IDENTIFIERS) identifiers.add(cve);
    }
    if (
      typeof vulnerabilityIdentifiers.githubID === 'string'
      && GHSA_RE.test(vulnerabilityIdentifiers.githubID)
      && identifiers.size < MAX_ADVISORY_IDENTIFIERS
    ) identifiers.add(vulnerabilityIdentifiers.githubID.toUpperCase());
    for (const cwe of boundedStringArray(vulnerability.cwe, 16, CWE_RE)) {
      if (weaknesses.size < MAX_WEAKNESS_CLASSES) weaknesses.add(cwe);
    }
  }

  const advisoryIdentifiers = [...identifiers].sort();
  const knownExploitedIdentifiers = advisoryIdentifiers.filter((identifier) => KNOWN_EXPLOITED_IDENTIFIERS.has(identifier));
  return {
    id: detected.component,
    name: detected.component,
    apparentVersion: detected.version,
    detectionMethods: [...detected.detections].sort(),
    advisoryCount: vulnerabilities.length,
    highestSeverity,
    advisoryIdentifiers,
    knownExploitedCount: knownExploitedIdentifiers.length,
    knownExploitedIdentifiers,
    weaknessClasses: [...weaknesses].sort(),
  };
}

function analyzeBrowserLibraries(input: BrowserLibraryProfileInput = {}) {
  const htmlAnalysis = input.htmlAnalysis ?? analyzeStaticHtml(input.html);
  const detected = new Map<string, DetectedComponent>();
  let referencesExamined = 0;
  let inlineScriptsExamined = 0;
  let inlineSignatureCharactersExamined = 0;
  let inlineSignatureLimitReached = false;
  const inlineSignatureSamples: string[] = [];

  for (const script of htmlAnalysis.scripts) {
    if (script.reference) {
      referencesExamined += 1;
      scanExtractor(detected, 'uri', script.reference, 'script URL');
      scanFilename(detected, script.reference);
    } else if (script.inlineContent && script.mediaType !== 'application/ld+json') {
      inlineScriptsExamined += 1;
      const remaining = Math.max(0, MAX_INLINE_LIBRARY_SCAN_TOTAL_CHARS - inlineSignatureCharactersExamined);
      const signatureScan = scanInlineContent(detected, script.inlineContent, remaining);
      inlineSignatureCharactersExamined += signatureScan.charactersExamined;
      inlineSignatureLimitReached ||= signatureScan.truncated;
      if (signatureScan.signatureContent) inlineSignatureSamples.push(signatureScan.signatureContent);
    }
  }
  const inlineSignatureResult = scanInlineSignatures(detected, inlineSignatureSamples.join('\u0000'));
  const inlineSignatureUnavailable = inlineSignatureResult.timedOut || inlineSignatureResult.unavailable;

  const allFindings = [...detected.values()]
    .map(findingFromDetection)
    .sort((left, right) => (
      (right.highestSeverity ? SEVERITY_WEIGHT[right.highestSeverity] : -1)
      - (left.highestSeverity ? SEVERITY_WEIGHT[left.highestSeverity] : -1)
      || right.advisoryCount - left.advisoryCount
      || left.name.localeCompare(right.name)
      || left.apparentVersion.localeCompare(right.apparentVersion)
    ));
  const findingLimitReached = allFindings.length > MAX_LIBRARY_FINDINGS;
  const truncated = input.sourceTruncated === true
    || htmlAnalysis.inputLimitReached
    || htmlAnalysis.tagLimitReached
    || htmlAnalysis.scriptLimitReached
    || htmlAnalysis.inlineLimitReached
    || inlineSignatureLimitReached
    || inlineSignatureUnavailable
    || findingLimitReached;
  const limitations = [
    'Library versions are inferred from passive static signatures and may be absent, transformed, or misleading.',
    'A catalogue advisory match identifies a component version associated with a published advisory; it does not establish reachability or exploitability.',
    'A CISA KEV match means that the advisory identifier appears in the pinned known-exploited catalogue; it does not establish that the detected page exposes or executes the affected code path.',
    'Referenced scripts are not fetched, executed, or retained, and unmatched scripts are not evidence that no library is present.',
  ];
  if (input.sourceTruncated === true) limitations.push('The captured homepage body was truncated, so script evidence may be incomplete.');
  if (htmlAnalysis.inputLimitReached) limitations.push(`Only the first ${MAX_LIBRARY_HTML_CHARS} HTML characters were evaluated.`);
  if (htmlAnalysis.tagLimitReached) limitations.push('Static HTML tokenization reached its tag or attribute boundary.');
  if (htmlAnalysis.scriptLimitReached) limitations.push(`Only the first ${MAX_SCRIPT_ELEMENTS} script elements were evaluated.`);
  if (htmlAnalysis.inlineLimitReached) limitations.push(`Inline script evaluation reached its ${MAX_INLINE_SCRIPT_TOTAL_CHARS}-character cumulative boundary.`);
  if (inlineSignatureLimitReached) limitations.push(`Passive library signature matching evaluated a deterministic ${MAX_INLINE_LIBRARY_SCAN_TOTAL_CHARS}-character cumulative sample across inline scripts; full-content hashes still used the complete bounded script content.`);
  if (inlineSignatureResult.timedOut) limitations.push(`Passive library signature matching exceeded its ${MAX_INLINE_LIBRARY_SCAN_MS} ms isolated-worker deadline; hash evidence was still evaluated.`);
  if (inlineSignatureResult.unavailable) limitations.push('Passive library signature matching was unavailable in its isolated worker; hash evidence was still evaluated.');
  if (findingLimitReached) limitations.push(`Only the first ${MAX_LIBRARY_FINDINGS} library findings were retained.`);

  return {
    profileVersion: BROWSER_LIBRARY_PROFILE_VERSION,
    catalog: {
      name: 'Retire.js',
      version: RETIRE_BROWSER_CATALOG.catalogVersion,
      sourceRevision: RETIRE_BROWSER_CATALOG.sourceRevision,
    },
    knownExploitedCatalog: {
      name: 'CISA KEV',
      version: CISA_KEV_CATALOG.catalogVersion,
      releasedAt: CISA_KEV_CATALOG.releasedAt,
    },
    ...createObservation({
      status: truncated ? 'partial' : 'success',
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'derived',
      complete: !truncated,
      truncated,
      limitations,
      diagnostics: {
        scriptsExamined: htmlAnalysis.scripts.length,
        referencesExamined,
        inlineScriptsExamined,
        inlineCharactersExamined: htmlAnalysis.inlineCharactersExamined,
        inlineSignatureCharactersExamined,
        inlineSignatureTimedOut: inlineSignatureResult.timedOut,
        inlineSignatureUnavailable: inlineSignatureResult.unavailable,
        catalogComponents: Object.keys(CATALOG_COMPONENTS).length,
        findings: allFindings.length,
        advisoryMatches: allFindings.reduce((sum, finding) => sum + finding.advisoryCount, 0),
        knownExploitedMatches: allFindings.reduce((sum, finding) => sum + finding.knownExploitedCount, 0),
      },
    }),
    findings: allFindings.slice(0, MAX_LIBRARY_FINDINGS),
  };
}

export {
  BROWSER_LIBRARY_PROFILE_VERSION,
  MAX_INLINE_SCRIPT_CHARS,
  MAX_INLINE_SCRIPT_TOTAL_CHARS,
  MAX_INLINE_LIBRARY_SCAN_CHARS,
  MAX_INLINE_LIBRARY_SCAN_TOTAL_CHARS,
  MAX_LIBRARY_FINDINGS,
  MAX_LIBRARY_HTML_CHARS,
  MAX_SCRIPT_ELEMENTS,
  analyzeBrowserLibraries,
};

export type {
  BrowserLibraryFinding,
  BrowserLibraryProfileInput,
  DetectionMethod,
  Severity,
};
