import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Capture = typeof import('../packages/web-capture/capture.mts')['captureRenderedPage'];
type Launcher = typeof import('../packages/web-capture/browser.mts')['launchCaptureBrowser'];

/** Source and installed-package checks exercise the same production boundary. */
export async function checkCaptureBrowserIsolation(capture: Capture, launch: Launcher) {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-network-boundary-'));
  let connections = 0;
  const sink = createServer(socket => { connections++; socket.destroy(); });
  const rows: { teardown: boolean; completeness: string }[] = [];
  try {
    await new Promise<void>((resolve, reject) => { sink.once('error', reject); sink.listen(0, '127.0.0.1', resolve); });
    const address = sink.address();
    if (!address || typeof address === 'string') throw new Error('Loopback fixture did not start.');
    const destination = `http://127.0.0.1:${address.port}`;
    // No route handler and a real listening endpoint: failed DNS cannot pass
    // this control, and observing a forbidden request is not sufficient.
    const browser = await launch(10_000);
    try {
      const page = await browser.newPage();
      await assert.rejects(() => page.goto(destination, { timeout: 5_000 }));
      assert.ok(browser.blockedDirectConnections() > 0);
      assert.equal(connections, 0);
    } finally { await browser.close(); }
    for (const teardown of [false, true]) {
      const collected: string[] = [];
      const html = `<!doctype html><title>Fixture capture</title><main>Fixture</main>${teardown ? `<script>
        addEventListener('pagehide', () => {
          navigator.sendBeacon('${destination}/beacon');
          fetch('${destination}/keepalive', { keepalive: true, mode: 'no-cors' }).catch(() => {});
        });
      </script>` : ''}`;
      const manifest = await capture({
        targetUrl: 'http://example.test/', outputDirectory: path.join(directory, String(teardown)), timeoutMs: 15_000,
      }, {
        launchBrowser: launch,
        resolveAddresses: async () => [{ address: '192.0.2.10', family: 4 }],
        fetchResource: async url => {
          collected.push(url);
          return new Response(new URL(url).pathname === '/' ? html : '', { headers: { 'content-type': 'text/html' } });
        },
      });
      assert.ok(collected.length > 0);
      assert.ok(collected.every(url => new URL(url).hostname === 'example.test'));
      assert.equal(manifest.captures[0]?.completeness, teardown ? 'partial' : 'complete');
      assert.equal(connections, 0);
      rows.push({ teardown, completeness: manifest.captures[0]!.completeness });
    }
    return { directConnections: connections, rows };
  } finally {
    if (sink.listening) await new Promise<void>((resolve, reject) => sink.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { captureRenderedPage } = await import('../packages/web-capture/capture.mts');
  const { launchCaptureBrowser } = await import('../packages/web-capture/browser.mts');
  process.stdout.write(`${JSON.stringify(await checkCaptureBrowserIsolation(captureRenderedPage, launchCaptureBrowser))}\n`);
}
