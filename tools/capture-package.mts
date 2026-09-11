#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseBoundedJson } from '../lib/bounded-json.mts';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { normalizeBoundedStableSemanticVersion } from '../lib/semantic-version.mts';
import { WHOISLEUTH_PROJECT_URL, WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL } from '../lib/project-metadata.mts';
import {
  assertCliPackageSourceSnapshot, captureCliPackageSourceSnapshot, compilePackageSources,
  discoverPackageCompilerClosure, materializeCliPackageSourceSnapshot, validatePackedCliFiles,
  MAX_CLI_PACKAGE_COMPILER_CONTEXT_BYTES, MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
  MAX_CLI_PACKAGE_GRAPH_BYTES, MAX_CLI_PACKAGE_PROCESSING_ITEMS, MAX_CLI_PACKAGE_PACKED_BYTES,
  MAX_CLI_PACKAGE_UNPACKED_BYTES, CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
} from './cli-package.mts';
import { buildThirdPartyNotices, productionDependencyInstallPaths } from './third-party-notices.mts';
import { playwrightBrowserCacheDirectory } from './ci-verification.mts';

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_SOURCE = 'packages/web-capture/package.json';
const ENTRY = 'packages/web-capture/bin/whoisleuth-capture.mts';
const ENTRY_OUTPUT = ENTRY.replace(/\.mts$/u, '.mjs');
const SOURCE = /^(?:package\.json|(?:lib|packages\/(?:contracts|evidence|web-capture))\/[A-Za-z0-9._/-]+\.(?:mts|ts|json))$/u;
const SUPPORT = [['packages/web-capture/README.md', 'README.md'], ['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE'], ['DISCLOSURE', 'DISCLOSURE']] as const;
type Json = Record<string, unknown>;
function object(value: unknown, label: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Json;
}
function parse(bytes: Buffer | string): Json { return object(parseBoundedJson(bytes.toString(), { label: 'Package input', maximumBytes: MAX_CLI_PACKAGE_GRAPH_BYTES }), 'Package input'); }

export function capturePackageInputs(value: unknown): Readonly<{ sources: readonly string[]; dependencies: readonly string[] }> {
  const graph = object(value, 'Capture graph');
  if (!Array.isArray(graph.modules) || !graph.modules.length || graph.modules.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) throw new Error('Capture graph exceeds its processing bound.');
  const sources = new Set<string>();
  const dependencies = new Set<string>();
  const externalDependency = (source: string) => {
    const segments = source.split('/');
    const name = segments[1]?.startsWith('@') ? segments.slice(1, 3).join('/') : segments[1]!;
    if (!['playwright', 'undici'].includes(name)) throw new Error(`Unreviewed capture runtime dependency: ${name}.`);
    dependencies.add(name);
  };
  for (const item of graph.modules) {
    const module = object(item, 'Capture module');
    if (!Array.isArray(module.dependencies) || module.dependencies.length > 512) throw new Error('Invalid capture dependency list.');
    for (const value of module.dependencies) {
      const dependency = object(value, 'Capture dependency');
      if (dependency.couldNotResolve) throw new Error('A capture dependency could not be resolved.');
      // The architecture resolver deliberately does not visit dependency
      // internals; their resolved edges still declare the runtime closure.
      if (typeof dependency.resolved === 'string' && dependency.resolved.startsWith('node_modules/')) externalDependency(dependency.resolved);
    }
    if (module.coreModule === true) continue;
    const source = module.source;
    if (typeof source !== 'string' || source.length > 512 || source.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid capture module path.');
    if (source.startsWith('node_modules/')) {
      externalDependency(source);
    } else if (SOURCE.test(source)) sources.add(source);
    else throw new Error(`Capture package contains an unexpected source: ${source}.`);
  }
  if (!sources.has(ENTRY)) throw new Error('Capture graph is missing its executable.');
  return Object.freeze({ sources: [...sources].sort(), dependencies: [...dependencies].sort() });
}

export function capturePackageManifest(sourceValue: unknown, lockValue: unknown, dependencies: readonly string[]): Json {
  const source = object(sourceValue, 'Capture manifest');
  const requested = object(source.dependencies, 'Capture dependencies');
  const packages = object(object(lockValue, 'Lockfile').packages, 'Locked packages');
  if (source.name !== '@slicedearth/whoisleuth-web-capture' || source.private !== true || source.license !== 'AGPL-3.0-only') throw new Error('Unexpected capture package identity.');
  assert.deepEqual([...dependencies].sort(), Object.keys(requested).sort(), 'Declared capture dependencies must equal the actual runtime closure.');
  const pinned: Record<string, string> = {};
  for (const name of dependencies) {
    const version = normalizeBoundedStableSemanticVersion(object(packages[`node_modules/${name}`], `Locked ${name}`).version);
    const range = requested[name];
    // This private package uses exact browser and caret transport declarations,
    // not arbitrary package-manager expressions or implicit dependency upgrades.
    if (typeof range !== 'string' || !/^\^?\d+\.\d+\.\d+$/u.test(range)) throw new Error('Capture dependency declaration is unsupported.');
    const minimum = range.replace(/^\^/u, '').split('.').map(Number);
    const actual = version.split('.').map(Number);
    const satisfies = range.startsWith('^')
      ? minimum[0]! > 0 && actual[0] === minimum[0] && (actual[1]! > minimum[1]! || actual[1] === minimum[1] && actual[2]! >= minimum[2]!)
      : range === version;
    if (!satisfies) throw new Error(`Locked ${name} does not satisfy the reviewed companion declaration.`);
    pinned[name] = version;
  }
  return {
    name: source.name, version: normalizeBoundedStableSemanticVersion(source.version), private: true,
    type: 'module', license: source.license, description: source.description,
    bin: { 'whoisleuth-capture': `runtime/${ENTRY_OUTPUT}` }, engines: { node: '>=24' }, dependencies: pinned,
    contentPolicy: { class: 'dual-use' },
    repository: { type: 'git', url: WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL }, homepage: WHOISLEUTH_PROJECT_URL,
  };
}

export function assertCaptureInstalledDependencies(installedValue: unknown, reviewedValue: unknown, direct: readonly string[]): number {
  const installed = object(object(installedValue, 'Installed lockfile').packages, 'Installed packages');
  const reviewed = object(object(reviewedValue, 'Reviewed lockfile').packages, 'Reviewed packages');
  const allowed = new Set(productionDependencyInstallPaths(reviewedValue, direct).map(location => {
    const entry = object(reviewed[location], 'Reviewed dependency');
    return JSON.stringify([location.split('node_modules/').at(-1), entry.version, entry.integrity]);
  }));
  const entries = Object.entries(installed);
  if (entries.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) throw new Error('Installed capture dependencies exceed their processing bound.');
  let count = 0;
  for (const [location, value] of entries) {
    if (!location || location === 'node_modules/@slicedearth/whoisleuth-web-capture') continue;
    const entry = object(value, 'Installed dependency');
    if (!allowed.has(JSON.stringify([location.split('node_modules/').at(-1), entry.version, entry.integrity]))) throw new Error('Installed capture dependency differs from the reviewed lockfile.');
    count++;
  }
  for (const name of direct) if (!installed[`node_modules/${name}`]) throw new Error('An installed capture dependency is missing.');
  return count;
}

async function emittedFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  async function visit(relative: string) {
    for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, item.name);
      if (item.isDirectory()) await visit(name);
      else if (item.isFile()) files.push(name);
      else throw new Error('Capture package contains a non-regular output.');
      if (files.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) throw new Error('Capture package exceeds its processing bound.');
    }
  }
  await visit(prefix);
  return files.sort();
}

export async function checkCapturePackage(repositoryRoot = ROOT, candidateDirectory?: string, browserSmoke = false) {
  const root = await realpath(repositoryRoot);
  const temporary = await mkdtemp(path.join(tmpdir(), 'whoisleuth-capture-package-'));
  const sourceRoot = path.join(temporary, 'source');
  const staged = path.join(temporary, 'package');
  const runtime = path.join(staged, 'runtime');
  const packed = path.join(temporary, 'packed');
  const installed = path.join(temporary, 'installed');
  const home = path.join(temporary, 'home');
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: path.join(temporary, 'cache'), npm_config_userconfig: path.join(home, 'npmrc'), npm_config_globalconfig: path.join(home, 'global-npmrc'), npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' };
  if (browserSmoke) environment.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowserCacheDirectory();
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_TOKEN', 'NODE_AUTH_TOKEN']) delete environment[name];
  const run = (command: string, args: string[], cwd: string) => execFile(command, args, { cwd, env: environment, encoding: 'utf8', timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS, maxBuffer: MAX_CLI_PACKAGE_GRAPH_BYTES, killSignal: 'SIGTERM' });
  try {
    await Promise.all([sourceRoot, staged, packed, installed, home].map(directory => mkdir(directory)));
    await Promise.all(['npmrc', 'global-npmrc'].map(name => writeFile(path.join(home, name), '')));
    // Retain external dependency edges in this package report. The shared
    // do-not-follow rule still prevents traversing dependency internals.
    const graph = parse((await run(process.execPath, [path.join(root, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs'), '--config', path.join(root, '.dependency-cruiser.json'), '--exclude', '^$', '--output-type', 'json', ENTRY], root)).stdout);
    const inputs = capturePackageInputs(graph);
    const closure = await discoverPackageCompilerClosure(root, temporary, inputs.sources, { acceptsSource: source => SOURCE.test(source) });
    const state = { totalBytes: 0 };
    const sources = await captureCliPackageSourceSnapshot(root, closure.sources, state);
    const metadata = await captureCliPackageSourceSnapshot(root, ['package.json', 'package-lock.json', PACKAGE_SOURCE, ...SUPPORT.map(([source]) => source)], state);
    const compiler = await captureCliPackageSourceSnapshot(root, closure.contextFiles, { totalBytes: 0, maximumBytes: MAX_CLI_PACKAGE_COMPILER_CONTEXT_BYTES, maximumFileBytes: MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES });
    const manifest = capturePackageManifest(parse(metadata.get(PACKAGE_SOURCE)!.bytes), parse(metadata.get('package-lock.json')!.bytes), inputs.dependencies);
    const captured = new Map([...sources, ...metadata, ...compiler]);
    for (const [file, identity] of sources) if (metadata.has(file)) assert.deepEqual(metadata.get(file)!.bytes, identity.bytes, 'Capture source metadata changed during snapshotting.');
    await materializeCliPackageSourceSnapshot(sourceRoot, captured);
    const verified = await discoverPackageCompilerClosure(sourceRoot, temporary, [ENTRY], { acceptsSource: source => SOURCE.test(source) });
    for (const file of verified.sources) if (!sources.has(file)) throw new Error('Materialised capture source closure changed.');
    for (const file of verified.contextFiles) if (!compiler.has(file)) throw new Error('Materialised capture compiler context changed.');
    await compilePackageSources(root, temporary, runtime, sourceRoot, [ENTRY], { compilerRoot: sourceRoot, dependencyRoot: sourceRoot });
    const runtimeFiles = await emittedFiles(staged);
    if (!runtimeFiles.includes('runtime/packages/web-capture/anchored-artifact-writer.mjs')) throw new Error('Capture package is missing its isolated artefact writer.');
    const notices = await buildThirdPartyNotices(root, { directDependencyNames: inputs.dependencies, scopeLabel: 'Capture companion', lockfileValue: parse(metadata.get('package-lock.json')!.bytes) });
    for (const [source, destination] of SUPPORT) await writeFile(path.join(staged, destination), metadata.get(source)!.bytes);
    await writeFile(path.join(runtime, PACKAGE_SOURCE), JSON.stringify({ name: manifest.name, version: manifest.version, type: 'module' }) + '\n');
    const applicationVersion = normalizeBoundedStableSemanticVersion(parse(metadata.get('package.json')!.bytes).version);
    await writeFile(path.join(runtime, 'package.json'), JSON.stringify({ name: 'whoisleuth', version: applicationVersion, type: 'module' }) + '\n');
    await writeFile(path.join(staged, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(path.join(staged, 'third-party-notices.txt'), notices);
    await chmod(path.join(runtime, ENTRY_OUTPUT), 0o755);
    const result = JSON.parse((await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packed], staged)).stdout) as unknown;
    if (!Array.isArray(result) || result.length !== 1) throw new Error('Expected exactly one capture archive.');
    const pack = object(result[0], 'Packed capture');
    const expected = [...new Set([...runtimeFiles, `runtime/${PACKAGE_SOURCE}`, 'runtime/package.json', 'package.json', 'third-party-notices.txt', ...SUPPORT.map(([, destination]) => destination)])].sort();
    const entries = validatePackedCliFiles(pack, expected);
    assert.deepEqual([...entries].sort(), expected, 'Capture package must contain only its reviewed closure and support files.');
    if (!Number.isSafeInteger(pack.size) || Number(pack.size) < 1 || Number(pack.size) > MAX_CLI_PACKAGE_PACKED_BYTES || !Number.isSafeInteger(pack.unpackedSize) || Number(pack.unpackedSize) > MAX_CLI_PACKAGE_UNPACKED_BYTES) throw new Error('Capture archive exceeds its byte bounds.');
    if (typeof pack.filename !== 'string' || !/^[A-Za-z0-9._-]+\.tgz$/u.test(pack.filename)) throw new Error('Invalid capture archive filename.');
    const archive = await readBoundedRegularFileWithin(packed, pack.filename, { maximumBytes: MAX_CLI_PACKAGE_PACKED_BYTES, minimumBytes: 1, label: 'Capture archive' });
    await assertCliPackageSourceSnapshot(root, sources);
    await assertCliPackageSourceSnapshot(root, metadata);
    await assertCliPackageSourceSnapshot(root, compiler, MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES);
    assert.equal(await buildThirdPartyNotices(root, { directDependencyNames: inputs.dependencies, scopeLabel: 'Capture companion', lockfileValue: parse(metadata.get('package-lock.json')!.bytes) }), notices, 'Capture licence inputs changed.');
    await writeFile(path.join(installed, 'package.json'), '{"private":true}\n');
    await run('npm', ['install', '--package-lock=true', '--ignore-scripts', '--no-audit', '--no-fund', path.join(packed, pack.filename)], installed);
    const dependencyCount = assertCaptureInstalledDependencies(parse(await readFile(path.join(installed, 'package-lock.json'))), parse(metadata.get('package-lock.json')!.bytes), inputs.dependencies);
    const packageRoot = path.join(installed, 'node_modules', ...String(manifest.name).split('/'));
    assert.deepEqual(parse(await readFile(path.join(packageRoot, 'package.json'))), manifest);
    const executable = path.join(packageRoot, 'runtime', ENTRY_OUTPUT);
    const offlineGuard = ['--import', path.join(root, 'tools/browser-server-egress-guard.mts')];
    const checks: string[] = ['installed dependency identities and integrity'];
    for (const args of [[], ['--help'], ['-h'], ['compare', '--help'], ['--version']]) {
      const output = await run(process.execPath, [...offlineGuard, executable, ...args], home);
      assert.equal(output.stderr, '');
      if (args[0] === '--version') assert.equal(output.stdout, `${String(manifest.version)}\n`);
      else assert.match(output.stdout, /Compare verifies selected local artefacts and makes no network requests/u);
      checks.push(args.join(' ') || 'zero-argument help');
    }
    const smoke = await run(process.execPath, [...offlineGuard, path.join(root, 'tools/capture-package-smoke.mts'), packageRoot, ...(browserSmoke ? ['--browser'] : [])], home);
    assert.equal(smoke.stderr, '');
    const checked = JSON.parse(smoke.stdout) as string[];
    if (!Array.isArray(checked) || checked.some(value => typeof value !== 'string') || !checked.length) throw new Error('Installed capture smoke checks did not report completion.');
    checks.push(...checked);
    const report = { packageName: manifest.name, packageVersion: manifest.version, applicationVersion, sourceModules: verified.sources.length, archiveFile: pack.filename, packedEntries: entries.length, packedBytes: archive.byteLength, unpackedBytes: pack.unpackedSize, archiveSha256: createHash('sha256').update(archive).digest('hex'), dependencies: manifest.dependencies, installedDependencies: dependencyCount, installedChecks: checks, publicationEnabled: false };
    if (candidateDirectory) {
      const destination = path.resolve(candidateDirectory);
      const parent = await realpath(path.dirname(destination));
      const relative = path.relative(root, parent);
      if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) throw new Error('Capture candidates must be written outside the checkout.');
      await mkdir(destination, { mode: 0o700 });
      await copyFile(path.join(packed, pack.filename), path.join(destination, pack.filename), constants.COPYFILE_EXCL);
      await writeFile(path.join(destination, 'capture-package-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    return report;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const browserSmoke = args[0] === '--browser-smoke';
    if (browserSmoke) args.shift();
    if (args.length && (args.length !== 2 || args[0] !== '--candidate' || !args[1])) throw new Error('Usage: capture-package [--browser-smoke] [--candidate <new-external-directory>]');
    process.stdout.write(JSON.stringify(await checkCapturePackage(ROOT, args[1], browserSmoke), null, 2) + '\n');
  } catch (cause) { process.stderr.write((cause instanceof Error ? cause.message : 'Capture package verification failed.') + '\n'); process.exitCode = 1; }
}
