#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseBoundedJson } from '../lib/bounded-json.mts';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { normalizeBoundedStableSemanticVersion } from '../lib/semantic-version.mts';
import { WHOISLEUTH_PROJECT_URL, WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL } from '../lib/project-metadata.mts';
import { LOCAL_APPLICATION_WORKER_URL } from '../lib/local-application-worker-client.mts';
import { assertFrontendBuildIntegrity } from './frontend-build-integrity.mts';
import {
  assertCliPackageSourceSnapshot, captureCliPackageSourceSnapshot, compilePackageSources,
  discoverPackageCompilerClosure, materializeCliPackageSourceSnapshot,
  MAX_CLI_PACKAGE_COMPILER_CONTEXT_BYTES, MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES, MAX_CLI_PACKAGE_GRAPH_BYTES,
  CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
} from './cli-package.mts';
import { optionalPackageInputs, assertInstalledPackageDependencies, emittedPackageFiles, optionalPackageLock, captureOptionalPackageFiles, assertInstalledOptionalPackage, validateOptionalPackageFiles } from './optional-package.mts';
import { buildThirdPartyNotices } from './third-party-notices.mts';
import { pathIsWithin, requireJsonRecord as object } from './maintainer-tool-helpers.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'packages/local-application/bin/whoisleuth-local.mts';
const PACKAGE_SOURCE = 'packages/local-application/package.json';
const WORKER = path.relative(ROOT, fileURLToPath(LOCAL_APPLICATION_WORKER_URL)).split(path.sep).join('/');
const ENTRIES = [ENTRY, WORKER];
const SOURCE = /^(?:package\.json|server\.mts|(?:lib|packages)\/[A-Za-z0-9._/-]+\.(?:mts|ts|json))$/u;
const SUPPORT = [['packages/local-application/README.md', 'README.md'], ['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE'],
  ['DISCLOSURE', 'DISCLOSURE'], ['SECURITY.md', 'SECURITY.md'], ['LICENSES/Retire.js-Apache-2.0.txt', 'LICENSES/Retire.js-Apache-2.0.txt']] as const;
// Emergency processing ceilings for a complete static application plus server,
// not release-to-release source-count targets. The build has its own byte guard.
export const MAX_LOCAL_PACKAGE_PACKED_BYTES = 128 * 1024 * 1024;
export const MAX_LOCAL_PACKAGE_UNPACKED_BYTES = 320 * 1024 * 1024;
const execFile = promisify(execFileCallback);
const parse = (bytes: Buffer | string) => object(parseBoundedJson(bytes.toString(), { maximumBytes: MAX_CLI_PACKAGE_GRAPH_BYTES }), 'Package input');

export function localApplicationPackageInputs(graph: unknown, rootManifest: unknown) {
  return optionalPackageInputs(graph, { requiredSources: ENTRIES, acceptsSource: source => SOURCE.test(source),
    dependencies: Object.keys(object(object(rootManifest, 'Application manifest').dependencies, 'Application dependencies')) });
}

export function localApplicationPackageManifest(sourceValue: unknown, lockfileValue: unknown, dependencies: readonly string[]) {
  const source = object(sourceValue, 'Local package manifest');
  if (source.name !== '@slicedearth/whoisleuth-local' || source.private !== true || source.license !== 'AGPL-3.0-only') throw new Error('Unexpected local application package identity.');
  const lock = object(object(lockfileValue, 'Lockfile').packages, 'Locked packages');
  const pinned = Object.fromEntries(dependencies.map(name => [name, normalizeBoundedStableSemanticVersion(object(lock[`node_modules/${name}`], 'Locked dependency').version)]));
  return { name: source.name, version: normalizeBoundedStableSemanticVersion(source.version), private: true, type: 'module', license: source.license,
    description: source.description, bin: { 'whoisleuth-local': `runtime/${ENTRY.replace(/\.mts$/u, '.mjs')}` }, engines: { node: '>=24.19.0' },
    dependencies: pinned, bundleDependencies: [...dependencies], repository: { type: 'git', url: WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL }, homepage: WHOISLEUTH_PROJECT_URL };
}

export async function checkLocalApplicationPackage(repositoryRoot = ROOT, candidateDirectory?: string) {
  const root = await realpath(repositoryRoot), build = assertFrontendBuildIntegrity(root);
  const temporary = await mkdtemp(path.join(tmpdir(), 'whoisleuth-local-package-'));
  const sourceRoot = path.join(temporary, 'source'), staged = path.join(temporary, 'package'), runtime = path.join(staged, 'runtime');
  const packed = path.join(temporary, 'packed'), installed = path.join(temporary, 'installed'), home = path.join(temporary, 'home');
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home,
    npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: path.join(temporary, 'cache'), npm_config_userconfig: path.join(home, 'npmrc'),
    npm_config_globalconfig: path.join(home, 'global-npmrc'), npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'SITE_PASSWORD', 'SESSION_SECRET']) delete environment[key];
  const run = (command: string, args: string[], cwd: string) => execFile(command, args, { cwd, env: environment, encoding: 'utf8', timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS, maxBuffer: MAX_CLI_PACKAGE_GRAPH_BYTES, killSignal: 'SIGTERM' });
  try {
    await Promise.all([sourceRoot, staged, packed, installed, home].map(directory => mkdir(directory)));
    await Promise.all(['npmrc', 'global-npmrc'].map(name => writeFile(path.join(home, name), '')));
    const metadata = await captureCliPackageSourceSnapshot(root, ['package.json', 'package-lock.json', PACKAGE_SOURCE, ...SUPPORT.map(([source]) => source)], { totalBytes: 0 });
    const lockfile = parse(metadata.get('package-lock.json')!.bytes);
    const graph = parse((await run(process.execPath, [path.join(root, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs'), '--config', path.join(root, '.dependency-cruiser.json'), '--exclude', '^$', '--output-type', 'json', ...ENTRIES], root)).stdout);
    const inputs = localApplicationPackageInputs(graph, parse(metadata.get('package.json')!.bytes));
    const closure = await discoverPackageCompilerClosure(root, temporary, inputs.sources, { acceptsSource: source => SOURCE.test(source) });
    const sources = await captureCliPackageSourceSnapshot(root, closure.sources, { totalBytes: 0 });
    const compiler = await captureCliPackageSourceSnapshot(root, closure.contextFiles, { totalBytes: 0, maximumBytes: MAX_CLI_PACKAGE_COMPILER_CONTEXT_BYTES, maximumFileBytes: MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES });
    for (const [file, content] of metadata) if (sources.has(file)) assert.deepEqual(sources.get(file)!.bytes, content.bytes, 'Source metadata changed.');
    await materializeCliPackageSourceSnapshot(sourceRoot, new Map([...sources, ...metadata, ...compiler]));
    const frozen = await discoverPackageCompilerClosure(sourceRoot, temporary, ENTRIES, { acceptsSource: source => SOURCE.test(source) });
    for (const file of frozen.sources) if (!sources.has(file)) throw new Error('Materialised local source closure changed.');
    for (const file of frozen.contextFiles) if (!compiler.has(file)) throw new Error('Materialised local compiler context changed.');
    await compilePackageSources(root, temporary, runtime, sourceRoot, ENTRIES, { compilerRoot: sourceRoot, dependencyRoot: sourceRoot });
    const manifest = localApplicationPackageManifest(parse(metadata.get(PACKAGE_SOURCE)!.bytes), lockfile, inputs.dependencies);
    const applicationVersion = normalizeBoundedStableSemanticVersion(parse(metadata.get('package.json')!.bytes).version);
    await writeFile(path.join(runtime, 'package.json'), JSON.stringify({ name: 'whoisleuth', version: applicationVersion, type: 'module' }) + '\n');
    await writeFile(path.join(runtime, PACKAGE_SOURCE), JSON.stringify({ name: manifest.name, version: manifest.version, type: 'module' }) + '\n');
    for (const file of build.served.files) {
      const relative = `frontend/build/${file.path}`;
      const bytes = await readBoundedRegularFileWithin(root, relative, { maximumBytes: Math.max(1, file.bytes), expectedBytes: file.bytes, label: 'Verified application asset' });
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('The verified application asset changed.');
      const destination = path.join(runtime, relative); await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, bytes);
    }
    for (const [source, destination] of SUPPORT) { await mkdir(path.dirname(path.join(staged, destination)), { recursive: true }); await writeFile(path.join(staged, destination), metadata.get(source)!.bytes); }
    const notices = await buildThirdPartyNotices(root, { directDependencyNames: inputs.dependencies, scopeLabel: 'Local application server', lockfileValue: lockfile });
    await writeFile(path.join(staged, 'third-party-notices.txt'), notices);
    await writeFile(path.join(staged, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(path.join(staged, 'package-lock.json'), JSON.stringify(optionalPackageLock(manifest, lockfile), null, 2) + '\n');
    await run('npm', ['ci', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund'], staged);
    assertInstalledPackageDependencies(parse(await readFile(path.join(staged, 'package-lock.json'))), lockfile, inputs.dependencies, manifest.name);
    await chmod(path.join(runtime, ENTRY.replace(/\.mts$/u, '.mjs')), 0o755);
    const expected = await emittedPackageFiles(staged);
    const fileIdentity = await captureOptionalPackageFiles(staged, expected);
    assert.ok(expected.includes(`runtime/${WORKER.replace(/\.mts$/u, '.mjs')}`), 'The storage worker must be in the package.');
    const results: unknown = JSON.parse((await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packed], staged)).stdout);
    if (!Array.isArray(results) || results.length !== 1) throw new Error('Expected one local application archive.');
    const pack = object(results[0], 'Packed local application'), files = validateOptionalPackageFiles(pack, expected);
    assert.deepEqual([...files].sort(), expected, 'The archive must contain only the reviewed runtime, assets and support files.');
    if (!Number.isSafeInteger(pack.size) || Number(pack.size) < 1 || Number(pack.size) > MAX_LOCAL_PACKAGE_PACKED_BYTES
      || !Number.isSafeInteger(pack.unpackedSize) || Number(pack.unpackedSize) > MAX_LOCAL_PACKAGE_UNPACKED_BYTES) throw new Error('Local application archive exceeds its processing bounds.');
    if (typeof pack.filename !== 'string' || !/^[A-Za-z0-9._-]+\.tgz$/u.test(pack.filename)) throw new Error('Invalid local archive filename.');
    const archive = await readBoundedRegularFileWithin(packed, pack.filename, { maximumBytes: MAX_LOCAL_PACKAGE_PACKED_BYTES, minimumBytes: 1, label: 'Local application archive' });
    await assertCliPackageSourceSnapshot(root, sources); await assertCliPackageSourceSnapshot(root, metadata);
    await assertCliPackageSourceSnapshot(root, compiler, MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES);
    assert.deepEqual(assertFrontendBuildIntegrity(root), build);
    assert.equal(await buildThirdPartyNotices(root, { directDependencyNames: inputs.dependencies, scopeLabel: 'Local application server', lockfileValue: lockfile }), notices);
    await writeFile(path.join(installed, 'package.json'), '{"private":true}\n');
    await run('npm', ['install', '--offline', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', path.join(packed, pack.filename)], installed);
    const packageRoot = path.join(installed, 'node_modules', ...manifest.name.split('/'));
    const dependencyCount = await assertInstalledOptionalPackage(packageRoot, fileIdentity, parse(await readFile(path.join(installed, 'package-lock.json'))), lockfile, inputs.dependencies, manifest.name);
    assert.deepEqual(parse(await readFile(path.join(packageRoot, 'package.json'))), manifest);
    const executable = path.join(packageRoot, 'runtime', ENTRY.replace(/\.mts$/u, '.mjs'));
    const guard = ['--import', path.join(root, 'tools/browser-server-egress-guard.mts')];
    const checks: string[] = ['exact installed package and dependency integrity'];
    for (const args of [[], ['--help'], ['-h'], ['--version']]) {
      const result = await run(process.execPath, [...guard, executable, ...args], home);
      assert.equal(result.stderr, '');
      if (args[0] === '--version') assert.equal(result.stdout, `${manifest.version}\n`); else assert.match(result.stdout, /Saved records, drafts and retained files live in the selected folder/u);
      checks.push(args.join(' ') || 'zero-argument help');
    }
    const smoke = await run(process.execPath, [path.join(root, 'tools/local-application-package-smoke.mts'), packageRoot, path.join(root, 'tools/browser-server-egress-guard.mts')], home);
    assert.equal(smoke.stderr, '');
    const smokeChecks: unknown = JSON.parse(smoke.stdout);
    if (!Array.isArray(smokeChecks) || !smokeChecks.length || smokeChecks.some(value => typeof value !== 'string')) throw new Error('Installed local checks did not report completion.');
    checks.push(...smokeChecks);
    const archiveFile = `whoisleuth-local-${manifest.version}.tgz`;
    const report = { packageName: manifest.name, packageVersion: manifest.version, applicationVersion, sourceModules: frozen.sources.length,
      servedFiles: build.served.fileCount, servedBytes: build.served.totalBytes, servedDigestSha256: build.served.digestSha256,
      archiveFile, packedEntries: files.length, packedBytes: archive.byteLength, unpackedBytes: pack.unpackedSize,
      archiveSha256: createHash('sha256').update(archive).digest('hex'), dependencies: manifest.dependencies, installedDependencies: dependencyCount, installedChecks: checks, publicationEnabled: false };
    if (candidateDirectory) {
      const destination = path.resolve(candidateDirectory), parent = await realpath(path.dirname(destination));
      if (pathIsWithin(root, parent)) throw new Error('Local application candidates must be outside the checkout.');
      await mkdir(destination, { mode: 0o700 });
      await copyFile(path.join(packed, pack.filename), path.join(destination, archiveFile), constants.COPYFILE_EXCL);
      await writeFile(path.join(destination, 'local-application-package-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    return report;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--candidate' || !args[1])) throw new Error('Usage: local-application-package [--candidate <new-external-directory>]');
    process.stdout.write(JSON.stringify(await checkLocalApplicationPackage(ROOT, args[1]), null, 2) + '\n');
  } catch (cause) { process.stderr.write((cause instanceof Error ? cause.message : 'Local application package verification failed.') + '\n'); process.exitCode = 1; }
}
