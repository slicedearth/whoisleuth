import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { summaryText, writeCiSummary } from './ci-summary.mts';

// Official multi-platform image. Verification only: never an application service.
export const REDIS_VERIFICATION_VERSION = '7.2.16';
export const REDIS_VERIFICATION_IMAGE = 'redis:7.2.16-bookworm@sha256:0637954999d01b7c9ce9167db2da50656e2590d3b884f1c600c5f63bb6e6773c';
export const REDIS_VERIFICATION_SETUP_CODE = 'ERR_REDIS_VERIFICATION_SETUP';
export const REDIS_VERIFICATION_GUIDANCE = `Start a reachable local Docker engine or set WHOISLEUTH_VERIFICATION_REDIS_BIN_DIR to the pinned Redis ${REDIS_VERIFICATION_VERSION} binaries.`;
const MAX_OUTPUT_BYTES = 64 * 1024;
const PREREQUISITE_TIMEOUT_MS = 5_000;

function command(executable: string, args: readonly string[], timeout = 15_000, env = process.env): string {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', timeout, maxBuffer: MAX_OUTPUT_BYTES,
    env: { PATH: env.PATH, HOME: env.HOME, DOCKER_HOST: env.DOCKER_HOST,
      DOCKER_CONTEXT: env.DOCKER_CONTEXT, DOCKER_CONFIG: env.DOCKER_CONFIG },
  });
  if (result.error) throw new Error(`Redis verification command is unavailable: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Redis verification command failed: ${result.stderr.trim().slice(0, 500) || result.status}`);
  return result.stdout.trim();
}

function setupError(reason: string, cause?: unknown): Error {
  return Object.assign(new Error(`${reason} ${REDIS_VERIFICATION_GUIDANCE}`, { cause }), { code: REDIS_VERIFICATION_SETUP_CODE });
}

type RedisVerificationEngine = { kind: 'binaries'; server: string; cli: string } | { kind: 'docker'; endpoint: string };

function localDockerCommand(endpoint: string, args: readonly string[], timeout?: number, env = process.env, run = command): string {
  // Pin the inspected socket for every command, independent of any context override.
  return run('docker', ['--host', endpoint, ...args], timeout, { ...env, DOCKER_HOST: undefined, DOCKER_CONTEXT: undefined });
}

/** Read-only prerequisite probe: no pull, container creation or server startup. */
export function resolveRedisVerificationEngine({ env = process.env, run = command } = {}): RedisVerificationEngine {
  const directory = env.WHOISLEUTH_VERIFICATION_REDIS_BIN_DIR;
  if (directory) {
    if (!path.isAbsolute(directory)) throw setupError('The Redis verification binary directory must be absolute.');
    const server = path.join(directory, 'redis-server');
    const cli = path.join(directory, 'redis-cli');
    try {
      if (run(server, ['--version'], PREREQUISITE_TIMEOUT_MS, env).includes(`v=${REDIS_VERIFICATION_VERSION} `)
        && run(cli, ['--version'], PREREQUISITE_TIMEOUT_MS, env) === `redis-cli ${REDIS_VERIFICATION_VERSION}`) {
        return { kind: 'binaries', server, cli };
      }
    } catch (error) {
      throw setupError('The configured Redis verification binaries could not be checked.', error);
    }
    throw setupError('The configured Redis verification binaries do not match the pinned version.');
  }

  let endpoint: string;
  try {
    // A named context takes precedence over a host override. Inspect its
    // configuration locally before contacting any engine.
    endpoint = (!env.DOCKER_CONTEXT && env.DOCKER_HOST)
      || run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], PREREQUISITE_TIMEOUT_MS, {
        ...env, DOCKER_HOST: undefined,
      });
  } catch (error) {
    throw setupError('The local Docker engine configuration is unavailable.', error);
  }
  if (!/^(?:unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/)[^\u0000-\u001f\u007f]+$/u.test(endpoint) || endpoint.length > 4_096) {
    throw setupError('Redis verification requires a local socket; remote Docker engines are not used.');
  }
  try {
    if (!localDockerCommand(endpoint, ['version', '--format', '{{.Server.Version}}'], PREREQUISITE_TIMEOUT_MS, env, run)) {
      throw new Error('No engine version returned.');
    }
  } catch (error) {
    throw setupError('The local Docker engine is not reachable.', error);
  }
  return { kind: 'docker', endpoint };
}

export function redisVerificationServerArguments(socket: string): readonly string[] {
  return ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '600', '--save', '',
    '--appendonly', 'no', '--maxmemory', '16mb', '--maxmemory-policy', 'noeviction',
    '--protected-mode', 'yes', '--loglevel', 'warning'];
}

export function redisVerificationContainerArguments(name: string): readonly string[] {
  return ['create', '--name', name, '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '64m', '--cpus', '1',
    '--pids-limit', '32', '--user', '999:999', '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m,mode=1777',
    REDIS_VERIFICATION_IMAGE, 'redis-server', ...redisVerificationServerArguments('/tmp/redis.sock')];
}

/** Fresh synthetic state, no published TCP port and no checkout/credential mount. */
export async function startRedisVerification() {
  const engine = resolveRedisVerificationEngine();
  let directory: string | null = null;
  let removeContainer: (() => void) | undefined;
  let child: ChildProcess | null = null;
  let childClosed: Promise<void> | null = null;
  let stopped = false;
  let execute: (args: readonly string[], timeout?: number) => string;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      removeContainer?.();
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child?.kill('SIGKILL'), 2_000);
        try { await childClosed; } finally { clearTimeout(timer); }
      }
    } finally {
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    if (engine.kind === 'binaries') {
      directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-redis-'));
      const socket = path.join(directory, 'redis.sock');
      child = spawn(engine.server, redisVerificationServerArguments(socket), { cwd: directory, stdio: 'ignore', env: {} });
      childClosed = new Promise(resolve => child!.once('close', () => resolve()));
      let failure: Error | null = null;
      child.once('error', error => { failure = error; });
      execute = (args, timeout) => {
        if (failure) throw failure;
        return command(engine.cli, ['-e', '--json', '-s', socket, ...args], timeout);
      };
    } else {
      const docker = (args: readonly string[], timeout?: number) => localDockerCommand(engine.endpoint, args, timeout);
      // A cold verification machine needs only this exact image, never a mutable tag.
      try { docker(['image', 'inspect', '--format', '{{.Id}}', REDIS_VERIFICATION_IMAGE]); }
      catch { docker(['pull', REDIS_VERIFICATION_IMAGE], 180_000); }
      const name = `whoisleuth-redis-${randomUUID()}`;
      const identity = docker(redisVerificationContainerArguments(name));
      if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('Redis verification container identity is invalid.');
      removeContainer = () => { docker(['rm', '--force', identity]); };
      docker(['start', identity]);
      execute = (args, timeout) => docker(['exec', identity, 'redis-cli', '-e', '--json', '-s', '/tmp/redis.sock', ...args], timeout);
    }
    let ready = false;
    const deadline = performance.now() + 5_000;
    for (let attempt = 0; attempt < 40 && performance.now() < deadline; attempt += 1) {
      try { if (execute(['PING'], 1_000) === '"PONG"') { ready = true; break; } } catch { /* bounded startup only */ }
      await delay(25);
    }
    if (!ready) throw new Error('The isolated Redis verification server did not become ready.');
    return Object.freeze({
      command(args: readonly (string | number)[]): unknown {
        if (stopped) throw new Error('Redis verification has already stopped.');
        return JSON.parse(execute(args.map(String)));
      },
      stop,
    });
  } catch (error) {
    try { await stop(); }
    catch (cleanupError) {
      throw setupError('Isolated Redis verification setup and cleanup failed.', new AggregateError([error, cleanupError]));
    }
    throw setupError('The isolated Redis verification server could not start.', error);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new TypeError('Usage: npm run verification:redis:check');
    const engine = resolveRedisVerificationEngine();
    process.stdout.write(`Integration Redis prerequisite: ${engine.kind === 'binaries' ? 'pinned binaries' : 'local container engine'} available.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Redis verification prerequisite check could not complete.';
    process.stderr.write(`${message}\n`);
    writeCiSummary(`## Integration prerequisites\n\n${summaryText(message)}\n`);
    process.exitCode = 2;
  }
}
