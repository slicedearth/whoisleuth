import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  REDIS_VERIFICATION_IMAGE, REDIS_VERIFICATION_VERSION, REDIS_VERIFICATION_SETUP_CODE,
  redisVerificationContainerArguments, redisVerificationServerArguments, resolveRedisVerificationEngine,
} from '../tools/redis-verification.mts';

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

test('checks both pinned executables without starting a native fixture', () => {
  const directory = path.resolve('fixture binaries');
  const env = { WHOISLEUTH_VERIFICATION_REDIS_BIN_DIR: directory };
  const called: string[] = [];
  const engine = resolveRedisVerificationEngine({ env, run: (executable, args) => {
    assert.deepEqual(args, ['--version']);
    called.push(executable);
    return executable.endsWith('redis-server') ? `Redis server v=${REDIS_VERIFICATION_VERSION} bits=64` : `redis-cli ${REDIS_VERIFICATION_VERSION}`;
  } });
  assert.equal(engine.kind, 'binaries');
  assert.deepEqual(called, [path.join(directory, 'redis-server'), path.join(directory, 'redis-cli')]);
  assert.throws(() => resolveRedisVerificationEngine({ env, run: () => 'Redis server v=0.0.0 bits=64' }), {
    code: REDIS_VERIFICATION_SETUP_CODE, message: /do not match the pinned version/u,
  });
});

test('pins the selected local Docker socket and never pulls or starts during the check', () => {
  const socket = 'unix:///fixture/engine.sock';
  const calls: string[][] = [];
  const env = { DOCKER_CONTEXT: 'fixture-context', DOCKER_HOST: 'ssh://engine.example' };
  const engine = resolveRedisVerificationEngine({ env, run: (executable, args, _timeout, childEnv) => {
    assert.equal(executable, 'docker');
    assert.equal(childEnv?.DOCKER_HOST, undefined);
    calls.push([...args]);
    if (args[0] === 'context') {
      assert.equal(childEnv?.DOCKER_CONTEXT, 'fixture-context');
      return socket;
    }
    assert.equal(childEnv?.DOCKER_CONTEXT, undefined);
    return 'fixture-version';
  } });
  assert.deepEqual(engine, { kind: 'docker', endpoint: socket });
  assert.deepEqual(calls.map(args => args.slice(0, 3)), [['context', 'inspect', '--format'], ['--host', socket, 'version']]);

  assert.throws(() => resolveRedisVerificationEngine({ env: { DOCKER_HOST: socket }, run: (_exe, args) => {
    assert.deepEqual(args.slice(0, 3), ['--host', socket, 'version']);
    throw new Error('simulated unavailable engine');
  } }), { code: REDIS_VERIFICATION_SETUP_CODE, message: /engine is not reachable/u });
});

test('rejects remote Docker configuration before contacting an engine', () => {
  const env = { DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'unix:///fixture/local.sock' };
  const calls: string[] = [];
  assert.throws(() => resolveRedisVerificationEngine({ env, run: (_executable, args) => {
    calls.push(args[0]!);
    return 'ssh://engine.example';
  } }), { code: REDIS_VERIFICATION_SETUP_CODE, message: /requires a local socket/u });
  assert.deepEqual(calls, ['context']);
  assert.throws(() => resolveRedisVerificationEngine({ env: { DOCKER_HOST: 'npipe:////remote/pipe/engine' }, run: () => {
    assert.fail('must reject a remote endpoint without a probe');
  } }), { code: REDIS_VERIFICATION_SETUP_CODE, message: /requires a local socket/u });
});
