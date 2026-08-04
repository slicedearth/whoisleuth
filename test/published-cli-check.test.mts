import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  checkPublishedCli,
  formatPublishedCliReport,
  main,
  parseArguments,
  validatePublishedManifest,
  type ExecuteCommand,
} from '../tools/published-cli-check.mts';

const VERSION = '1.33.0';
const PACKAGE_NAME = '@slicedearth/whoisleuth-cli';

function publishedManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: PACKAGE_NAME,
    version: VERSION,
    license: 'AGPL-3.0-only',
    type: 'module',
    author: 'slicedearth',
    bin: { whoisleuth: 'bin/whoisleuth.mjs' },
    engines: { node: '>=24' },
    contentPolicy: { class: 'dual-use' },
    publishConfig: { access: 'public', provenance: true },
    repository: { type: 'git', url: 'git+https://github.com/slicedearth/whoisleuth.git' },
    homepage: 'https://whoisleuth.com/',
    bugs: { url: 'https://github.com/slicedearth/whoisleuth/issues' },
    dependencies: {
      '@peculiar/x509': '2.0.0',
      maxmind: '5.0.7',
      parse5: '8.0.1',
      'reflect-metadata': '0.2.2',
      tldts: '7.4.10',
      undici: '8.9.0',
    },
    dist: {
      integrity: `sha512-${'A'.repeat(86)}==`,
      shasum: 'a'.repeat(40),
      tarball: `https://registry.npmjs.org/@slicedearth/whoisleuth-cli/-/whoisleuth-cli-${VERSION}.tgz`,
      fileCount: 191,
      unpackedSize: 3_120_000,
      attestations: {
        url: `https://registry.npmjs.org/-/npm/v1/attestations/@slicedearth%2fwhoisleuth-cli@${VERSION}`,
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
      signatures: [{ keyid: 'SHA256:fixture-key', sig: 'fixture-signature' }],
    },
    ...overrides,
  };
}

function capture() {
  let value = '';
  return {
    stream: { write(chunk: string) { value += chunk; } },
    value: () => value,
  };
}

describe('published CLI verification', () => {
  test('validates exact bounded registry metadata and provenance', () => {
    const report = validatePublishedManifest(publishedManifest(), VERSION);
    assert.equal(report.schema, 'whoisleuth.published-cli-check');
    assert.equal(report.version, 1);
    assert.equal(report.packageVersion, VERSION);
    assert.deepEqual(report.runtimeDependencies, {
      '@peculiar/x509': '2.0.0',
      maxmind: '5.0.7',
      parse5: '8.0.1',
      'reflect-metadata': '0.2.2',
      tldts: '7.4.10',
      undici: '8.9.0',
    });
    assert.equal(report.registrySignatureCount, 1);
    assert.match(formatPublishedCliReport({ ...report, checks: ['metadata', 'version'] }), /Result: PASS/u);
  });

  test('rejects lifecycle scripts, dependency ranges, provenance loss, and off-registry artifacts', () => {
    assert.throws(() => validatePublishedManifest(publishedManifest({ scripts: { postinstall: 'node install.mjs' } }), VERSION), /must not be private or declare lifecycle scripts/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({ author: 'different-publisher' }), VERSION), /author, licence, or module type/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({ homepage: 'https://example.invalid/' }), VERSION), /source and support links/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({
      dependencies: {
        '@peculiar/x509': '2.0.0', maxmind: '5.0.7', parse5: '^8.0.1',
        'reflect-metadata': '0.2.2', tldts: '7.4.10', undici: '8.9.0',
      },
    }), VERSION), /major, minor, and patch/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({
      dist: { ...(publishedManifest().dist as object), attestations: { url: 'https://registry.npmjs.org/fixture', provenance: {} } },
    }), VERSION), /expected provenance predicate/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({
      dist: { ...(publishedManifest().dist as object), tarball: `https://packages.example.invalid/whoisleuth-cli-${VERSION}.tgz` },
    }), VERSION), /outside the expected public registry boundary/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({
      dist: { ...(publishedManifest().dist as object), tarball: `https://registry.npmjs.org/not-the-package/whoisleuth-cli-${VERSION}.tgz` },
    }), VERSION), /outside the expected public registry boundary/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({
      dist: {
        ...(publishedManifest().dist as object),
        attestations: {
          url: `https://registry.npmjs.org/-/npm/v1/attestations/other-package@${VERSION}`,
          provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
        },
      },
    }), VERSION), /attestation URL is outside the public registry boundary/u);
  });

  test('checks the exact installed command without lifecycle scripts or network diagnostics', async () => {
    const calls: string[][] = [];
    const inheritedEnvironment = {
      PATH: process.env.PATH,
      HOME: '/fixture/home',
      NODE_AUTH_TOKEN: 'must-not-be-forwarded',
      NPM_TOKEN: 'must-not-be-forwarded',
      NPM_CONFIG_USERCONFIG: '/fixture/credentialed-user.npmrc',
      'npm_config_//registry.npmjs.org/:_authToken': 'must-not-be-forwarded',
      npm_config_cert: 'must-not-be-forwarded',
      npm_config_email: 'must-not-be-forwarded@example.invalid',
      npm_config_key: 'must-not-be-forwarded',
    } satisfies NodeJS.ProcessEnv;
    const execute: ExecuteCommand = async (executable, args, options) => {
      assert.equal(executable, 'npm');
      assert.equal(options.env.npm_config_ignore_scripts, 'true');
      assert.equal(options.env.npm_config_loglevel, 'silent');
      assert.equal(options.env.npm_config_always_auth, 'false');
      assert.equal(options.env.HOME, '/fixture/home');
      assert.ok(options.env.npm_config_userconfig?.startsWith(`${options.cwd}/`));
      assert.ok(options.env.npm_config_globalconfig?.startsWith(`${options.cwd}/`));
      assert.equal(options.env.NODE_AUTH_TOKEN, undefined);
      assert.equal(options.env.NPM_TOKEN, undefined);
      assert.equal(options.env.NPM_CONFIG_USERCONFIG, undefined);
      assert.equal(options.env['npm_config_//registry.npmjs.org/:_authToken'], undefined);
      assert.equal(options.env.npm_config_cert, undefined);
      assert.equal(options.env.npm_config_email, undefined);
      assert.equal(options.env.npm_config_key, undefined);
      calls.push([...args]);
      if (args[0] === 'view') return { stdout: JSON.stringify(publishedManifest()), stderr: '' };
      if (args.at(-1) === '--version') return { stdout: `${VERSION}\n`, stderr: '' };
      return {
        stdout: JSON.stringify({
          schema: 'whoisleuth.cli.doctor',
          version: 1,
          cliVersion: VERSION,
          state: 'pass',
          networkRequested: false,
          checks: [],
        }),
        stderr: '',
      };
    };

    const report = await checkPublishedCli(VERSION, { execute, environment: inheritedEnvironment });
    assert.deepEqual(report.checks, ['metadata', 'integrity', 'registry-signature', 'oidc-provenance', 'version', 'offline-doctor']);
    assert.equal(calls.length, 3);
    assert.ok(calls.slice(1).every((args) => args.includes('--ignore-scripts')));
    assert.ok(calls.slice(1).every((args) => args.includes(`--package=${PACKAGE_NAME}@${VERSION}`)));
    assert.equal(calls[2]?.includes('--network'), false);
  });

  test('keeps command arguments explicit and reports bounded failures', async () => {
    assert.deepEqual(parseArguments([VERSION]), { version: VERSION, json: false });
    assert.deepEqual(parseArguments(['--json', VERSION]), { version: VERSION, json: true });
    assert.throws(() => parseArguments([]), /Usage/u);
    assert.throws(() => parseArguments([VERSION, VERSION]), /Usage/u);

    const stdout = capture();
    const stderr = capture();
    const code = await main([VERSION], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      execute: async () => { throw new Error(`fixture\nregistry unavailable\u202e${'x'.repeat(600)}`); },
    });
    assert.equal(code, 2);
    assert.equal(stdout.value(), '');
    const message = stderr.value().trimEnd();
    assert.match(message, /^fixture registry unavailable x+/u);
    assert.ok(message.length <= 512);
    assert.doesNotMatch(message, /[\u0000-\u001f\u007f\u202e]/u);
  });
});
