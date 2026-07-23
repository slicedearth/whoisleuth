import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  MAX_RELEASE_VERSION_LENGTH,
  RELEASE_VERSION_CHECK_SCHEMA,
  RELEASE_VERSION_CHECK_VERSION,
  buildReleaseVersionReport,
  formatReleaseVersionReport,
  main,
  normalizeSemanticVersion,
  parseArguments,
} from '../tools/release-version-check.mts';

function capture() {
  let value = '';
  return { stream: { write(chunk) { value += String(chunk); } }, value: () => value };
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
      assert.equal(await main([], { repositoryRoot: directory, stdout: stdout.stream, stderr: stderr.stream }), 0);
      assert.match(stdout.value(), /Version: 2\.1\.0/);
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
