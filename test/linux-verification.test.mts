import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linuxVerificationEnvironment, linuxVerificationImageReference, linuxVerificationImages, linuxVerificationRunArguments, parseLinuxVerificationArguments } from '../tools/linux-verification.mts';
import { CI_COMMAND_GROUPS, criticalBrowserInstallArguments } from '../tools/ci-verification.mts';
import { REDIS_VERIFICATION_IMAGE } from '../tools/redis-verification.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('isolated Linux verification', () => {
  test('requires an explicit execution scope and shares focused-path and CI-group validation', async () => {
    for (const args of [[], ['--help']]) assert.equal((await parseLinuxVerificationArguments(args)).mode, 'help');
    assert.equal((await parseLinuxVerificationArguments(['--build-image'])).mode, 'build-image');
    assert.deepEqual(await parseLinuxVerificationArguments(['--full']), { mode: 'full', arguments: ['--full'] });
    for (const group of CI_COMMAND_GROUPS) {
      const expected = { mode: 'group', arguments: [`--group=${group}`] };
      assert.deepEqual(await parseLinuxVerificationArguments([`--group=${group}`]), expected);
      assert.deepEqual(await parseLinuxVerificationArguments(['--group', group]), expected);
    }
    for (const changedPath of ['test/linux-verification.test.mts', 'unknown/file.mts']) {
      assert.deepEqual(await parseLinuxVerificationArguments(['--focused', '--list', changedPath]), {
        mode: 'focused', arguments: ['--focused', '--list', changedPath],
      });
    }
    for (const args of [
      ['--focused'], ['--focused', '--changed'], ['--focused', '--list'],
      ['--focused', '../outside.mts'], ['--focused', '/absolute.mts'], ['--focused', 'tools/../outside.mts'],
      ['--focused', 'tools/$(command).mts'],
      ['--focused', 'test/linux-verification.test.mts', 'test/linux-verification.test.mts'],
      ['--focused', '--full'], ['--group=unknown'], ['--group=unit', '--full'],
      ['--full', '--list'], ['--build-image', '--full'], ['--privileged'],
    ]) await assert.rejects(() => parseLinuxVerificationArguments(args), args.join(' '));
  });

  test('keeps help, image preparation and CI bootstrapping available without installed host dependencies', () => {
    const source = `
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, next) {
        const result = next(specifier, context);
        if (result.url.includes('/node_modules/')) throw new Error('Unexpected host dependency: ' + specifier);
        return result;
      } });
      const { parseLinuxVerificationArguments, main } = await import(${JSON.stringify(new URL('../tools/linux-verification.mts', import.meta.url).href)});
      for (const args of [[], ['--full'], ['--build-image'], ['--group=quality']]) {
        console.log((await parseLinuxVerificationArguments(args)).mode);
      }
      process.exitCode = await main([]);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: ROOT, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^help\nfull\nbuild-image\ngroup\nUsage:/u);
  });

  test('pins the requested platform manifest before pulling rather than relying on daemon tag aliases', () => {
    const amd = { digest: `sha256:${'a'.repeat(64)}`, platform: { os: 'linux', architecture: 'amd64' } };
    const arm = { digest: `sha256:${'b'.repeat(64)}`, platform: { os: 'linux', architecture: 'arm64', variant: 'v8' } };
    const manifest = { manifests: [amd, arm, { platform: { os: 'unknown', architecture: 'unknown' } }] };
    assert.equal(linuxVerificationImageReference('node:24.19.0-bookworm-slim', manifest, 'linux/arm64'), `node:24.19.0-bookworm-slim@${arm.digest}`);
    assert.equal(linuxVerificationImageReference('node:24.19.0-bookworm-slim', manifest, 'linux/amd64'), `node:24.19.0-bookworm-slim@${amd.digest}`);
    assert.equal(linuxVerificationImageReference(REDIS_VERIFICATION_IMAGE, manifest, 'linux/arm64'), `redis:7.2.16-bookworm@${arm.digest}`);
    for (const invalid of [null, {}, { manifests: [amd] }, { manifests: [arm, arm] }, { manifests: [{ ...arm, digest: 'mutable' }] }]) {
      assert.throws(() => linuxVerificationImageReference('node:24.19.0-bookworm-slim', invalid, 'linux/arm64'), /unique immutable manifest/u);
    }
  });

  test('selects the native engine architecture and rejects unsupported or insufficient environments before downloads', () => {
    for (const architecture of ['arm64', 'aarch64', 'amd64', 'x86_64']) {
      const result = linuxVerificationEnvironment({ OSType: 'linux', Architecture: architecture, MemTotal: 4 * 1024 ** 3 });
      assert.equal(result.platform, ['arm64', 'aarch64'].includes(architecture) ? 'linux/arm64' : 'linux/amd64');
      assert.equal(result.analysisMemoryMiB, 3072);
    }
    for (const info of [
      { OSType: 'windows', Architecture: 'amd64', MemTotal: 4 * 1024 ** 3 },
      { OSType: 'linux', Architecture: 'riscv64', MemTotal: 4 * 1024 ** 3 },
      { OSType: 'linux', Architecture: 'arm64', MemTotal: 2 * 1024 ** 3 },
      { OSType: 'linux', Architecture: 'arm64', MemTotal: NaN },
    ]) assert.throws(() => linuxVerificationEnvironment(info));
    assert.equal(linuxVerificationEnvironment({ OSType: 'linux', Architecture: 'arm64', MemTotal: 2 * 1024 ** 3 }, false).analysisMemoryMiB, null);
    for (const memory of [NaN, 0, -1, Infinity]) {
      assert.throws(() => linuxVerificationEnvironment({ OSType: 'linux', Architecture: 'arm64', MemTotal: memory }, false));
    }
  });

  test('derives runtime images from existing source identities', () => {
    assert.deepEqual(linuxVerificationImages('24.19.0', '1.62.1', 26), {
      PRIMARY_NODE_IMAGE: 'node:24.19.0-bookworm-slim',
      COMPATIBILITY_NODE_IMAGE: 'node:26-bookworm-slim',
      BROWSER_IMAGE: 'mcr.microsoft.com/playwright:v1.62.1-noble',
      REDIS_IMAGE: REDIS_VERIFICATION_IMAGE,
    });
    for (const invalid of ['latest', '24', '24.19.0\n--privileged']) {
      assert.throws(() => linuxVerificationImages(invalid, '1.62.1'));
      assert.throws(() => linuxVerificationImages('24.19.0', invalid));
    }
  });

  test('mounts only the read-only committed bundle with no host credentials or privileges', async () => {
    const options = {
      name: 'whoisleuth-verification-1234', image: `sha256:${'a'.repeat(64)}`,
      bundle: '/private/review folder/source.bundle', seccomp: '/private/review folder/seccomp.json',
      revision: 'b'.repeat(40), base: 'c'.repeat(40),
      platform: 'linux/amd64' as const,
      selection: ['--full'],
    };
    const args = await linuxVerificationRunArguments(options);
    assert.deepEqual(args.filter((_, index) => args[index - 1] === '--mount'), [
      'type=bind,source=/private/review folder/source.bundle,target=/input/source.bundle,readonly',
    ]);
    assert.deepEqual(args.filter((_, index) => args[index - 1] === '--env'), [
      `WHOISLEUTH_VERIFY_REVISION=${options.revision}`, `WHOISLEUTH_VERIFY_BASE=${options.base}`,
    ]);
    assert.equal(args.includes('--platform=linux/amd64'), true);
    assert.equal((await linuxVerificationRunArguments({ ...options, platform: 'linux/arm64' })).includes('--platform=linux/arm64'), true);
    assert.equal(args.includes('seccomp=/private/review folder/seccomp.json'), true);
    assert.deepEqual(args.slice(args.indexOf(options.image) + 1), ['--full']);
    const focused = await linuxVerificationRunArguments({ ...options, selection: ['--focused', 'frontend/src/routes/(public)/contact/+page.svelte'] });
    assert.deepEqual(focused.slice(focused.indexOf(options.image) + 1), ['--focused', 'frontend/src/routes/(public)/contact/+page.svelte']);
    assert.equal(args.includes('--privileged'), false);
    assert.equal(args.some(arg => /no-sandbox|docker\.sock|network=host/u.test(arg)), false);
    for (const override of [
      { image: 'mutable:latest' }, { revision: 'HEAD' }, { base: 'main' },
      { bundle: '/private/source,readonly=false' }, { seccomp: 'relative.json' },
      { selection: [] }, { selection: ['--build-image'] },
      { selection: ['--focused', '--list', 'test/linux-verification.test.mts'] },
    ]) await assert.rejects(() => linuxVerificationRunArguments({ ...options, ...override }));
  });

  test('validates every installed browser while avoiding root package changes in the prepared image', () => {
    assert.deepEqual(criticalBrowserInstallArguments(''), ['install', '--with-deps', 'chromium', 'firefox', 'webkit']);
    assert.deepEqual(criticalBrowserInstallArguments('preinstalled'), ['install', 'chromium', 'firefox', 'webkit']);
    assert.throws(() => criticalBrowserInstallArguments('skip'));
  });

  test('checks out the exact commit and forwards each selected owner without a duplicate install or full run', () => {
    const filename = path.join(ROOT, 'tools/linux-verification-entrypoint.sh');
    const syntax = spawnSync('sh', ['-n', filename], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const temporary = mkdtempSync(path.join(tmpdir(), 'linux-entrypoint-test-'));
    try {
      writeFileSync(path.join(temporary, 'git'), '#!/bin/sh\nprintf "%s\\0" git "$@" >> "$LOG"\nprintf "\\n" >> "$LOG"\nif [ "$1" = clone ]; then mkdir checkout; fi\n', { mode: 0o700 });
      writeFileSync(path.join(temporary, 'npm'), '#!/bin/sh\nprintf "%s\\0" npm "$@" >> "$LOG"\nprintf "\\n" >> "$LOG"\nif [ "${FAIL_ON-}" = "$*" ]; then exit 37; fi\n', { mode: 0o700 });
      const log = path.join(temporary, 'calls');
      const checkout = [
        ['git', 'clone', '--quiet', '/input/source.bundle', 'checkout'],
        ['git', 'checkout', '--quiet', '--detach', 'b'.repeat(40)],
        ['git', 'update-ref', 'refs/remotes/origin/main', 'c'.repeat(40)],
      ];
      const install = ['npm', 'ci', '--include=optional', '--ignore-scripts', '--audit=false'];
      const invoke = (args: readonly string[], failOn = '') => {
        rmSync(path.join(temporary, 'checkout'), { recursive: true, force: true });
        writeFileSync(log, '');
        const result = spawnSync('sh', [filename, ...args], { cwd: temporary, encoding: 'utf8', env: {
          PATH: `${temporary}${path.delimiter}${process.env.PATH}`, LOG: log, FAIL_ON: failOn,
          WHOISLEUTH_VERIFY_REVISION: 'b'.repeat(40), WHOISLEUTH_VERIFY_BASE: 'c'.repeat(40),
        } });
        const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.split('\0').slice(0, -1));
        return { result, calls };
      };
      const full = invoke(['--full']);
      assert.equal(full.result.status, 0, full.result.stderr);
      assert.deepEqual(full.calls, [...checkout, ['npm', 'run', 'verification:ci']]);
      const changed = 'frontend/src/routes/(public)/contact/+page.svelte';
      const focused = invoke(['--focused', changed, 'test/linux-verification.test.mts']);
      assert.equal(focused.result.status, 0, focused.result.stderr);
      assert.deepEqual(focused.calls, [...checkout, install, ['npm', 'run', 'verification:focused', '--', changed, 'test/linux-verification.test.mts']]);
      for (const group of CI_COMMAND_GROUPS) {
        const selected = invoke([`--group=${group}`]);
        assert.equal(selected.result.status, 0, selected.result.stderr);
        assert.deepEqual(selected.calls, [...checkout, install,
          ...(group === 'cli-runtime' ? [['npm', 'run', 'verification:ci', '--', '--group=browser-build']] : []),
          ['npm', 'run', 'verification:ci', '--', `--group=${group}`],
        ]);
      }
      const installFailure = invoke(['--focused', changed], install.slice(1).join(' '));
      assert.equal(installFailure.result.status, 37);
      assert.deepEqual(installFailure.calls, [...checkout, install]);
      const buildFailure = invoke(['--group=cli-runtime'], 'run verification:ci -- --group=browser-build');
      assert.equal(buildFailure.result.status, 37);
      assert.deepEqual(buildFailure.calls, [...checkout, install, ['npm', 'run', 'verification:ci', '--', '--group=browser-build']]);
      const testFailure = invoke(['--focused', changed], `run verification:focused -- ${changed}`);
      assert.equal(testFailure.result.status, 37);
      assert.deepEqual(testFailure.calls, [...checkout, install, ['npm', 'run', 'verification:focused', '--', changed]]);
      for (const args of [[], ['--focused'], ['--full', '--group=unit'], ['--group=unit', '--full']]) {
        const invalid = invoke(args);
        assert.equal(invalid.result.status, 2);
        assert.deepEqual(invalid.calls, []);
      }
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
});
