import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

/** Test lifecycle for the real native entry, with denied product egress. */
export async function startVerifiedLocalProcess(options: Readonly<{
  entry: string; guard: string; workspace: string; cwd: string; create: boolean; port?: number;
}>) {
  const environment = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP']
    .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
  const child = spawn(process.execPath, ['--import', options.guard, options.entry, '--workspace', options.workspace,
    '--offline', ...(options.create ? ['--init'] : []), ...(options.port ? ['--port', String(options.port)] : [])],
  { cwd: options.cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', stopped = false;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  child.stderr.on('data', value => { stderr += String(value); if (stderr.length > 16_384) child.kill('SIGTERM'); });
  async function stop(verify: boolean) {
    if (stopped) return;
    stopped = true; child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      const result = await exited;
      if (verify) { assert.deepEqual(result, { code: 0, signal: null }); assert.equal(stderr, ''); }
    } finally { clearTimeout(timer); }
  }
  try {
    const launchUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local application did not become ready.')), 30_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', () => { clearTimeout(timer); reject(new Error('Local application exited before readiness: ' + stderr.slice(0, 2_000))); });
      child.stdout.on('data', value => {
        stdout += String(value);
        if (stdout.length > 16_384) { clearTimeout(timer); reject(new Error('Local startup output exceeded its bound.')); return; }
        const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+\/login#[a-f0-9]{64}/u)?.[0];
        if (url) { clearTimeout(timer); resolve(url); }
      });
    });
    return { origin: new URL(launchUrl).origin, launchUrl, directory: options.workspace, close: () => stop(true) };
  } catch (cause) { await stop(false); throw cause; }
}
