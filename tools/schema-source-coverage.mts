import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_SOURCE_CLASSIFICATIONS } from '../fixtures/schema-source-classifications.mts';
import { decodeBoundedUtf8, readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import {
  isCanonicalLocalSchemaIdentifier,
  type SchemaCompatibilityEntry,
} from '../packages/contracts/schema-compatibility.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { compareCodeUnits as ordinalCompare } from './maintainer-tool-helpers.mts';
import {
  appendBounded,
  discoverSchemaIdentifiersInSource,
  MAX_SCHEMA_SOURCE_AST_DEPTH,
  MAX_SCHEMA_SOURCE_BINDINGS,
  MAX_SCHEMA_SOURCE_FILE_BYTES,
  MAX_SCHEMA_SOURCE_OCCURRENCES,
  SCHEMA_DYNAMIC_USE_ALLOWLIST,
  tokens,
  type DynamicConstruction,
  type SourceDefinition,
  type SourceFileDiscovery,
  type SourceImportBinding,
  type SourceLocalDeclaration,
  type SourceOccurrence,
  type SourceSchemaAlias,
  type SourceSchemaEmitter,
} from './schema-source-parsers.mts';

export {
  discoverSchemaIdentifiersInSource,
  MAX_SCHEMA_SOURCE_AST_DEPTH,
  MAX_SCHEMA_SOURCE_AST_NODES,
  MAX_SCHEMA_SOURCE_BINDINGS,
  MAX_SCHEMA_SOURCE_CANDIDATE_BYTES,
  MAX_SCHEMA_SOURCE_FILE_BYTES,
  MAX_SCHEMA_SOURCE_JSON_CONTAINER_ITEMS,
  MAX_SCHEMA_SOURCE_JSON_DEPTH,
  MAX_SCHEMA_SOURCE_JSON_VALUES,
  MAX_SCHEMA_SOURCE_OCCURRENCES,
  MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS,
} from './schema-source-parsers.mts';

export const MAX_SCHEMA_SOURCE_FILES = 1_024;
export const MAX_SCHEMA_SOURCE_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_SCHEMA_SOURCE_IDENTIFIERS = 512;
export const MAX_SCHEMA_SOURCE_REFERENCES = 100_000;
export const MAX_SCHEMA_SOURCE_DIRECTORIES = 1_024;
export const MAX_SCHEMA_SOURCE_DIRECTORY_ENTRIES = 4_096;
export const MAX_SCHEMA_SOURCE_DIRECTORY_DEPTH = 32;
export const MAX_SCHEMA_SOURCE_MANIFEST_BYTES = 2 * 1024 * 1024;
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
  ['whoisleuth.common-infrastructure', 'packages/relationships/common-infrastructure-snapshot.json', 1],
  ['whoisleuth.common-infrastructure', 'packages/relationships/common-infrastructure.mts', 1],
  ['whoisleuth.external-findings', 'cli/ct-event-intake.mts', 1],
  ['whoisleuth.registry-standards-coverage', 'lib/registry-capability-catalogue.mts', 1],
  ['whoisleuth.shortlist', 'frontend/src/lib/browser-local-data-definitions.ts', 2],
  ['whoisleuth.sslbl-certificate-snapshot', 'lib/sslbl-certificates.generated.mts', 1],
  ['whoisleuth.watchlists', 'frontend/src/lib/browser-local-data-definitions.ts', 1],
] as const);

const SCHEMA_OWNER_USE_ALLOWLIST = Object.freeze([
  ['cli.web-capture-comparison', 'packages/web-capture/compare.mts', 'writer', 1],
  ['export.web-capture-dom-digest', 'packages/web-capture/capture.mts', 'writer', 1],
  ['browser.analyst-review-state', 'packages/contracts/analyst-review-state.mts', 'writer', 1],
] as const);

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
      if (entry.isDirectory() && (
        SCHEMA_SOURCE_IGNORED_DIRECTORY_NAMES.has(entry.name)
        || relative === 'frontend/src/lib/generated'
      )) continue;
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
  const dynamicUseAllowlist = new Map<string, number>();
  if (enforceRepositoryLedgers) {
    for (const [file, role, expectedCount] of SCHEMA_DYNAMIC_USE_ALLOWLIST) {
      const key = `${file}\0${role}`;
      if (dynamicUseAllowlist.has(key)) throw new Error(`Schema source dynamic-use allowance is duplicated: ${file} (${role}).`);
      dynamicUseAllowlist.set(key, expectedCount);
    }
  }
  const usedDynamicUseAllowlist = new Map<string, number>();
  const uses: ResolvedSchemaUse[] = [];
  const unresolvedUses: string[] = [];
  for (const emitter of discovery.emitters) {
    const identifier = emitter.identifier ?? (emitter.symbol ? resolve(emitter.file, emitter.symbol) : null);
    if (!identifier) {
      const useKey = `${emitter.file}\0${emitter.role}`;
      if (dynamicUseAllowlist.has(useKey)) {
        usedDynamicUseAllowlist.set(useKey, (usedDynamicUseAllowlist.get(useKey) ?? 0) + 1);
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
  for (const [allowedFile, allowedRole, expectedCount] of SCHEMA_DYNAMIC_USE_ALLOWLIST) {
    if (!enforceRepositoryLedgers) break;
    const key = `${allowedFile}\0${allowedRole}`;
    const actualCount = usedDynamicUseAllowlist.get(key) ?? 0;
    if (actualCount !== expectedCount) {
      throw new Error(`Schema source dynamic-use allowance expected ${expectedCount} uses but found ${actualCount}: ${allowedFile} (${allowedRole}).`);
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
  const inlineAllowlist = new Map<string, number>();
  if (enforceRepositoryLedgers) {
    for (const [identifier, file, expectedCount] of SCHEMA_INLINE_EMITTER_ALLOWLIST) {
      const key = `${identifier}\0${file}`;
      if (inlineAllowlist.has(key)) throw new Error(`Schema source inline-emitter allowance is duplicated: ${identifier} (${file}).`);
      inlineAllowlist.set(key, expectedCount);
    }
  }
  const usedInlineAllowlist = new Map<string, number>();
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
      usedInlineAllowlist.set(key, (usedInlineAllowlist.get(key) ?? 0) + 1);
    }
  }
  for (const [identifier, file, expectedCount] of SCHEMA_INLINE_EMITTER_ALLOWLIST) {
    if (!enforceRepositoryLedgers) break;
    const key = `${identifier}\0${file}`;
    const actualCount = usedInlineAllowlist.get(key) ?? 0;
    if (actualCount !== expectedCount) {
      throw new Error(`Schema source inline-emitter allowance expected ${expectedCount} uses but found ${actualCount}: ${identifier} (${file}).`);
    }
  }
  const canonicalBindings = buildCanonicalSourceBindings(discovery, enforceRepositoryLedgers);

  const lifecycleMetadataByIdentifier = new Map<string, Set<string>>();
  for (const family of SCHEMA_LIFECYCLE_REGISTRY) {
    for (const contract of family.contracts) {
      const entry = entryById.get(contract.compatibilityId);
      if (!entry || entry.schema !== null || !isCanonicalLocalSchemaIdentifier(contract.schema)) continue;
      const entryIds = lifecycleMetadataByIdentifier.get(contract.schema) ?? new Set<string>();
      entryIds.add(entry.id);
      lifecycleMetadataByIdentifier.set(contract.schema, entryIds);
    }
  }

  const classificationByIdentifier = new Map<string, SchemaSourceClassificationRecord>();
  let previousClassification = '';
  for (const raw of classifications) {
    validateClassification(raw);
    if (previousClassification && ordinalCompare(previousClassification, raw.identifier) >= 0) {
      throw new Error('Schema source classifications must use unique ordinal identifier order.');
    }
    previousClassification = raw.identifier;
    if (classificationByIdentifier.has(raw.identifier)
      || inventoryBySchema.has(raw.identifier)
      || lifecycleMetadataByIdentifier.has(raw.identifier)) {
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
    if (!inventoryBySchema.has(identifier)
      && !classificationByIdentifier.has(identifier)
      && !lifecycleMetadataByIdentifier.has(identifier)) {
      throw new Error(`Schema source identifier is not inventoried or classified: ${identifier}`);
    }
  }
  for (const identifier of inventoryBySchema.keys()) {
    if (!discovered.has(identifier)) throw new Error(`Schema compatibility identifier is no longer present in production sources: ${identifier}`);
  }
  for (const identifier of classificationByIdentifier.keys()) {
    if (!discovered.has(identifier)) throw new Error(`Schema source classification is stale: ${identifier}`);
  }
  for (const [identifier, entryIds] of lifecycleMetadataByIdentifier) {
    if (!discovered.has(identifier)) throw new Error(`Schema lifecycle metadata identity is stale: ${identifier}`);
    for (const entryId of entryIds) {
      if (!entryById.has(entryId)) throw new Error(`Schema lifecycle metadata identity ${identifier} references an unknown compatibility entry ${entryId}.`);
    }
  }

  const classificationsThatMayEmit = new Set(['provenance_marker', 'serialised_unversioned', 'transient_projection']);
  for (const use of canonicalBindings.uses) {
    if (use.source.role !== 'writer' || !use.identifier) continue;
    const classification = classificationByIdentifier.get(use.identifier);
    if (lifecycleMetadataByIdentifier.has(use.identifier)) {
      throw new Error(`Schema lifecycle metadata identity ${use.identifier} cannot mask a schema emitter at ${use.source.file}:${use.source.line}.`);
    }
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

  const ownerUseAllowlist = new Map<string, { owner: string; role: 'reader' | 'writer'; expectedCount: number }>();
  if (enforceRepositoryLedgers) {
    for (const [entryId, owner, role, expectedCount] of SCHEMA_OWNER_USE_ALLOWLIST) {
      if (ownerUseAllowlist.has(entryId)) throw new Error(`Schema source owner-use allowance is duplicated: ${entryId}.`);
      ownerUseAllowlist.set(entryId, { owner, role, expectedCount });
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
        const actualCount = canonicalBindings.uses.filter((use) => (
          use.identifier === identifier
          && use.source.file === entry.owner
          && use.source.role === allowance.role
        )).length;
        if (actualCount !== allowance.expectedCount) {
          throw new Error(`Schema source owner-use allowance expected ${allowance.expectedCount} uses but found ${actualCount}: ${entry.id}.`);
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
    classifiedIdentifiers: classificationByIdentifier.size + lifecycleMetadataByIdentifier.size,
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
