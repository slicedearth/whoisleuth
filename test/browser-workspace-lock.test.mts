import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceIdleTimer, readWorkspaceIdleMinutes, saveWorkspaceIdleMinutes, workspaceIdleMinutes } from '../frontend/src/lib/browser-workspace-lock.ts';

function timer(minutes = 5) {
  let now = 0, expired = 0;
  const scheduled = new Map<() => void, number>();
  const control = createWorkspaceIdleTimer(minutes, { now: () => now, expire: () => { expired++; }, schedule: (callback, delay) => { scheduled.set(callback, delay); return () => { scheduled.delete(callback); }; } });
  return { control, scheduled, expired: () => expired, advance: (value: number) => { now += value; }, setTime: (value: number) => { now = value; } };
}
test('idle locking is off by default and supports only explicit bounded choices', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const first = '00000000-0000-4000-8000-000000000001', second = '00000000-0000-4000-8000-000000000002';
  assert.equal(readWorkspaceIdleMinutes(first, storage), 0); assert.equal(values.size, 0);
  saveWorkspaceIdleMinutes(first, 15, storage); assert.equal(readWorkspaceIdleMinutes(first, storage), 15); assert.equal(readWorkspaceIdleMinutes(second, storage), 0);
  assert.deepEqual([...values.values()], ['15']);
  for (const value of [null, '15', NaN, -1, 1, 1441]) assert.throws(() => workspaceIdleMinutes(value));
  assert.throws(() => saveWorkspaceIdleMinutes('default', 5, storage));
  values.set([...values.keys()][0]!, 'unknown'); assert.throws(() => readWorkspaceIdleMinutes(first, storage), /unreadable/);
  saveWorkspaceIdleMinutes(first, 0, storage); assert.equal(values.size, 0);
});
test('a disabled timer never schedules or expires', () => {
  const state = timer(0); state.advance(10_000_000); state.control.activity(); state.control.check(); assert.equal(state.scheduled.size, 0); assert.equal(state.expired(), 0); state.control.dispose();
});
test('activity extends the selected period without rescheduling on every input event', () => {
  const state = timer(); assert.deepEqual([...state.scheduled.values()], [300_000]);
  state.advance(200_000); state.control.activity(); state.control.activity(); assert.equal(state.scheduled.size, 1);
  state.advance(100_000); state.control.check(); assert.equal(state.expired(), 0); assert.deepEqual([...state.scheduled.values()], [200_000]);
  state.advance(200_000); state.control.check(); assert.equal(state.expired(), 1); assert.equal(state.scheduled.size, 0);
  state.control.check(); assert.equal(state.expired(), 1);
  state.control.activity(); assert.equal(state.scheduled.size, 1); state.advance(300_000); state.control.check(); assert.equal(state.expired(), 2);
});
test('suspension and clock rollback trigger one conservative expiry when execution resumes', () => {
  const suspended = timer(); suspended.advance(20_000_000); suspended.control.check(); assert.equal(suspended.expired(), 1);
  const backwards = timer(); backwards.setTime(-1); backwards.control.check(); assert.equal(backwards.expired(), 1);
  const invalid = timer(); invalid.setTime(NaN); invalid.control.check(); assert.equal(invalid.expired(), 1);
});
test('disposed callbacks cannot trigger a later lock', () => {
  const state = timer(), callback = [...state.scheduled.keys()][0]!;
  state.control.dispose(); state.advance(400_000); callback(); state.control.activity(); assert.equal(state.expired(), 0); assert.equal(state.scheduled.size, 0);
});
