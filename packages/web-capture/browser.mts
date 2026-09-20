import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { MAX_CAPTURE_TIMEOUT_MS, type CaptureBrowser } from './capture.mts';

/** Only the separate pinned collector may reach a resource operator. */
async function launchIsolatedBrowser(timeout: number, browser: Pick<typeof chromium, 'launch'>): Promise<CaptureBrowser> {
  const startedAt = performance.now();
  let blocked = 0;
  const recordDenial = () => { blocked = Math.min(Number.MAX_SAFE_INTEGER, blocked + 1); };
  // A deny-only proxy never parses a target, resolves DNS, forwards bytes or
  // retains request content. Unlike page routing it outlives page teardown.
  const proxy = createServer(socket => { recordDenial(); socket.destroy(); });
  proxy.maxConnections = 32;
  proxy.on('drop', recordDenial);
  proxy.unref();
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen({ host: '127.0.0.1', port: 0, backlog: 32 }, () => {
      proxy.off('error', reject);
      resolve();
    });
  });
  let stop: Promise<void> | undefined;
  const stopProxy = () => stop ??= new Promise<void>((resolve, reject) => {
    proxy.close(error => error ? reject(error) : resolve());
  });
  try {
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Capture network isolation could not start.');
    const remaining = timeout - Math.ceil(performance.now() - startedAt);
    if (remaining < 1) throw new Error('Capture browser launch exceeded its deadline.');
    const instance = await browser.launch({
      headless: true,
      chromiumSandbox: true,
      timeout: remaining,
      proxy: { server: `http://127.0.0.1:${address.port}`, bypass: '<-loopback>' },
      args: ['--dns-prefetch-disable', '--disable-quic', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    });
    const closeBrowser = instance.close.bind(instance);
    let closing: Promise<void> | undefined;
    Object.defineProperties(instance, {
      blockedDirectConnections: { value: () => blocked },
      close: { value: (options?: Parameters<Browser['close']>[0]) => closing ??= (async () => {
        try { await closeBrowser(options); } finally { await stopProxy(); }
      })() },
    });
    instance.once('disconnected', () => { void stopProxy().catch(() => {}); });
    return instance as CaptureBrowser;
  } catch (error) {
    await stopProxy();
    throw error;
  }
}

export function launchCaptureBrowser(timeout: number, browser: Pick<typeof chromium, 'launch'> = chromium): Promise<CaptureBrowser> {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_CAPTURE_TIMEOUT_MS) throw new Error('Capture browser launch requires a bounded deadline.');
  return launchIsolatedBrowser(timeout, browser);
}
