import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { environmentWithoutV8Coverage } from './helpers/subprocess-environment.mts';

import {
  DEFERRED_MODULE_DEADLINE_MS,
  DeferredModuleLoadError,
  isDeferredModuleLoadError,
  loadDeferredModule,
  type DeferredModuleScheduler,
} from '../frontend/src/lib/deferred-module.ts';

function controlledScheduler() {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const cleared: number[] = [];
  const scheduler: DeferredModuleScheduler = {
    setTimeout(callback: () => void) {
      nextHandle += 1;
      callbacks.set(nextHandle, callback as () => void);
      return nextHandle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(handle) {
      const numeric = handle as unknown as number;
      cleared.push(numeric);
      callbacks.delete(numeric);
    },
  };
  return {
    scheduler,
    cleared,
    expire(handle = 1) {
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.();
    },
  };
}

describe('bounded deferred module loading', () => {
  test('checks required values and callback outcomes through the actual deferred component', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const workspace = await mkdtemp(path.join(tmpdir(), 'whoisleuth-deferred-types-'));
    try {
      await symlink(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
      await copyFile(path.join(root, 'frontend/src/lib/components/DeferredSurface.svelte'), path.join(workspace, 'DeferredSurface.svelte'));
      await copyFile(path.join(root, 'frontend/src/lib/deferred-module.ts'), path.join(workspace, 'deferred-module.ts'));
      await writeFile(path.join(workspace, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
          noEmit: true, allowJs: true, checkJs: true, skipLibCheck: true, allowImportingTsExtensions: true,
          types: ['svelte'], lib: ['ES2023', 'DOM', 'DOM.Iterable'], paths: { '$lib/*': ['./*'] } },
        include: ['*.svelte', '*.ts'],
      }));
      await writeFile(path.join(workspace, 'Subject.svelte'), `<script lang="ts">
        let { label, save }: { label: string; save: (value: string) => Promise<{ status: 'committed' | 'rejected' }> } = $props();
        </script><button onclick={() => { void save(label); }}>{label}</button>`);
      const save = "save: async (value: string) => ({ status: 'committed' as const })";
      const cases = [
        ['Valid', `props={{ label: 'Valid', ${save} }}`, null],
        ['MissingProps', '', /props.*missing/iu],
        ['MissingLabel', `props={{ ${save} }}`, /label.*missing/iu],
        ['WrongValue', `props={{ label: 42, ${save} }}`, /number.*string/iu],
        ['WrongOutcome', "props={{ label: 'Invalid', save: async () => {} }}", /Promise<void>/u],
        ['UnexpectedField', `props={{ label: 'Invalid', ${save}, extra: true }}`, /extra/u],
      ] as const;
      for (const [name, attributes] of cases) await writeFile(path.join(workspace, `${name}.svelte`), `<script lang="ts">
        import DeferredSurface from './DeferredSurface.svelte'; import Subject from './Subject.svelte';
        </script><DeferredSurface load={async () => ({ default: Subject })} ${attributes} loadingLabel="Loading" unavailableLabel="Unavailable" />`);
      const environment = environmentWithoutV8Coverage();
      delete environment.NODE_TEST_CONTEXT;
      const checked = spawnSync(process.execPath, [path.join(root, 'node_modules/svelte-check/bin/svelte-check'),
        '--workspace', workspace, '--tsconfig', 'tsconfig.json', '--output', 'machine-verbose'], {
        cwd: workspace, env: environment, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
      });
      assert.equal(checked.error, undefined);
      assert.equal(checked.status, 1, checked.stdout + checked.stderr);
      const diagnostics = checked.stdout.split('\n').flatMap((line) => {
        const json = line.replace(/^\d+ /u, '');
        return json.startsWith('{') ? [JSON.parse(json) as { type: string; filename: string; message: string }] : [];
      });
      assert.match(checked.stdout, /COMPLETED \d+ FILES \d+ ERRORS 0 WARNINGS/u);
      assert.deepEqual([...new Set(diagnostics.map((item) => path.basename(item.filename)))].sort(),
        cases.filter(([, , failure]) => failure).map(([name]) => `${name}.svelte`).sort());
      for (const [name, , failure] of cases) {
        const messages = diagnostics.filter((item) => path.basename(item.filename) === `${name}.svelte`);
        if (!failure) assert.deepEqual(messages, []);
        else {
          assert.ok(messages.length > 0, `${name} must be rejected`);
          assert.ok(messages.every((item) => item.type === 'ERROR'));
          assert.match(messages.map((item) => item.message).join('\n'), failure);
        }
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('resolves a healthy module and clears its deadline', async () => {
    const clock = controlledScheduler();
    const module = await loadDeferredModule(async () => ({ value: 7 }), { scheduler: clock.scheduler });
    assert.deepEqual(module, { value: 7 });
    assert.deepEqual(clock.cleared, [1]);
  });

  test('times out a pending module and ignores its late resolution', async () => {
    const clock = controlledScheduler();
    let resolveModule = (_value: string) => {};
    const pending = new Promise<string>((resolve) => { resolveModule = resolve; });
    const result = loadDeferredModule(() => pending, { scheduler: clock.scheduler });
    clock.expire();
    await assert.rejects(result, (cause) => (
      isDeferredModuleLoadError(cause) && cause.code === 'timed_out'
    ));
    resolveModule('late module');
    await Promise.resolve();
    await assert.rejects(result, (cause) => cause instanceof DeferredModuleLoadError && cause.code === 'timed_out');
  });

  test('aborts on destruction and detaches the underlying import', async () => {
    const clock = controlledScheduler();
    const controller = new AbortController();
    const result = loadDeferredModule(() => new Promise<string>(() => {}), {
      scheduler: clock.scheduler,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(result, (cause) => (
      cause instanceof DeferredModuleLoadError && cause.code === 'aborted'
    ));
    assert.deepEqual(clock.cleared, [1]);
  });

  test('normalises rejected and synchronous module failures', async () => {
    const rejected = loadDeferredModule(
      async () => { throw new Error('private failure detail'); },
      { deadlineMs: 1 },
    );
    await assert.rejects(rejected, (cause) => (
      cause instanceof DeferredModuleLoadError
      && cause.code === 'failed'
      && cause.message === 'The deferred module could not be loaded.'
    ));
    await assert.rejects(
      loadDeferredModule(() => { throw new Error('synchronous failure'); }),
      (cause) => cause instanceof DeferredModuleLoadError && cause.code === 'failed',
    );
  });

  test('rejects invalid or widened deadlines', () => {
    for (const deadlineMs of [0, 1.5, DEFERRED_MODULE_DEADLINE_MS + 1]) {
      assert.throws(
        () => loadDeferredModule(async () => true, { deadlineMs }),
        /Deferred module deadlines must be whole milliseconds/u,
      );
    }
  });
});
