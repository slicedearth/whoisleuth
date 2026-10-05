import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Server } from 'node:net';
import { createNativeTabTransport } from './native-tab-fixtures';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function expectBlockedDestination(page: Page, target: string, errorCode: RegExp): Promise<void> {
  await expect(page.locator('.error-code')).toHaveText(errorCode);
  // Failed documents expose an internal error-page URL. Read the native
  // history entry to bind the observed failure to the exact attempted target.
  const session = await page.context().newCDPSession(page);
  try {
    const history = await session.send('Page.getNavigationHistory');
    expect(history.entries[history.currentIndex]?.url).toBe(target);
  } finally { await session.detach(); }
}

test('native documents, redirects and proxy loss retain exact-origin transport isolation', async ({ launchOptions }) => {
  let unexpectedConnections = 0, documents = 0, redirects = 0, deniedUrl = '';
  const sink = createServer(socket => { unexpectedConnections++; socket.destroy(); });
  const server = createHttpServer((request, response) => {
    if (request.url === '/redirect') {
      redirects++; response.writeHead(302, { location: deniedUrl }); response.end(); return;
    }
    response.setHeader('content-type', 'text/html');
    if (request.url === '/destination') {
      documents++; response.end('<!doctype html><title>Native destination</title>'); return;
    }
    response.end(`<!doctype html><title>Native source</title>
      <a href="/destination">Allowed destination</a>
      <a href="${deniedUrl}">Denied destination</a>
      <a href="/redirect">Redirected destination</a>`);
  });
  let transport: Awaited<ReturnType<typeof createNativeTabTransport>> | undefined;
  let browser: Browser | undefined;
  try {
    deniedUrl = `${await listen(sink)}/denied`;
    const origin = await listen(server);
    transport = await createNativeTabTransport(origin);
    browser = await chromium.launch({ ...transport.launchOptions(launchOptions), channel: 'chromium' });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(origin);
      const [destination] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('link', { name: 'Allowed destination' }).click({ modifiers: ['ControlOrMeta', 'Shift'] }),
      ]);
      await expect(destination).toHaveTitle('Native destination');
      await expect(destination).toHaveURL(`${origin}/destination`);
      await expect(page).toHaveURL(`${origin}/`);
      expect(destination.context()).toBe(context);
      expect(documents).toBe(1);
    } finally { await context.close(); }

    // No request interception: require the actual native destination to fail,
    // not an aggregate counter that may include browser background traffic.
    for (const label of ['Denied destination', 'Redirected destination']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.goto(origin);
        const before = transport.deniedConnections;
        const [destination] = await Promise.all([
          context.waitForEvent('page'),
          page.getByRole('link', { name: label }).click({ modifiers: ['ControlOrMeta', 'Shift'] }),
        ]);
        // A destroyed proxy socket can fail before or after connection setup.
        // Still require the exact failed destination, a proxy denial and no
        // connection to the listening destination sink.
        await expectBlockedDestination(destination, deniedUrl, /^ERR_(?:CONNECTION_RESET|EMPTY_RESPONSE|SOCKET_NOT_CONNECTED)$/u);
        expect(transport.deniedConnections).toBeGreaterThan(before);
        expect(unexpectedConnections).toBe(0);
      } finally { await context.close(); }
    }
    expect(redirects).toBe(1);

    const page = await browser.newPage({ serviceWorkers: 'block' });
    try {
      await page.goto(origin);
      await transport.close();
      const [destination] = await Promise.all([
        page.context().waitForEvent('page'),
        page.getByRole('link', { name: 'Denied destination' }).click({ modifiers: ['ControlOrMeta', 'Shift'] }),
      ]);
      await expectBlockedDestination(destination, deniedUrl, /^ERR_PROXY_CONNECTION_FAILED$/u);
      expect(unexpectedConnections).toBe(0);
    } finally { await page.context().close(); }
  } finally {
    try { await browser?.close(); } finally {
      await Promise.all([transport?.close(), close(server), close(sink)]);
    }
  }
});
