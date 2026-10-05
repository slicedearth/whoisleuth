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
      let teardownProbed = false;
      const manifest = await capture({
        targetUrl: 'http://example.test/', outputDirectory: path.join(directory, String(teardown)), timeoutMs: 15_000,
      }, {
        launchBrowser: async timeout => {
          const instance = await launch(timeout);
          if (!teardown) return instance;
          const newContext = instance.newContext.bind(instance);
          instance.newContext = async options => {
            const context = await newContext(options);
            const close = context.close.bind(context);
            context.close = async options => {
              await close(options);
              if (teardownProbed) return;
              teardownProbed = true;
              // Native pagehide delivery on forced close is not guaranteed.
              // Prove a real direct request is refused after the capture's
              // context and routes are gone, while its browser remains alive.
              const probe = await instance.newPage();
              try {
                const before = instance.blockedDirectConnections();
                await assert.rejects(() => probe.goto(destination, { timeout: 5_000 }));
                assert.ok(instance.blockedDirectConnections() > before);
              } finally { await probe.context().close(); }
            };
            return context;
          };
          return instance;
        },
        resolveAddresses: async () => [{ address: '192.0.2.10', family: 4 }],
        fetchResource: async url => {
          collected.push(url);
          return new Response(new URL(url).pathname === '/' ? html : '', { headers: { 'content-type': 'text/html' } });
        },
      });
      assert.ok(collected.length > 0);
      assert.ok(collected.every(url => new URL(url).hostname === 'example.test'));
      assert.equal(teardownProbed, teardown);
      assert.equal(manifest.captures[0]?.completeness, teardown ? 'partial' : 'complete');
      assert.equal(connections, 0);
      rows.push({ teardown, completeness: manifest.captures[0]!.completeness });
    }
    const rich = await capture({ targetUrl: 'https://example.test/', outputDirectory: path.join(directory, 'observations'), timeoutMs: 15_000 }, {
      launchBrowser: launch,
      resolveAddresses: async () => [{ address: '192.0.2.10', family: 4 }],
      fetchResource: async url => new Response(new URL(url).pathname === '/' ? `<!doctype html><title>Local observation fixture</title>
        <base href="https://base.example.test/">
        <form method="post" action="https://submit.example.test/private?token=sentinel"><input type="password" value="private-form-value"></form>
        <form><input type="password"></form>
        <iframe src="https://frame.example.test/frame?token=sentinel"></iframe>
        <script src="https://static.example.test/app.js?token=sentinel"></script>
        <p>Verify you are human. Copy and paste the command into terminal.</p>
        <script>
          fetch('https://example.test/data?token=sentinel').catch(() => {});
          const request = new XMLHttpRequest(); request.open('GET', 'https://example.test/xhr'); request.send();
          const image = new Image(); image.src = 'https://example.test/image'; document.body.append(image);
          navigator.sendBeacon('https://example.test/beacon?token=sentinel', 'private-beacon-value');
          navigator.clipboard.writeText('private-clipboard-value').catch(() => {});
          Element.prototype.getAttribute = () => 'forged';
          Document.prototype.createTreeWalker = () => { throw new Error('forged'); };
          window.Boolean = () => true;
        </script>` : new URL(url).pathname.endsWith('.js') ? 'void 0;' : '<p>Frame</p>',
        { headers: { 'content-type': new URL(url).pathname.endsWith('.js') ? 'text/javascript' : 'text/html', 'content-security-policy-report-only': "default-src 'self'" } }),
    });
    const observations = rich.captures[0]!.pageBehaviour;
    assert.equal(observations.clipboardWriteAttempts, 1);
    assert.equal(observations.elements.find(row => row.kind === 'form')?.origin, 'https://submit.example.test');
    assert.equal(observations.elements.filter(row => row.kind === 'form')[1]?.origin, 'https://example.test');
    assert.equal(observations.elements.find(row => row.kind === 'script' && !row.inline)?.integrity, 'absent');
    assert.equal(observations.elements.find(row => row.kind === 'form')?.passwordFields, 1);
    assert.ok(observations.requests.some(row => row.kind === 'script' && row.contentSha256?.length === 64));
    assert.ok(observations.requests.some(row => row.kind === 'frame'));
    assert.ok(observations.actionHints.includes('verification_prompt'));
    for (const channel of ['fetch', 'xhr', 'image']) assert.ok(observations.coverage.attempts.some(row => row.channel === channel && row.state === 'observed' && row.collectionStarted), channel);
    assert.ok(observations.coverage.attempts.some(row => row.channel === 'beacon' && row.state === 'refused' && row.reason === 'method' && !row.collectionStarted));
    assert.equal(observations.coverage.interactions, 'not_exercised');
    assert.doesNotMatch(JSON.stringify(observations), /sentinel|private-form-value|private-clipboard-value|private-beacon-value|app\.js|forged/u);
    const navigationRefusals: string[] = [];
    for (const behaviour of ['form', 'redirect']) {
      const collected: string[] = [];
      const html = `<!doctype html><title>Navigation fixture</title><form method="post" action="https://refused.example.test/private"><input value="never-submit"></form><script>
        setTimeout(() => { ${behaviour === 'form' ? 'document.forms[0].submit()' : 'location.href = "https://refused.example.test/private"'}; }, 50);
      </script>`;
      const manifest = await capture({ targetUrl: 'https://example.test/', outputDirectory: path.join(directory, behaviour), timeoutMs: 15_000 }, {
        launchBrowser: launch,
        resolveAddresses: async hostname => { if (hostname !== 'example.test') throw new Error('Fixture refuses this destination'); return [{ address: '192.0.2.10', family: 4 }]; },
        fetchResource: async (url, options) => {
          assert.equal(options.method, 'GET');
          collected.push(url);
          return new Response(new URL(url).pathname === '/' ? html : '', { headers: { 'content-type': 'text/html' } });
        },
      });
      const result = manifest.captures[0]!;
      assert.equal(result.completeness, 'partial');
      assert.deepEqual(result.page, { title: null, finalOrigin: null });
      assert.deepEqual(result.artifacts.map(item => item.kind), ['screenshot']);
      assert.ok(result.pageBehaviour.coverage.attempts.some(row => row.channel === 'navigation' && row.state !== 'observed'));
      assert.ok(collected.length > 0);
      assert.ok(collected.every(url => new URL(url).hostname === 'example.test'));
      navigationRefusals.push(behaviour);
    }
    assert.equal(connections, 0);
    return { directConnections: connections, rows, navigationRefusals };
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
