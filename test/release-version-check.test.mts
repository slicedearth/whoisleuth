import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  MAX_RELEASE_VERSION_LENGTH,
  RELEASE_IDENTITY_PATHS,
  RELEASE_VERSION_CHECK_SCHEMA,
  RELEASE_VERSION_CHECK_VERSION,
  buildReleaseVersionReport,
  formatReleaseVersionReport,
  inspectReleaseVersionIdentity,
  main,
  normalizeSemanticVersion,
  parseArguments,
} from '../tools/release-version-check.mts';

function capture() {
  let value = '';
  return { stream: { write(chunk: unknown) { value += String(chunk); } }, value: () => value };
}

function manifests(version = '1.5.0') {
  return {
    packageManifest: { name: 'whoisleuth', version, private: true },
    lockfile: {
      name: 'whoisleuth',
      version,
      packages: { '': { name: 'whoisleuth', version } },
    },
  };
}

function git(repositoryRoot: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: repositoryRoot, stdio: 'ignore' });
}

describe('release semantic-version validation', () => {
  test('accepts stable, prerelease, and build semantic versions', () => {
    for (const version of ['0.1.0', '1.5.0', '2.0.0-rc.1', '2.0.0-rc.1+build.42']) {
      assert.equal(normalizeSemanticVersion(version), version);
    }
  });

  test('rejects prefixes, whitespace, missing components, leading zeroes, and invalid identifiers', () => {
    for (const version of [
      'v1.5.0',
      ' 1.5.0',
      '1.5',
      '1.05.0',
      '1.5.0-01',
      '1.5.0-',
      '1.5.0+',
      '1.5.0+bad/value',
      '1.5.0++build',
      '1'.repeat(MAX_RELEASE_VERSION_LENGTH + 1),
    ]) {
      assert.throws(() => normalizeSemanticVersion(version), /Release/);
    }
  });
});

describe('release manifest lockstep', () => {
  test('returns a bounded report without publishing or tagging', () => {
    const { packageManifest, lockfile } = manifests();
    const report = buildReleaseVersionReport(packageManifest, lockfile);
    assert.deepEqual(report, {
      schema: RELEASE_VERSION_CHECK_SCHEMA,
      version: RELEASE_VERSION_CHECK_VERSION,
      releaseVersion: '1.5.0',
      expectedTag: 'v1.5.0',
      packagePublishing: 'disabled',
      manifestLockstep: true,
      releaseIdentity: {
        state: 'unreleased',
        checkedPaths: RELEASE_IDENTITY_PATHS.length,
      },
    });
    assert.match(formatReleaseVersionReport(report), /Expected tag: v1\.5\.0/);
    assert.match(formatReleaseVersionReport(report), /Package publishing: disabled/);
  });

  test('rejects mismatched versions, renamed packages, and accidental publication', () => {
    const mismatch = manifests();
    mismatch.lockfile.packages[''].version = '1.4.0';
    assert.throws(() => buildReleaseVersionReport(mismatch.packageManifest, mismatch.lockfile), /versions must match/);

    const renamed = manifests();
    renamed.lockfile.name = 'other-package';
    assert.throws(() => buildReleaseVersionReport(renamed.packageManifest, renamed.lockfile), /names must match/);

    const publishable = manifests();
    publishable.packageManifest.private = false;
    assert.throws(() => buildReleaseVersionReport(publishable.packageManifest, publishable.lockfile), /remain private/);
  });

  test('checks repository manifests through the no-argument command', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-release-check-'));
    const { packageManifest, lockfile } = manifests('2.1.0');
    try {
      await writeFile(path.join(directory, 'package.json'), JSON.stringify(packageManifest), 'utf8');
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lockfile), 'utf8');
      const stdout = capture();
      const stderr = capture();
      assert.equal(await main([], {
        repositoryRoot: directory,
        stdout: stdout.stream,
        stderr: stderr.stream,
        inspectIdentity: () => ({ state: 'unreleased', checkedPaths: RELEASE_IDENTITY_PATHS.length }),
      }), 0);
      assert.match(stdout.value(), /Version: 2\.1\.0/);
      assert.match(stdout.value(), /Release identity: untagged version/u);
      assert.equal(stderr.value(), '');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects command arguments and malformed manifests without leaking their contents', async () => {
    assert.equal(parseArguments([]), undefined);
    assert.throws(() => parseArguments(['--tag']), /Usage/);

    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-release-check-'));
    try {
      await writeFile(path.join(directory, 'package.json'), '{"secret":"not-json"', 'utf8');
      await writeFile(path.join(directory, 'package-lock.json'), '{}', 'utf8');
      const stdout = capture();
      const stderr = capture();
      assert.equal(await main([], { repositoryRoot: directory, stdout: stdout.stream, stderr: stderr.stream }), 2);
      assert.equal(stdout.value(), '');
      assert.match(stderr.value(), /package\.json is not valid JSON/);
      assert.doesNotMatch(stderr.value(), /secret/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('release source identity', () => {
  test('allows a new version and an unchanged tagged source boundary', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-release-identity-'));
    try {
      await mkdir(path.join(directory, 'cli'), { recursive: true });
      await mkdir(path.join(directory, 'docs'), { recursive: true });
      const { packageManifest, lockfile } = manifests('2.1.0');
      await writeFile(path.join(directory, 'package.json'), JSON.stringify(packageManifest), 'utf8');
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lockfile), 'utf8');
      await writeFile(path.join(directory, 'cli', 'runtime.mts'), 'export const value = 1;\n', 'utf8');
      await writeFile(path.join(directory, 'docs', 'application-guide.md'), '# Guide\n', 'utf8');
      git(directory, 'init', '--quiet');
      git(directory, 'config', 'user.name', 'Release identity fixture');
      git(directory, 'config', 'user.email', 'release-identity@example.test');
      git(directory, 'add', '.');
      git(directory, 'commit', '--quiet', '-m', 'Create fixture release');
      git(directory, 'tag', 'v2.1.0');

      assert.deepEqual(inspectReleaseVersionIdentity(directory, 'v2.1.0'), {
        state: 'tagged_current_sources',
        checkedPaths: RELEASE_IDENTITY_PATHS.length,
      });
      assert.deepEqual(inspectReleaseVersionIdentity(directory, 'v2.2.0'), {
        state: 'unreleased',
        checkedPaths: RELEASE_IDENTITY_PATHS.length,
      });

      await writeFile(path.join(directory, 'docs', 'application-guide.md'), '# Revised guide\n', 'utf8');
      assert.equal(inspectReleaseVersionIdentity(directory, 'v2.1.0').state, 'tagged_current_sources');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects committed, staged, unstaged, and untracked release-input drift', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-release-identity-'));
    try {
      await mkdir(path.join(directory, 'cli'), { recursive: true });
      const { packageManifest, lockfile } = manifests('2.1.0');
      await writeFile(path.join(directory, 'package.json'), JSON.stringify(packageManifest), 'utf8');
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lockfile), 'utf8');
      await writeFile(path.join(directory, 'cli', 'runtime.mts'), 'export const value = 1;\n', 'utf8');
      git(directory, 'init', '--quiet');
      git(directory, 'config', 'user.name', 'Release identity fixture');
      git(directory, 'config', 'user.email', 'release-identity@example.test');
      git(directory, 'add', '.');
      git(directory, 'commit', '--quiet', '-m', 'Create fixture release');
      git(directory, 'tag', 'v2.1.0');

      await writeFile(path.join(directory, 'cli', 'runtime.mts'), 'export const value = 2;\n', 'utf8');
      assert.throws(() => inspectReleaseVersionIdentity(directory, 'v2.1.0'), /already identifies different release inputs/u);
      git(directory, 'add', 'cli/runtime.mts');
      assert.throws(() => inspectReleaseVersionIdentity(directory, 'v2.1.0'), /already identifies different release inputs/u);
      git(directory, 'commit', '--quiet', '-m', 'Change fixture runtime');
      assert.throws(() => inspectReleaseVersionIdentity(directory, 'v2.1.0'), /already identifies different release inputs/u);

      git(directory, 'tag', '--force', 'v2.1.0');
      assert.equal(inspectReleaseVersionIdentity(directory, 'v2.1.0').state, 'tagged_current_sources');
      await writeFile(path.join(directory, 'cli', 'untracked.mts'), 'export {};\n', 'utf8');
      assert.throws(() => inspectReleaseVersionIdentity(directory, 'v2.1.0'), /already identifies different release inputs/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects malformed tag identities and repositories without Git history', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-release-identity-'));
    try {
      assert.throws(() => inspectReleaseVersionIdentity(directory, '2.1.0'), /exact semantic-version tag/u);
      assert.throws(() => inspectReleaseVersionIdentity(directory, 'v2.1.0'), /Git checkout with complete local tag history/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
