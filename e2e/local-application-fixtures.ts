import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, expect } from './fixtures';
import { startVerifiedLocalProcess } from '../tools/local-application-process.mts';

type Instance = Awaited<ReturnType<typeof startVerifiedLocalProcess>>;
type LocalFixture = {
  readonly instance: Instance;
  restart(fresh?: boolean): Promise<void>;
};

export const test = base.extend<{ localApplication: LocalFixture }>({
  localApplication: async ({}, use) => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'whoisleuth-browser-local-'));
    let workspace = path.join(temporary, 'selected workspace with a deliberately descriptive folder name');
    const launch = (create: boolean, port?: number) => startVerifiedLocalProcess({ workspace, create, ...(port ? { port } : {}), cwd: temporary,
      entry: path.resolve(__dirname, '../packages/local-application/bin/whoisleuth-local.mts'),
      guard: path.resolve(__dirname, '../tools/browser-server-egress-guard.mts') });
    let instance: Instance | undefined;
    try {
      instance = await launch(true);
      await use({
        get instance() { return instance!; },
        async restart(fresh = false) {
          const port = Number(new URL(instance!.origin).port);
          await instance!.close(); instance = undefined;
          if (fresh) workspace = path.join(temporary, 'restored workspace');
          instance = await launch(fresh, port);
        },
      });
    } finally { await instance?.close(); await rm(temporary, { recursive: true, force: true }); }
  },
  networkGuardOrigin: async ({ localApplication }, use) => use(localApplication.instance.origin),
  context: async ({ browser, localApplication }, use) => {
    const context = await browser.newContext({ baseURL: localApplication.instance.origin, storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      let calls = 0;
      Object.defineProperty(window, '__unexpectedBrowserDatabaseCalls', { get: () => calls });
      Object.defineProperty(indexedDB, 'open', { value: () => { calls++; throw new Error('Filesystem mode must not open a browser database.'); } });
    });
    try { await use(context); } finally { await context.close(); }
  },
});

export async function openLocalApplication(page: import('@playwright/test').Page, local: LocalFixture) {
  await page.goto(local.instance.launchUrl);
  await expect(page).toHaveURL(`${local.instance.origin}/dashboard`);
  await expect(page.locator('#main-content > .workspace-scope strong')).toHaveText('Filesystem workspace');
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __unexpectedBrowserDatabaseCalls: number }).__unexpectedBrowserDatabaseCalls)).toBe(0);
}

export { expect };
