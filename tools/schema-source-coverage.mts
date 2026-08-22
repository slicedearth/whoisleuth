import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { SCHEMA_SOURCE_CLASSIFICATIONS } from '../fixtures/schema-source-classifications.mts';
import { decodeBoundedUtf8, readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import {
  LOCAL_SCHEMA_IDENTIFIER_SOURCE,
  isCanonicalLocalSchemaIdentifier,
  type SchemaCompatibilityEntry,
} from '../packages/contracts/schema-compatibility.mts';
import { compareCodeUnits as ordinalCompare } from './maintainer-tool-helpers.mts';

export const MAX_SCHEMA_SOURCE_FILES = 1_024;
export const MAX_SCHEMA_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SCHEMA_SOURCE_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_SCHEMA_SOURCE_IDENTIFIERS = 512;
export const MAX_SCHEMA_SOURCE_OCCURRENCES = 10_000;
export const MAX_SCHEMA_SOURCE_BINDINGS = 10_000;
export const MAX_SCHEMA_SOURCE_REFERENCES = 100_000;
export const MAX_SCHEMA_SOURCE_DIRECTORIES = 1_024;
export const MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES = 4_096;
export const MAX_SCHEMA_SOURCE_DIRECTORY_DEPTH = 32;
export const MAX_SCHEMA_SOURCE_AST_NODES = 250_000;
export const MAX_SCHEMA_SOURCE_AST_DEPTH = 256;
export const MAX_SCHEMA_SOURCE_CANDIDATE_BYTES = 4 * 1024;
export const MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS = 4_096;
export const MAX_SCHEMA_SOURCE_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_SCHEMA_SOURCE_JSON_DEPTH = 48;
export const MAX_SCHEMA_SOURCE_JSON_VALUES = 100_000;
export const MAX_SCHEMA_SOURCE_JSON_CONTAINER_ITEMS = 10_000;
export const SCHEMA_SOURCE_ROOTS = Object.freeze([
  'bin',
  'cli',
  'frontend/src',
  'lib',
  'netlify/functions',
  'packages',
  'tools',
] as const);
export const SCHEMA_SOURCE_ROOT_FILES = Object.freeze(['server.mts'] as const);
export const SCHEMA_SOURCE_NON_SOURCE_FILES = Object.freeze([
  'frontend/src/app.css',
  'frontend/src/app.html',
  'lib/generated/cisa-kev-catalog.sha256',
  'lib/generated/retire-browser-catalog.sha256',
  'packages/cli/README.md',
  'packages/web-capture/README.md',
] as const);
const DEFAULT_SCHEMA_SOURCE_REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

const SCHEMA_SOURCE_EXEMPT_ROOTS = new Set(['.git', '.github', 'LICENSES', 'docs', 'e2e', 'fixtures', 'frontend/static', 'playwright', 'test']);
const SCHEMA_SOURCE_EXEMPT_FILES = new Set([
  '.dependency-cruiser.json',
  '.gitattributes',
  '.gitignore',
  '.nvmrc',
  'DISCLOSURE',
  'LICENSE',
  'NOTICE',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'TRADEMARKS.md',
  'frontend/analysis-tsconfig.json',
  'frontend/package.json',
  'frontend/svelte.config.ts',
  'frontend/tsconfig.json',
  'frontend/vite.config.ts',
  'netlify.toml',
  'package-lock.json',
  'package.json',
  'playwright.config.ts',
  'tsconfig.dependency-cruiser.json',
  'tsconfig.json',
]);
const SCHEMA_SOURCE_IGNORED_DIRECTORY_NAMES = new Set([
  'build',
  'coverage',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.json', '.jsx', '.mjs', '.mts', '.svelte', '.ts', '.tsx']);
const SCHEMA_SOURCE_NON_SOURCE_FILE_SET = new Set<string>(SCHEMA_SOURCE_NON_SOURCE_FILES);
const SCHEMA_METADATA_FILES = new Set([
  'lib/interchange-fidelity-registry.mts',
  'packages/contracts/case-portability.mts',
  'packages/contracts/external-observation-interchange.mts',
  'packages/contracts/investigation-portability.mts',
  'packages/contracts/offline-comparison.mts',
  'packages/contracts/schema-compatibility.mts',
  'packages/contracts/schema-lifecycle.mts',
  'packages/contracts/workspace-portability.mts',
  'tools/schema-compatibility.mts',
  'tools/schema-source-coverage.mts',
]);
const TOKEN_PATTERN = new RegExp(`(?<![a-z0-9._:-])${LOCAL_SCHEMA_IDENTIFIER_SOURCE}(?![a-z0-9._:-])`, 'gu');
const CASE_INSENSITIVE_TOKEN_PATTERN = new RegExp(`(?<![a-z0-9._:-])${LOCAL_SCHEMA_IDENTIFIER_SOURCE}(?![a-z0-9._:-])`, 'giu');
const DEFINITION_NAME_PATTERN = /(?:^|_)SCHEMA$/u;
const CLASSIFICATION_KINDS = new Set(['exempt', 'member', 'non_schema']);
const CLASSIFICATION_REASONS = new Set([
  'identifier_only',
  'legacy_unsupported',
  'non_schema_filename',
  'packaged_executable_filename',
  'provenance_marker',
  'public_site_hostname',
  'repository_filename',
  'reserved_local_uid_host',
  'reserved_protocol_hostname',
  'serialised_unversioned',
  'source_entry_filename',
  'transient_projection',
]);
const CLASSIFICATION_REASONS_BY_KIND = Object.freeze({
  exempt: new Set(['identifier_only', 'legacy_unsupported', 'serialised_unversioned', 'transient_projection']),
  member: new Set(['provenance_marker']),
  non_schema: new Set([
    'non_schema_filename',
    'packaged_executable_filename',
    'public_site_hostname',
    'repository_filename',
    'reserved_local_uid_host',
    'reserved_protocol_hostname',
    'source_entry_filename',
  ]),
} as const);
const MAX_SCHEMA_CLASSIFICATION_PATH_LENGTH = 240;
const MAX_SCHEMA_CLASSIFICATION_RELATED_ENTRIES = 8;
const MAX_SCHEMA_CLASSIFICATION_NOTE_LENGTH = 240;
const MAX_SCHEMA_CLASSIFICATION_SOURCE_USES = 16;

const SCHEMA_INLINE_EMITTER_ALLOWLIST = Object.freeze([
  ['whoisleuth.common-infrastructure', 'packages/relationships/common-infrastructure-snapshot.json', [1]],
  ['whoisleuth.common-infrastructure', 'packages/relationships/common-infrastructure.mts', [224]],
  ['whoisleuth.external-findings', 'cli/ct-event-intake.mts', [174]],
  ['whoisleuth.external-findings', 'cli/external-observation-mapping.mts', [148]],
  ['whoisleuth.lookup-evidence', 'frontend/src/lib/analysis/case-evidence-checkpoint.ts', [236]],
  ['whoisleuth.registry-standards-coverage', 'lib/registry-capability-catalogue.mts', [85]],
  ['whoisleuth.shortlist', 'frontend/src/lib/browser-local-data-definitions.ts', [247, 252]],
  ['whoisleuth.sslbl-certificate-snapshot', 'lib/sslbl-certificates.generated.mts', [5]],
  ['whoisleuth.watchlists', 'frontend/src/lib/browser-local-data-definitions.ts', [237]],
] as const);

const SCHEMA_DYNAMIC_EMITTER_ALLOWLIST = Object.freeze([
  ['cli/artifact-structure.mts', 'schema', 'reader', [2535]],
  ['cli/artifact-verify.mts', 'schema', 'writer', [370, 514, 548, 578]],
  ['cli/formatters/json.mts', 'schema', 'writer', [119]],
  ['cli/investigation-manifest.mts', 'schema', 'writer', [82]],
  ['cli/sharing-review.mts', 'artifactSchema', 'writer', [229]],
  ['packages/investigation/investigation-capsule.mts', 'evidenceSchema', 'writer', [168]],
] as const);

const SCHEMA_DYNAMIC_USE_ALLOWLIST = Object.freeze([
  ['frontend/src/lib/browser-local-data-definitions.ts', 173, 'reader', 'Compares an optional legacy-store marker selected by the static collection definition.'],
  ['packages/contracts/analyst-interchange.mts', 37, 'writer', 'Registers the reviewed external CACAO profile identity without changing its public spec marker.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 66, 'writer', 'Projects a statically registered lifecycle migration target.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 77, 'writer', 'Projects a statically registered fixture lifecycle identity.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 102, 'writer', 'Projects a statically registered lifecycle contract identity.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 111, 'reader', 'Matches an immutable fixture to its statically registered lifecycle contract.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 119, 'writer', 'Projects a statically registered lifecycle shape identity.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 194, 'writer', 'Projects a statically registered readable lifecycle identity.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 201, 'writer', 'Projects a statically registered emitted lifecycle identity.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 225, 'writer', 'Projects a statically registered serialisation profile identity.'],
  ['packages/contracts/privacy-data-flow-catalogue.mts', 648, 'writer', 'Projects a compatibility descriptor identity already validated by the canonical lifecycle registry.'],
  ['packages/contracts/privacy-data-flow-catalogue.mts', 688, 'writer', 'Projects a consumer contract identity already validated by the canonical lifecycle registry.'],
  ['packages/contracts/privacy-data-flow-catalogue.mts', 990, 'writer', 'Copies a bounded registered lifecycle identity into the detached catalogue.'],
  ['packages/contracts/privacy-data-flow-catalogue.mts', 1047, 'writer', 'Copies a bounded accepted-contract identity into the detached catalogue.'],
  ['packages/contracts/privacy-data-flow-catalogue.mts', 1058, 'writer', 'Copies a bounded emitted-contract identity into the detached catalogue.'],
  ['cli/archive-inspect.mts', 135, 'writer', 'Copies a validated archive section marker into the content identity.'],
  ['cli/archive-inspect.mts', 272, 'writer', 'Copies a validated archive section marker into the inspection report.'],
  ['cli/artifact-verify.mts', 438, 'writer', 'Reports the marker already validated from an encrypted workspace envelope.'],
  ['cli/artifact-verify.mts', 608, 'writer', 'Projects a bounded marker from the verified artifact metadata.'],
  ['cli/artifact-verify.mts', 645, 'reader', 'Compares two bounded artifact markers during manifest verification.'],
  ['cli/artifact-verify.mts', 645, 'writer', 'Reports the result of the bounded artifact-marker comparison.'],
  ['cli/evidence-signing.mts', 288, 'writer', 'Copies the verified source artifact marker into signature metadata.'],
  ['cli/export-evidence.mts', 47, 'reader', 'Checks a builder result against its injected canonical contract marker.'],
  ['cli/interchange-report.mts', 92, 'reader', 'Matches a bounded container marker to a reviewed interchange contract.'],
  ['cli/interchange-report.mts', 231, 'writer', 'Copies the matched interchange contract marker into the report.'],
  ['cli/retained-artifact-diff.mts', 430, 'reader', 'Requires both bounded retained documents to declare the same marker.'],
  ['cli/risk-calibration.mts', 558, 'writer', 'Copies the validated calibration dataset marker into report metadata.'],
  ['packages/relationships/case-relationship-graph-export.mts', 462, 'writer', 'Copies the canonical graph marker into GraphML metadata.'],
  ['packages/relationships/case-relationship-graph-export.mts', 497, 'writer', 'Copies the canonical graph marker into GEXF metadata.'],
  ['packages/interchange/external-findings-import.mts', 373, 'reader', 'Compares bounded nested source-provenance markers.'],
  ['packages/interchange/external-findings-import.mts', 403, 'writer', 'Copies a validated nested source-provenance marker.'],
  ['packages/monitoring/scheduled-monitor-model.mts', 476, 'writer', 'Copies the normalised monitor-state marker into an export.'],
  ['packages/workspace/workspace-archive.mts', 360, 'writer', 'Copies the canonical embedded Case-section marker into the runtime section definition.'],
  ['packages/workspace/workspace-archive-crypto.mts', 154, 'writer', 'Copies the validated envelope marker into authenticated metadata.'],
  ['packages/workspace/workspace-archive.mts', 521, 'writer', 'Copies a reviewed section definition marker into the archive manifest.'],
  ['packages/workspace/workspace-archive.mts', 634, 'reader', 'Compares a bounded archive entry marker to its reviewed section definition.'],
  ['packages/cases/case-response-model.mts', 536, 'writer', 'Copies bounded source-provenance fields after local normalisation.'],
  ['packages/interchange/external-findings-converters.mts', 137, 'reader', 'Checks an input marker supplied by a reviewed observation-row adapter.'],
  ['packages/workspace/workspace-archive.mts', 560, 'writer', 'Copies a bounded archive-section marker after local normalisation.'],
  ['packages/workspace/workspace-archive.mts', 624, 'reader', 'Compares two bounded archive-section markers during import.'],
  ['frontend/src/lib/components/ExternalFindingsImport.svelte', 140, 'reader', 'Dispatches a bounded local import through its reviewed marker family.'],
  ['frontend/src/lib/components/ExternalFindingsImport.svelte', 177, 'reader', 'Dispatches a bounded local import through its reviewed marker family.'],
  ['frontend/src/lib/components/ExternalFindingsImport.svelte', 193, 'reader', 'Dispatches a bounded local import through its reviewed marker family.'],
  ['frontend/src/lib/components/ExternalFindingsImport.svelte', 206, 'reader', 'Dispatches a bounded local import through its reviewed marker family.'],
  ['frontend/src/routes/(console)/bulk/+page.svelte', 157, 'writer', 'Initialises a browser-local store from its reviewed contract constant.'],
  ['tools/first-use-analyst-study.mts', 90, 'writer', 'Hashes the fixed study-task fixture contract into a local report.'],
  ['tools/first-use-analyst-study.mts', 222, 'writer', 'Copies the fixed study-task fixture marker into a local report.'],
  ['tools/registry-fixture-freshness.mts', 209, 'writer', 'Copies fixed fixture provenance into a maintainer report.'],
  ['tools/synthetic-analyst-journeys.mts', 71, 'writer', 'Copies the fixed journey fixture marker into a maintainer result.'],
  ['tools/synthetic-analyst-journeys.mts', 96, 'writer', 'Copies the fixed journey fixture marker into a maintainer result.'],
  ['tools/synthetic-analyst-journeys.mts', 209, 'writer', 'Copies the fixed journey fixture marker into a maintainer report.'],
  ['tools/technology-example-review.mts', 372, 'writer', 'Copies the fixed technology-review input marker into a maintainer review.'],
  ['tools/technology-example-review.mts', 390, 'writer', 'Copies the fixed technology-review input marker into a maintainer review.'],
  ['tools/technology-example-review.mts', 403, 'writer', 'Copies fixed source provenance into a maintainer review.'],
  ['tools/technology-fixture-review.mts', 282, 'reader', 'Checks a bounded fixture against its reviewed source marker.'],
  ['tools/technology-fixture-review.mts', 343, 'writer', 'Copies the fixed reviewed-fixture marker into a maintainer record.'],
  ['tools/technology-review-candidate.mts', 254, 'writer', 'Copies the fixed review-input marker into a candidate record.'],
  ['tools/technology-signature-benchmark.mts', 475, 'writer', 'Copies the fixed signature-fixture marker into a benchmark record.'],
  ['tools/technology-signature-benchmark.mts', 479, 'writer', 'Copies the fixed reviewed-fixture marker into a benchmark record.'],
] as const);

const SCHEMA_OWNER_USE_ALLOWLIST = Object.freeze([
  ['cli.web-capture-comparison', 'packages/web-capture/compare.mts', 'writer', [405]],
  ['export.web-capture-dom-digest', 'packages/web-capture/capture.mts', 'writer', [791]],
] as const);

type SourceOccurrence = Readonly<{
  identifier: string;
  file: string;
  line: number;
}>;

type SourceDefinition = Readonly<{
  identifier: string;
  file: string;
  line: number;
  symbol: string;
}>;

type DynamicConstruction = Readonly<{
  file: string;
  line: number;
  identifier: string | null;
  reason: 'case_changed' | 'dynamic' | 'malformed_schema_identifier' | 'non_literal_schema_declaration' | 'unresolved_schema_alias' | 'unresolved_schema_emitter';
}>;

type SourceImportBinding = Readonly<{
  file: string;
  line: number;
  local: string;
  imported: string;
  specifier: string;
  reexport: boolean;
}>;

type SourceSchemaAlias = Readonly<{
  file: string;
  line: number;
  symbol: string;
  target: string;
}>;

type SourceSchemaEmitter = Readonly<{
  identifier: string | null;
  file: string;
  line: number;
  symbol: string | null;
  role: 'reader' | 'writer';
}>;

type SourceLocalDeclaration = Readonly<{
  file: string;
  line: number;
  symbol: string;
}>;

type SourceFileDiscovery = Readonly<{
  occurrences: readonly SourceOccurrence[];
  definitions: readonly SourceDefinition[];
  dynamicConstructions: readonly DynamicConstruction[];
  imports: readonly SourceImportBinding[];
  aliases: readonly SourceSchemaAlias[];
  emitters: readonly SourceSchemaEmitter[];
  localDeclarations: readonly SourceLocalDeclaration[];
  referencedSymbols: readonly string[];
}>;

type SchemaSourceClassificationRecord = Readonly<{
  identifier: string;
  kind: keyof typeof CLASSIFICATION_REASONS_BY_KIND;
  reason: string;
  owner: string;
  sourceUses: readonly Readonly<{
    file: string;
    literalOccurrences: number;
    dynamicConstructions: number;
  }>[];
  relatedEntryIds: readonly string[];
  note: string;
}>;

export type SchemaSourceDiscovery = Readonly<{
  repositoryRoot: string;
  files: readonly string[];
  totalBytes: number;
  identifiers: readonly string[];
  occurrences: readonly SourceOccurrence[];
  definitions: readonly SourceDefinition[];
  dynamicConstructions: readonly DynamicConstruction[];
  imports: readonly SourceImportBinding[];
  aliases: readonly SourceSchemaAlias[];
  emitters: readonly SourceSchemaEmitter[];
  localDeclarations: readonly SourceLocalDeclaration[];
  referencedSymbolsByFile: Readonly<Record<string, readonly string[]>>;
  digestSha256: string;
}>;

export type SchemaSourceCoverage = Readonly<{
  files: number;
  totalBytes: number;
  identifiers: number;
  inventoriedIdentifiers: number;
  classifiedIdentifiers: number;
  definitions: number;
  digestSha256: string;
}>;

function tokens(value: string): string[] {
  return [...value.matchAll(TOKEN_PATTERN)].flatMap((match) => match[0] ? [match[0]] : []);
}

function exactSchemaIdentifier(value: string): string | null {
  return isCanonicalLocalSchemaIdentifier(value) ? value : null;
}

function hasLocalSchemaPrefix(value: string): boolean {
  return /^whoisleuth\./iu.test(value);
}

function exactLineSet(actual: readonly number[], expected: readonly number[]): boolean {
  const sorted = [...actual].sort((left, right) => left - right);
  return sorted.length === expected.length && sorted.every((line, index) => line === expected[index]);
}

function appendBounded<Value>(
  target: Value[],
  incoming: readonly Value[],
  maximum: number,
  message: string,
): void {
  if (incoming.length > maximum - target.length) throw new TypeError(message);
  for (const value of incoming) target.push(value);
}

function lineLocator(source: string): (position: number) => number {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return (position: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle]! <= position) low = middle + 1;
      else high = middle - 1;
    }
    return high + 1;
  };
}

function unwrapExpression(value: ts.Expression): ts.Expression {
  let current = value;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)) {
    current = current.expression;
  }
  return current;
}

function scriptKind(file: string): ts.ScriptKind {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function propertyName(node: ts.PropertyName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function directSchemaIdentifier(value: ts.Expression): string | null {
  const unwrapped = unwrapExpression(value);
  if (!ts.isStringLiteral(unwrapped) && !ts.isNoSubstitutionTemplateLiteral(unwrapped)) return null;
  return exactSchemaIdentifier(unwrapped.text);
}

function directString(value: ts.Expression): string | null {
  const unwrapped = unwrapExpression(value);
  return ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)
    ? unwrapped.text
    : null;
}

function isObjectSchemaDescriptor(value: ts.Expression): boolean {
  const unwrapped = unwrapExpression(value);
  if (ts.isObjectLiteralExpression(unwrapped)) return true;
  if (!ts.isCallExpression(unwrapped) || unwrapped.arguments.length !== 1) return false;
  const callee = unwrapExpression(unwrapped.expression);
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === 'Object'
    && callee.name.text === 'freeze'
    && ts.isObjectLiteralExpression(unwrapExpression(unwrapped.arguments[0]!));
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isVariableDeclaration(parent)
      || ts.isParameter(parent)
      || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent)
      || ts.isClassDeclaration(parent)
      || ts.isClassExpression(parent)
      || ts.isInterfaceDeclaration(parent)
      || ts.isTypeAliasDeclaration(parent)
      || ts.isEnumDeclaration(parent)
      || ts.isModuleDeclaration(parent)
      || ts.isImportClause(parent)
      || ts.isImportSpecifier(parent)
      || ts.isNamespaceImport(parent)
      || ts.isImportEqualsDeclaration(parent)
      || ts.isBindingElement(parent))
    && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent)
      || ts.isPropertyDeclaration(parent)
      || ts.isPropertySignature(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent)
      || ts.isGetAccessorDeclaration(parent)
      || ts.isSetAccessorDeclaration(parent))
    && parent.name === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isExportSpecifier(parent) || ts.isImportSpecifier(parent)) return false;
  return true;
}

type StaticStringResult = Readonly<{ value: string; constructed: boolean }>;
type StaticStringEvaluation = {
  activeSymbols: Set<string>;
  memo: Map<ts.Expression, StaticStringResult | null>;
  steps: number;
};

function boundedCandidate(value: string, file: string): string {
  if (Buffer.byteLength(value, 'utf8') > MAX_SCHEMA_SOURCE_CANDIDATE_BYTES) {
    throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_CANDIDATE_BYTES} candidate bytes.`);
  }
  return value;
}

function appendCandidate(current: string, next: string, file: string): string {
  const projected = Buffer.byteLength(current, 'utf8') + Buffer.byteLength(next, 'utf8');
  if (!Number.isSafeInteger(projected) || projected > MAX_SCHEMA_SOURCE_CANDIDATE_BYTES) {
    throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_CANDIDATE_BYTES} candidate bytes.`);
  }
  return current + next;
}

function staticStringExpression(
  value: ts.Expression,
  file: string,
  initializers: ReadonlyMap<string, readonly ts.Expression[]>,
  evaluation: StaticStringEvaluation = { activeSymbols: new Set<string>(), memo: new Map(), steps: 0 },
  depth = 0,
): StaticStringResult | null {
  if (depth > MAX_SCHEMA_SOURCE_AST_DEPTH) {
    throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_AST_DEPTH} static-expression levels.`);
  }
  const node = unwrapExpression(value);
  if (evaluation.memo.has(node)) return evaluation.memo.get(node) ?? null;
  evaluation.steps += 1;
  if (evaluation.steps > MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS) {
    throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS} static-evaluation steps.`);
  }
  const evaluate = (): StaticStringResult | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { value: boundedCandidate(node.text, file), constructed: false };
    }
    if (ts.isIdentifier(node)) {
      const candidates = initializers.get(node.text) ?? [];
      if (candidates.length !== 1 || evaluation.activeSymbols.has(node.text)) return null;
      evaluation.activeSymbols.add(node.text);
      try {
        return staticStringExpression(candidates[0]!, file, initializers, evaluation, depth + 1);
      } finally {
        evaluation.activeSymbols.delete(node.text);
      }
    }
    if (ts.isTemplateExpression(node)) {
      let output = boundedCandidate(node.head.text, file);
      for (const span of node.templateSpans) {
        const expression = staticStringExpression(span.expression, file, initializers, evaluation, depth + 1);
        if (!expression) return null;
        output = appendCandidate(output, expression.value, file);
        output = appendCandidate(output, span.literal.text, file);
      }
      return { value: output, constructed: true };
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticStringExpression(node.left, file, initializers, evaluation, depth + 1);
      const right = staticStringExpression(node.right, file, initializers, evaluation, depth + 1);
      if (!left || !right) return null;
      return { value: appendCandidate(left.value, right.value, file), constructed: true };
    }
    if (!ts.isCallExpression(node)) return null;
    const callee = unwrapExpression(node.expression);
    if (!ts.isPropertyAccessExpression(callee)) return null;
    const method = callee.name.text;
    if (method === 'concat') {
      const receiver = staticStringExpression(callee.expression, file, initializers, evaluation, depth + 1);
      if (!receiver) return null;
      let output = receiver.value;
      for (const argument of node.arguments) {
        const part = staticStringExpression(argument, file, initializers, evaluation, depth + 1);
        if (!part) return null;
        output = appendCandidate(output, part.value, file);
      }
      return { value: output, constructed: true };
    }
    if (method === 'join') {
      const array = unwrapExpression(callee.expression);
      if (!ts.isArrayLiteralExpression(array)) return null;
      const separator = node.arguments.length === 0
        ? { value: ',', constructed: false }
        : staticStringExpression(node.arguments[0]!, file, initializers, evaluation, depth + 1);
      if (!separator || node.arguments.length > 1) return null;
      let output = '';
      for (let index = 0; index < array.elements.length; index += 1) {
        const element = array.elements[index];
        if (!element || !ts.isExpression(element)) return null;
        const part = staticStringExpression(element, file, initializers, evaluation, depth + 1);
        if (!part) return null;
        if (index > 0) output = appendCandidate(output, separator.value, file);
        output = appendCandidate(output, part.value, file);
      }
      return { value: output, constructed: true };
    }
    if (method === 'replace' || method === 'replaceAll') {
      const input = staticStringExpression(callee.expression, file, initializers, evaluation, depth + 1);
      const search = node.arguments[0]
        ? staticStringExpression(node.arguments[0], file, initializers, evaluation, depth + 1)
        : null;
      const replacement = node.arguments[1]
        ? staticStringExpression(node.arguments[1], file, initializers, evaluation, depth + 1)
        : null;
      if (!input || !search || !replacement || node.arguments.length !== 2) return null;
      let matches = 0;
      if (search.value === '') {
        matches = method === 'replaceAll' ? input.value.length + 1 : 1;
      } else {
        let cursor = 0;
        const maximumMatches = method === 'replaceAll' ? Number.POSITIVE_INFINITY : 1;
        while (matches < maximumMatches && cursor <= input.value.length - search.value.length) {
          const next = input.value.indexOf(search.value, cursor);
          if (next < 0) break;
          matches += 1;
          cursor = next + search.value.length;
        }
      }
      const projected = Buffer.byteLength(input.value, 'utf8')
        - matches * Buffer.byteLength(search.value, 'utf8')
        + matches * Buffer.byteLength(replacement.value, 'utf8');
      if (!Number.isSafeInteger(projected) || projected > MAX_SCHEMA_SOURCE_CANDIDATE_BYTES) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_CANDIDATE_BYTES} candidate bytes.`);
      }
      const output = method === 'replaceAll'
        ? input.value.replaceAll(search.value, replacement.value)
        : input.value.replace(search.value, replacement.value);
      return { value: boundedCandidate(output, file), constructed: true };
    }
    return null;
  };
  const result = evaluate();
  evaluation.memo.set(node, result);
  return result;
}

function expressionContainsSchemaPrefixFragment(node: ts.Expression): boolean {
  const stack: ts.Node[] = [node];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop()!;
    visited += 1;
    if (visited > MAX_SCHEMA_SOURCE_AST_NODES) return true;
    if ((ts.isStringLiteral(current)
        || ts.isNoSubstitutionTemplateLiteral(current)
        || current.kind === ts.SyntaxKind.TemplateHead
        || current.kind === ts.SyntaxKind.TemplateMiddle
        || current.kind === ts.SyntaxKind.TemplateTail)
      && /whoisleuth/iu.test((current as ts.LiteralLikeNode).text)) return true;
    current.forEachChild((child) => { stack.push(child); });
  }
  return false;
}

function expressionContainsCombinedSchemaFragments(
  node: ts.Expression,
  file: string,
  initializers: ReadonlyMap<string, readonly ts.Expression[]>,
  schemaImportLocals: ReadonlySet<string>,
): boolean {
  let candidate = '';
  let visited = 0;
  let canonicalBindingFound = false;
  const activeSymbols = new Set<string>();
  const visitedExpressions = new Set<ts.Expression>();
  const visit = (value: ts.Expression, depth: number): void => {
    if (depth > MAX_SCHEMA_SOURCE_AST_DEPTH) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_AST_DEPTH} schema-fragment levels.`);
    }
    visited += 1;
    if (visited > MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS} schema-fragment steps.`);
    }
    const current = unwrapExpression(value);
    if (visitedExpressions.has(current)) return;
    visitedExpressions.add(current);
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      candidate = appendCandidate(candidate, current.text, file);
      return;
    }
    if (ts.isIdentifier(current)) {
      if (!isReferenceIdentifier(current)) return;
      if (DEFINITION_NAME_PATTERN.test(current.text) || schemaImportLocals.has(current.text)) {
        canonicalBindingFound = true;
      }
      const values = initializers.get(current.text) ?? [];
      if (values.length > 0 && !activeSymbols.has(current.text)) {
        activeSymbols.add(current.text);
        try {
          for (const value of values) visit(value, depth + 1);
        } finally {
          activeSymbols.delete(current.text);
        }
      }
      return;
    }
    const children: ts.Expression[] = [];
    current.forEachChild((child) => {
      if (ts.isExpression(child)) children.push(child);
    });
    for (const child of children) visit(child, depth + 1);
  };
  visit(node, 0);
  return canonicalBindingFound || /whoisleuth\./iu.test(candidate);
}

function isLocalDeclarationIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return ((ts.isVariableDeclaration(parent)
      || ts.isParameter(parent)
      || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent)
      || ts.isClassDeclaration(parent)
      || ts.isClassExpression(parent)
      || ts.isEnumDeclaration(parent)
      || ts.isBindingElement(parent))
    && parent.name === node);
}

function schemaMember(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value)) return value.name.text === 'schema';
  if (!ts.isElementAccessExpression(value) || !value.argumentExpression) return false;
  return directString(value.argumentExpression) === 'schema';
}

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);
const MUTATING_COLLECTION_METHODS = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

function returnedExpressions(accessor: ts.GetAccessorDeclaration): ts.Expression[] {
  const output: ts.Expression[] = [];
  if (!accessor.body) return output;
  const stack: ts.Node[] = [...accessor.body.statements];
  while (stack.length) {
    const node = stack.pop()!;
    if (ts.isFunctionLike(node)) continue;
    if (ts.isReturnStatement(node) && node.expression) {
      output.push(node.expression);
      continue;
    }
    node.forEachChild((child) => { stack.push(child); });
  }
  return output;
}

function descriptorValueExpression(value: ts.Expression): ts.Expression | null {
  const unwrapped = unwrapExpression(value);
  if (!ts.isObjectLiteralExpression(unwrapped)) return null;
  for (const property of unwrapped.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === 'value') return property.initializer;
  }
  return null;
}

function preflightTypeScriptNesting(source: string, file: string): void {
  const extension = path.extname(file).toLowerCase();
  const variant = extension === '.jsx' || extension === '.tsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, source);
  let depth = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.OpenParenToken
      || token === ts.SyntaxKind.OpenBracketToken
      || token === ts.SyntaxKind.OpenBraceToken) {
      depth += 1;
      if (depth > MAX_SCHEMA_SOURCE_AST_DEPTH) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_AST_DEPTH} lexical nesting levels.`);
      }
    } else if (token === ts.SyntaxKind.CloseParenToken
      || token === ts.SyntaxKind.CloseBracketToken
      || token === ts.SyntaxKind.CloseBraceToken) {
      depth = Math.max(0, depth - 1);
    }
  }
}

function discoverTypeScriptSource(
  source: string,
  file: string,
  lineOffset = 0,
): SourceFileDiscovery {
  preflightTypeScriptNesting(source, file);
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  } catch (cause) {
    if (cause instanceof RangeError) {
      throw new TypeError(`Schema source ${file} exceeds bounded parser nesting.`);
    }
    throw cause;
  }
  const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length) throw new TypeError(`Schema source ${file} must contain valid source syntax.`);
  const occurrences: SourceOccurrence[] = [];
  const definitions: SourceDefinition[] = [];
  const dynamicConstructions: DynamicConstruction[] = [];
  const imports: SourceImportBinding[] = [];
  const aliases: SourceSchemaAlias[] = [];
  const emitters: SourceSchemaEmitter[] = [];
  const localDeclarations: SourceLocalDeclaration[] = [];
  const referencedSymbols = new Set<string>();
  const initializers = new Map<string, ts.Expression[]>();
  const pendingSchemaDeclarations: Array<{ node: ts.VariableDeclaration; expression: ts.Expression }> = [];
  const pendingUses: Array<{ node: ts.Node; expression: ts.Expression; role: 'reader' | 'writer' }> = [];
  const pendingGenericConstructions: ts.Expression[] = [];
  const pendingProperties: Array<{
    node: ts.PropertyAssignment | ts.PropertyDeclaration;
    expression: ts.Expression;
  }> = [];
  const pendingGetters: ts.GetAccessorDeclaration[] = [];
  const pendingJsxAttributes: ts.JsxAttribute[] = [];
  const pendingSchemaCalls: ts.CallExpression[] = [];
  const pendingCompoundAssignments: ts.BinaryExpression[] = [];
  const pendingElementAssignments: ts.BinaryExpression[] = [];

  const lineFor = (position: number) => sourceFile.getLineAndCharacterOfPosition(position).line + 1 + lineOffset;
  const admitBinding = <Value,>(values: Value[], value: Value): void => {
    if (values.length >= MAX_SCHEMA_SOURCE_BINDINGS) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    }
    values.push(value);
  };
  const recordInitializer = (symbol: string, expression: ts.Expression): void => {
    const values = initializers.get(symbol) ?? [];
    if (values.length >= MAX_SCHEMA_SOURCE_BINDINGS) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    }
    initializers.set(symbol, [...values, expression]);
  };

  const recordValue = (value: string, position: number) => {
    for (const match of value.matchAll(CASE_INSENSITIVE_TOKEN_PATTERN)) {
      const raw = match[0];
      if (!raw) continue;
      if (raw !== raw.toLowerCase()) {
        admitBinding(dynamicConstructions, {
          file,
          line: lineFor(position),
          identifier: raw.toLowerCase(),
          reason: 'case_changed',
        });
      } else {
        if (occurrences.length >= MAX_SCHEMA_SOURCE_OCCURRENCES) {
          throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_OCCURRENCES} identifier occurrences.`);
        }
        occurrences.push({ identifier: raw, file, line: lineFor(position) });
      }
    }
  };

  const recordUse = (node: ts.Node, expression: ts.Expression, role: 'reader' | 'writer') => {
    pendingUses.push({ node, expression, role });
  };

  const stack: Array<{ node: ts.Node; depth: number }> = [{ node: sourceFile, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_SCHEMA_SOURCE_AST_NODES) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_AST_NODES} syntax nodes.`);
    }
    if (depth > MAX_SCHEMA_SOURCE_AST_DEPTH) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_AST_DEPTH} syntax levels.`);
    }
    if (ts.isIdentifier(node) && isReferenceIdentifier(node)) {
      if (!referencedSymbols.has(node.text) && referencedSymbols.size >= MAX_SCHEMA_SOURCE_BINDINGS) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      }
      referencedSymbols.add(node.text);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      recordValue(node.text, node.getStart(sourceFile));
    }
    if (ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.importClause?.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const element of node.importClause.namedBindings.elements) {
        admitBinding(imports, {
          file,
          line: lineFor(element.getStart(sourceFile)),
          local: element.name.text,
          imported: element.propertyName?.text ?? element.name.text,
          specifier: node.moduleSpecifier.text,
          reexport: false,
        });
      }
    }
    const exportModuleSpecifier = ts.isExportDeclaration(node) ? node.moduleSpecifier : undefined;
    if (ts.isExportDeclaration(node)
      && exportModuleSpecifier
      && ts.isStringLiteral(exportModuleSpecifier)
      && (!node.exportClause || ts.isNamedExports(node.exportClause))) {
      if (!node.exportClause) {
        admitBinding(imports, {
          file,
          line: lineFor(node.getStart(sourceFile)),
          local: '*',
          imported: '*',
          specifier: exportModuleSpecifier.text,
          reexport: true,
        });
      } else {
        for (const element of node.exportClause.elements) {
          admitBinding(imports, {
            file,
            line: lineFor(element.getStart(sourceFile)),
            local: element.name.text,
            imported: element.propertyName?.text ?? element.name.text,
            specifier: exportModuleSpecifier.text,
            reexport: true,
          });
        }
      }
    }
    if (ts.isIdentifier(node) && isLocalDeclarationIdentifier(node)) {
      admitBinding(localDeclarations, {
        file,
        line: lineFor(node.getStart(sourceFile)),
        symbol: node.text,
      });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      recordInitializer(node.name.text, node.initializer);
    }
    if ((ts.isTemplateExpression(node)
        || (ts.isBinaryExpression(node)
          && node.operatorToken.kind === ts.SyntaxKind.PlusToken
          && (!ts.isBinaryExpression(node.parent) || node.parent.operatorToken.kind !== ts.SyntaxKind.PlusToken)))
      && expressionContainsSchemaPrefixFragment(node)) {
      pendingGenericConstructions.push(node);
    }
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && DEFINITION_NAME_PATTERN.test(node.name.text)
      && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
        const identifier = directSchemaIdentifier(initializer);
        if (identifier) {
          admitBinding(definitions, {
            identifier,
            file,
            line: lineFor(node.getStart(sourceFile)),
            symbol: node.name.text,
          });
        } else if (/whoisleuth/iu.test(initializer.text)) {
          pendingSchemaDeclarations.push({ node, expression: initializer });
        }
      } else if (ts.isIdentifier(initializer)) {
        admitBinding(aliases, {
          file,
          line: lineFor(node.getStart(sourceFile)),
          symbol: node.name.text,
          target: initializer.text,
        });
      } else if (!isObjectSchemaDescriptor(initializer)) {
        pendingSchemaDeclarations.push({ node, expression: initializer });
      }
    }
    if (!SCHEMA_METADATA_FILES.has(file) && ts.isPropertyAssignment(node)) {
      pendingProperties.push({ node, expression: node.initializer });
    }
    if (!SCHEMA_METADATA_FILES.has(file)
      && ts.isPropertyDeclaration(node)
      && node.initializer) {
      pendingProperties.push({ node, expression: node.initializer });
    }
    if (!SCHEMA_METADATA_FILES.has(file) && ts.isGetAccessorDeclaration(node)) {
      pendingGetters.push(node);
    }
    if (!SCHEMA_METADATA_FILES.has(file) && ts.isJsxAttribute(node)) {
      pendingJsxAttributes.push(node);
    }
    if (!SCHEMA_METADATA_FILES.has(file) && ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression)
        && MUTATING_COLLECTION_METHODS.has(callee.name.text)) {
        for (const argument of node.arguments) recordInitializer(callee.expression.text, argument);
      }
      if (ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression)
        && ((callee.expression.text === 'Object'
            && (callee.name.text === 'defineProperty'
              || callee.name.text === 'defineProperties'
              || callee.name.text === 'fromEntries'))
          || (callee.expression.text === 'Reflect'
            && (callee.name.text === 'set' || callee.name.text === 'defineProperty')))) {
        pendingSchemaCalls.push(node);
      }
    }
    if (!SCHEMA_METADATA_FILES.has(file)
      && ts.isShorthandPropertyAssignment(node)
      && node.name.text === 'schema') {
      recordUse(node, node.name, 'writer');
    }
    if (!SCHEMA_METADATA_FILES.has(file) && ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (ASSIGNMENT_OPERATORS.has(operator)) {
        const left = unwrapExpression(node.left);
        if (ts.isIdentifier(left)) recordInitializer(left.text, node.right);
        else if ((ts.isElementAccessExpression(left) || ts.isPropertyAccessExpression(left))
          && ts.isIdentifier(left.expression)) recordInitializer(left.expression.text, node.right);
        if (schemaMember(left)) {
          if (operator === ts.SyntaxKind.EqualsToken) recordUse(node, node.right, 'writer');
          else pendingCompoundAssignments.push(node);
        } else if (ts.isElementAccessExpression(left) && left.argumentExpression) {
          pendingElementAssignments.push(node);
        }
      } else if ([
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(operator)) {
        if (schemaMember(node.left)) recordUse(node, node.right, 'reader');
        else if (schemaMember(node.right)) recordUse(node, node.left, 'reader');
      }
    }
    const children: ts.Node[] = [];
    node.forEachChild((child) => { children.push(child); });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index]!, depth: depth + 1 });
    }
  }

  const staticEvaluation: StaticStringEvaluation = {
    activeSymbols: new Set<string>(),
    memo: new Map<ts.Expression, StaticStringResult | null>(),
    steps: 0,
  };

  const resolveStatic = (expression: ts.Expression): StaticStringResult | null => (
    staticStringExpression(expression, file, initializers, staticEvaluation)
  );

  const schemaImportLocals = new Set(imports.flatMap((binding) => (
    DEFINITION_NAME_PATTERN.test(binding.imported) ? [binding.local] : []
  )));

  const schemaRelevantExpression = (expression: ts.Expression): boolean => {
    const resolved = resolveStatic(expression);
    if (resolved && hasLocalSchemaPrefix(resolved.value)) return true;
    if (expressionContainsSchemaPrefixFragment(expression)) return true;
    if (expressionContainsCombinedSchemaFragments(expression, file, initializers, schemaImportLocals)) return true;
    const value = unwrapExpression(expression);
    return ts.isIdentifier(value)
      && (DEFINITION_NAME_PATTERN.test(value.text)
        || value.text === 'schema'
        || schemaImportLocals.has(value.text));
  };

  const recordUnresolvedWriter = (node: ts.Node, identifier: string | null = null) => {
    const line = lineFor(node.getStart(sourceFile));
    admitBinding(emitters, { identifier: null, file, line, symbol: null, role: 'writer' });
    admitBinding(dynamicConstructions, {
      file,
      line,
      identifier,
      reason: identifier ? 'malformed_schema_identifier' : 'unresolved_schema_emitter',
    });
  };

  let aliasResolutionSteps = 0;
  const resolveLocalAlias = (
    expression: ts.Expression,
    active = new Set<string>(),
    depth = 0,
  ): ts.Expression => {
    if (depth > MAX_SCHEMA_SOURCE_AST_DEPTH) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_AST_DEPTH} local-alias levels.`);
    }
    aliasResolutionSteps += 1;
    if (aliasResolutionSteps > MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS} local-alias steps.`);
    }
    const current = unwrapExpression(expression);
    if (!ts.isIdentifier(current)) return current;
    const values = initializers.get(current.text) ?? [];
    if (values.length !== 1 || active.has(current.text)) return current;
    active.add(current.text);
    try {
      return resolveLocalAlias(values[0]!, active, depth + 1);
    } finally {
      active.delete(current.text);
    }
  };

  for (const pending of pendingProperties) {
    let name = propertyName(pending.node.name);
    if (name === null && ts.isComputedPropertyName(pending.node.name)) {
      name = resolveStatic(pending.node.name.expression)?.value ?? null;
    }
    if (name === 'schema') {
      recordUse(pending.node, pending.expression, 'writer');
    } else if (name === null && schemaRelevantExpression(pending.expression)) {
      recordUnresolvedWriter(pending.node);
    }
  }

  for (const getter of pendingGetters) {
    let name = propertyName(getter.name);
    if (name === null && ts.isComputedPropertyName(getter.name)) {
      name = resolveStatic(getter.name.expression)?.value ?? null;
    }
    const returns = returnedExpressions(getter);
    if (name === 'schema') {
      if (!returns.length) recordUnresolvedWriter(getter);
      else for (const expression of returns) recordUse(getter, expression, 'writer');
    } else if (name === null && returns.some(schemaRelevantExpression)) {
      recordUnresolvedWriter(getter);
    }
  }

  for (const attribute of pendingJsxAttributes) {
    if (!ts.isIdentifier(attribute.name) || attribute.name.text !== 'schema') continue;
    if (!attribute.initializer) {
      recordUnresolvedWriter(attribute);
    } else if (ts.isStringLiteral(attribute.initializer)) {
      recordUse(attribute, attribute.initializer, 'writer');
    } else if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
      recordUse(attribute, attribute.initializer.expression, 'writer');
    } else {
      recordUnresolvedWriter(attribute);
    }
  }

  for (const assignment of pendingCompoundAssignments) recordUnresolvedWriter(assignment);

  for (const assignment of pendingElementAssignments) {
    const left = unwrapExpression(assignment.left);
    if (!ts.isElementAccessExpression(left) || !left.argumentExpression) continue;
    const name = resolveStatic(left.argumentExpression)?.value ?? directString(left.argumentExpression);
    if (name === 'schema') {
      if (assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken) recordUse(assignment, assignment.right, 'writer');
      else recordUnresolvedWriter(assignment);
    } else if (name === null && schemaRelevantExpression(assignment.right)) {
      recordUnresolvedWriter(assignment);
    }
  }

  for (const call of pendingSchemaCalls) {
    const callee = unwrapExpression(call.expression);
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) continue;
    const owner = callee.expression.text;
    const method = callee.name.text;
    if (owner === 'Object' && method === 'fromEntries') {
      const argument = call.arguments[0];
      if (!argument) continue;
      const entries = resolveLocalAlias(argument);
      if (!ts.isArrayLiteralExpression(entries)) {
        if (schemaRelevantExpression(argument)) recordUnresolvedWriter(call);
        continue;
      }
      for (const element of entries.elements) {
        if (!ts.isExpression(element)) continue;
        const pair = resolveLocalAlias(element);
        if (!ts.isArrayLiteralExpression(pair) || pair.elements.length < 2) {
          if (schemaRelevantExpression(element)) recordUnresolvedWriter(element);
          continue;
        }
        const key = pair.elements[0];
        const value = pair.elements[1];
        if (!key || !value || !ts.isExpression(key) || !ts.isExpression(value)) continue;
        const name = resolveStatic(key)?.value ?? directString(key);
        if (name === 'schema') recordUse(element, value, 'writer');
        else if (name === null && schemaRelevantExpression(value)) recordUnresolvedWriter(element);
      }
      continue;
    }
    if (owner === 'Reflect' && method === 'set') {
      const key = call.arguments[1];
      const value = call.arguments[2];
      if (!key || !value) continue;
      const name = resolveStatic(key)?.value ?? directString(key);
      if (name === 'schema') recordUse(call, value, 'writer');
      else if (name === null && schemaRelevantExpression(value)) recordUnresolvedWriter(call);
      continue;
    }
    if ((owner !== 'Object' && owner !== 'Reflect')
      || (method !== 'defineProperty' && method !== 'defineProperties')) continue;
    if (method === 'defineProperty') {
      const key = call.arguments[1];
      const descriptor = call.arguments[2];
      if (!key || !descriptor) continue;
      const value = descriptorValueExpression(descriptor);
      const name = resolveStatic(key)?.value ?? directString(key);
      if (name === 'schema') {
        if (value) recordUse(call, value, 'writer');
        else recordUnresolvedWriter(call);
      } else if (name === null && value && schemaRelevantExpression(value)) {
        recordUnresolvedWriter(call);
      }
      continue;
    }
    const descriptors = call.arguments[1] ? unwrapExpression(call.arguments[1]!) : null;
    if (!descriptors || !ts.isObjectLiteralExpression(descriptors)) continue;
    for (const property of descriptors.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      let name = propertyName(property.name);
      if (name === null && ts.isComputedPropertyName(property.name)) {
        name = resolveStatic(property.name.expression)?.value ?? null;
      }
      const value = descriptorValueExpression(property.initializer);
      if (name === 'schema') {
        if (value) recordUse(property, value, 'writer');
        else recordUnresolvedWriter(property);
      } else if (name === null && value && schemaRelevantExpression(value)) {
        recordUnresolvedWriter(property);
      }
    }
  }

  for (const pending of pendingSchemaDeclarations) {
    const resolved = resolveStatic(pending.expression);
    const identifier = resolved ? exactSchemaIdentifier(resolved.value) : null;
    admitBinding(dynamicConstructions, {
      file,
      line: lineFor(pending.node.getStart(sourceFile)),
      identifier,
      reason: 'non_literal_schema_declaration',
    });
  }

  for (const expression of pendingGenericConstructions) {
    if (ts.isTemplateExpression(expression)) {
      const fragments = [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)];
      const staticFound = fragments.flatMap(tokens);
      if (staticFound.length || fragments.some((fragment) => /whoisleuth\./iu.test(fragment))) {
        admitBinding(dynamicConstructions, {
          file,
          line: lineFor(expression.getStart(sourceFile)),
          identifier: staticFound.length === 1 ? staticFound[0]! : null,
          reason: 'dynamic',
        });
      }
      continue;
    }
    const resolved = resolveStatic(expression);
    if (!resolved?.constructed) continue;
    const found = tokens(resolved.value);
    if (found.length || /whoisleuth\./iu.test(resolved.value)) {
      admitBinding(dynamicConstructions, {
        file,
        line: lineFor(expression.getStart(sourceFile)),
        identifier: found.length === 1 && found[0] === resolved.value ? found[0]! : null,
        reason: 'dynamic',
      });
    }
  }

  for (const pending of pendingUses) {
    const expression = unwrapExpression(pending.expression);
    const identifier = directSchemaIdentifier(expression);
    if (identifier) {
      admitBinding(emitters, {
        identifier,
        file,
        line: lineFor(pending.node.getStart(sourceFile)),
        symbol: null,
        role: pending.role,
      });
      continue;
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      if (hasLocalSchemaPrefix(expression.text)) {
        admitBinding(dynamicConstructions, {
          file,
          line: lineFor(pending.node.getStart(sourceFile)),
          identifier: null,
          reason: 'malformed_schema_identifier',
        });
      }
      continue;
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword
      || (ts.isIdentifier(expression) && expression.text === 'undefined')) continue;
    if (ts.isIdentifier(expression)) {
      admitBinding(emitters, {
        identifier: null,
        file,
        line: lineFor(pending.node.getStart(sourceFile)),
        symbol: expression.text,
        role: pending.role,
      });
      continue;
    }
    const resolved = resolveStatic(expression);
    const found = resolved ? tokens(resolved.value) : [];
    if (resolved && found.length === 1 && found[0] === resolved.value) {
      admitBinding(emitters, {
        identifier: found[0]!,
        file,
        line: lineFor(pending.node.getStart(sourceFile)),
        symbol: null,
        role: pending.role,
      });
      admitBinding(dynamicConstructions, {
        file,
        line: lineFor(pending.node.getStart(sourceFile)),
        identifier: found[0]!,
        reason: 'dynamic',
      });
    } else if (resolved && hasLocalSchemaPrefix(resolved.value)) {
      admitBinding(dynamicConstructions, {
        file,
        line: lineFor(pending.node.getStart(sourceFile)),
        identifier: null,
        reason: 'malformed_schema_identifier',
      });
    } else {
      const line = lineFor(pending.node.getStart(sourceFile));
      admitBinding(emitters, {
        identifier: null,
        file,
        line,
        symbol: null,
        role: pending.role,
      });
      if (!SCHEMA_DYNAMIC_USE_ALLOWLIST.some(([allowedFile, allowedLine, allowedRole]) => (
        allowedFile === file && allowedLine === line && allowedRole === pending.role
      ))) {
        admitBinding(dynamicConstructions, {
          file,
          line,
          identifier: null,
          reason: 'unresolved_schema_emitter',
        });
      }
    }
  }
  return {
    occurrences,
    definitions,
    dynamicConstructions,
    imports,
    aliases,
    emitters,
    localDeclarations,
    referencedSymbols: [...referencedSymbols].sort(),
  };
}

function discoverJsonSource(source: string, file: string): SourceFileDiscovery {
  scanBoundedJson(source, {
    maximumDepth: MAX_SCHEMA_SOURCE_JSON_DEPTH,
    maximumKeys: MAX_SCHEMA_SOURCE_JSON_VALUES,
    maximumValues: MAX_SCHEMA_SOURCE_JSON_VALUES,
    maximumContainerItems: MAX_SCHEMA_SOURCE_JSON_CONTAINER_ITEMS,
  });
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new TypeError(`Schema source ${file} must contain valid JSON.`);
  }
  const occurrences: SourceOccurrence[] = [];
  const dynamicConstructions: DynamicConstruction[] = [];
  const emitters: SourceSchemaEmitter[] = [];
  const recordValue = (item: string) => {
    for (const match of item.matchAll(CASE_INSENSITIVE_TOKEN_PATTERN)) {
      const raw = match[0];
      if (!raw) continue;
      if (raw !== raw.toLowerCase()) {
        if (dynamicConstructions.length >= MAX_SCHEMA_SOURCE_BINDINGS) {
          throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
        }
        dynamicConstructions.push({ file, line: 1, identifier: raw.toLowerCase(), reason: 'case_changed' });
      } else {
        if (occurrences.length >= MAX_SCHEMA_SOURCE_OCCURRENCES) {
          throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_OCCURRENCES} identifier occurrences.`);
        }
        occurrences.push({ identifier: raw, file, line: 1 });
      }
    }
  };
  const stack: unknown[] = [value];
  let visited = 0;
  while (stack.length) {
    const item = stack.pop();
    visited += 1;
    if (visited > MAX_SCHEMA_SOURCE_JSON_VALUES) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_JSON_VALUES} JSON values.`);
    }
    if (typeof item === 'string') {
      recordValue(item);
      continue;
    }
    if (Array.isArray(item)) {
      for (const member of item) stack.push(member);
      continue;
    }
    if (item && typeof item === 'object') {
      for (const [key, member] of Object.entries(item as Record<string, unknown>)) {
        recordValue(key);
        if (key === 'schema' && typeof member === 'string') {
          const found = tokens(member);
          if (found.length === 1 && found[0] === member) {
            if (emitters.length >= MAX_SCHEMA_SOURCE_BINDINGS) {
              throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
            }
            emitters.push({ identifier: member, file, line: 1, symbol: null, role: 'writer' });
          } else if (hasLocalSchemaPrefix(member)) {
            if (dynamicConstructions.length >= MAX_SCHEMA_SOURCE_BINDINGS) {
              throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
            }
            dynamicConstructions.push({
              file,
              line: 1,
              identifier: null,
              reason: 'malformed_schema_identifier',
            });
          }
        }
        stack.push(member);
      }
    }
  }
  return {
    occurrences,
    definitions: [],
    dynamicConstructions,
    imports: [],
    aliases: [],
    emitters,
    localDeclarations: [],
    referencedSymbols: [],
  };
}

function maskMatches(value: string[], source: string, pattern: RegExp): void {
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    for (let index = start; index < start + match[0].length; index += 1) {
      if (value[index] !== '\n' && value[index] !== '\r') value[index] = ' ';
    }
  }
}

type ElementBlock = Readonly<{
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
}>;

type MarkupExpressionBlock = Readonly<{
  start: number;
  contentStart: number;
  contentEnd: number;
}>;

type MarkupOpeningTagBlock = Readonly<{
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
}>;

function markupExpressionBlocks(source: string, file: string): MarkupExpressionBlock[] {
  const blocks: MarkupExpressionBlock[] = [];
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 1;
    let quote: '"' | "'" | '`' | null = null;
    let escaped = false;
    let end = start + 1;
    for (; end < source.length && depth > 0; end += 1) {
      const character = source[end]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
      }
    }
    if (depth !== 0) throw new TypeError(`Schema source ${file} contains an unterminated markup expression.`);
    const contentStart = start + 1;
    const contentEnd = end - 1;
    const first = source.slice(contentStart, contentEnd).trimStart()[0] ?? '';
    if (!'#/:@'.includes(first)) {
      blocks.push({ start, contentStart, contentEnd });
      if (blocks.length > MAX_SCHEMA_SOURCE_BINDINGS) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} markup expressions.`);
      }
    }
    start = contentEnd;
  }
  return blocks;
}

function elementBlocks(source: string, tagName: 'script' | 'style', file: string): ElementBlock[] {
  const lower = source.toLowerCase();
  const opening = `<${tagName}`;
  const closing = `</${tagName}>`;
  const blocks: ElementBlock[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = lower.indexOf(opening, cursor);
    if (start < 0) break;
    const boundary = lower[start + opening.length] ?? '';
    if (boundary && !/[\s>/]/u.test(boundary)) {
      cursor = start + opening.length;
      continue;
    }
    let quote: '"' | "'" | null = null;
    let openingEnd = -1;
    for (let index = start + opening.length; index < source.length; index += 1) {
      const character = source[index]!;
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        openingEnd = index;
        break;
      }
    }
    if (openingEnd < 0) throw new TypeError(`Schema source ${file} contains an unterminated <${tagName}> tag.`);
    const contentStart = openingEnd + 1;
    const contentEnd = lower.indexOf(closing, contentStart);
    if (contentEnd < 0) throw new TypeError(`Schema source ${file} contains an unterminated <${tagName}> block.`);
    const end = contentEnd + closing.length;
    blocks.push({ start, end, contentStart, contentEnd });
    if (blocks.length > MAX_SCHEMA_SOURCE_BINDINGS) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} element blocks.`);
    }
    cursor = end;
  }
  return blocks;
}

function markupOpeningTagBlocks(source: string, file: string): MarkupOpeningTagBlock[] {
  const blocks: MarkupOpeningTagBlock[] = [];
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '<' || !/[A-Za-z]/u.test(source[start + 1] ?? '')) continue;
    let quote: '"' | "'" | '`' | null = null;
    let escaped = false;
    let braceDepth = 0;
    let end = start + 1;
    for (; end < source.length; end += 1) {
      const character = source[end]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
      } else if (character === '{') {
        braceDepth += 1;
      } else if (character === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (character === '>' && braceDepth === 0) {
        break;
      }
    }
    if (end >= source.length) throw new TypeError(`Schema source ${file} contains an unterminated markup tag.`);
    blocks.push({ start, end: end + 1, contentStart: start + 1, contentEnd: end });
    if (blocks.length > MAX_SCHEMA_SOURCE_BINDINGS) {
      throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} markup tags.`);
    }
    start = end;
  }
  return blocks;
}

const SCHEMA_ATTRIBUTE_NAMED_REFERENCES = Object.freeze(new Map<string, string>([
  ['NewLine', '\n'],
  ['Tab', '\t'],
  ['amp', '&'],
  ['apos', "'"],
  ['colon', ':'],
  ['gt', '>'],
  ['lowbar', '_'],
  ['lt', '<'],
  ['period', '.'],
  ['quot', '"'],
]));

function decodeBoundedSchemaAttribute(value: string, file: string): Readonly<{ value: string; complete: boolean }> {
  boundedCandidate(value, file);
  let complete = true;
  const decoded = value.replace(/&(#(?:[xX][0-9a-fA-F]+|\d+)|[A-Za-z][A-Za-z0-9]+);?/gu, (match, encoded: string) => {
    if (encoded.startsWith('#')) {
      const hexadecimal = encoded[1]?.toLowerCase() === 'x';
      const digits = encoded.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isSafeInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
        complete = false;
        return match;
      }
      return String.fromCodePoint(codePoint);
    }
    const named = SCHEMA_ATTRIBUTE_NAMED_REFERENCES.get(encoded);
    if (named === undefined) {
      complete = false;
      return match;
    }
    return named;
  });
  return Object.freeze({ value: boundedCandidate(decoded, file), complete });
}

function discoverSvelteSource(source: string, file: string): SourceFileDiscovery {
  const occurrences: SourceOccurrence[] = [];
  const definitions: SourceDefinition[] = [];
  const dynamicConstructions: DynamicConstruction[] = [];
  const imports: SourceImportBinding[] = [];
  const aliases: SourceSchemaAlias[] = [];
  const emitters: SourceSchemaEmitter[] = [];
  const localDeclarations: SourceLocalDeclaration[] = [];
  const referencedSymbols = new Set<string>();
  const locateLine = lineLocator(source);
  const uncommented = source.split('');
  maskMatches(uncommented, source, /<!--[\s\S]*?-->/gu);
  maskMatches(uncommented, source, /\{\/\*[\s\S]*?\*\/\}/gu);
  const admittedSource = uncommented.join('');
  const withoutScripts = admittedSource.split('');
  for (const block of elementBlocks(admittedSource, 'script', file)) {
    const content = admittedSource.slice(block.contentStart, block.contentEnd);
    const contentOffset = block.contentStart;
    const result = discoverTypeScriptSource(content, file, locateLine(contentOffset) - 1);
    appendBounded(occurrences, result.occurrences, MAX_SCHEMA_SOURCE_OCCURRENCES, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_OCCURRENCES} identifier occurrences.`);
    appendBounded(definitions, result.definitions, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    appendBounded(dynamicConstructions, result.dynamicConstructions, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    appendBounded(imports, result.imports, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    appendBounded(aliases, result.aliases, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    appendBounded(emitters, result.emitters, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    appendBounded(localDeclarations, result.localDeclarations, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} local declarations.`);
    for (const symbol of result.referencedSymbols) {
      if (!referencedSymbols.has(symbol) && referencedSymbols.size >= MAX_SCHEMA_SOURCE_BINDINGS) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      }
      referencedSymbols.add(symbol);
    }
    for (let index = block.start; index < block.end; index += 1) {
      withoutScripts[index] = ' ';
    }
  }
  const markupCharacters = withoutScripts;
  const markupSource = markupCharacters.join('');
  for (const block of elementBlocks(markupSource, 'style', file)) {
    for (let index = block.start; index < block.end; index += 1) markupCharacters[index] = ' ';
  }
  const markup = markupCharacters.join('');
  const openingTags = markupOpeningTagBlocks(markup, file);
  const recordMarkupSchemaValue = (rawValue: string, position: number): void => {
    const line = locateLine(position);
    const decoded = decodeBoundedSchemaAttribute(rawValue, file);
    if (!decoded.complete) {
      appendBounded(emitters, [{ identifier: null, file, line, symbol: null, role: 'writer' }], MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      appendBounded(dynamicConstructions, [{ file, line, identifier: null, reason: 'unresolved_schema_emitter' }], MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      return;
    }
    const identifier = exactSchemaIdentifier(decoded.value);
    if (identifier) {
      appendBounded(emitters, [{ identifier, file, line, symbol: null, role: 'writer' }], MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      if (decoded.value !== rawValue) {
        appendBounded(occurrences, [{ identifier, file, line }], MAX_SCHEMA_SOURCE_OCCURRENCES, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_OCCURRENCES} identifier occurrences.`);
      }
    } else if (/whoisleuth/iu.test(decoded.value)) {
      appendBounded(dynamicConstructions, [{ file, line, identifier: null, reason: 'malformed_schema_identifier' }], MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    }
  };
  for (const tag of openingTags) {
    const content = markup.slice(tag.contentStart, tag.contentEnd);
    const staticAttribute = /(?:^|\s)(?:bind:)?schema\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>{}]+))/giu;
    for (const match of content.matchAll(staticAttribute)) {
      const value = match[1] ?? match[2] ?? match[3] ?? '';
      recordMarkupSchemaValue(value, tag.contentStart + (match.index ?? 0));
    }
    const bareAttribute = /(?:^|\s)(?:bind:)?schema(?=\s|\/|$)(?!\s*=)/giu;
    for (const match of content.matchAll(bareAttribute)) {
      const line = locateLine(tag.contentStart + (match.index ?? 0));
      appendBounded(emitters, [{ identifier: null, file, line, symbol: null, role: 'writer' }], MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      appendBounded(dynamicConstructions, [{ file, line, identifier: null, reason: 'unresolved_schema_emitter' }], MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    }
  }
  for (const block of markupExpressionBlocks(markup, file)) {
    const expression = markup.slice(block.contentStart, block.contentEnd);
    const prefix = markup.slice(Math.max(0, block.start - 80), block.start);
    const directSchemaAttribute = /\bschema\s*=\s*$/iu.test(prefix);
    const insideOpeningTag = openingTags.some((tag) => block.start > tag.start && block.start < tag.end);
    const shorthandSchemaAttribute = insideOpeningTag && expression.trim() === 'schema';
    const schemaSpreadAttribute = insideOpeningTag && /^\.\.\.\s*schema$/u.test(expression.trim());
    if (shorthandSchemaAttribute || schemaSpreadAttribute) {
      const line = locateLine(block.start);
      appendBounded(emitters, [{ identifier: null, file, line, symbol: 'schema', role: 'writer' }], MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      referencedSymbols.add('schema');
      continue;
    }
    if (!directSchemaAttribute && !/(?:\bschema\b|whoisleuth)/iu.test(expression)) continue;
    const wrapped = directSchemaAttribute
      ? `const __MARKUP_VALUE = { schema: (${expression}) };`
      : `const __MARKUP_VALUE = (${expression});`;
    const result = discoverTypeScriptSource(wrapped, file, locateLine(block.contentStart) - 1);
    appendBounded(dynamicConstructions, result.dynamicConstructions, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    appendBounded(emitters, result.emitters, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
    for (const symbol of result.referencedSymbols) {
      if (!referencedSymbols.has(symbol) && referencedSymbols.size >= MAX_SCHEMA_SOURCE_BINDINGS) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      }
      referencedSymbols.add(symbol);
    }
  }
  for (const match of markup.matchAll(CASE_INSENSITIVE_TOKEN_PATTERN)) {
    const raw = match[0];
    if (!raw) continue;
    if (raw !== raw.toLowerCase()) {
      if (dynamicConstructions.length >= MAX_SCHEMA_SOURCE_BINDINGS) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema bindings.`);
      }
      dynamicConstructions.push({
        file,
        line: locateLine(match.index ?? 0),
        identifier: raw.toLowerCase(),
        reason: 'case_changed',
      });
    } else {
      if (occurrences.length >= MAX_SCHEMA_SOURCE_OCCURRENCES) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_OCCURRENCES} identifier occurrences.`);
      }
      occurrences.push({ identifier: raw, file, line: locateLine(match.index ?? 0) });
    }
  }
  return {
    occurrences,
    definitions,
    dynamicConstructions,
    imports,
    aliases,
    emitters,
    localDeclarations,
    referencedSymbols: [...referencedSymbols].sort(),
  };
}

export function discoverSchemaIdentifiersInSource(source: string, file: string): SourceFileDiscovery {
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > MAX_SCHEMA_SOURCE_FILE_BYTES) {
    throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_FILE_BYTES} bytes.`);
  }
  const extension = path.extname(file).toLowerCase();
  if (extension === '.json') return discoverJsonSource(source, file);
  if (extension === '.svelte') return discoverSvelteSource(source, file);
  return discoverTypeScriptSource(source, file);
}

type SourceTraversalState = {
  files: string[];
  nonSourceFiles: Set<string>;
  directories: number;
  entries: number;
  declaredBytes: number;
};

function validateNonSourceFileLedger(): void {
  if (SCHEMA_SOURCE_NON_SOURCE_FILE_SET.size !== SCHEMA_SOURCE_NON_SOURCE_FILES.length) {
    throw new TypeError('Schema source non-source file ledger contains duplicate paths.');
  }
  let previous = '';
  for (const ledgerPath of SCHEMA_SOURCE_NON_SOURCE_FILES) {
    const relative: string = ledgerPath;
    if (relative.startsWith('/')
      || relative.includes('\\')
      || path.posix.normalize(relative) !== relative
      || relative === '..'
      || relative.startsWith('../')
      || !pathInside(relative, new Set<string>(SCHEMA_SOURCE_ROOTS))
      || SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      throw new TypeError(`Schema source non-source file ledger contains an unsafe or admitted source path: ${relative}`);
    }
    if (previous && ordinalCompare(previous, relative) >= 0) {
      throw new TypeError('Schema source non-source file ledger must be unique and ordinal-sorted.');
    }
    previous = relative;
  }
}

async function collectFiles(
  repositoryRoot: string,
  relativeRoot: string,
  state: SourceTraversalState,
): Promise<void> {
  const root = path.join(repositoryRoot, relativeRoot);
  const stat = await lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`Schema source root ${relativeRoot} must be an ordinary directory.`);
  }
  const visit = async (absoluteDirectory: string, relativeDirectory: string, depth: number): Promise<void> => {
    if (depth > MAX_SCHEMA_SOURCE_DIRECTORY_DEPTH) {
      throw new TypeError(`Schema source directory ${relativeDirectory} exceeds ${MAX_SCHEMA_SOURCE_DIRECTORY_DEPTH} levels.`);
    }
    state.directories += 1;
    if (state.directories > MAX_SCHEMA_SOURCE_DIRECTORIES) {
      throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_DIRECTORIES} directories.`);
    }
    const entries = [];
    const directory = await opendir(absoluteDirectory);
    for await (const entry of directory) {
      state.entries += 1;
      if (state.entries > MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES) {
        throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES} directory entries.`);
      }
      entries.push(entry);
    }
    entries.sort((left, right) => ordinalCompare(left.name, right.name));
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      const absolute = path.join(absoluteDirectory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new TypeError(`Schema source path ${relative} must not be a symbolic link.`);
      if (metadata.isDirectory()) {
        await visit(absolute, relative, depth + 1);
        continue;
      }
      if (!metadata.isFile()) throw new TypeError(`Schema source path ${relative} must be an ordinary file or directory.`);
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (!SCHEMA_SOURCE_NON_SOURCE_FILE_SET.has(relative)) {
          throw new TypeError(`Schema source scope contains an unclassified source path: ${relative}`);
        }
        state.nonSourceFiles.add(relative);
        continue;
      }
      if (metadata.size > MAX_SCHEMA_SOURCE_FILE_BYTES) {
        throw new TypeError(`Schema source ${relative} exceeds ${MAX_SCHEMA_SOURCE_FILE_BYTES} bytes.`);
      }
      state.declaredBytes += metadata.size;
      if (state.declaredBytes > MAX_SCHEMA_SOURCE_TOTAL_BYTES) {
        throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_TOTAL_BYTES} aggregate bytes.`);
      }
      state.files.push(relative);
      if (state.files.length > MAX_SCHEMA_SOURCE_FILES) {
        throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_FILES} files.`);
      }
    }
  };
  await visit(root, relativeRoot, 0);
}

function pathInside(relativePath: string, roots: ReadonlySet<string>): boolean {
  for (const root of roots) {
    if (relativePath === root || relativePath.startsWith(`${root}/`)) return true;
  }
  return false;
}

async function gitSourceManifest(repositoryRoot: string): Promise<string[] | null> {
  try {
    const metadata = await lstat(path.join(repositoryRoot, '.git'));
    if (!metadata.isDirectory() && !metadata.isFile()) return null;
  } catch {
    return null;
  }
  let raw: Buffer;
  try {
    raw = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: repositoryRoot,
      encoding: 'buffer',
      maxBuffer: MAX_SCHEMA_SOURCE_MANIFEST_BYTES + 1,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
  } catch (cause) {
    throw new TypeError(`Schema source scope could not read the bounded repository manifest: ${cause instanceof Error ? cause.message : 'unknown error'}`);
  }
  if (raw.byteLength > MAX_SCHEMA_SOURCE_MANIFEST_BYTES) {
    throw new TypeError(`Schema source scope exceeds ${MAX_SCHEMA_SOURCE_MANIFEST_BYTES} manifest bytes.`);
  }
  const decoded = decodeBoundedUtf8(raw, 'Schema source repository manifest');
  const paths = decoded.split('\0').filter(Boolean);
  if (paths.length > MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES) {
    throw new TypeError(`Schema source scope exceeds ${MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES} repository paths.`);
  }
  for (const relative of paths) {
    if (relative.startsWith('/')
      || relative.includes('\\')
      || path.posix.normalize(relative) !== relative
      || relative === '..'
      || relative.startsWith('../')) {
      throw new TypeError('Schema source scope contains an unsafe repository path.');
    }
  }
  return paths.sort(ordinalCompare);
}

async function validateSchemaSourceScope(repositoryRoot: string): Promise<void> {
  const coveredRoots = new Set<string>(SCHEMA_SOURCE_ROOTS);
  const coveredFiles = new Set<string>(SCHEMA_SOURCE_ROOT_FILES);
  const manifest = await gitSourceManifest(repositoryRoot);
  if (manifest) {
    const observedNonSourceFiles = new Set<string>();
    for (const relative of manifest) {
      if (pathInside(relative, coveredRoots)) {
        if (SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
        if (SCHEMA_SOURCE_NON_SOURCE_FILE_SET.has(relative)) {
          observedNonSourceFiles.add(relative);
          continue;
        }
        throw new TypeError(`Schema source scope contains an unclassified source path: ${relative}`);
      }
      if (pathInside(relative, SCHEMA_SOURCE_EXEMPT_ROOTS)
        || coveredFiles.has(relative)
        || SCHEMA_SOURCE_EXEMPT_FILES.has(relative)) continue;
      throw new TypeError(`Schema source scope contains an unclassified repository path: ${relative}`);
    }
    for (const relative of SCHEMA_SOURCE_NON_SOURCE_FILES) {
      if (!observedNonSourceFiles.has(relative)) {
        throw new TypeError(`Schema source non-source file allowance is stale or missing: ${relative}`);
      }
    }
    return;
  }
  let directories = 0;
  let entriesSeen = 0;
  const visit = async (absoluteDirectory: string, relativeDirectory: string, depth: number): Promise<void> => {
    if (depth > MAX_SCHEMA_SOURCE_DIRECTORY_DEPTH) {
      throw new TypeError(`Schema source scope ${relativeDirectory || '.'} exceeds ${MAX_SCHEMA_SOURCE_DIRECTORY_DEPTH} levels.`);
    }
    directories += 1;
    if (directories > MAX_SCHEMA_SOURCE_DIRECTORIES) {
      throw new TypeError(`Schema source scope exceeds ${MAX_SCHEMA_SOURCE_DIRECTORIES} directories.`);
    }
    const directory = await opendir(absoluteDirectory);
    const entries = [];
    for await (const entry of directory) {
      entriesSeen += 1;
      if (entriesSeen > MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES) {
        throw new TypeError(`Schema source scope exceeds ${MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES} directory entries.`);
      }
      entries.push(entry);
    }
    entries.sort((left, right) => ordinalCompare(left.name, right.name));
    for (const entry of entries) {
      const relative = relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name;
      if (pathInside(relative, coveredRoots) || pathInside(relative, SCHEMA_SOURCE_EXEMPT_ROOTS)) continue;
      if ([...coveredRoots].some((root) => root.startsWith(`${relative}/`))) {
        if (!entry.isDirectory()) throw new TypeError(`Schema source scope ${relative} must be a directory.`);
        await visit(path.join(absoluteDirectory, entry.name), relative, depth + 1);
        continue;
      }
      if (coveredFiles.has(relative) || SCHEMA_SOURCE_EXEMPT_FILES.has(relative)) continue;
      if (entry.isDirectory() && SCHEMA_SOURCE_IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const absolute = path.join(absoluteDirectory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        throw new TypeError(`Schema source scope path ${relative} must not be a symbolic link.`);
      }
      if (metadata.isDirectory()) {
        await visit(absolute, relative, depth + 1);
      } else if (!metadata.isFile()) {
        throw new TypeError(`Schema source scope path ${relative} must be an ordinary file or directory.`);
      } else {
        throw new TypeError(`Schema source scope contains an unclassified source path: ${relative}`);
      }
    }
  };
  await visit(repositoryRoot, '', 0);
}

export async function discoverSchemaSources(
  repositoryRoot = DEFAULT_SCHEMA_SOURCE_REPOSITORY_ROOT,
): Promise<SchemaSourceDiscovery> {
  validateNonSourceFileLedger();
  await validateSchemaSourceScope(repositoryRoot);
  const traversal: SourceTraversalState = {
    files: [],
    nonSourceFiles: new Set<string>(),
    directories: 0,
    entries: 0,
    declaredBytes: 0,
  };
  for (const relativeRoot of SCHEMA_SOURCE_ROOTS) {
    await collectFiles(repositoryRoot, relativeRoot, traversal);
  }
  for (const relative of SCHEMA_SOURCE_NON_SOURCE_FILES) {
    if (!traversal.nonSourceFiles.has(relative)) {
      throw new TypeError(`Schema source non-source file allowance is stale or missing: ${relative}`);
    }
  }
  for (const relativeFile of SCHEMA_SOURCE_ROOT_FILES) {
    const stat = await lstat(path.join(repositoryRoot, relativeFile));
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new TypeError(`Schema source path ${relativeFile} must be an ordinary file.`);
    }
    traversal.entries += 1;
    if (traversal.entries > MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES) {
      throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES} directory entries.`);
    }
    if (stat.size > MAX_SCHEMA_SOURCE_FILE_BYTES) {
      throw new TypeError(`Schema source ${relativeFile} exceeds ${MAX_SCHEMA_SOURCE_FILE_BYTES} bytes.`);
    }
    traversal.declaredBytes += stat.size;
    if (traversal.declaredBytes > MAX_SCHEMA_SOURCE_TOTAL_BYTES) {
      throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_TOTAL_BYTES} aggregate bytes.`);
    }
    traversal.files.push(relativeFile);
  }
  const files = traversal.files.sort(ordinalCompare);
  if (files.length > MAX_SCHEMA_SOURCE_FILES) {
    throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_FILES} files.`);
  }

  const occurrences: SourceOccurrence[] = [];
  const definitions: SourceDefinition[] = [];
  const dynamicConstructions: DynamicConstruction[] = [];
  const imports: SourceImportBinding[] = [];
  const aliases: SourceSchemaAlias[] = [];
  const emitters: SourceSchemaEmitter[] = [];
  const localDeclarations: SourceLocalDeclaration[] = [];
  const referencedSymbolsByFile: Record<string, readonly string[]> = {};
  const digest = createHash('sha256');
  let totalBytes = 0;
  let referencedSymbolCount = 0;
  for (const file of files) {
    const raw = await readBoundedRegularFileWithin(repositoryRoot, file, {
      maximumBytes: MAX_SCHEMA_SOURCE_FILE_BYTES,
      minimumBytes: 0,
      label: `Schema source ${file}`,
    });
    totalBytes += raw.byteLength;
    if (totalBytes > MAX_SCHEMA_SOURCE_TOTAL_BYTES) {
      throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_TOTAL_BYTES} aggregate bytes.`);
    }
    const source = decodeBoundedUtf8(raw, `Schema source ${file}`);
    const result = discoverSchemaIdentifiersInSource(source, file);
    appendBounded(occurrences, result.occurrences, MAX_SCHEMA_SOURCE_OCCURRENCES, `Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_OCCURRENCES} occurrences.`);
    appendBounded(definitions, result.definitions, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} definitions.`);
    appendBounded(dynamicConstructions, result.dynamicConstructions, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} schema diagnostics.`);
    appendBounded(imports, result.imports, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} imports.`);
    appendBounded(aliases, result.aliases, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} aliases.`);
    appendBounded(emitters, result.emitters, MAX_SCHEMA_SOURCE_BINDINGS, `Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_BINDINGS} emitters.`);
    appendBounded(localDeclarations, result.localDeclarations, MAX_SCHEMA_SOURCE_REFERENCES, `Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_REFERENCES} local declarations.`);
    referencedSymbolCount += result.referencedSymbols.length;
    if (referencedSymbolCount > MAX_SCHEMA_SOURCE_REFERENCES) {
      throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_REFERENCES} symbol references.`);
    }
    referencedSymbolsByFile[file] = result.referencedSymbols;
    digest.update(file, 'utf8').update('\0').update(createHash('sha256').update(raw).digest('hex'), 'utf8').update('\n');
  }
  const identifiers = [...new Set([
    ...occurrences.map((item) => item.identifier),
    ...dynamicConstructions.flatMap((item) => item.identifier ? [item.identifier] : []),
  ])].sort(ordinalCompare);
  if (identifiers.length > MAX_SCHEMA_SOURCE_IDENTIFIERS) {
    throw new TypeError(`Schema source coverage exceeds ${MAX_SCHEMA_SOURCE_IDENTIFIERS} identifiers.`);
  }
  return Object.freeze({
    repositoryRoot,
    files: Object.freeze(files),
    totalBytes,
    identifiers: Object.freeze(identifiers),
    occurrences: Object.freeze(occurrences),
    definitions: Object.freeze(definitions),
    dynamicConstructions: Object.freeze(dynamicConstructions),
    imports: Object.freeze(imports),
    aliases: Object.freeze(aliases),
    emitters: Object.freeze(emitters),
    localDeclarations: Object.freeze(localDeclarations),
    referencedSymbolsByFile: Object.freeze(referencedSymbolsByFile),
    digestSha256: digest.digest('hex'),
  });
}

function validateClassification(value: unknown): asserts value is SchemaSourceClassificationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Schema source classification must be an object.');
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort();
  if (keys.join(',') !== 'identifier,kind,note,owner,reason,relatedEntryIds,sourceUses') {
    throw new TypeError('Schema source classification has an invalid field set.');
  }
  if (typeof item.identifier !== 'string'
    || tokens(item.identifier).length !== 1
    || tokens(item.identifier)[0] !== item.identifier
    || typeof item.kind !== 'string'
    || !CLASSIFICATION_KINDS.has(item.kind)
    || typeof item.reason !== 'string'
    || !CLASSIFICATION_REASONS.has(item.reason)
    || typeof item.owner !== 'string'
    || item.owner.length > MAX_SCHEMA_CLASSIFICATION_PATH_LENGTH
    || item.owner.startsWith('/')
    || item.owner.includes('..')
    || !Array.isArray(item.sourceUses)
    || item.sourceUses.length < 1
    || item.sourceUses.length > MAX_SCHEMA_CLASSIFICATION_SOURCE_USES
    || !Array.isArray(item.relatedEntryIds)
    || item.relatedEntryIds.length > MAX_SCHEMA_CLASSIFICATION_RELATED_ENTRIES
    || item.relatedEntryIds.some((id) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,79}$/u.test(id))
    || new Set(item.relatedEntryIds).size !== item.relatedEntryIds.length
    || typeof item.note !== 'string'
    || !item.note
    || item.note.length > MAX_SCHEMA_CLASSIFICATION_NOTE_LENGTH
    || /[\x00-\x1f\x7f]/u.test(item.note)) {
    throw new TypeError('Schema source classification has invalid bounded metadata.');
  }
  let previousFile = '';
  for (const rawUse of item.sourceUses) {
    if (!rawUse || typeof rawUse !== 'object' || Array.isArray(rawUse)) {
      throw new TypeError('Schema source classification has an invalid source-use ledger.');
    }
    const use = rawUse as Record<string, unknown>;
    if (Object.keys(use).sort().join(',') !== 'dynamicConstructions,file,literalOccurrences'
      || typeof use.file !== 'string'
      || !use.file
      || use.file.length > MAX_SCHEMA_CLASSIFICATION_PATH_LENGTH
      || use.file.startsWith('/')
      || use.file.includes('..')
      || (previousFile && ordinalCompare(previousFile, use.file) >= 0)
      || !Number.isSafeInteger(use.literalOccurrences)
      || (use.literalOccurrences as number) < 0
      || (use.literalOccurrences as number) > MAX_SCHEMA_SOURCE_OCCURRENCES
      || !Number.isSafeInteger(use.dynamicConstructions)
      || (use.dynamicConstructions as number) < 0
      || (use.dynamicConstructions as number) > MAX_SCHEMA_SOURCE_OCCURRENCES
      || (use.literalOccurrences as number) + (use.dynamicConstructions as number) < 1) {
      throw new TypeError('Schema source classification has an invalid source-use ledger.');
    }
    previousFile = use.file;
  }
  const kind = item.kind as keyof typeof CLASSIFICATION_REASONS_BY_KIND;
  if (!CLASSIFICATION_REASONS_BY_KIND[kind].has(item.reason as never)
    || (kind === 'member' && item.relatedEntryIds.length === 0)
    || (kind === 'non_schema' && item.relatedEntryIds.length !== 0)) {
    throw new TypeError('Schema source classification has inconsistent kind metadata.');
  }
}

async function ordinaryFile(repositoryRoot: string, relativeFile: string): Promise<boolean> {
  try {
    const stat = await lstat(path.join(repositoryRoot, relativeFile));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function sourceSymbolKey(file: string, symbol: string): string {
  return `${file}\0${symbol}`;
}

function resolveSourceModule(
  sourceFile: string,
  specifier: string,
  sourceFiles: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), specifier));
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) return null;
  const extension = path.posix.extname(base).toLowerCase();
  const candidates = [base];
  if (!extension) {
    for (const candidateExtension of SOURCE_EXTENSIONS) {
      candidates.push(`${base}${candidateExtension}`, `${base}/index${candidateExtension}`);
    }
  } else if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    const stem = base.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.mts`, `${stem}.cts`, `${stem}.tsx`);
  }
  return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

type ResolvedSchemaUse = Readonly<{
  source: SourceSchemaEmitter;
  identifier: string | null;
}>;

type CanonicalSourceBindings = Readonly<{
  byFile: ReadonlyMap<string, ReadonlySet<string>>;
  uses: readonly ResolvedSchemaUse[];
}>;

function buildCanonicalSourceBindings(
  discovery: SchemaSourceDiscovery,
  enforceRepositoryLedgers: boolean,
): CanonicalSourceBindings {
  const sourceFiles = new Set(discovery.files);
  const directByKey = new Map(discovery.definitions.map((definition) => [
    sourceSymbolKey(definition.file, definition.symbol),
    definition.identifier,
  ]));
  const aliasByKey = new Map(discovery.aliases.map((alias) => [
    sourceSymbolKey(alias.file, alias.symbol),
    alias,
  ]));
  const importsByKey = new Map<string, SourceImportBinding[]>();
  const wildcardReexportsByFile = new Map<string, SourceImportBinding[]>();
  for (const binding of discovery.imports) {
    if (binding.reexport && binding.local === '*' && binding.imported === '*') {
      wildcardReexportsByFile.set(binding.file, [...(wildcardReexportsByFile.get(binding.file) ?? []), binding]);
      continue;
    }
    const key = sourceSymbolKey(binding.file, binding.local);
    importsByKey.set(key, [...(importsByKey.get(key) ?? []), binding]);
  }
  const localDeclarationKeys = new Set(discovery.localDeclarations.map((item) => sourceSymbolKey(item.file, item.symbol)));

  const memo = new Map<string, string | null>();
  const resolve = (file: string, symbol: string, active = new Set<string>()): string | null => {
    const key = sourceSymbolKey(file, symbol);
    if (memo.has(key)) return memo.get(key) ?? null;
    if (active.has(key)) throw new Error(`Schema source alias cycle includes ${file}#${symbol}.`);
    if (active.size >= MAX_SCHEMA_SOURCE_AST_DEPTH) {
      throw new Error(`Schema source alias resolution exceeds ${MAX_SCHEMA_SOURCE_AST_DEPTH} levels at ${file}#${symbol}.`);
    }
    active.add(key);
    const direct = directByKey.get(key);
    const resolved = new Set<string>();
    if (direct) resolved.add(direct);
    const alias = aliasByKey.get(key);
    if (alias) {
      const target = resolve(file, alias.target, active);
      if (target) resolved.add(target);
    }
    if (direct || alias || !localDeclarationKeys.has(key)) {
      for (const binding of importsByKey.get(key) ?? []) {
        const targetFile = resolveSourceModule(file, binding.specifier, sourceFiles);
        if (!targetFile) continue;
        const target = resolve(targetFile, binding.imported, active);
        if (target) resolved.add(target);
      }
      for (const binding of wildcardReexportsByFile.get(file) ?? []) {
        const targetFile = resolveSourceModule(file, binding.specifier, sourceFiles);
        if (!targetFile) continue;
        const target = resolve(targetFile, symbol, active);
        if (target) resolved.add(target);
      }
    }
    active.delete(key);
    if (resolved.size > 1) {
      throw new Error(`Schema source binding ${file}#${symbol} resolves to multiple identifiers.`);
    }
    const result = [...resolved][0] ?? null;
    memo.set(key, result);
    return result;
  };

  for (const alias of discovery.aliases) {
    if (!resolve(alias.file, alias.symbol)) {
      throw new Error(`Schema source alias ${alias.file}:${alias.line} does not resolve to a canonical schema definition.`);
    }
  }

  const boundByFile = new Map<string, Set<string>>();
  const bind = (file: string, identifier: string | null) => {
    if (!identifier) return;
    const values = boundByFile.get(file) ?? new Set<string>();
    values.add(identifier);
    boundByFile.set(file, values);
  };
  for (const definition of discovery.definitions) bind(definition.file, definition.identifier);
  const dynamicAllowlist = new Map<string, readonly number[]>();
  const dynamicUseAllowlist = new Map<string, readonly number[]>();
  if (enforceRepositoryLedgers) {
    for (const [file, symbol, role, expectedLines] of SCHEMA_DYNAMIC_EMITTER_ALLOWLIST) {
      const key = `${sourceSymbolKey(file, symbol)}\0${role}`;
      if (dynamicAllowlist.has(key)) throw new Error(`Schema source dynamic-emitter allowance is duplicated: ${file}#${symbol}.`);
      dynamicAllowlist.set(key, expectedLines);
    }
    for (const [file, line, role] of SCHEMA_DYNAMIC_USE_ALLOWLIST) {
      const key = `${file}\0${line}\0${role}`;
      if (dynamicUseAllowlist.has(key)) throw new Error(`Schema source dynamic-use allowance is duplicated: ${file}:${line} (${role}).`);
      dynamicUseAllowlist.set(key, [line]);
    }
  }
  const usedDynamicAllowlist = new Map<string, number[]>();
  const usedDynamicUseAllowlist = new Map<string, number[]>();
  const uses: ResolvedSchemaUse[] = [];
  const unresolvedUses: string[] = [];
  for (const emitter of discovery.emitters) {
    const identifier = emitter.identifier ?? (emitter.symbol ? resolve(emitter.file, emitter.symbol) : null);
    if (!identifier) {
      const key = emitter.symbol ? `${sourceSymbolKey(emitter.file, emitter.symbol)}\0${emitter.role}` : '';
      const useKey = `${emitter.file}\0${emitter.line}\0${emitter.role}`;
      if (dynamicAllowlist.has(key)) {
        usedDynamicAllowlist.set(key, [...(usedDynamicAllowlist.get(key) ?? []), emitter.line]);
      } else if (dynamicUseAllowlist.has(useKey)) {
        usedDynamicUseAllowlist.set(useKey, [...(usedDynamicUseAllowlist.get(useKey) ?? []), emitter.line]);
      } else {
        if (unresolvedUses.length < 64) unresolvedUses.push(`${emitter.role} ${emitter.file}:${emitter.line}`);
      }
    }
    uses.push({ source: emitter, identifier });
    bind(emitter.file, identifier);
  }
  if (unresolvedUses.length) {
    throw new Error(`Schema source uses do not resolve to canonical schema definitions: ${unresolvedUses.join(', ')}.`);
  }
  for (const [allowedFile, allowedSymbol, allowedRole, expectedLines] of SCHEMA_DYNAMIC_EMITTER_ALLOWLIST) {
    if (!enforceRepositoryLedgers) break;
    const key = `${sourceSymbolKey(allowedFile, allowedSymbol)}\0${allowedRole}`;
    const actualLines = usedDynamicAllowlist.get(key) ?? [];
    if (!exactLineSet(actualLines, expectedLines)) {
      throw new Error(`Schema source dynamic-emitter allowance expected lines ${expectedLines.join(',')} but found ${[...actualLines].sort((left, right) => left - right).join(',') || 'none'}: ${allowedFile}#${allowedSymbol}.`);
    }
  }
  for (const [allowedFile, allowedLine, allowedRole] of SCHEMA_DYNAMIC_USE_ALLOWLIST) {
    if (!enforceRepositoryLedgers) break;
    const key = `${allowedFile}\0${allowedLine}\0${allowedRole}`;
    const actualLines = usedDynamicUseAllowlist.get(key) ?? [];
    if (!exactLineSet(actualLines, [allowedLine])) {
      throw new Error(`Schema source dynamic-use allowance expected one use at line ${allowedLine} but found ${actualLines.length}: ${allowedFile} (${allowedRole}).`);
    }
  }
  return {
    byFile: new Map([...boundByFile].map(([file, identifiers]) => [file, identifiers as ReadonlySet<string>])),
    uses: Object.freeze(uses),
  };
}

export async function validateSchemaSourceCoverage(
  entries: readonly SchemaCompatibilityEntry[],
  discovery: SchemaSourceDiscovery,
  classifications: readonly unknown[] = SCHEMA_SOURCE_CLASSIFICATIONS,
): Promise<SchemaSourceCoverage> {
  const enforceRepositoryLedgers = path.resolve(discovery.repositoryRoot) === DEFAULT_SCHEMA_SOURCE_REPOSITORY_ROOT;
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const inventoryBySchema = new Map<string, SchemaCompatibilityEntry[]>();
  for (const entry of entries) {
    if (!await ordinaryFile(discovery.repositoryRoot, entry.owner)) {
      throw new Error(`Schema compatibility owner ${entry.owner} is missing or is not an ordinary file.`);
    }
    if (entry.schema && tokens(entry.schema)[0] === entry.schema) {
      inventoryBySchema.set(entry.schema, [...(inventoryBySchema.get(entry.schema) ?? []), entry]);
    }
  }

  const definitionsByIdentifier = new Map<string, SourceDefinition[]>();
  for (const definition of discovery.definitions) {
    definitionsByIdentifier.set(
      definition.identifier,
      [...(definitionsByIdentifier.get(definition.identifier) ?? []), definition],
    );
  }
  for (const [identifier, definitions] of definitionsByIdentifier) {
    if (definitions.length > 1) {
      throw new Error(`Schema identifier has multiple definition owners: ${identifier} (${definitions.map((item) => `${item.file}:${item.line}`).join(', ')}).`);
    }
  }
  const literalEmittersByIdentifier = new Map<string, SourceSchemaEmitter[]>();
  for (const emitter of discovery.emitters) {
    if (!emitter.identifier || emitter.role !== 'writer') continue;
    literalEmittersByIdentifier.set(
      emitter.identifier,
      [...(literalEmittersByIdentifier.get(emitter.identifier) ?? []), emitter],
    );
  }
  const inlineAllowlist = new Map<string, readonly number[]>();
  if (enforceRepositoryLedgers) {
    for (const [identifier, file, expectedLines] of SCHEMA_INLINE_EMITTER_ALLOWLIST) {
      const key = `${identifier}\0${file}`;
      if (inlineAllowlist.has(key)) throw new Error(`Schema source inline-emitter allowance is duplicated: ${identifier} (${file}).`);
      inlineAllowlist.set(key, expectedLines);
    }
  }
  const usedInlineAllowlist = new Map<string, number[]>();
  for (const [identifier, emitters] of literalEmittersByIdentifier) {
    const definitions = definitionsByIdentifier.get(identifier) ?? [];
    if (!definitions.length && emitters.length > 1) {
      throw new Error(`Schema identifier has multiple inline emitters without one canonical definition: ${identifier} (${emitters.map((item) => `${item.file}:${item.line}`).join(', ')}).`);
    }
    const definitionFile = definitions[0]?.file ?? null;
    for (const emitter of emitters) {
      if (!definitionFile || emitter.file === definitionFile) continue;
      const key = `${identifier}\0${emitter.file}`;
      if (!inlineAllowlist.has(key)) {
        throw new Error(`Schema identifier has an unreviewed disconnected inline emitter: ${identifier} (${emitter.file}:${emitter.line}).`);
      }
      usedInlineAllowlist.set(key, [...(usedInlineAllowlist.get(key) ?? []), emitter.line]);
    }
  }
  for (const [identifier, file, expectedLines] of SCHEMA_INLINE_EMITTER_ALLOWLIST) {
    if (!enforceRepositoryLedgers) break;
    const key = `${identifier}\0${file}`;
    const actualLines = usedInlineAllowlist.get(key) ?? [];
    if (!exactLineSet(actualLines, expectedLines)) {
      throw new Error(`Schema source inline-emitter allowance expected lines ${expectedLines.join(',')} but found ${[...actualLines].sort((left, right) => left - right).join(',') || 'none'}: ${identifier} (${file}).`);
    }
  }
  const canonicalBindings = buildCanonicalSourceBindings(discovery, enforceRepositoryLedgers);

  const classificationByIdentifier = new Map<string, SchemaSourceClassificationRecord>();
  let previousClassification = '';
  for (const raw of classifications) {
    validateClassification(raw);
    if (previousClassification && ordinalCompare(previousClassification, raw.identifier) >= 0) {
      throw new Error('Schema source classifications must use unique ordinal identifier order.');
    }
    previousClassification = raw.identifier;
    if (classificationByIdentifier.has(raw.identifier) || inventoryBySchema.has(raw.identifier)) {
      throw new Error(`Schema source classification is duplicated or overlaps the inventory: ${raw.identifier}`);
    }
    if (!await ordinaryFile(discovery.repositoryRoot, raw.owner)) {
      throw new Error(`Schema source classification owner ${raw.owner} is missing or is not an ordinary file.`);
    }
    const actualSourceUses = new Map<string, { literalOccurrences: number; dynamicConstructions: number }>();
    for (const occurrence of discovery.occurrences) {
      if (occurrence.identifier !== raw.identifier) continue;
      const use = actualSourceUses.get(occurrence.file) ?? { literalOccurrences: 0, dynamicConstructions: 0 };
      use.literalOccurrences += 1;
      actualSourceUses.set(occurrence.file, use);
    }
    for (const dynamic of discovery.dynamicConstructions) {
      if (dynamic.identifier !== raw.identifier) continue;
      const use = actualSourceUses.get(dynamic.file) ?? { literalOccurrences: 0, dynamicConstructions: 0 };
      use.dynamicConstructions += 1;
      actualSourceUses.set(dynamic.file, use);
    }
    const expectedSourceUses = new Map(raw.sourceUses.map((use) => [use.file, use]));
    const sourceUseFiles = [...new Set([...actualSourceUses.keys(), ...expectedSourceUses.keys()])].sort(ordinalCompare);
    const sourceUseMismatch = sourceUseFiles.find((file) => {
      const actual = actualSourceUses.get(file) ?? { literalOccurrences: 0, dynamicConstructions: 0 };
      const expected = expectedSourceUses.get(file) ?? { literalOccurrences: 0, dynamicConstructions: 0 };
      return actual.literalOccurrences !== expected.literalOccurrences
        || actual.dynamicConstructions !== expected.dynamicConstructions;
    });
    if (sourceUseMismatch) {
      const actual = actualSourceUses.get(sourceUseMismatch) ?? { literalOccurrences: 0, dynamicConstructions: 0 };
      const expected = expectedSourceUses.get(sourceUseMismatch) ?? { literalOccurrences: 0, dynamicConstructions: 0 };
      throw new Error(`Schema source classification ${raw.identifier} expected ${expected.literalOccurrences} literal and ${expected.dynamicConstructions} dynamic use(s) in ${sourceUseMismatch}, but found ${actual.literalOccurrences} literal and ${actual.dynamicConstructions} dynamic use(s).`);
    }
    if (!expectedSourceUses.has(raw.owner)) {
      throw new Error(`Schema source classification owner ${raw.owner} is not present in its source-use ledger.`);
    }
    for (const id of raw.relatedEntryIds) {
      if (!entryById.has(id)) throw new Error(`Schema source classification ${raw.identifier} references an unknown compatibility entry ${id}.`);
    }
    classificationByIdentifier.set(raw.identifier, raw);
  }

  const discovered = new Set(discovery.identifiers);
  for (const identifier of discovery.identifiers) {
    if (!inventoryBySchema.has(identifier) && !classificationByIdentifier.has(identifier)) {
      throw new Error(`Schema source identifier is not inventoried or classified: ${identifier}`);
    }
  }
  for (const identifier of inventoryBySchema.keys()) {
    if (!discovered.has(identifier)) throw new Error(`Schema compatibility identifier is no longer present in production sources: ${identifier}`);
  }
  for (const identifier of classificationByIdentifier.keys()) {
    if (!discovered.has(identifier)) throw new Error(`Schema source classification is stale: ${identifier}`);
  }

  const classificationsThatMayEmit = new Set(['provenance_marker', 'serialised_unversioned', 'transient_projection']);
  for (const use of canonicalBindings.uses) {
    if (use.source.role !== 'writer' || !use.identifier) continue;
    const classification = classificationByIdentifier.get(use.identifier);
    if (classification && !classificationsThatMayEmit.has(classification.reason)) {
      throw new Error(`Schema source classification ${use.identifier} cannot mask a schema emitter at ${use.source.file}:${use.source.line}.`);
    }
  }

  for (const dynamic of discovery.dynamicConstructions) {
    const allowedDynamicNonSchema = dynamic.reason === 'dynamic'
      && dynamic.identifier
      && classificationByIdentifier.get(dynamic.identifier)?.kind === 'non_schema'
      && classificationByIdentifier.get(dynamic.identifier)?.owner === dynamic.file;
    if (!allowedDynamicNonSchema) {
      throw new Error(`Schema-like identifier has an unsafe ${dynamic.reason.replaceAll('_', ' ')} at ${dynamic.file}:${dynamic.line}; use one exact-case canonical literal or imported constant.`);
    }
  }

  const ownerUseAllowlist = new Map<string, { owner: string; role: 'reader' | 'writer'; expectedLines: readonly number[] }>();
  if (enforceRepositoryLedgers) {
    for (const [entryId, owner, role, expectedLines] of SCHEMA_OWNER_USE_ALLOWLIST) {
      if (ownerUseAllowlist.has(entryId)) throw new Error(`Schema source owner-use allowance is duplicated: ${entryId}.`);
      ownerUseAllowlist.set(entryId, { owner, role, expectedLines });
    }
  }
  const usedOwnerAllowlist = new Set<string>();
  for (const [identifier, schemaEntries] of inventoryBySchema) {
    for (const entry of schemaEntries) {
      const definitions = definitionsByIdentifier.get(identifier) ?? [];
      if (definitions.some((definition) => definition.file === entry.owner)) continue;
      const literalWriters = literalEmittersByIdentifier.get(identifier) ?? [];
      if (!definitions.length
        && literalWriters.length === 1
        && literalWriters[0]?.file === entry.owner) continue;
      const allowance = ownerUseAllowlist.get(entry.id);
      if (allowance && allowance.owner === entry.owner) {
        const actualLines = canonicalBindings.uses.filter((use) => (
          use.identifier === identifier
          && use.source.file === entry.owner
          && use.source.role === allowance.role
        )).map((use) => use.source.line);
        if (!exactLineSet(actualLines, allowance.expectedLines)) {
          throw new Error(`Schema source owner-use allowance expected lines ${allowance.expectedLines.join(',')} but found ${[...actualLines].sort((left, right) => left - right).join(',') || 'none'}: ${entry.id}.`);
        }
        usedOwnerAllowlist.add(entry.id);
        continue;
      }
      throw new Error(`Schema compatibility owner ${entry.owner} is not the canonical definition or a reviewed producer or reader of ${identifier}.`);
    }
  }
  if (enforceRepositoryLedgers) {
    for (const entryId of ownerUseAllowlist.keys()) {
      if (!usedOwnerAllowlist.has(entryId)) throw new Error(`Schema source owner-use allowance is stale: ${entryId}.`);
    }
  }

  return Object.freeze({
    files: discovery.files.length,
    totalBytes: discovery.totalBytes,
    identifiers: discovery.identifiers.length,
    inventoriedIdentifiers: inventoryBySchema.size,
    classifiedIdentifiers: classificationByIdentifier.size,
    definitions: discovery.definitions.length,
    digestSha256: discovery.digestSha256,
  });
}

export async function reconcileSchemaSourceCoverage(
  entries: readonly SchemaCompatibilityEntry[],
  repositoryRoot?: string,
): Promise<SchemaSourceCoverage> {
  const discovery = await discoverSchemaSources(repositoryRoot);
  return validateSchemaSourceCoverage(entries, discovery);
}
