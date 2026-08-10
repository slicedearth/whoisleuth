#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { parseBoundedJsonObject } from '../lib/bounded-json.mts';
import { compareCodeUnits } from './maintainer-tool-helpers.mts';

type WritableLike = { write(value: string): unknown };
type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type FunctionCandidate = Readonly<{
  id: string;
  file: string;
  name: string;
  line: number;
  lineCount: number;
  tokenCount: number;
  signature: string;
  node: FunctionNode;
}>;
type ReportOptions = Readonly<{
  repositoryRoot?: string;
}>;
type MainOptions = ReportOptions & Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export const MAINTAINER_DUPLICATION_REPORT_SCHEMA = 'whoisleuth.maintainer-duplication-report';
export const MAINTAINER_DUPLICATION_REPORT_VERSION = 1;
export const MAX_MAINTAINER_TOOL_FILES = 64;
export const MAX_MAINTAINER_TOOL_FILE_BYTES = 512 * 1024;
export const MAX_MAINTAINER_TOOL_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_MAINTAINER_TOOL_AST_NODES = 200_000;
export const MAX_MAINTAINER_TOOL_FUNCTIONS = 2_000;
export const MAX_MAINTAINER_TOOL_CALL_EDGES = 8_000;
export const MAX_MAINTAINER_DUPLICATE_CLUSTERS = 256;
export const MAX_MAINTAINER_DUPLICATE_MEMBERS = 32;
export const MAX_MAINTAINER_DUPLICATION_REPORT_BYTES = 2 * 1024 * 1024;

const TOOL_NAME_RE = /^[a-z0-9][a-z0-9.-]*\.mts$/u;
const MIN_DUPLICATE_TOKENS = 12;

function sourceLine(source: ts.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

function normalizedBody(body: ts.ConciseBody, source: ts.SourceFile): Readonly<{ signature: string; tokenCount: number }> {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    body.getText(source),
  );
  const tokens: string[] = [];
  while (true) {
    const token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) break;
    tokens.push(`${token}:${scanner.getTokenText()}`);
  }
  return Object.freeze({ signature: tokens.join('\u0000'), tokenCount: tokens.length });
}

function functionCandidate(
  file: string,
  source: ts.SourceFile,
  name: string,
  node: FunctionNode,
): FunctionCandidate | null {
  if (!node.body) return null;
  const normalized = normalizedBody(node.body, source);
  const line = sourceLine(source, node.getStart(source));
  const endLine = sourceLine(source, node.end);
  return Object.freeze({
    id: `${file}#${name}`,
    file,
    name,
    line,
    lineCount: endLine - line + 1,
    tokenCount: normalized.tokenCount,
    signature: normalized.signature,
    node,
  });
}

function topLevelFunctions(file: string, source: ts.SourceFile): readonly FunctionCandidate[] {
  const candidates: FunctionCandidate[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const candidate = functionCandidate(file, source, statement.name.text, statement);
      if (candidate) candidates.push(candidate);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer
        || (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer))) continue;
      const candidate = functionCandidate(file, source, declaration.name.text, declaration.initializer);
      if (candidate) candidates.push(candidate);
    }
  }
  return Object.freeze(candidates.sort((left, right) => left.line - right.line || compareCodeUnits(left.name, right.name)));
}

function localImportTarget(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  if (target.startsWith('../') || target === '..') return null;
  return target;
}

function importedBindings(file: string, source: ts.SourceFile): Readonly<{
  names: ReadonlyMap<string, string>;
  namespaces: ReadonlyMap<string, string>;
  imports: readonly string[];
}> {
  const names = new Map<string, string>();
  const namespaces = new Map<string, string>();
  const imports = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = localImportTarget(file, statement.moduleSpecifier.text);
    if (!target) continue;
    imports.add(target);
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) names.set(clause.name.text, `${target}#default`);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.set(clause.namedBindings.name.text, target);
    } else if (clause.namedBindings) {
      for (const element of clause.namedBindings.elements) {
        names.set(element.name.text, `${target}#${element.propertyName?.text ?? element.name.text}`);
      }
    }
  }
  return Object.freeze({
    names,
    namespaces,
    imports: Object.freeze([...imports].sort()),
  });
}

function collectCallEdges(
  file: string,
  source: ts.SourceFile,
  functions: readonly FunctionCandidate[],
): Readonly<{ calls: readonly Readonly<{ caller: string; callee: string; kind: 'local' | 'imported' }>[]; imports: readonly string[] }> {
  const bindings = importedBindings(file, source);
  const local = new Map(functions.map((candidate) => [candidate.name, candidate.id]));
  const edges = new Map<string, Readonly<{ caller: string; callee: string; kind: 'local' | 'imported' }>>();
  const addCalls = (root: ts.Node, caller: string, excluded: ReadonlySet<ts.Node> = new Set()) => {
    const visit = (node: ts.Node): void => {
      if (node !== root && excluded.has(node)) return;
      if (ts.isCallExpression(node)) {
        let callee: string | null = null;
        let kind: 'local' | 'imported' = 'local';
        if (ts.isIdentifier(node.expression)) {
          callee = local.get(node.expression.text) ?? bindings.names.get(node.expression.text) ?? null;
          kind = local.has(node.expression.text) ? 'local' : 'imported';
        } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
          const target = bindings.namespaces.get(node.expression.expression.text);
          if (target) {
            callee = `${target}#${node.expression.name.text}`;
            kind = 'imported';
          }
        }
        if (callee) {
          const edge = Object.freeze({ caller, callee, kind });
          edges.set(`${caller}\u0000${callee}\u0000${kind}`, edge);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
  };
  for (const candidate of functions) addCalls(candidate.node, candidate.id);
  addCalls(source, `${file}#<module>`, new Set(functions.map((candidate) => candidate.node)));
  const calls = [...edges.values()].sort((left, right) => (
    compareCodeUnits(left.caller, right.caller)
    || compareCodeUnits(left.callee, right.callee)
    || compareCodeUnits(left.kind, right.kind)
  ));
  if (calls.length > MAX_MAINTAINER_TOOL_CALL_EDGES) {
    throw new TypeError(`Maintainer-tool call graph exceeds ${MAX_MAINTAINER_TOOL_CALL_EDGES} static edges.`);
  }
  return Object.freeze({ calls: Object.freeze(calls), imports: bindings.imports });
}

function packageToolEntrypoints(packageDocument: Record<string, unknown>): ReadonlySet<string> {
  const scripts = packageDocument.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return new Set();
  const output = new Set<string>();
  for (const value of Object.values(scripts)) {
    if (typeof value !== 'string' || value.length > 2_000) continue;
    for (const match of value.matchAll(/(?:^|[\s'"=])(tools\/[a-z0-9][a-z0-9.-]*\.mts)(?=$|[\s'";])/gu)) {
      if (match[1]) output.add(match[1]);
    }
  }
  return output;
}

export async function buildMaintainerDuplicationReport(options: ReportOptions = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? path.resolve(fileURLToPath(new URL('..', import.meta.url))));
  const toolRoot = path.join(repositoryRoot, 'tools');
  const directory = await readdir(toolRoot, { withFileTypes: true });
  const toolEntries = directory.filter((entry) => entry.name.endsWith('.mts'));
  if (!toolEntries.length || toolEntries.length > MAX_MAINTAINER_TOOL_FILES) {
    throw new TypeError(`Maintainer-tool inventory must contain 1-${MAX_MAINTAINER_TOOL_FILES} modules.`);
  }
  for (const entry of toolEntries) {
    if (!entry.isFile() || !TOOL_NAME_RE.test(entry.name)) {
      throw new TypeError('Maintainer-tool inventory contains a non-regular or unsupported module name.');
    }
  }
  const packageRaw = await readBoundedRegularTextFile(path.join(repositoryRoot, 'package.json'), {
    maximumBytes: MAX_MAINTAINER_TOOL_FILE_BYTES,
    minimumBytes: 2,
    label: 'Package manifest',
  });
  const packageDocument = parseBoundedJsonObject(packageRaw, {
    label: 'Package manifest',
    maximumBytes: MAX_MAINTAINER_TOOL_FILE_BYTES,
  });
  const scriptedEntrypoints = packageToolEntrypoints(packageDocument);
  const files: Array<Readonly<{ file: string; bytes: number; entrypoint: boolean; functionCount: number; directLocalImports: readonly string[] }>> = [];
  const allFunctions: FunctionCandidate[] = [];
  const allCalls: Array<Readonly<{ caller: string; callee: string; kind: 'local' | 'imported' }>> = [];
  let totalBytes = 0;
  let astNodes = 0;

  for (const entry of toolEntries.sort((left, right) => compareCodeUnits(left.name, right.name))) {
    const file = `tools/${entry.name}`;
    const text = await readBoundedRegularTextFile(path.join(toolRoot, entry.name), {
      maximumBytes: MAX_MAINTAINER_TOOL_FILE_BYTES,
      minimumBytes: 1,
      label: file,
    });
    const bytes = new TextEncoder().encode(text).byteLength;
    totalBytes += bytes;
    if (totalBytes > MAX_MAINTAINER_TOOL_TOTAL_BYTES) {
      throw new TypeError(`Maintainer-tool source exceeds the ${MAX_MAINTAINER_TOOL_TOTAL_BYTES}-byte aggregate limit.`);
    }
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const countNode = (node: ts.Node): void => {
      astNodes += 1;
      if (astNodes > MAX_MAINTAINER_TOOL_AST_NODES) {
        throw new TypeError(`Maintainer-tool syntax exceeds ${MAX_MAINTAINER_TOOL_AST_NODES} AST nodes.`);
      }
      ts.forEachChild(node, countNode);
    };
    countNode(source);
    const functions = topLevelFunctions(file, source);
    allFunctions.push(...functions);
    if (allFunctions.length > MAX_MAINTAINER_TOOL_FUNCTIONS) {
      throw new TypeError(`Maintainer-tool inventory exceeds ${MAX_MAINTAINER_TOOL_FUNCTIONS} top-level functions.`);
    }
    const graph = collectCallEdges(file, source, functions);
    allCalls.push(...graph.calls);
    if (allCalls.length > MAX_MAINTAINER_TOOL_CALL_EDGES) {
      throw new TypeError(`Maintainer-tool call graph exceeds ${MAX_MAINTAINER_TOOL_CALL_EDGES} static edges.`);
    }
    files.push(Object.freeze({
      file,
      bytes,
      entrypoint: text.startsWith('#!/usr/bin/env node') || scriptedEntrypoints.has(file),
      functionCount: functions.length,
      directLocalImports: graph.imports,
    }));
  }

  const duplicateGroups = new Map<string, FunctionCandidate[]>();
  for (const candidate of allFunctions) {
    if (candidate.tokenCount < MIN_DUPLICATE_TOKENS) continue;
    const values = duplicateGroups.get(candidate.signature) ?? [];
    values.push(candidate);
    duplicateGroups.set(candidate.signature, values);
  }
  const exactClusters = [...duplicateGroups.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([signature, values]) => {
      if (values.length > MAX_MAINTAINER_DUPLICATE_MEMBERS) {
        throw new TypeError(`Exact duplicate cluster exceeds ${MAX_MAINTAINER_DUPLICATE_MEMBERS} functions.`);
      }
      const members = values
        .map((candidate) => Object.freeze({
          id: candidate.id,
          file: candidate.file,
          name: candidate.name,
          line: candidate.line,
          lineCount: candidate.lineCount,
        }))
        .sort((left, right) => compareCodeUnits(left.id, right.id));
      return Object.freeze({
        id: `exact-${createHash('sha256').update(signature).digest('hex').slice(0, 16)}`,
        tokenCount: values[0]!.tokenCount,
        memberCount: members.length,
        repeatedLineCount: members.slice(1).reduce((sum, member) => sum + member.lineCount, 0),
        members: Object.freeze(members),
      });
    })
    .sort((left, right) => right.repeatedLineCount - left.repeatedLineCount || compareCodeUnits(left.id, right.id));
  if (exactClusters.length > MAX_MAINTAINER_DUPLICATE_CLUSTERS) {
    throw new TypeError(`Exact duplicate inventory exceeds ${MAX_MAINTAINER_DUPLICATE_CLUSTERS} clusters.`);
  }
  const callEdges = [...new Map(allCalls.map((edge) => [`${edge.caller}\u0000${edge.callee}\u0000${edge.kind}`, edge])).values()]
    .sort((left, right) => compareCodeUnits(left.caller, right.caller) || compareCodeUnits(left.callee, right.callee));
  const report = Object.freeze({
    schema: MAINTAINER_DUPLICATION_REPORT_SCHEMA,
    version: MAINTAINER_DUPLICATION_REPORT_VERSION,
    scope: Object.freeze({
      root: 'tools/*.mts',
      fileCount: files.length,
      entrypointCount: files.filter((file) => file.entrypoint).length,
      totalBytes,
      astNodeCount: astNodes,
      topLevelFunctionCount: allFunctions.length,
    }),
    files: Object.freeze(files),
    callGraph: Object.freeze({
      staticEdgeCount: callEdges.length,
      edges: Object.freeze(callEdges),
    }),
    repeatedImplementations: Object.freeze({
      exactClusterCount: exactClusters.length,
      repeatedFunctionCount: exactClusters.reduce((sum, cluster) => sum + cluster.memberCount - 1, 0),
      repeatedLineCount: exactClusters.reduce((sum, cluster) => sum + cluster.repeatedLineCount, 0),
      exactClusters: Object.freeze(exactClusters),
    }),
    limitations: Object.freeze([
      'The call graph resolves direct calls to top-level local functions and statically imported bindings. Method dispatch, callbacks, computed properties, and runtime imports remain outside this bounded report.',
      'Repeated implementations are exact comment-free token matches. Similar intent with different tokens is not labelled duplicate, and a match is evidence for review rather than automatic consolidation.',
      'The report contains repository-relative module and function metadata only. It does not retain source text, literals, environment values, absolute paths, or runtime data.',
    ]),
  });
  const reportBytes = new TextEncoder().encode(JSON.stringify(report)).byteLength;
  if (reportBytes > MAX_MAINTAINER_DUPLICATION_REPORT_BYTES) {
    throw new TypeError(`Maintainer-tool report exceeds ${MAX_MAINTAINER_DUPLICATION_REPORT_BYTES} bytes.`);
  }
  return report;
}

export function formatMaintainerDuplicationReport(report: Awaited<ReturnType<typeof buildMaintainerDuplicationReport>>): string {
  const lines = [
    'WHOISleuth maintainer-tool duplication report',
    `Scope: ${report.scope.fileCount} modules · ${report.scope.entrypointCount} entry points · ${report.scope.topLevelFunctionCount} top-level functions · ${report.scope.totalBytes} bytes`,
    `Static call graph: ${report.callGraph.staticEdgeCount} resolved edges`,
    `Exact repeated implementations: ${report.repeatedImplementations.exactClusterCount} clusters · ${report.repeatedImplementations.repeatedFunctionCount} repeated functions · ${report.repeatedImplementations.repeatedLineCount} repeated lines`,
  ];
  for (const cluster of report.repeatedImplementations.exactClusters) {
    lines.push(`- ${cluster.id}: ${cluster.members.map((member) => `${member.file}:${member.line} ${member.name}`).join(' · ')}`);
  }
  lines.push('', 'Limits:');
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  return `${lines.join('\n')}\n`;
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const unknown = args.filter((argument) => argument !== '--json');
  if (unknown.length || args.filter((argument) => argument === '--json').length > 1) {
    options.stderr?.write('Usage: node tools/maintainer-duplication-report.mts [--json]\n');
    return 2;
  }
  try {
    const report = await buildMaintainerDuplicationReport(options);
    (options.stdout ?? process.stdout).write(args.includes('--json')
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatMaintainerDuplicationReport(report));
    return 0;
  } catch (reason) {
    (options.stderr ?? process.stderr).write(`${reason instanceof Error ? reason.message : 'Maintainer-tool report failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
