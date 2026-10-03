import { createHash } from 'node:crypto';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { normalizeBoundedSemanticVersion } from '../packages/analysis/semantic-version.mts';
import { requireJsonRecord as object } from './maintainer-tool-helpers.mts';
import { MAX_NOTICE_LOCKFILE_BYTES, MAX_NOTICE_PACKAGES, packageNameFromInstallPath, productionDependencyInstallPaths, resolveInstalledDependency } from './third-party-notices.mts';

const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_MANIFEST_TOTAL_BYTES = 8 * 1024 * 1024;
type InstallationPlatform = Readonly<{ os: string; cpu: string; libc: string | null }>;

function readPlatform(value: unknown): InstallationPlatform {
  const platform = object(value, 'Installation platform');
  if (Object.keys(platform).sort().join(',') !== 'cpu,libc,os'
    || ![platform.os, platform.cpu].every(item => typeof item === 'string' && /^[a-z0-9_]{1,32}$/u.test(item))
    || platform.libc !== null && platform.libc !== 'glibc' && platform.libc !== 'musl') throw new TypeError('Installation platform is invalid.');
  return platform as InstallationPlatform;
}

function excludedOnPlatform(entry: Record<string, unknown>, platform: InstallationPlatform): boolean {
  return (['os', 'cpu', 'libc'] as const).some(key => {
    const values = entry[key] as readonly string[] | undefined;
    if (!values || platform[key] === null) return false;
    const actual = platform[key]!, positive = values.filter(value => !value.startsWith('!'));
    return values.includes(`!${actual}`) || positive.length > 0 && !positive.includes('any') && !positive.includes(actual);
  });
}

function candidateLockfile(value: unknown, packageName: string) {
  const candidatePath = `node_modules/${packageName}`;
  if (packageNameFromInstallPath(candidatePath) !== packageName) throw new TypeError('Candidate package name is invalid.');
  const lock = object(value, 'Installed dependency lock');
  if (lock.lockfileVersion !== 3) throw new TypeError('Installed dependency evidence requires lockfile version 3.');
  const packages = object(lock.packages, 'Installed packages');
  const locations = Object.keys(packages).filter(location => location !== '').sort();
  if (!locations.length || locations.length > MAX_NOTICE_PACKAGES) throw new TypeError('Installed dependency inventory exceeds its bound.');
  const closure = productionDependencyInstallPaths(lock, [packageName]);
  if (JSON.stringify(locations) !== JSON.stringify(closure)) throw new TypeError('Installed packages do not match the candidate runtime closure.');
  const auditPackages: Record<string, Record<string, unknown>> = {};
  for (const location of locations) {
    packageNameFromInstallPath(location);
    const entry = object(packages[location], 'Installed dependency');
    if (entry.link || entry.dev || entry.inBundle) throw new TypeError('Unbundled candidate dependency evidence cannot certify linked, development or bundled packages.');
    const version = normalizeBoundedSemanticVersion(entry.version, 'Installed dependency');
    const retained: Record<string, unknown> = { version };
    if (entry.optional === true) retained.optional = true;
    for (const key of ['os', 'cpu', 'libc'] as const) if (entry[key] !== undefined) {
      const values = entry[key];
      if (!Array.isArray(values) || !values.length || values.length > 32 || new Set(values).size !== values.length
        || values.some(value => typeof value !== 'string' || !/^!?[a-z0-9_]{1,32}$/u.test(value))) throw new TypeError('Locked platform requirements are invalid.');
      retained[key] = values;
    }
    if (entry.peerDependenciesMeta !== undefined) {
      const values = object(entry.peerDependenciesMeta, 'Peer dependency metadata');
      if (Object.keys(values).length > MAX_NOTICE_PACKAGES) throw new TypeError('Peer metadata exceeds its bound.');
      retained.peerDependenciesMeta = Object.fromEntries(Object.entries(values).map(([name, raw]) => {
        packageNameFromInstallPath(`node_modules/${name}`);
        const metadata = object(raw, 'Peer metadata');
        if (Object.keys(metadata).some(key => key !== 'optional') || typeof metadata.optional !== 'boolean') throw new TypeError('Peer metadata is invalid.');
        return [name, { optional: metadata.optional }];
      }));
    }
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      if (entry[key] !== undefined) {
        const values = object(entry[key], 'Installed dependency requirements');
        if (Object.keys(values).length > MAX_NOTICE_PACKAGES) throw new TypeError('Installed dependency requirements exceed their bound.');
        for (const [dependency, range] of Object.entries(values)) {
          packageNameFromInstallPath(`node_modules/${dependency}`);
          // Registry semver ranges only; no local paths, credentials or URLs.
          if (typeof range !== 'string' || !/^[0-9A-Za-z.*+^~<>=| -]{1,128}$/u.test(range)) throw new TypeError('Installed dependency requirement is not a bounded registry version range.');
          if (key === 'dependencies' && !Object.hasOwn(object(entry.optionalDependencies ?? {}, 'Optional requirements'), dependency)
            && !resolveInstalledDependency(packages, location, dependency)) throw new TypeError('An installed runtime dependency is missing from the lockfile.');
        }
        retained[key] = values;
      }
    }
    if (location !== candidatePath) {
      if (typeof entry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(entry.integrity)) throw new TypeError('Installed dependency lacks registry integrity.');
      let resolved: URL | null = null;
      try { if (typeof entry.resolved === 'string') resolved = new URL(entry.resolved); } catch { /* Reject without exposing the input URL. */ }
      if (!resolved || resolved.origin !== 'https://registry.npmjs.org' || resolved.username || resolved.password || resolved.search || resolved.hash) throw new TypeError('Installed dependency has an unexpected registry origin.');
      retained.integrity = entry.integrity;
      retained.resolved = resolved.href;
    }
    auditPackages[location] = retained;
  }
  // The candidate's temporary file: location is deliberately not retained.
  // This standard lock projects only registry identities for a no-install audit.
  return { lockfileVersion: 3, requires: true, packages: {
    '': { name: 'candidate-dependency-review', version: '1.0.0', private: true, dependencies: { [packageName]: String(auditPackages[candidatePath]!.version) } },
    ...auditPackages,
  } };
}

/** Observe fresh npm resolution; do not substitute the repository's lockfile. */
export async function installedDependencyEvidence(directory: string, packageName: string, archiveSha256: string) {
  if (!/^[a-f0-9]{64}$/u.test(archiveSha256)) throw new TypeError('Candidate archive digest is invalid.');
  const lockBytes = await readBoundedRegularFileWithin(directory, 'package-lock.json', { maximumBytes: MAX_NOTICE_LOCKFILE_BYTES, label: 'Installed dependency lock' });
  const lockfile = candidateLockfile(parseBoundedJsonObject(lockBytes.toString('utf8'), { maximumBytes: MAX_NOTICE_LOCKFILE_BYTES, label: 'Installed dependency lock' }), packageName);
  const locations = Object.keys(lockfile.packages).filter(location => location !== '');
  const mandatory = new Set(productionDependencyInstallPaths(lockfile, [packageName], { omitOptionalDependencies: true }));
  const installationPlatform: InstallationPlatform = { os: process.platform, cpu: process.arch,
    libc: process.platform === 'linux' ? (object(object(process.report.getReport(), 'Runtime report').header, 'Runtime header').glibcVersionRuntime ? 'glibc' : 'musl') : null };
  const manifests: Record<string, string | null> = {};
  let totalBytes = 0;
  for (const location of locations) {
    const entry = object((lockfile.packages as Record<string, unknown>)[location], 'Installed dependency');
    let bytes: Buffer;
    try { bytes = await readBoundedRegularFileWithin(directory, `${location}/package.json`, { maximumBytes: MAX_MANIFEST_BYTES, label: 'Installed dependency manifest' }); }
    catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT'
        && entry.optional === true && !mandatory.has(location) && excludedOnPlatform(entry, installationPlatform)) {
        manifests[location] = null; continue;
      }
      throw cause;
    }
    if ((totalBytes += bytes.byteLength) > MAX_MANIFEST_TOTAL_BYTES) throw new TypeError('Installed manifests exceed their aggregate byte bound.');
    const manifest = parseBoundedJsonObject(bytes.toString('utf8'), { maximumBytes: MAX_MANIFEST_BYTES, label: 'Installed dependency manifest' });
    if (manifest.name !== packageNameFromInstallPath(location) || manifest.version !== entry.version) throw new TypeError('An installed manifest differs from its resolved lock identity.');
    manifests[location] = createHash('sha256').update(bytes).digest('hex');
  }
  const packageVersion = String(object((lockfile.packages as Record<string, unknown>)[`node_modules/${packageName}`], 'Candidate identity').version);
  return Object.freeze({ packageName, packageVersion, archiveSha256,
    dependencyCount: locations.length - 1, manifestSha256: manifests, installationPlatform, lockfile });
}

/** Re-admit an external candidate's recorded graph before its explicit audit. */
export function candidateDependencyAuditInput(value: unknown) {
  const evidence = object(value, 'Candidate dependency evidence');
  if (typeof evidence.packageName !== 'string' || typeof evidence.archiveSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(evidence.archiveSha256)) throw new TypeError('Candidate dependency identity is invalid.');
  const lockfile = candidateLockfile(evidence.lockfile, evidence.packageName);
  const entries = Object.keys(lockfile.packages).filter(location => location !== '').sort();
  const manifests = object(evidence.manifestSha256, 'Installed manifest identities');
  const platform = evidence.installationPlatform === undefined ? null : readPlatform(evidence.installationPlatform);
  const mandatory = new Set(productionDependencyInstallPaths(lockfile, [evidence.packageName], { omitOptionalDependencies: true }));
  if (evidence.dependencyCount !== entries.length - 1 || JSON.stringify(Object.keys(manifests).sort()) !== JSON.stringify(entries)
    || Object.entries(manifests).some(([location, value]) => {
      if (typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)) return false;
      const entry = object((lockfile.packages as Record<string, unknown>)[location], 'Installed dependency');
      return value !== null || !platform || mandatory.has(location) || entry.optional !== true || !excludedOnPlatform(entry, platform);
    })) throw new TypeError('Candidate dependency evidence is incomplete.');
  const candidate = object((lockfile.packages as Record<string, unknown>)[`node_modules/${evidence.packageName}`], 'Candidate identity');
  if (candidate.version !== evidence.packageVersion) throw new TypeError('Candidate dependency version differs from its lock.');
  return { archiveSha256: evidence.archiveSha256, lockfile };
}
