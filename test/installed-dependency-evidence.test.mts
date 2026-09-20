import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { candidateDependencyAuditInput, installedDependencyEvidence } from '../tools/installed-dependency-evidence.mts';
import { main as audit } from '../tools/production-dependency-audit.mts';

const PACKAGE = '@example/tool';
const ARCHIVE_SHA = createHash('sha256').update('independent candidate bytes').digest('hex');
const INTEGRITY = `sha512-${createHash('sha512').update('dependency archive').digest('base64')}`;

async function fixture(context: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'installed-dependency-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const packages: Record<string, Record<string, unknown>> = {
    '': { dependencies: { [PACKAGE]: 'file:/private/fixture-not-retained.tgz' } },
    [`node_modules/${PACKAGE}`]: { version: '2.4.0', resolved: 'file:/private/fixture-not-retained.tgz', integrity: INTEGRITY, dependencies: { direct: '1.0.0' } },
    'node_modules/direct': { version: '1.0.0', resolved: 'https://registry.npmjs.org/direct/-/direct-1.0.0.tgz', integrity: INTEGRITY, dependencies: { shared: '^2.0.0' } },
    'node_modules/shared': { version: '2.1.0', resolved: 'https://registry.npmjs.org/shared/-/shared-2.1.0.tgz', integrity: INTEGRITY },
  };
  const lock = { lockfileVersion: 3, packages };
  const save = () => writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lock));
  await save();
  for (const [location, entry] of Object.entries(packages)) {
    if (!location) continue;
    await mkdir(path.join(directory, location), { recursive: true });
    await writeFile(path.join(directory, location, 'package.json'), JSON.stringify({ name: location.slice('node_modules/'.length), version: entry.version, dependencies: entry.dependencies }));
  }
  return { directory, packages, save };
}

test('records the actual installed transitive version and integrity without retaining temporary paths', async context => {
  const { directory } = await fixture(context);
  const evidence = await installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA);
  assert.equal(evidence.archiveSha256, ARCHIVE_SHA);
  assert.equal(evidence.packageName, PACKAGE);
  assert.equal(evidence.packageVersion, '2.4.0');
  assert.equal(evidence.dependencyCount, 2);
  const lock = candidateDependencyAuditInput(evidence).lockfile;
  const packages = lock.packages as Record<string, Record<string, unknown>>;
  assert.equal(packages['node_modules/shared']!.version, '2.1.0');
  assert.equal(packages['node_modules/shared']!.integrity, INTEGRITY);
  assert.deepEqual(packages['node_modules/direct']!.dependencies, { shared: '^2.0.0' });
  assert.equal(Object.keys(evidence.manifestSha256).length, 3);
  assert.ok(Object.values(evidence.manifestSha256).every(value => /^[a-f0-9]{64}$/u.test(value)));
  assert.doesNotMatch(JSON.stringify(evidence), /file:|\/private\/|fixture-not-retained/u);
  assert.deepEqual(evidence, await installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA));
});

test('rejects missing runtime dependencies, unrelated packages and malformed candidate evidence', async context => {
  const { directory, packages, save } = await fixture(context);
  const evidence = await installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA);
  for (const mutation of [
    (value: typeof evidence) => ({ ...value, dependencyCount: 1 }),
    (value: typeof evidence) => ({ ...value, archiveSha256: 'unknown' }),
    (value: typeof evidence) => ({ ...value, packageVersion: '9.0.0' }),
    (value: typeof evidence) => ({ ...value, manifestSha256: {} }),
  ]) assert.throws(() => candidateDependencyAuditInput(mutation(evidence)), /identity|incomplete|differs/u);
  packages['node_modules/unrelated'] = { version: '1.0.0' };
  await save();
  await assert.rejects(installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA), /runtime closure/u);
  delete packages['node_modules/unrelated'];
  delete packages['node_modules/shared'];
  await save();
  await assert.rejects(installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA), /runtime dependency is missing/u);
});

test('rejects changed installed identities and symlinked manifests', async context => {
  const { directory } = await fixture(context);
  const manifest = path.join(directory, 'node_modules/shared/package.json');
  await writeFile(manifest, JSON.stringify({ name: 'shared', version: '2.2.0' }));
  await assert.rejects(installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA), /differs from its resolved lock identity/u);
  const outside = path.join(directory, 'outside.json');
  await writeFile(outside, JSON.stringify({ name: 'shared', version: '2.1.0' }));
  await rm(manifest);
  await symlink(outside, manifest);
  await assert.rejects(installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA), /regular|link|symbolic/u);
});

test('rejects unverified integrity, non-registry sources and linked or bundled dependencies', async context => {
  const { directory, packages, save } = await fixture(context);
  const original = structuredClone(packages['node_modules/shared']!);
  for (const altered of [
    { integrity: 'sha512-incomplete' }, { resolved: 'file:/private/secret' },
    { resolved: 'https://credential@registry.npmjs.org/shared' }, { resolved: 'not a URL' },
    { resolved: 'https://registry.npmjs.org/shared?private=value' },
    { link: true }, { inBundle: true }, { dev: true },
    { dependencies: { extra: 'file:/private/secret' } },
  ]) {
    packages['node_modules/shared'] = { ...original, ...altered };
    await save();
    await assert.rejects(installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret|credential|private=value/u);
      return true;
    });
  }
});

test('audits the recorded candidate graph rather than silently substituting the source lockfile', async context => {
  const { directory } = await fixture(context);
  const evidence = await installedDependencyEvidence(directory, PACKAGE, ARCHIVE_SHA);
  const file = path.join(directory, 'installed-dependencies.json');
  await writeFile(file, JSON.stringify(evidence));
  let calls = 0, output = '';
  assert.equal(audit({ installedCandidate: file,
    stdout: { write: value => { output += value; } }, stderr: { write: () => assert.fail('valid candidate should pass') },
    runAudit: lock => {
      calls++;
      assert.deepEqual(lock, evidence.lockfile);
      return { status: 0, signal: null, stderr: '', stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
        dependencies: { prod: 4, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 3 },
      } }) };
    },
  }), 0);
  assert.equal(calls, 1);
  assert.match(output, new RegExp(ARCHIVE_SHA, 'u'));
  await writeFile(file, JSON.stringify({ ...evidence, dependencyCount: 999 }));
  assert.equal(audit({ installedCandidate: file, stdout: { write: () => assert.fail('invalid graph must not be audited') },
    stderr: { write: () => {} }, runAudit: () => assert.fail('invalid graph must not make an advisory request') }), 2);
});
