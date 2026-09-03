#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { parseBoundedJsonObject } from '../lib/bounded-json.mts';
import { compareCodeUnits } from './maintainer-tool-helpers.mts';

type WritableLike = { write(value: string): unknown };
type AssignedFunctionNode = ts.ArrowFunction | ts.FunctionExpression;
type NamedFunctionNode = ts.FunctionDeclaration
  | AssignedFunctionNode
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;
type FunctionCandidate = Readonly<{
  id: string;
  file: string;
  name: string;
  line: number;
  lineCount: number;
  tokenCount: number;
  signature: string;
  node: NamedFunctionNode;
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
export const MAINTAINED_SOURCE_ROOTS = Object.freeze([
  'bin',
  'cli',
  'frontend/src/lib',
  'frontend/src/routes',
  'lib',
  'netlify/functions',
  'packages',
  'tools',
]);
export const MAINTAINED_ROOT_SOURCE_FILES = Object.freeze(['server.mts']);
export const MAX_MAINTAINED_SOURCE_FILES = 1_024;
export const MAX_MAINTAINED_SOURCE_FILE_BYTES = 512 * 1024;
export const MAX_MAINTAINED_SOURCE_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_MAINTAINED_SOURCE_AST_NODES = 3_000_000;
export const MAX_MAINTAINED_SOURCE_FUNCTIONS = 20_000;
export const MAX_MAINTAINED_SOURCE_CALL_EDGES = 40_000;
export const MAX_MAINTAINER_DUPLICATE_CLUSTERS = 512;
export const MAX_MAINTAINER_DUPLICATE_MEMBERS = 128;
export const MAX_MAINTAINER_DUPLICATION_REPORT_BYTES = 8 * 1024 * 1024;

// Retain the original exported limits for callers that used the first report
// version. Their values now describe the broader maintained-source scope.
export const MAX_MAINTAINER_TOOL_FILES = MAX_MAINTAINED_SOURCE_FILES;
export const MAX_MAINTAINER_TOOL_FILE_BYTES = MAX_MAINTAINED_SOURCE_FILE_BYTES;
export const MAX_MAINTAINER_TOOL_TOTAL_BYTES = MAX_MAINTAINED_SOURCE_TOTAL_BYTES;
export const MAX_MAINTAINER_TOOL_AST_NODES = MAX_MAINTAINED_SOURCE_AST_NODES;
export const MAX_MAINTAINER_TOOL_FUNCTIONS = MAX_MAINTAINED_SOURCE_FUNCTIONS;
export const MAX_MAINTAINER_TOOL_CALL_EDGES = MAX_MAINTAINED_SOURCE_CALL_EDGES;

const SOURCE_NAME_RE = /\.(?:m)?ts$/u;
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
  node: NamedFunctionNode,
  includeLineInId: boolean,
): FunctionCandidate | null {
  if (!node.body) return null;
  const normalized = normalizedBody(node.body, source);
  const line = sourceLine(source, node.getStart(source));
  const endLine = sourceLine(source, node.end);
  return Object.freeze({
    id: `${file}#${name}${includeLineInId ? `@${line}` : ''}`,
    file,
    name,
    line,
    lineCount: endLine - line + 1,
    tokenCount: normalized.tokenCount,
    signature: normalized.signature,
    node,
  });
}

function staticMemberName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)
    || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function namedFunctions(file: string, source: ts.SourceFile): readonly FunctionCandidate[] {
  const candidates: FunctionCandidate[] = [];
  const add = (name: string | null, node: NamedFunctionNode) => {
    if (!name) return;
    const candidate = functionCandidate(file, source, name, node, true);
    if (candidate) candidates.push(candidate);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      add(node.name?.text ?? null, node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      add(node.name.text, node.initializer);
    } else if ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node))
      && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      add(staticMemberName(node.name), node.initializer);
    } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      add(staticMemberName(node.name), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.freeze(candidates.sort((left, right) => left.line - right.line || compareCodeUnits(left.name, right.name)));
}

function topLevelFunctions(file: string, source: ts.SourceFile): readonly FunctionCandidate[] {
  const candidates: FunctionCandidate[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const candidate = functionCandidate(file, source, statement.name.text, statement, false);
      if (candidate) candidates.push(candidate);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer
        || (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer))) continue;
      const candidate = functionCandidate(file, source, declaration.name.text, declaration.initializer, false);
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
    imports: Object.freeze([...imports].sort(compareCodeUnits)),
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
  return Object.freeze({ calls: Object.freeze(calls), imports: bindings.imports });
}

function packageEntrypoints(packageDocument: Record<string, unknown>): ReadonlySet<string> {
  const scripts = packageDocument.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return new Set();
  const output = new Set<string>();
  for (const value of Object.values(scripts)) {
    if (typeof value !== 'string' || value.length > 2_000) continue;
    for (const match of value.matchAll(/(?:^|[\s'"=])((?:bin|tools)\/[a-z0-9][a-z0-9./-]*\.mts)(?=$|[\s'";])/gu)) {
      if (match[1]) output.add(match[1]);
    }
  }
  return output;
}

function isGeneratedSource(file: string): boolean {
  return file.split('/').includes('generated') || /\.generated\.(?:m)?ts$/u.test(file);
}

async function discoverMaintainedSourceFiles(repositoryRoot: string): Promise<readonly string[]> {
  const files: string[] = [];
  const walk = async (relativeDirectory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path.join(repositoryRoot, relativeDirectory), { withFileTypes: true });
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw reason;
    }
    for (const entry of entries.sort((left, right) => compareCodeUnits(left.name, right.name))) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new TypeError(`Maintained-source inventory must not traverse symbolic links: ${relative}`);
      }
      if (entry.isDirectory()) {
        if (!isGeneratedSource(relative)) await walk(relative);
        continue;
      }
      if (!entry.isFile() || !SOURCE_NAME_RE.test(entry.name) || isGeneratedSource(relative)) continue;
      files.push(relative);
      if (files.length > MAX_MAINTAINED_SOURCE_FILES) {
        throw new TypeError(`Maintained-source inventory exceeds ${MAX_MAINTAINED_SOURCE_FILES} modules.`);
      }
    }
  };
  for (const root of MAINTAINED_SOURCE_ROOTS) await walk(root);
  for (const file of MAINTAINED_ROOT_SOURCE_FILES) {
    try {
      const metadata = await lstat(path.join(repositoryRoot, file));
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new TypeError(`Maintained root source must be a regular file: ${file}`);
      }
      files.push(file);
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason;
    }
  }
  const unique = [...new Set(files)].sort(compareCodeUnits);
  if (!unique.length) throw new TypeError('Maintained-source inventory must contain at least one module.');
  if (unique.length > MAX_MAINTAINED_SOURCE_FILES) {
    throw new TypeError(`Maintained-source inventory exceeds ${MAX_MAINTAINED_SOURCE_FILES} modules.`);
  }
  return Object.freeze(unique);
}

export async function buildMaintainerDuplicationReport(options: ReportOptions = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? path.resolve(fileURLToPath(new URL('..', import.meta.url))));
  const sourceFiles = await discoverMaintainedSourceFiles(repositoryRoot);
  const packageRaw = await readBoundedRegularTextFile(path.join(repositoryRoot, 'package.json'), {
    maximumBytes: MAX_MAINTAINED_SOURCE_FILE_BYTES,
    minimumBytes: 2,
    label: 'Package manifest',
  });
  const packageDocument = parseBoundedJsonObject(packageRaw, {
    label: 'Package manifest',
    maximumBytes: MAX_MAINTAINED_SOURCE_FILE_BYTES,
  });
  const scriptedEntrypoints = packageEntrypoints(packageDocument);
  const files: Array<Readonly<{
    file: string;
    bytes: number;
    entrypoint: boolean;
    functionCount: number;
    topLevelFunctionCount: number;
    directLocalImports: readonly string[];
  }>> = [];
  const allFunctions: FunctionCandidate[] = [];
  const allTopLevelFunctions: FunctionCandidate[] = [];
  const allCalls: Array<Readonly<{ caller: string; callee: string; kind: 'local' | 'imported' }>> = [];
  let totalBytes = 0;
  let astNodes = 0;

  for (const file of sourceFiles) {
    const text = await readBoundedRegularTextFile(path.join(repositoryRoot, ...file.split('/')), {
      maximumBytes: MAX_MAINTAINED_SOURCE_FILE_BYTES,
      minimumBytes: 1,
      label: file,
    });
    const bytes = new TextEncoder().encode(text).byteLength;
    totalBytes += bytes;
    if (totalBytes > MAX_MAINTAINED_SOURCE_TOTAL_BYTES) {
      throw new TypeError(`Maintained source exceeds the ${MAX_MAINTAINED_SOURCE_TOTAL_BYTES}-byte aggregate limit.`);
    }
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (parseDiagnostics.length) throw new TypeError(`Maintained source could not be parsed: ${file}`);
    const countNode = (node: ts.Node): void => {
      astNodes += 1;
      if (astNodes > MAX_MAINTAINED_SOURCE_AST_NODES) {
        throw new TypeError(`Maintained-source syntax exceeds ${MAX_MAINTAINED_SOURCE_AST_NODES} AST nodes.`);
      }
      ts.forEachChild(node, countNode);
    };
    countNode(source);
    const functions = namedFunctions(file, source);
    const topLevel = topLevelFunctions(file, source);
    allFunctions.push(...functions);
    allTopLevelFunctions.push(...topLevel);
    if (allFunctions.length > MAX_MAINTAINED_SOURCE_FUNCTIONS) {
      throw new TypeError(`Maintained-source inventory exceeds ${MAX_MAINTAINED_SOURCE_FUNCTIONS} named functions.`);
    }
    const graph = collectCallEdges(file, source, topLevel);
    allCalls.push(...graph.calls);
    if (allCalls.length > MAX_MAINTAINED_SOURCE_CALL_EDGES) {
      throw new TypeError(`Maintained-source call graph exceeds ${MAX_MAINTAINED_SOURCE_CALL_EDGES} static edges.`);
    }
    files.push(Object.freeze({
      file,
      bytes,
      entrypoint: text.startsWith('#!/usr/bin/env node') || scriptedEntrypoints.has(file),
      functionCount: functions.length,
      topLevelFunctionCount: topLevel.length,
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
      root: 'maintained TypeScript source roots',
      roots: Object.freeze([...MAINTAINED_SOURCE_ROOTS, ...MAINTAINED_ROOT_SOURCE_FILES]),
      generatedSourcesExcluded: true,
      fileCount: files.length,
      entrypointCount: files.filter((file) => file.entrypoint).length,
      totalBytes,
      astNodeCount: astNodes,
      namedFunctionCount: allFunctions.length,
      topLevelFunctionCount: allTopLevelFunctions.length,
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
      'The inventory covers maintained TypeScript modules in the declared roots. Generated modules, Svelte component script blocks, tests, workflows, configuration, and non-TypeScript source remain outside this bounded report.',
      'The call graph resolves direct calls to top-level local functions and statically imported bindings. Method dispatch, callbacks, computed properties, and runtime imports remain outside this bounded report.',
      'Repeated implementations are exact comment-free token matches between named functions. Similar intent with different tokens is not labelled duplicate, and a match is evidence for review rather than automatic consolidation.',
      'The report contains repository-relative module and function metadata only. It does not retain source text, literals, environment values, absolute paths, or runtime data.',
    ]),
  });
  const reportBytes = new TextEncoder().encode(JSON.stringify(report)).byteLength;
  if (reportBytes > MAX_MAINTAINER_DUPLICATION_REPORT_BYTES) {
    throw new TypeError(`Maintainer report exceeds ${MAX_MAINTAINER_DUPLICATION_REPORT_BYTES} bytes.`);
  }
  return report;
}

export function formatMaintainerDuplicationReport(report: Awaited<ReturnType<typeof buildMaintainerDuplicationReport>>): string {
  const lines = [
    'WHOISleuth maintained-source duplication report',
    `Scope: ${report.scope.fileCount} modules · ${report.scope.entrypointCount} entry points · ${report.scope.namedFunctionCount} named functions · ${report.scope.totalBytes} bytes`,
    `Static top-level call graph: ${report.callGraph.staticEdgeCount} resolved edges`,
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
    (options.stderr ?? process.stderr).write(`${reason instanceof Error ? reason.message : 'Maintained-source report failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
