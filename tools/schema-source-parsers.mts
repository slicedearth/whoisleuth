import path from 'node:path';

import ts from 'typescript';

import { scanBoundedJson } from '../lib/bounded-json.mts';
import {
  LOCAL_SCHEMA_IDENTIFIER_SOURCE,
  isCanonicalLocalSchemaIdentifier,
} from '../packages/contracts/schema-compatibility.mts';

export const MAX_SCHEMA_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SCHEMA_SOURCE_OCCURRENCES = 10_000;
export const MAX_SCHEMA_SOURCE_BINDINGS = 10_000;
export const MAX_SCHEMA_SOURCE_AST_NODES = 250_000;
export const MAX_SCHEMA_SOURCE_AST_DEPTH = 256;
export const MAX_SCHEMA_SOURCE_CANDIDATE_BYTES = 4 * 1024;
export const MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS = 4_096;
export const MAX_SCHEMA_SOURCE_JSON_DEPTH = 48;
export const MAX_SCHEMA_SOURCE_JSON_VALUES = 100_000;
export const MAX_SCHEMA_SOURCE_JSON_CONTAINER_ITEMS = 10_000;

const TOKEN_PATTERN = new RegExp(`(?<![a-z0-9._:-])${LOCAL_SCHEMA_IDENTIFIER_SOURCE}(?![a-z0-9._:-])`, 'gu');
const CASE_INSENSITIVE_TOKEN_PATTERN = new RegExp(`(?<![a-z0-9._:-])${LOCAL_SCHEMA_IDENTIFIER_SOURCE}(?![a-z0-9._:-])`, 'giu');
const DEFINITION_NAME_PATTERN = /(?:^|_)SCHEMA$/u;

const SCHEMA_METADATA_FILES = new Set([
  'lib/interchange-fidelity-registry.mts',
  'packages/contracts/case-portability.mts',
  'packages/contracts/external-observation-interchange.mts',
  'packages/contracts/investigation-portability.mts',
  'packages/contracts/offline-comparison.mts',
  'packages/contracts/schema-compatibility.mts',
  'packages/contracts/schema-lifecycle.mts',
  'packages/contracts/workspace-portability.mts',
  'tools/public-product-catalogue-renderer.mts',
  'tools/schema-compatibility.mts',
  'tools/schema-source-coverage.mts',
  'tools/schema-source-parsers.mts',
]);
export const SCHEMA_DYNAMIC_USE_ALLOWLIST = Object.freeze([
  ['cli/archive-inspect.mts', 'writer', 2, 'Copies validated archive markers into inspection projections.'],
  ['cli/artifact-validation/signed-review.mts', 'reader', 1, 'Confirms a directly selected signed-review contract before family-specific validation.'],
  ['cli/artifact-verify.mts', 'reader', 1, 'Compares bounded artifact markers during manifest verification.'],
  ['cli/artifact-verify.mts', 'writer', 7, 'Projects verified canonical and bounded artifact markers into reports.'],
  ['cli/evidence-signing.mts', 'writer', 1, 'Copies a verified source-artifact marker into signature metadata.'],
  ['cli/export-evidence.mts', 'reader', 1, 'Checks a builder result against its injected canonical contract marker.'],
  ['cli/formatters/json.mts', 'writer', 1, 'Projects the selected canonical CLI result marker.'],
  ['cli/interchange-report.mts', 'reader', 1, 'Matches a bounded container marker to a reviewed interchange contract.'],
  ['cli/interchange-report.mts', 'writer', 1, 'Copies the matched interchange marker into a report.'],
  ['cli/investigation-manifest.mts', 'writer', 1, 'Projects a reviewed manifest-entry marker.'],
  ['cli/retained-artifact-diff.mts', 'reader', 1, 'Requires bounded retained documents to declare the same marker.'],
  ['cli/risk-calibration.mts', 'writer', 1, 'Copies the validated calibration marker into report metadata.'],
  ['cli/sharing-review.mts', 'writer', 1, 'Projects a bounded reviewed artifact marker.'],
  ['frontend/src/lib/browser-local-data-definitions.ts', 'reader', 1, 'Compares the marker selected by a canonical collection definition.'],
  ['frontend/src/lib/components/CaseRenderedCapture.svelte', 'reader', 1, 'Dispatches a selected local capture through the canonical manifest reader.'],
  ['frontend/src/lib/components/ExternalFindingsImport.svelte', 'reader', 4, 'Dispatches bounded local imports through reviewed marker families.'],
  ['frontend/src/routes/(console)/bulk/+page.svelte', 'writer', 1, 'Initialises a browser-local store from its reviewed contract constant.'],
  ['packages/cases/case-response-model.mts', 'writer', 1, 'Copies bounded source-provenance fields after local normalisation.'],
  ['packages/contracts/analyst-interchange.mts', 'writer', 1, 'Registers the reviewed external profile identity.'],
  ['packages/contracts/case-supported-contract-baseline.mts', 'writer', 1, 'Projects a validated compatibility marker into the Case baseline.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 'reader', 1, 'Matches immutable fixtures to registered lifecycle contracts.'],
  ['packages/contracts/extracted-domain-lifecycle.mts', 'writer', 7, 'Projects statically registered lifecycle identities.'],
  ['packages/contracts/privacy-data-flow-catalogue.mts', 'writer', 5, 'Projects validated canonical lifecycle identities.'],
  ['packages/interchange/external-findings-converters.mts', 'reader', 1, 'Checks a marker supplied by a reviewed observation-row adapter.'],
  ['packages/interchange/external-findings-import.mts', 'reader', 1, 'Compares bounded nested source-provenance markers.'],
  ['packages/interchange/external-findings-import.mts', 'writer', 1, 'Copies a validated nested source-provenance marker.'],
  ['packages/investigation/investigation-capsule.mts', 'writer', 1, 'Projects the linked evidence contract marker.'],
  ['packages/monitoring/scheduled-monitor-model.mts', 'writer', 1, 'Copies a normalised monitor-state marker into an export.'],
  ['packages/relationships/case-relationship-graph-export.mts', 'writer', 2, 'Copies canonical graph markers into portable projections.'],
  ['packages/workspace/workspace-archive-crypto.mts', 'writer', 1, 'Copies a validated envelope marker into authenticated metadata.'],
  ['packages/workspace/workspace-archive.mts', 'reader', 3, 'Compares bounded archive-section markers with canonical definitions.'],
  ['packages/workspace/workspace-archive.mts', 'writer', 7, 'Projects canonical section markers into runtime definitions and manifests.'],
  ['tools/evidence-storage-measurement.mts', 'writer', 1, 'Copies a validated measurement-fixture marker into the deterministic profile.'],
  ['tools/first-use-analyst-study.mts', 'writer', 2, 'Projects fixed study-task markers into local reports.'],
  ['tools/registry-fixture-freshness.mts', 'writer', 1, 'Copies fixed fixture provenance into a maintainer report.'],
  ['tools/synthetic-analyst-journeys.mts', 'writer', 3, 'Projects fixed journey markers into maintainer results.'],
  ['tools/technology-example-review.mts', 'writer', 3, 'Projects fixed review-input and provenance markers.'],
  ['tools/technology-fixture-review.mts', 'reader', 1, 'Checks a bounded fixture against its reviewed source marker.'],
  ['tools/technology-fixture-review.mts', 'writer', 1, 'Copies a fixed reviewed-fixture marker into a maintainer record.'],
  ['tools/technology-review-candidate.mts', 'writer', 1, 'Copies a fixed review-input marker into a candidate record.'],
  ['tools/technology-signature-benchmark.mts', 'writer', 2, 'Copies fixed signature-fixture markers into a benchmark record.'],
] as const);

export type SourceOccurrence = Readonly<{
  identifier: string;
  file: string;
  line: number;
}>;

export type SourceDefinition = Readonly<{
  identifier: string;
  file: string;
  line: number;
  symbol: string;
}>;

export type DynamicConstruction = Readonly<{
  file: string;
  line: number;
  identifier: string | null;
  reason: 'case_changed' | 'dynamic' | 'malformed_schema_identifier' | 'non_literal_schema_declaration' | 'unresolved_schema_alias' | 'unresolved_schema_emitter';
}>;

export type SourceImportBinding = Readonly<{
  file: string;
  line: number;
  local: string;
  imported: string;
  specifier: string;
  reexport: boolean;
}>;

export type SourceSchemaAlias = Readonly<{
  file: string;
  line: number;
  symbol: string;
  target: string;
}>;

export type SourceSchemaEmitter = Readonly<{
  identifier: string | null;
  file: string;
  line: number;
  symbol: string | null;
  role: 'reader' | 'writer';
}>;

export type SourceLocalDeclaration = Readonly<{
  file: string;
  line: number;
  symbol: string;
}>;

export type SourceFileDiscovery = Readonly<{
  occurrences: readonly SourceOccurrence[];
  definitions: readonly SourceDefinition[];
  dynamicConstructions: readonly DynamicConstruction[];
  imports: readonly SourceImportBinding[];
  aliases: readonly SourceSchemaAlias[];
  emitters: readonly SourceSchemaEmitter[];
  localDeclarations: readonly SourceLocalDeclaration[];
  referencedSymbols: readonly string[];
}>;

export function tokens(value: string): string[] {
  return [...value.matchAll(TOKEN_PATTERN)].flatMap((match) => match[0] ? [match[0]] : []);
}

function exactSchemaIdentifier(value: string): string | null {
  return isCanonicalLocalSchemaIdentifier(value) ? value : null;
}

function hasLocalSchemaPrefix(value: string): boolean {
  return /^whoisleuth\./iu.test(value);
}

export function appendBounded<Value>(
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
  for (let syntaxKind = scanner.scan(); syntaxKind !== ts.SyntaxKind.EndOfFileToken; syntaxKind = scanner.scan()) {
    if (syntaxKind === ts.SyntaxKind.OpenParenToken
      || syntaxKind === ts.SyntaxKind.OpenBracketToken
      || syntaxKind === ts.SyntaxKind.OpenBraceToken) {
      depth += 1;
      if (depth > MAX_SCHEMA_SOURCE_AST_DEPTH) {
        throw new TypeError(`Schema source ${file} exceeds ${MAX_SCHEMA_SOURCE_AST_DEPTH} lexical nesting levels.`);
      }
    } else if (syntaxKind === ts.SyntaxKind.CloseParenToken
      || syntaxKind === ts.SyntaxKind.CloseBracketToken
      || syntaxKind === ts.SyntaxKind.CloseBraceToken) {
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
      if (!SCHEMA_DYNAMIC_USE_ALLOWLIST.some(([allowedFile, allowedRole]) => (
        allowedFile === file && allowedRole === pending.role
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
