import { createServer } from 'node:net';
import type { LaunchOptions } from '@playwright/test';
import { ALLOWED_ORIGIN, expect, test as base } from './fixtures';

/** Native initial documents can precede the driver's request interception. */
export async function createNativeTabTransport(origin: string = ALLOWED_ORIGIN) {
  const allowed = new URL(origin);
  if (allowed.origin !== origin || allowed.protocol !== 'http:'
    || allowed.hostname !== '127.0.0.1' || !allowed.port) {
    throw new Error('Native browser tests require one exact loopback origin.');
  }
  let denied = 0;
  const recordDenial = () => { denied = Math.min(Number.MAX_SAFE_INTEGER, denied + 1); };
  // No target parsing, DNS, forwarding or request retention. The browser's
  // exact scheme/IP/port bypass admits only the owned fixture server.
  const proxy = createServer(socket => { recordDenial(); socket.destroy(); });
  proxy.maxConnections = 32;
  proxy.on('drop', recordDenial);
  proxy.unref();
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen({ host: '127.0.0.1', port: 0, backlog: 32 }, () => {
      proxy.off('error', reject); resolve();
    });
  });
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Native browser isolation could not start.');
  const proxyOptions = Object.freeze({ server: `http://127.0.0.1:${address.port}`, bypass: `<-loopback>,${origin}` });
  let closing: Promise<void> | undefined;
  return {
    proxy: proxyOptions,
    get deniedConnections() { return denied; },
    launchOptions(options: LaunchOptions = {}): LaunchOptions {
      return {
        ...options,
        proxy: proxyOptions,
        args: [...options.args ?? [], '--dns-prefetch-disable', '--disable-quic',
          '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
      };
    },
    close: () => closing ??= new Promise<void>((resolve, reject) => {
      proxy.close(error => error ? reject(error) : resolve());
    }),
  };
}

type NativeTabTransport = Awaited<ReturnType<typeof createNativeTabTransport>>;

// The full pinned browser owns native tab disposition. Its transport guard
// lives longer than every context; route and console assertions still apply.
export const test = base.extend<{ nativeTabNetworkGuard: void }, { nativeTabTransport: NativeTabTransport | null }>({
  channel: async ({ browserName }, use) => use(browserName === 'chromium' ? 'chromium' : undefined),
  nativeTabTransport: [async ({ browserName }, use) => {
    const transport = browserName === 'chromium' ? await createNativeTabTransport() : null;
    try { await use(transport); } finally { await transport?.close(); }
  }, { scope: 'worker' }],
  launchOptions: async ({ launchOptions, nativeTabTransport }, use) => {
    await use(nativeTabTransport?.launchOptions(launchOptions) ?? launchOptions);
  },
  nativeTabNetworkGuard: [async ({ nativeTabTransport, browser, proxy, networkAndConsoleGuard }, use, testInfo) => {
    void networkAndConsoleGuard;
    if (!nativeTabTransport) { await use(); return; }
    expect(proxy, 'contexts must retain the native browser transport').toBeUndefined();
    const before = nativeTabTransport.deniedConnections;
    const original = browser.newContext;
    browser.newContext = async function (options) {
      if (options?.proxy) throw new Error('Native browser contexts cannot replace the fixture transport.');
      return original.call(this, options);
    };
    try { await use(); } finally {
      browser.newContext = original;
      // Includes browser-internal traffic even inside isolated contexts. The
      // count is diagnostic, not a claim that the application made a request.
      // Route/console assertions remain active for observable requests; this
      // transport independently prevents off-origin delivery.
      await testInfo.attach('native-browser-transport', {
        body: JSON.stringify({ deniedConnections: nativeTabTransport.deniedConnections - before }),
        contentType: 'application/json',
      });
    }
  }, { auto: true }],
});

export { expect };
