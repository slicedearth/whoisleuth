import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  MAX_RELEASE_VERSION_LENGTH,
  MAX_RELEASE_DERIVED_REPORTS,
  RELEASE_IDENTITY_PATHS,
  RELEASE_VERSION_CHECK_SCHEMA,
  RELEASE_VERSION_CHECK_VERSION,
  assertReleaseVersionDerivedCasePack,
  buildReleaseVersionReport,
  formatReleaseVersionReport,
  inspectReleaseVersionIdentity,
  inspectReleaseVersionDerivedOutputs,
  inspectPublicCompatibilityVersion,
  selectPublicCompatibilityVersion,
  main,
  normalizeSemanticVersion,
  parseArguments,
} from '../tools/release-version-check.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { WHOISLEUTH_APPLICATION_VERSION } from '../lib/application-version.mts';
import { buildCaseSupportedContractBaseline } from '../packages/contracts/case-supported-contract-baseline.mts';
import { CASE_SUPPORTED_CONTRACT_BASELINE_PATH } from '../tools/case-supported-contract-baseline.mts';
import { releasePreparationCommands, runReleasePreparation } from '../tools/prepare-release.mts';
import { npmExecutableName } from '../tools/maintainer-tool-helpers.mts';
import { checkCliPackage } from '../tools/cli-package.mts';

function capture() {
  let value = '';
  return { stream: { write(chunk: unknown) { value += String(chunk); return true; } }, value: () => value };
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
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgSign=false', ...args], {
    cwd: repositoryRoot, stdio: 'ignore', timeout: 10_000,
  });
}

describe('release semantic-version validation', () => {
  test('disposable release commits and tags do not invoke inherited signing configuration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-release-signing-'));
    try {
      git(directory, 'init', '--quiet');
      git(directory, 'config', 'user.name', 'Release fixture');
      git(directory, 'config', 'user.email', 'release@example.test');
      git(directory, 'config', 'commit.gpgsign', 'true');
      git(directory, 'config', 'tag.gpgSign', 'true');
      git(directory, 'config', 'gpg.program', path.join(directory, 'must-not-run'));
      await writeFile(path.join(directory, 'fixture.txt'), 'Release fixture');
      git(directory, 'add', 'fixture.txt');
      git(directory, 'commit', '--quiet', '-m', 'Retain fixture');
      git(directory, 'tag', 'v4.1.0');
      assert.equal(execFileSync('git', ['cat-file', '-t', 'v4.1.0'], { cwd: directory, encoding: 'utf8' }).trim(), 'commit');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test('prepares approved versions through existing writers without tags or dependency scripts', () => {
    const commands = releasePreparationCommands('4.1.1', '4.1.0');
    assert.deepEqual(commands[0], [npmExecutableName(), 'version', '4.1.1', '--no-git-tag-version', '--ignore-scripts']);
    assert.deepEqual(commands.slice(1), [
      [process.execPath, 'tools/public-product-catalogue.mts', '--write'],
      [process.execPath, 'tools/release-version-check.mts'],
    ]);
    assert.deepEqual(releasePreparationCommands('4.1.1', '4.1.1'), commands.slice(1));
    assert.throws(() => releasePreparationCommands('--force', '4.1.0'));
  });
  test('accepts stable, prerelease, and build semantic versions', () => {
    for (const version of ['0.1.0', '1.5.0', '2.0.0-rc.1', '2.0.0-rc.1+build.42']) {
      assert.equal(normalizeSemanticVersion(version), version);
    }
  });

  test('stops at a failed preparation phase and resumes an already updated version without another bump', () => {
    for (const failedPhase of [0, 1, 2]) {
      const stderr = capture();
      let current = '4.1.0';
      const executed: string[][] = [];
      assert.equal(runReleasePreparation('4.1.1', current, (command, args) => {
        executed.push([command, ...args]);
        if (executed.length - 1 === failedPhase) return { status: 1 };
        if (args[0] === 'version') current = args[1]!;
        return { status: 0 };
      }, stderr.stream), 2);
      assert.equal(executed.length, failedPhase + 1);
      assert.equal(current, failedPhase === 0 ? '4.1.0' : '4.1.1');
      assert.match(stderr.value(), /Earlier edits remain/u);
      assert.match(stderr.value(), /rerun npm run release:prepare -- 4\.1\.1/u);
      const resumed: string[][] = [];
      assert.equal(runReleasePreparation('4.1.1', current, (command, args) => {
        resumed.push([command, ...args]);
        return { status: 0 };
      }, stderr.stream), 0);
      assert.equal(resumed.filter(command => command[1] === 'version').length, failedPhase === 0 ? 1 : 0);
      assert.deepEqual(resumed.slice(-2).map(command => command.slice(1)), [
        ['tools/public-product-catalogue.mts', '--write'], ['tools/release-version-check.mts'],
      ]);
    }
    const stderr = capture();
    let attempts = 0;
    assert.throws(() => runReleasePreparation('4.1.1', '4.1.0', () => {
      attempts += 1;
      return { status: null, error: new Error('fixture execution failed') };
    }, stderr.stream), /fixture execution failed/u);
    assert.equal(attempts, 1);
    assert.match(stderr.value(), /Earlier edits remain/u);
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

  test('requires current generated Case-pack reports to match the release version', () => {
    const fixture = {
      version: CASE_SCHEMA_VERSION,
      packet: {
        schema: 'whoisleuth.cli.case-pack',
        reports: [{ application: { name: 'WHOISleuth', version: '2.2.0' } }],
      },
    };
    assert.equal(assertReleaseVersionDerivedCasePack(fixture, '2.2.0'), 1);
    assert.throws(
      () => assertReleaseVersionDerivedCasePack(fixture, '2.2.1'),
      /must match release version 2\.2\.1.*canonical writer/u,
    );
    assert.throws(
      () => assertReleaseVersionDerivedCasePack({ ...fixture, version: CASE_SCHEMA_VERSION - 1 }, '2.2.0'),
      /current Case schema/u,
    );
    assert.throws(
      () => assertReleaseVersionDerivedCasePack({
        ...fixture,
        packet: { ...fixture.packet, reports: Array(MAX_RELEASE_DERIVED_REPORTS + 1).fill(null) },
      }, '2.2.0'),
      /invalid or unbounded/u,
    );
  });

  test('selects the latest reachable stable tag before the current release', () => {
    assert.equal(selectPublicCompatibilityVersion('2.2.0', [
      'v1.47.4',
      'v2.0.1',
      'v2.1.0',
      'v2.2.0',
      'v2.3.0',
      'v2.2.0-rc.1',
      'not-a-release',
    ]), '2.1.0');
    assert.equal(selectPublicCompatibilityVersion('2.1.1', ['v2.1.0', 'v2.0.10']), '2.1.0');
    assert.throws(
      () => selectPublicCompatibilityVersion('2.0.0', ['v2.0.0', 'v2.1.0']),
      /No preceding public release tag/u,
    );
    assert.throws(
      () => selectPublicCompatibilityVersion('2.2.0', []),
      /tag inventory/u,
    );
  });

  test('contributions retain the current public boundary and cannot downgrade it through the manifest', () => {
    const tags = ['v2.0.10', 'v2.1.0', 'v2.2.0-rc.1'];
    assert.equal(selectPublicCompatibilityVersion('2.1.0', tags, 'contribution'), '2.1.0');
    assert.equal(selectPublicCompatibilityVersion('2.2.0', tags, 'contribution'), '2.1.0');
    assert.throws(() => selectPublicCompatibilityVersion('2.0.10', tags, 'contribution'), /precedes the latest reachable public release/u);
  });

  test('checks generated writer metadata without rewriting a published same-schema fixture', async () => {
    const fixturePath = new URL('./fixtures/case-lifecycle/cli-case-pack-v2-case-v16-current.json', import.meta.url);
    const frozenBytes = await readFile(fixturePath);
    const published = JSON.parse(await readFile(new URL('./fixtures/case-lifecycle/cli-case-pack-v2-case-v15.json', import.meta.url), 'utf8'));
    assert.equal(published.packet.reports[0].application.version, '2.3.0');
    assert.deepEqual(await inspectReleaseVersionDerivedOutputs(process.cwd(), WHOISLEUTH_APPLICATION_VERSION), {
      checkedFixtures: 1, checkedReports: 1,
    });
    await assert.rejects(
      inspectReleaseVersionDerivedOutputs(process.cwd(), '0.0.0'),
      /application metadata must match release version/u,
    );
    assert.deepEqual(await readFile(fixturePath), frozenBytes);
  });

  test('checks the actual preceding tag without a manually maintained application-release declaration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-public-boundary-'));
    try {
      await mkdir(path.join(directory, 'docs'));
      const filename = path.join(directory, CASE_SUPPORTED_CONTRACT_BASELINE_PATH);
      const baseline = buildCaseSupportedContractBaseline();
      await writeFile(filename, JSON.stringify(baseline));
      git(directory, 'init', '--quiet');
      git(directory, 'config', 'user.name', 'Release fixture');
      git(directory, 'config', 'user.email', 'release@example.test');
      git(directory, 'add', '.');
      git(directory, 'commit', '--quiet', '-m', 'Retain published contracts');
      git(directory, 'tag', 'v4.1.0');
      assert.equal(inspectPublicCompatibilityVersion(directory, '4.1.1'), '4.1.0');
      const missingContract = { ...baseline.commitments.contracts[0]!, key: 'browser.cases@999', version: 999 };
      await writeFile(filename, JSON.stringify({ ...baseline, commitments: {
        ...baseline.commitments, contracts: [...baseline.commitments.contracts, missingContract],
      } }));
      git(directory, 'add', '.');
      git(directory, 'commit', '--quiet', '-m', 'Add a published contract');
      git(directory, 'tag', 'v4.1.1');
      assert.throws(() => inspectPublicCompatibilityVersion(directory, '4.1.2'), /browser\.cases@999 disappeared/u);
      assert.throws(() => inspectPublicCompatibilityVersion(directory, '4.1.1', 'contribution'), /browser\.cases@999 disappeared/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
        inspectPublicBoundary: () => '2.1.0',
      }), 0);
      assert.match(stdout.value(), /Version: 2\.1\.0/);
      assert.match(stdout.value(), /Release identity: untagged version/u);
      assert.match(stdout.value(), /Preceding public compatibility boundary: v2\.1\.0/u);
      assert.equal(stderr.value(), '');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects command arguments and malformed manifests without leaking their contents', async () => {
    assert.equal(parseArguments([]), 'release');
    assert.equal(parseArguments(['--contribution']), 'contribution');
    assert.throws(() => parseArguments(['--contribution', '--contribution']), /Usage/u);
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
  test('same-version contributions pass while release checks and direct candidate assembly reject changed inputs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-contribution-version-'));
    try {
      await mkdir(path.join(directory, 'docs'));
      await mkdir(path.join(directory, 'cli'));
      const { packageManifest, lockfile } = manifests('4.1.0');
      await writeFile(path.join(directory, 'package.json'), JSON.stringify(packageManifest));
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lockfile));
      await writeFile(path.join(directory, CASE_SUPPORTED_CONTRACT_BASELINE_PATH), JSON.stringify(buildCaseSupportedContractBaseline()));
      await writeFile(path.join(directory, 'cli/runtime.mts'), 'export const value = 1;\n');
      git(directory, 'init', '--quiet');
      git(directory, 'config', 'user.name', 'Release fixture');
      git(directory, 'config', 'user.email', 'release@example.test');
      git(directory, 'add', '.');
      git(directory, 'commit', '--quiet', '-m', 'Retain release fixture');
      git(directory, 'tag', 'v4.0.0');
      git(directory, 'tag', 'v4.1.0');

      for (const [file, contents] of [
        ['package-lock.json', JSON.stringify({ ...lockfile, packages: {
          ...lockfile.packages, 'node_modules/example-parser': { version: '1.1.1', dev: true },
        } })],
        ['cli/runtime.mts', 'export const value = 2;\n'],
      ]) {
        await writeFile(path.join(directory, file!), contents!);
        const stdout = capture();
        const stderr = capture();
        assert.equal(await main(['--contribution'], { repositoryRoot: directory, stdout: stdout.stream, stderr: stderr.stream }), 0);
        assert.match(stdout.value(), /Public compatibility boundary: v4\.1\.0/u);
        assert.match(stdout.value(), /Release identity: not assessed/u);
        assert.doesNotMatch(stdout.value(), /untagged version|existing tag matches/u);
        assert.equal(stderr.value(), '');
        assert.equal(await main([], { repositoryRoot: directory, stdout: capture().stream, stderr: stderr.stream }), 2);
        assert.match(stderr.value(), /already identifies different release inputs/u);
        await assert.rejects(checkCliPackage(directory, {
          publicationEnabled: true, expectedTag: 'v4.1.0', artifactDirectory: path.join(directory, 'candidate'),
        }), /already identifies different release inputs/u);
        await assert.rejects(readFile(path.join(directory, 'candidate/cli-package-report.json')), { code: 'ENOENT' });
        git(directory, 'add', file!);
        git(directory, 'commit', '--quiet', '-m', 'Update contribution fixture');
      }
      assert.equal(await main(['--contribution'], { repositoryRoot: directory, stdout: capture().stream, stderr: capture().stream }), 0);
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...packageManifest, version: '4.2.0' }));
      const stderr = capture();
      assert.equal(await main(['--contribution'], { repositoryRoot: directory, stdout: capture().stream, stderr: stderr.stream }), 2);
      assert.match(stderr.value(), /versions must match/u);

      const shallow = path.join(directory, 'shallow');
      git(directory, 'clone', '--quiet', '--depth=1', pathToFileURL(directory).href, shallow);
      assert.throws(() => inspectPublicCompatibilityVersion(shallow, '4.1.0', 'contribution'), /non-shallow Git checkout/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

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
      assert.throws(() => inspectPublicCompatibilityVersion(directory, '2.1.0', 'contribution'), /Git checkout with complete local tag history/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
