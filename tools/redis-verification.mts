import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Official multi-platform image. Verification only: never an application service.
export const REDIS_VERIFICATION_VERSION = '7.2.16';
export const REDIS_VERIFICATION_IMAGE = 'redis:7.2.16-bookworm@sha256:0637954999d01b7c9ce9167db2da50656e2590d3b884f1c600c5f63bb6e6773c';
const MAX_OUTPUT_BYTES = 64 * 1024;

function command(executable: string, args: readonly string[], timeout = 15_000): string {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', timeout, maxBuffer: MAX_OUTPUT_BYTES,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST,
      DOCKER_CONTEXT: process.env.DOCKER_CONTEXT, DOCKER_CONFIG: process.env.DOCKER_CONFIG },
  });
  if (result.error) throw new Error(`Redis verification command is unavailable: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Redis verification command failed: ${result.stderr.trim().slice(0, 500) || result.status}`);
  return result.stdout.trim();
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
  const binaryDirectory = process.env.WHOISLEUTH_VERIFICATION_REDIS_BIN_DIR;
  let directory: string | null = null;
  let container: string | null = null;
  let child: ChildProcess | null = null;
  let childClosed: Promise<void> | null = null;
  let stopped = false;
  let execute: (args: readonly string[], timeout?: number) => string;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      if (container) command('docker', ['rm', '--force', container]);
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
    if (binaryDirectory) {
      // The isolated verification image contains these exact image-owned binaries.
      // Do not silently select a host-installed or differently versioned daemon.
      if (!path.isAbsolute(binaryDirectory)) throw new Error('Redis verification binary directory must be absolute.');
      const server = path.join(binaryDirectory, 'redis-server');
      const cli = path.join(binaryDirectory, 'redis-cli');
      if (!command(server, ['--version']).includes(`v=${REDIS_VERIFICATION_VERSION} `)
        || command(cli, ['--version']) !== `redis-cli ${REDIS_VERIFICATION_VERSION}`) {
        throw new Error('Redis verification requires the pinned binary version.');
      }
      directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-redis-'));
      const socket = path.join(directory, 'redis.sock');
      child = spawn(server, redisVerificationServerArguments(socket), { cwd: directory, stdio: 'ignore', env: {} });
      childClosed = new Promise(resolve => child!.once('close', () => resolve()));
      let failure: Error | null = null;
      child.once('error', error => { failure = error; });
      execute = (args, timeout) => {
        if (failure) throw failure;
        return command(cli, ['-e', '--json', '-s', socket, ...args], timeout);
      };
    } else {
      const endpoint = process.env.DOCKER_HOST
        || command('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
      if (!/^(?:unix|npipe):\/\//u.test(endpoint)) throw new Error('Redis verification requires a local container engine.');
      // A cold verification machine needs only this exact image, never a mutable tag.
      try { command('docker', ['image', 'inspect', '--format', '{{.Id}}', REDIS_VERIFICATION_IMAGE]); }
      catch { command('docker', ['pull', REDIS_VERIFICATION_IMAGE], 180_000); }
      const name = `whoisleuth-redis-${randomUUID()}`;
      const identity = command('docker', redisVerificationContainerArguments(name));
      if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('Redis verification container identity is invalid.');
      container = identity;
      command('docker', ['start', container]);
      execute = (args, timeout) => command('docker', ['exec', container!, 'redis-cli', '-e', '--json', '-s', '/tmp/redis.sock', ...args], timeout);
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
    await stop();
    throw error;
  }
}
