import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linuxVerificationEnvironment, linuxVerificationImageReference, linuxVerificationImages, linuxVerificationRunArguments } from '../tools/linux-verification.mts';
import { criticalBrowserInstallArguments } from '../tools/ci-verification.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('isolated Linux verification', () => {
  test('pins the requested platform manifest before pulling rather than relying on daemon tag aliases', () => {
    const amd = { digest: `sha256:${'a'.repeat(64)}`, platform: { os: 'linux', architecture: 'amd64' } };
    const arm = { digest: `sha256:${'b'.repeat(64)}`, platform: { os: 'linux', architecture: 'arm64', variant: 'v8' } };
    const manifest = { manifests: [amd, arm, { platform: { os: 'unknown', architecture: 'unknown' } }] };
    assert.equal(linuxVerificationImageReference('node:24.19.0-bookworm-slim', manifest, 'linux/arm64'), `node:24.19.0-bookworm-slim@${arm.digest}`);
    assert.equal(linuxVerificationImageReference('node:24.19.0-bookworm-slim', manifest, 'linux/amd64'), `node:24.19.0-bookworm-slim@${amd.digest}`);
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
  });

  test('derives runtime images from existing source identities', () => {
    assert.deepEqual(linuxVerificationImages('24.19.0', '1.62.1', 26), {
      PRIMARY_NODE_IMAGE: 'node:24.19.0-bookworm-slim',
      COMPATIBILITY_NODE_IMAGE: 'node:26-bookworm-slim',
      BROWSER_IMAGE: 'mcr.microsoft.com/playwright:v1.62.1-noble',
    });
    for (const invalid of ['latest', '24', '24.19.0\n--privileged']) {
      assert.throws(() => linuxVerificationImages(invalid, '1.62.1'));
      assert.throws(() => linuxVerificationImages('24.19.0', invalid));
    }
  });

  test('mounts only the read-only committed bundle with no host credentials or privileges', () => {
    const options = {
      name: 'whoisleuth-verification-1234', image: `sha256:${'a'.repeat(64)}`,
      bundle: '/private/review/source.bundle', seccomp: '/private/review/seccomp.json',
      revision: 'b'.repeat(40), base: 'c'.repeat(40),
      platform: 'linux/amd64' as const,
    };
    const args = linuxVerificationRunArguments(options);
    assert.deepEqual(args.filter((_, index) => args[index - 1] === '--mount'), [
      'type=bind,source=/private/review/source.bundle,target=/input/source.bundle,readonly',
    ]);
    assert.deepEqual(args.filter((_, index) => args[index - 1] === '--env'), [
      `WHOISLEUTH_VERIFY_REVISION=${options.revision}`, `WHOISLEUTH_VERIFY_BASE=${options.base}`,
    ]);
    assert.equal(args.includes('--platform=linux/amd64'), true);
    assert.equal(linuxVerificationRunArguments({ ...options, platform: 'linux/arm64' }).includes('--platform=linux/arm64'), true);
    assert.equal(args.includes('seccomp=/private/review/seccomp.json'), true);
    assert.equal(args.includes('--privileged'), false);
    assert.equal(args.some(arg => /no-sandbox|docker\.sock|network=host/u.test(arg)), false);
    for (const override of [
      { image: 'mutable:latest' }, { revision: 'HEAD' }, { base: 'main' },
      { bundle: '/private/source,readonly=false' }, { seccomp: 'relative.json' },
    ]) assert.throws(() => linuxVerificationRunArguments({ ...options, ...override }));
  });

  test('validates every installed browser while avoiding root package changes in the prepared image', () => {
    assert.deepEqual(criticalBrowserInstallArguments(''), ['install', '--with-deps', 'chromium', 'firefox', 'webkit']);
    assert.deepEqual(criticalBrowserInstallArguments('preinstalled'), ['install', 'chromium', 'firefox', 'webkit']);
    assert.throws(() => criticalBrowserInstallArguments('skip'));
  });

  test('checks out the requested commit and invokes the same verification owner', () => {
    const filename = path.join(ROOT, 'tools/linux-verification-entrypoint.sh');
    const syntax = spawnSync('sh', ['-n', filename], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const temporary = mkdtempSync(path.join(tmpdir(), 'linux-entrypoint-test-'));
    try {
      writeFileSync(path.join(temporary, 'git'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$LOG"\nif [ "$1" = clone ]; then mkdir checkout; fi\n', { mode: 0o700 });
      writeFileSync(path.join(temporary, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$LOG"\n', { mode: 0o700 });
      const log = path.join(temporary, 'calls');
      const result = spawnSync('sh', [filename], { cwd: temporary, encoding: 'utf8', env: {
        PATH: `${temporary}${path.delimiter}${process.env.PATH}`, LOG: log,
        WHOISLEUTH_VERIFY_REVISION: 'b'.repeat(40), WHOISLEUTH_VERIFY_BASE: 'c'.repeat(40),
      } });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
        'clone --quiet /input/source.bundle checkout', `checkout --quiet --detach ${'b'.repeat(40)}`,
        `update-ref refs/remotes/origin/main ${'c'.repeat(40)}`, 'run verification:ci',
      ]);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
});
