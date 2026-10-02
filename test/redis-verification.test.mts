import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REDIS_VERIFICATION_IMAGE, redisVerificationContainerArguments, redisVerificationServerArguments } from '../tools/redis-verification.mts';

test('Redis verification has no application network, persistence, public port or host mount', () => {
  const args = redisVerificationContainerArguments('fixture-only');
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  assert.match(REDIS_VERIFICATION_IMAGE, /^redis:7\.2\.16-bookworm@sha256:[a-f0-9]{64}$/u);
  assert.equal(value('--network'), 'none');
  assert.equal(value('--cap-drop'), 'ALL');
  assert.equal(value('--security-opt'), 'no-new-privileges');
  assert.equal(value('--memory'), '64m');
  assert.equal(value('--pids-limit'), '32');
  assert.equal(value('--user'), '999:999');
  assert.ok(args.includes('--read-only'));
  assert.equal(args.some(arg => /^--(?:publish|volume|mount|privileged)(?:=|$)/u.test(arg)), false);
  assert.deepEqual(args.slice(args.indexOf(REDIS_VERIFICATION_IMAGE) + 1), ['redis-server', ...redisVerificationServerArguments('/tmp/redis.sock')]);
  const server = redisVerificationServerArguments('/private-fixture/socket');
  const setting = (flag: string) => server[server.indexOf(flag) + 1];
  assert.equal(setting('--port'), '0');
  assert.equal(setting('--unixsocketperm'), '600');
  assert.equal(setting('--save'), '');
  assert.equal(setting('--appendonly'), 'no');
  assert.equal(setting('--maxmemory-policy'), 'noeviction');
});
