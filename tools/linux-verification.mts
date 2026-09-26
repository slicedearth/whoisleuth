#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CI_CLI_RUNTIME_NODE_MAJOR } from './ci-verification.mts';
import { codeqlRamMegabytes } from './local-codeql.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECCOMP_SHA256 = 'cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849';
const MAX_COMMAND_OUTPUT = 4 * 1024 * 1024;
export type LinuxVerificationPlatform = 'linux/amd64' | 'linux/arm64';

/** Follow the engine architecture: emulation is not a full-verification default. */
export function linuxVerificationEnvironment(info: Readonly<{ OSType: string; Architecture: string; MemTotal: number }>) {
  if (info.OSType !== 'linux') throw new Error('Verification requires a Linux container engine.');
  const platform: LinuxVerificationPlatform = info.Architecture === 'x86_64' || info.Architecture === 'amd64'
    ? 'linux/amd64' : info.Architecture === 'aarch64' || info.Architecture === 'arm64'
      ? 'linux/arm64' : (() => { throw new Error('Verification supports native Linux AMD64 and ARM64 engines.'); })();
  const analysisMemoryMiB = codeqlRamMegabytes(info.MemTotal, 0, 'linux');
  return Object.freeze({ platform, engineMemoryBytes: info.MemTotal, analysisMemoryMiB });
}

export function linuxVerificationImages(primary: string, browser: string, compatibility = CI_CLI_RUNTIME_NODE_MAJOR) {
  if (!/^\d+\.\d+\.\d+$/u.test(primary) || !/^\d+\.\d+\.\d+$/u.test(browser)
    || !Number.isSafeInteger(compatibility) || compatibility < 1) throw new TypeError('Verification images require exact source runtime identities.');
  return Object.freeze({
    PRIMARY_NODE_IMAGE: `node:${primary}-bookworm-slim`,
    COMPATIBILITY_NODE_IMAGE: `node:${compatibility}-bookworm-slim`,
    BROWSER_IMAGE: `mcr.microsoft.com/playwright:v${browser}-noble`,
  });
}

export function linuxVerificationImageReference(reference: string, manifest: unknown, platform: LinuxVerificationPlatform): string {
  const root = manifest as { manifests?: Array<{ digest?: unknown; platform?: { os?: unknown; architecture?: unknown } }> } | null;
  const [os, architecture] = platform.split('/');
  const matches = Array.isArray(root?.manifests)
    ? root.manifests.filter(item => item?.platform?.os === os && item.platform?.architecture === architecture) : [];
  if (matches.length !== 1 || typeof matches[0]?.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(matches[0].digest)) {
    throw new Error(`The verification image has no unique immutable manifest for ${platform}.`);
  }
  return `${reference}@${matches[0].digest}`;
}

export function linuxVerificationRunArguments(options: Readonly<{
  name: string; image: string; bundle: string; seccomp: string; revision: string; base: string;
  platform: LinuxVerificationPlatform;
}>): readonly string[] {
  if (!/^[a-f0-9]{40}$/u.test(options.revision) || !/^[a-f0-9]{40}$/u.test(options.base)
    || !/^whoisleuth-verification-[a-f0-9-]+$/u.test(options.name)
    || !/^sha256:[a-f0-9]{64}$/u.test(options.image)
    || !['linux/amd64', 'linux/arm64'].includes(options.platform)
    || [options.bundle, options.seccomp].some(value => !path.isAbsolute(value) || /[,\r\n\0]/u.test(value))) {
    throw new TypeError('Verification requires exact image/source identities and unambiguous private input paths.');
  }
  return Object.freeze([
    'run', '--name', options.name, `--platform=${options.platform}`, '--init', '--shm-size=1g',
    '--security-opt', `seccomp=${options.seccomp}`,
    '--mount', `type=bind,source=${options.bundle},target=/input/source.bundle,readonly`,
    '--env', `WHOISLEUTH_VERIFY_REVISION=${options.revision}`,
    '--env', `WHOISLEUTH_VERIFY_BASE=${options.base}`,
    options.image,
  ]);
}

function output(command: string, args: readonly string[], cwd = ROOT, env = process.env): string {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: MAX_COMMAND_OUTPUT, timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim() || result.status}`);
  return result.stdout.trim();
}

async function run(command: string, args: readonly string[], signal: AbortSignal, cwd = ROOT, env = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', signal });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code ?? 'interrupted'}.`)));
  });
}

async function downloadSeccomp(filename: string, browser: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(`https://raw.githubusercontent.com/microsoft/playwright/v${browser}/utils/docker/seccomp_profile.json`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: 'error',
  });
  if (!response.ok || !response.body) throw new Error('The pinned browser seccomp profile could not be downloaded.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 128 * 1024) throw new Error('The browser seccomp profile exceeds its input bound.');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  if (createHash('sha256').update(body).digest('hex') !== SECCOMP_SHA256) throw new Error('The pinned browser seccomp profile digest does not match.');
  writeFileSync(filename, body, { flag: 'wx', mode: 0o600 });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.length > 0 && !(args.length === 1 && args[0] === '--build-image')) {
    process.stderr.write('Usage: npm run verification:linux [-- --build-image]\n');
    return 2;
  }
  const buildOnly = args[0] === '--build-image';
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let temporary = '';
  let container = '';
  let keepEvidence = false;
  let accepted = false;
  let dockerEnvironment = process.env;
  try {
    const engine = JSON.parse(output('docker', ['info', '--format', '{{json .}}']));
    const environment = linuxVerificationEnvironment(engine);
    process.stdout.write(`Native verification platform: ${environment.platform}; engine memory: ${Math.floor(environment.engineMemoryBytes / 1024 / 1024)} MiB; analysis allocation: ${environment.analysisMemoryMiB} MiB.\n`);
    if (!buildOnly && output('git', ['status', '--porcelain=v1', '--untracked-files=all'])) {
      throw new Error('Linux verification requires a clean commit. Use focused checks while editing.');
    }
    const primary = readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    const browser = lock.packages['node_modules/playwright']?.version;
    if (!browser) throw new Error('The lockfile does not identify the browser runtime.');
    const images = linuxVerificationImages(primary, browser);
    temporary = mkdtempSync(path.join(tmpdir(), 'whoisleuth-linux-verification-'));
    const endpoint = process.env.DOCKER_HOST || output('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    if (!/^(?:unix|npipe):\/\//u.test(endpoint)) throw new Error('Verification requires a local Docker engine; remote engines are not selected implicitly.');
    const registryConfig = path.join(temporary, 'registry-config');
    mkdirSync(registryConfig, { mode: 0o700 });
    const buildPlugins = (engine.ClientInfo?.Plugins ?? []).filter((plugin: { Name?: string }) => plugin.Name === 'buildx');
    if (buildPlugins.length !== 1 || typeof buildPlugins[0].Path !== 'string' || !path.isAbsolute(buildPlugins[0].Path)) {
      throw new Error('Verification requires the installed Docker Buildx plugin.');
    }
    // Keep the installed builder discoverable without copying registry logins,
    // credential helpers, contexts or unrelated plugins into the private config.
    const plugins = path.join(registryConfig, 'cli-plugins');
    mkdirSync(plugins, { mode: 0o700 });
    symlinkSync(realpathSync(buildPlugins[0].Path), path.join(plugins, 'docker-buildx'));
    // Public image downloads need no registry credential helper or stored login.
    dockerEnvironment = { ...process.env, DOCKER_HOST: endpoint, DOCKER_CONFIG: registryConfig };
    delete dockerEnvironment.DOCKER_CONTEXT;
    const context = path.join(temporary, 'image');
    mkdirSync(context);
    for (const file of ['linux-verification.Dockerfile', 'linux-verification-entrypoint.sh']) {
      copyFileSync(path.join(ROOT, 'tools', file), path.join(context, file));
    }
    const resolvedImages: Record<string, string> = {};
    for (const [argument, reference] of Object.entries(images)) {
      const manifest = JSON.parse(output('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest}}'], ROOT, dockerEnvironment));
      const resolved = linuxVerificationImageReference(reference, manifest, environment.platform);
      resolvedImages[argument] = resolved;
      await run('docker', ['pull', `--platform=${environment.platform}`, resolved], cancellation.signal, ROOT, dockerEnvironment);
    }
    const imageIdFile = path.join(temporary, 'image-id');
    await run('docker', ['build', `--platform=${environment.platform}`, '--iidfile', imageIdFile,
      ...Object.entries(resolvedImages).flatMap(([key, value]) => ['--build-arg', `${key}=${value}`]),
      '-f', path.join(context, 'linux-verification.Dockerfile'), context], cancellation.signal, ROOT, dockerEnvironment);
    const image = readFileSync(imageIdFile, 'utf8').trim();
    process.stdout.write(`Verification image: ${image}\n`);
    if (buildOnly) return 0;

    const revision = output('git', ['rev-parse', 'HEAD']);
    const base = output('git', ['rev-parse', 'refs/remotes/origin/main']);
    const bundle = path.join(temporary, 'source.bundle');
    output('git', ['bundle', 'create', bundle, 'HEAD', 'refs/remotes/origin/main', '--tags']);
    if (output('git', ['rev-parse', 'HEAD']) !== revision || output('git', ['status', '--porcelain=v1', '--untracked-files=all'])) {
      throw new Error('The source checkout changed while preparing the Linux snapshot.');
    }
    const seccomp = path.join(temporary, 'seccomp.json');
    await downloadSeccomp(seccomp, browser, cancellation.signal);
    writeFileSync(path.join(temporary, 'environment.json'), JSON.stringify({
      revision, base, ...environment, primary, browser, images: resolvedImages, image,
      seccompSha256: SECCOMP_SHA256,
      scope: 'Canonical local verification in Linux; hosted services and runner hardware remain separate.',
    }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    container = `whoisleuth-verification-${randomUUID()}`;
    try {
      await run('docker', linuxVerificationRunArguments({ name: container, image, bundle, seccomp, revision, base, platform: environment.platform }), cancellation.signal, ROOT, dockerEnvironment);
      accepted = true;
    } finally {
      // Keep logs and the environment record outside the source checkout even
      // after failure. Source bundles and disposable checkouts are not reports.
      const logs = spawnSync('docker', ['logs', container], { env: dockerEnvironment, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000 });
      if (!logs.error) writeFileSync(path.join(temporary, 'verification.log'), logs.stdout + logs.stderr, { mode: 0o600 });
      keepEvidence = true;
    }
    process.stdout.write('Linux verification passed. No remote check, publication or deployment was performed.\n');
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Linux verification failed.'}\n`);
    return 2;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (container) {
      spawnSync('docker', [accepted ? 'rm' : 'stop', container], { env: dockerEnvironment, stdio: 'inherit', timeout: 30_000 });
      if (!accepted) process.stdout.write(`Stopped diagnostic container retained: ${container}\nRemove it after inspection with docker rm ${container}.\n`);
    }
    if (temporary && keepEvidence) {
      for (const item of ['image', 'source.bundle', 'seccomp.json', 'image-id', 'registry-config']) {
        const filename = path.join(temporary, item);
        if (existsSync(filename)) rmSync(filename, { recursive: true, force: true });
      }
      process.stdout.write(`Private Linux verification evidence: ${temporary}\n`);
    } else if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
