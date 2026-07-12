const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWhoisChainUncached, fetchGtRegistryWhois } = require('../lib/whois');

test('registry HTML fallback uses the injected safe request boundary', async () => {
  const calls = [];
  const result = await fetchGtRegistryWhois('example.gt', {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return new Response('<p>The domain is not registered</p>', { status: 200 });
    },
  });

  assert.deepEqual(result, { registered: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.gt/sitio/whois.php?dn=example.gt.&lang=en');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('registry HTML fallback degrades safely when the request boundary rejects a redirect', async () => {
  let calls = 0;
  const result = await fetchGtRegistryWhois('example.gt', {
    fetcher: async () => {
      calls += 1;
      throw new Error('Refusing to fetch redirect target: resolves to a private/reserved address');
    },
  });

  assert.equal(result, null);
  assert.equal(calls, 1);
});

test('registry HTML fallback retains bounded structured fields', async () => {
  const html = `
    <i class="fas fa-bell fa-fw"></i> Active
    Expiration: 2030-Jan-02
    <h4>Entitled Organization</h4>
    <i class="fas fa-building"></i> Example Holder
    <i class="fas fa-address-card"></i> 1 Registry Street
    <i class="fas fa-phone"></i> +1 555 0100
    <h4>Servers</h4>
    <strong>ns2.example.net.</strong><strong>ns1.example.net.</strong>
    <div class="span6"></div>
  `;
  const result = await fetchGtRegistryWhois('example.gt', {
    fetcher: async () => new Response(html, { status: 200 }),
  });

  assert.equal(result.registered, true);
  assert.equal(result.status, 'Active');
  assert.equal(result.expiryDate, '2030-Jan-02');
  assert.equal(result.registrantOrg, 'Example Holder');
  assert.deepEqual(result.nameservers, ['ns2.example.net.', 'ns1.example.net.']);
});

test('registry HTML fallback refuses a truncated response', async () => {
  const result = await fetchGtRegistryWhois('example.gt', {
    fetcher: async () => new Response('x'.repeat(500_001), { status: 200 }),
  });
  assert.equal(result, null);
});

test('the WHOIS chain retains the best-effort registry website result', async () => {
  const chain = await buildWhoisChainUncached('example.gt', {
    whoisQuery: async () => 'domain: GT\norganisation: Registry',
    fetchGtRegistryWhois: async () => ({
      registered: true,
      status: 'Active',
      expiryDate: '2030-Jan-02',
      registrantOrg: null,
      registrantAddress: null,
      registrantPhone: null,
      adminName: null,
      adminOrg: null,
      adminEmail: null,
      nameservers: ['ns1.example.net'],
    }),
  });

  assert.equal(chain.length, 2);
  assert.match(chain[1].server, /registry website/);
  assert.match(chain[1].response, /Domain Name: EXAMPLE\.GT/);
  assert.match(chain[1].response, /Domain Status: Active/);
  assert.match(chain[1].response, /Name Server: ns1\.example\.net/);
});
