import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainFeedIntakeOperation } from '../frontend/src/lib/controllers/domain-feed-intake.ts';

test('new file, selection and profile generations reject controlled late replies', () => {
  const owner = new DomainFeedIntakeOperation();
  const first = owner.begin('profile-a:file-a:selection-a');
  assert.equal(owner.current(first, 'profile-a:file-a:selection-a'), true);
  assert.equal(owner.current(first, 'profile-b:file-a:selection-a'), false);
  assert.equal(owner.current(first, 'profile-a:file-a:selection-b'), false);
  const second = owner.begin('profile-a:file-b:selection-a');
  assert.equal(first.signal.aborted, true);
  assert.equal(owner.current(first, first.context), false);
  owner.finish(first);
  assert.equal(owner.current(second, second.context), true);
  owner.invalidate();
  assert.equal(second.signal.aborted, true);
  assert.equal(owner.current(second, second.context), false);
});

test('separate status cancellation does not interrupt the always-available manual operation', () => {
  const local = new DomainFeedIntakeOperation(), status = new DomainFeedIntakeOperation();
  const scan = local.begin('profile-a:file-a');
  const config = status.begin('profile-a');
  status.invalidate();
  assert.equal(config.signal.aborted, true);
  assert.equal(local.current(scan, scan.context), true);
  local.invalidate();
  assert.equal(scan.signal.aborted, true);
});

test('finished operation teardown cannot cancel a later queued operation', () => {
  const owner = new DomainFeedIntakeOperation();
  const first = owner.begin('first');
  owner.finish(first);
  const next = owner.begin('next');
  owner.finish(first);
  owner.invalidate();
  assert.equal(next.signal.aborted, true);
});
