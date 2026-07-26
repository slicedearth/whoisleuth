// Passive browser-library identification over the capped HTML body already
// collected by an eligible deep lookup. The matcher uses a pinned, reviewed
// projection of Retire.js's browser catalogue and never fetches referenced
// scripts. Upstream URLs, filenames, inline bodies, and catalogue expressions
// are treated as untrusted inputs and are not retained in the result.

import { createHash } from 'node:crypto';

import { parse } from 'parse5';

import { RETIRE_BROWSER_CATALOG } from './generated/retire-browser-catalog.mts';
import { createObservation } from './observation.mts';

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
  weaknessClasses: string[];
};
type BrowserLibraryProfileInput = {
  html?: unknown;
  observedAt?: unknown;
  sourceTruncated?: unknown;
};
type ParsedAttribute = { name?: unknown; value?: unknown };
type ParsedNode = {
  nodeName?: unknown;
  tagName?: unknown;
  value?: unknown;
  attrs?: ParsedAttribute[];
  childNodes?: ParsedNode[];
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

const BROWSER_LIBRARY_PROFILE_VERSION = 1;
const MAX_LIBRARY_HTML_CHARS = 300_000;
const MAX_LIBRARY_NODES = 8_192;
const MAX_SCRIPT_ELEMENTS = 64;
const MAX_SCRIPT_REFERENCE_LENGTH = 2_048;
const MAX_INLINE_SCRIPT_CHARS = 32_768;
const MAX_INLINE_SCRIPT_TOTAL_CHARS = 65_536;
const MAX_LIBRARY_FINDINGS = 16;
const MAX_ADVISORIES_PER_FINDING = 16;
const MAX_ADVISORY_IDENTIFIERS = 16;
const MAX_WEAKNESS_CLASSES = 12;
const MAX_MATCHES_PER_PATTERN = 4;
const MAX_VERSION_LENGTH = 64;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
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
  for (const rawVulnerability of vulnerabilities.slice(0, MAX_ADVISORIES_PER_FINDING * 4)) {
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
    if (matched.length >= MAX_ADVISORIES_PER_FINDING) break;
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

function matchReplacementPattern(pattern: unknown, value: string): string[] {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 2_048) return [];
  const descriptor = /^\/(.*[^\\])\/([^/]+)\/$/.exec(pattern);
  if (!descriptor) return [];
  let expression: RegExp;
  try {
    expression = new RegExp(descriptor[1], 'g');
  } catch {
    return [];
  }
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(value)) && matches.length < MAX_MATCHES_PER_PATTERN) {
    const replaced = match[0].replace(new RegExp(descriptor[1]), descriptor[2]).replace(/(?:\.|-)?min$/i, '');
    if (VERSION_RE.test(replaced)) matches.push(replaced);
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
  extractorName: 'uri' | 'filename' | 'filecontent',
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

function scanInlineContent(
  detected: Map<string, DetectedComponent>,
  content: string,
): void {
  const normalized = content.replace(/\r\n?|\n/g, '\n');
  scanExtractor(detected, 'filecontent', normalized, 'inline signature');

  for (const [componentName, rawComponent] of Object.entries(CATALOG_COMPONENTS)) {
    const component = record(rawComponent) as CatalogComponent;
    const extractors = record(component.extractors);
    const replacementPatterns = Array.isArray(extractors.filecontentreplace) ? extractors.filecontentreplace : [];
    for (const pattern of replacementPatterns.slice(0, 64)) {
      for (const version of matchReplacementPattern(pattern, normalized)) {
        addDetected(detected, componentName, version, 'inline signature');
      }
    }

    const hashes = record(extractors.hashes);
    const version = hashes[createHash('sha1').update(normalized).digest('hex')];
    if (typeof version === 'string') addDetected(detected, componentName, version, 'inline hash');
  }
}

function scriptReference(node: ParsedNode): string | null {
  for (const attribute of (Array.isArray(node.attrs) ? node.attrs : []).slice(0, 128)) {
    if (typeof attribute.name !== 'string' || attribute.name.toLowerCase() !== 'src') continue;
    if (
      typeof attribute.value !== 'string'
      || attribute.value.length === 0
      || attribute.value.length > MAX_SCRIPT_REFERENCE_LENGTH
      || CONTROL_CHARACTER_RE.test(attribute.value)
    ) return null;
    return attribute.value;
  }
  return null;
}

function inlineScript(node: ParsedNode): { content: string; truncated: boolean } {
  let content = '';
  let truncated = false;
  for (const child of (Array.isArray(node.childNodes) ? node.childNodes : []).slice(0, 64)) {
    if (child.nodeName !== '#text' || typeof child.value !== 'string') continue;
    const remaining = MAX_INLINE_SCRIPT_CHARS - content.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    content += child.value.slice(0, remaining);
    if (child.value.length > remaining) truncated = true;
  }
  return { content, truncated };
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

  return {
    id: detected.component,
    name: detected.component,
    apparentVersion: detected.version,
    detectionMethods: [...detected.detections].sort(),
    advisoryCount: vulnerabilities.length,
    highestSeverity,
    advisoryIdentifiers: [...identifiers].sort(),
    weaknessClasses: [...weaknesses].sort(),
  };
}

function analyzeBrowserLibraries(input: BrowserLibraryProfileInput = {}) {
  const supplied = typeof input.html === 'string' ? input.html : '';
  const htmlLimitReached = supplied.length > MAX_LIBRARY_HTML_CHARS;
  const document = parse(supplied.slice(0, MAX_LIBRARY_HTML_CHARS)) as ParsedNode;
  const pending: ParsedNode[] = [document];
  const detected = new Map<string, DetectedComponent>();
  let nodesExamined = 0;
  let scriptsExamined = 0;
  let referencesExamined = 0;
  let inlineScriptsExamined = 0;
  let inlineCharactersExamined = 0;
  let traversalLimitReached = false;
  let scriptLimitReached = false;
  let inlineLimitReached = false;

  while (pending.length) {
    const node = pending.pop() as ParsedNode;
    nodesExamined += 1;
    if (nodesExamined > MAX_LIBRARY_NODES) {
      traversalLimitReached = true;
      break;
    }

    if (typeof node.tagName === 'string' && node.tagName.toLowerCase() === 'script') {
      if (scriptsExamined >= MAX_SCRIPT_ELEMENTS) {
        scriptLimitReached = true;
        continue;
      }
      scriptsExamined += 1;
      const reference = scriptReference(node);
      if (reference) {
        referencesExamined += 1;
        scanExtractor(detected, 'uri', reference, 'script URL');
        scanFilename(detected, reference);
      } else {
        const inline = inlineScript(node);
        if (inline.truncated) inlineLimitReached = true;
        const remaining = MAX_INLINE_SCRIPT_TOTAL_CHARS - inlineCharactersExamined;
        if (remaining <= 0) {
          inlineLimitReached = true;
        } else if (inline.content) {
          const retained = inline.content.slice(0, remaining);
          if (retained.length < inline.content.length) inlineLimitReached = true;
          inlineCharactersExamined += retained.length;
          inlineScriptsExamined += 1;
          scanInlineContent(detected, retained);
        }
      }
    }

    const children = Array.isArray(node.childNodes) ? node.childNodes : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (pending.length + nodesExamined >= MAX_LIBRARY_NODES) {
        traversalLimitReached = true;
        break;
      }
      pending.push(children[index] as ParsedNode);
    }
  }

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
    || htmlLimitReached
    || traversalLimitReached
    || scriptLimitReached
    || inlineLimitReached
    || findingLimitReached;
  const limitations = [
    'Library versions are inferred from passive static signatures and may be absent, transformed, or misleading.',
    'A catalogue advisory match identifies a component version associated with a published advisory; it does not establish reachability or exploitability.',
    'Referenced scripts are not fetched, executed, or retained, and unmatched scripts are not evidence that no library is present.',
  ];
  if (input.sourceTruncated === true) limitations.push('The captured homepage body was truncated, so script evidence may be incomplete.');
  if (htmlLimitReached) limitations.push(`Only the first ${MAX_LIBRARY_HTML_CHARS} HTML characters were evaluated.`);
  if (traversalLimitReached) limitations.push(`HTML traversal reached the ${MAX_LIBRARY_NODES}-node boundary.`);
  if (scriptLimitReached) limitations.push(`Only the first ${MAX_SCRIPT_ELEMENTS} script elements were evaluated.`);
  if (inlineLimitReached) limitations.push(`Inline script evaluation reached its ${MAX_INLINE_SCRIPT_TOTAL_CHARS}-character cumulative boundary.`);
  if (findingLimitReached) limitations.push(`Only the first ${MAX_LIBRARY_FINDINGS} library findings were retained.`);

  return {
    profileVersion: BROWSER_LIBRARY_PROFILE_VERSION,
    catalog: {
      name: 'Retire.js',
      version: RETIRE_BROWSER_CATALOG.catalogVersion,
      sourceRevision: RETIRE_BROWSER_CATALOG.sourceRevision,
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
        scriptsExamined,
        referencesExamined,
        inlineScriptsExamined,
        inlineCharactersExamined,
        catalogComponents: Object.keys(CATALOG_COMPONENTS).length,
        findings: allFindings.length,
        advisoryMatches: allFindings.reduce((sum, finding) => sum + finding.advisoryCount, 0),
      },
    }),
    findings: allFindings.slice(0, MAX_LIBRARY_FINDINGS),
  };
}

export {
  BROWSER_LIBRARY_PROFILE_VERSION,
  MAX_INLINE_SCRIPT_CHARS,
  MAX_INLINE_SCRIPT_TOTAL_CHARS,
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
