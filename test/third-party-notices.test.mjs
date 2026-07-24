import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  THIRD_PARTY_NOTICE_PATH,
  collectProductionPackages,
  main,
  parseArguments,
} from '../tools/third-party-notices.mts';

function capture() {
  let value = '';
  return { stream: { write(chunk) { value += String(chunk); } }, value: () => value };
}

function fixtureLockfile() {
  return {
    packages: {
      '': { dependencies: { alpha: '1.0.0' } },
      frontend: { dependencies: { beta: '2.0.0' } },
      'node_modules/alpha': { version: '1.0.0', license: 'MIT' },
      'node_modules/beta': { version: '2.0.0', license: 'ISC' },
      'node_modules/shared': { version: '3.0.0', license: 'BSD-3-Clause' },
      'node_modules/dev-only': { version: '4.0.0', license: 'MIT', dev: true },
    },
  };
}

async function writeFixturePackage(root, name, licenseText = '') {
  const directory = path.join(root, 'node_modules', name);
  await mkdir(directory, { recursive: true });
  if (licenseText) await writeFile(path.join(directory, 'LICENSE'), licenseText, 'utf8');
  else await writeFile(path.join(directory, 'README.md'), '# Package\n\n## License\n\nMIT\n', 'utf8');
}

describe('third-party production dependency notices', () => {
  test('collects exact direct and transitive production packages while excluding development dependencies', () => {
    assert.deepEqual(collectProductionPackages(fixtureLockfile()), [
      { name: 'alpha', version: '1.0.0', license: 'MIT', direct: true, installPath: 'node_modules/alpha' },
      { name: 'beta', version: '2.0.0', license: 'ISC', direct: true, installPath: 'node_modules/beta' },
      { name: 'shared', version: '3.0.0', license: 'BSD-3-Clause', direct: false, installPath: 'node_modules/shared' },
    ]);
  });

  test('rejects malformed inventories and unsupported command arguments', () => {
    assert.throws(() => collectProductionPackages({ packages: { '': {}, 'node_modules/unknown': { version: '1.0.0' } } }), /licence/);
    assert.equal(parseArguments(['--check']), 'check');
    assert.equal(parseArguments(['--write']), 'write');
    assert.throws(() => parseArguments([]), /Usage/);
    assert.throws(() => parseArguments(['--delete']), /Usage/);
  });

  test('writes and checks a deterministic bounded notice artifact', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-notices-'));
    try {
      await mkdir(path.join(directory, 'frontend', 'static'), { recursive: true });
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(fixtureLockfile()), 'utf8');
      await writeFixturePackage(directory, 'alpha', 'Alpha licence text');
      await writeFixturePackage(directory, 'beta', 'Beta licence text');
      await writeFixturePackage(directory, 'shared');

      const writeStdout = capture();
      const writeStderr = capture();
      assert.equal(await main(['--write'], { repositoryRoot: directory, stdout: writeStdout.stream, stderr: writeStderr.stream }), 0);
      assert.equal(writeStderr.value(), '');
      const output = await readFile(path.join(directory, THIRD_PARTY_NOTICE_PATH), 'utf8');
      assert.match(output, /Package count: 3/u);
      assert.match(output, /alpha@1\.0\.0[\s\S]+direct production dependency/u);
      assert.match(output, /shared@3\.0\.0[\s\S]+transitive production dependency/u);
      assert.doesNotMatch(output, /dev-only/u);

      const checkStdout = capture();
      const checkStderr = capture();
      assert.equal(await main(['--check'], { repositoryRoot: directory, stdout: checkStdout.stream, stderr: checkStderr.stream }), 0);
      assert.match(checkStdout.value(), /pass \(3 packages\)/u);
      assert.equal(checkStderr.value(), '');

      await writeFile(path.join(directory, THIRD_PARTY_NOTICE_PATH), 'stale', 'utf8');
      const staleStderr = capture();
      assert.equal(await main(['--check'], { repositoryRoot: directory, stderr: staleStderr.stream }), 2);
      assert.match(staleStderr.value(), /notices are stale/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
