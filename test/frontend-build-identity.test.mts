import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontendBuildIdentity } from '../frontend/build-identity.ts';

test('build and update labels share a stable version and validated revision', () => {
  const environment = { WHOISLEUTH_BUILD_REVISION: ' ABCDEF1234 ', COMMIT_REF: '1234567' };
  const noGit = () => { throw new Error('Must not read Git when the build revision is declared'); };
  const result = frontendBuildIdentity(environment, noGit, '2.5.0');
  assert.deepEqual(result, { applicationVersion: '2.5.0', buildRevision: 'abcdef1234', updateVersion: '2.5.0-abcdef1234' });
  assert.deepEqual(frontendBuildIdentity(environment, noGit, '2.5.0'), result);
  assert.notEqual(frontendBuildIdentity({ GITHUB_SHA: '7654321' }, noGit, '2.5.0').updateVersion, result.updateVersion);
  assert.notEqual(frontendBuildIdentity(environment, noGit, '2.5.1').updateVersion, result.updateVersion);
});

test('invalid external revision text falls back to Git or an explicit local label', () => {
  assert.equal(frontendBuildIdentity({ COMMIT_REF: '<script>' }, () => '9876543\n', '2.5.0').buildRevision, '9876543');
  assert.equal(frontendBuildIdentity({}, () => { throw new Error('No Git metadata'); }, '2.5.0').updateVersion, '2.5.0-local');
  assert.equal(frontendBuildIdentity({}, () => 'not-a-revision', '2.5.0').buildRevision, 'local');
  assert.throws(() => frontendBuildIdentity({}, () => '9876543', 'not-a-version'), /version/iu);
});
