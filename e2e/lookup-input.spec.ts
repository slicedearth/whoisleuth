import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow } from './helpers';

// Every value here is deliberately dotless (no TLD), so classifyQuery on the
// server rejects it with a 400 before any RDAP/WHOIS/DNS call - these tests
// never trigger a live lookup, only client-side parsing/navigation.

test.beforeEach(async ({ page }) => {
  await page.goto('/lookup');
});

test('a single domain can be entered normally', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await expect(query).toHaveValue('bad-domain-one');
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeVisible();
  await expect(page.getByText('Separate multiple domains with commas, semicolons, tabs, or new lines.')).toBeVisible();
});

test('newlines, commas, and semicolons all parse as multiple domains and hand off to Bulk', async ({ page }) => {
  // Each delimiter gets its own line: the client-side parser picks one
  // dominant delimiter per line, so a line mixing "," and ";" together would
  // only split on one of them. Using `.invalid` (RFC 2606) keeps these
  // syntactically domain-shaped - required for the parser to treat a line as
  // a pasted list rather than a single free-text token - without this test
  // ever reaching /api/lookup: the multi-domain path only hands candidates
  // off to Bulk client-side and never submits a lookup itself.
  const query = page.locator('#query');
  await query.fill(
    [
      'bad-domain-one.invalid',
      'bad-domain-two.invalid,bad-domain-three.invalid',
      'bad-domain-four.invalid;bad-domain-five.invalid',
    ].join('\n')
  );
  await expect(page.getByRole('button', { name: 'Open 5 in Bulk' })).toBeVisible();

  await page.getByRole('button', { name: 'Open 5 in Bulk' }).click();
  await expect(page).toHaveURL(/\/bulk/);
  await expect(page.locator('#domains')).toHaveValue(
    [
      'bad-domain-one.invalid',
      'bad-domain-two.invalid',
      'bad-domain-three.invalid',
      'bad-domain-four.invalid',
      'bad-domain-five.invalid',
    ].join('\n')
  );
});

test('Enter inserts a newline in the query field instead of submitting', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await query.press('End');
  await query.press('Enter');
  await query.pressSequentially('bad-domain-two');

  await expect(query).toHaveValue('bad-domain-one\nbad-domain-two');
  // Enter must not have already submitted the multi-domain handoff.
  await expect(page).toHaveURL(/\/lookup$/);
  await expect(page.getByRole('button', { name: 'Open 2 in Bulk' })).toBeVisible();
});

test('the clear action empties the field', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await page.getByRole('button', { name: 'Clear query' }).click();
  await expect(query).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Clear query' })).toHaveCount(0);
});

test('the clear action stays within the input wrapper at desktop and mobile widths, with no overflow', async ({ page }) => {
  const query = page.locator('#query');
  const wrapper = page.locator('.query-field');
  const clearButton = page.getByRole('button', { name: 'Clear query' });

  for (const size of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await query.fill('bad-domain-one');
    const wrapperBox = await boundingBox(wrapper);
    const clearBox = await boundingBox(clearButton);
    expect(clearBox.x).toBeGreaterThanOrEqual(wrapperBox.x - 1);
    expect(clearBox.y).toBeGreaterThanOrEqual(wrapperBox.y - 1);
    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(wrapperBox.x + wrapperBox.width + 1);
    expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(wrapperBox.y + wrapperBox.height + 1);
    await expectNoHorizontalOverflow(page);
    await query.fill('');
  }
});

test('bounded RDAP contact roles and repeated channels render in Lookup', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'example.com', type: 'domain', registrableDomain: 'example.com',
      availability: { state: 'registered', confidence: 'high', domain: 'example.com' },
      rdap: {
        upstreamStatus: 200,
        rdapServer: 'https://rdap.example/domain/example.com',
        attempts: [
          { outcome: 'rate_limited', selected: false },
          { outcome: 'success', selected: true },
        ],
        parsed: {
          domain: 'EXAMPLE.COM', handle: 'DOMAIN-1', statuses: ['active'], nameservers: ['NS1.EXAMPLE.COM'],
          nameserverDetails: [{ name: 'NS1.EXAMPLE.COM', addresses: ['192.0.2.10'] }],
          dsData: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' }],
          objectClassName: 'domain', language: 'en', conformance: ['rdap_level_0', 'redacted_0'],
          redactions: [{ name: 'Registrant Email', method: 'removal', reason: 'Server Policy', prePath: '$.entities[0]' }],
          variants: [{ relation: ['registered'], idnTable: 'Example table', variantNames: [{ unicodeName: 'éxample.com' }] }],
          entitiesByRole: {
            registrant: [{
              handle: 'CONTACT-1', name: 'Example Contact', organizations: ['Example Org'],
              emails: ['first@example.com', 'second@example.com'], phones: ['+61 1', '+61 2'],
              addresses: ['1 Main St', '2 Branch St'], publicIds: [], links: [],
            }],
            abuse: [{
              handle: 'ABUSE-1', name: null, organizations: [], emails: ['abuse@example.com'],
              phones: [], addresses: [], publicIds: [], links: [],
            }],
          },
        },
      },
      whois: { parsed: {}, chain: [] },
      diagnostics: {
        rdap: { status: 'success', attempts: [{ outcome: 'rate_limited' }, { outcome: 'success' }] },
        whois: { status: 'partial' }, availability: { status: 'complete' },
      },
    }),
  }));

  await page.locator('#query').fill('example.com');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await page.getByText('Published contacts · 2 roles').click();
  const rdapSection = page.locator('.sources > details').first();
  await expect(rdapSection.getByText('rdap_level_0, redacted_0', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText(/Registrant Email · removal · Server Policy/)).toBeVisible();
  await expect(rdapSection.getByText(/registered, Example table: éxample.com/)).toBeVisible();
  await expect(rdapSection.getByText('12345 13 2 ABCDEF', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('NS1.EXAMPLE.COM: 192.0.2.10', { exact: true })).toBeVisible();
  await expect(page.getByText('Email: first@example.com, second@example.com')).toBeVisible();
  await expect(page.getByText('Phone: +61 1, +61 2')).toBeVisible();
  await expect(page.getByText('Email: abuse@example.com')).toBeVisible();
  await expect(page.getByText(/attempts: rate limited → success/)).toBeVisible();
  const comparison = page.locator('.comparison');
  await expect(comparison.getByText(/0 source-only · 0 redacted · 4 unavailable\/incomplete/)).toBeVisible();
  await comparison.locator('summary').click();
  await expect(comparison.getByText('WHOIS incomplete').first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('a Lookup case stores the registrar name rather than stringifying its entity', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'example.com', type: 'domain', registrableDomain: 'example.com',
      availability: {
        state: 'registered', confidence: 'high', domain: 'example.com', deepScanComplete: true,
        registrar: { handle: 'REG-1', name: 'Example Registrar LLC', org: 'Example Registrar Group' },
      },
      rdap: { parsed: { registrar: { name: 'RDAP Fallback Registrar' } } },
      whois: { parsed: { registrar: 'WHOIS Fallback Registrar' }, chain: [] },
      diagnostics: {
        rdap: { status: 'success' }, whois: { status: 'success' }, availability: { status: 'complete' },
      },
    }),
  }));

  await page.locator('#query').fill('example.com');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await page.getByRole('button', { name: 'Create case' }).click();

  const registrar = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('whois-rdap-cases-v1') || '{}');
    return stored.cases?.[0]?.evidenceHistory?.[0]?.registrar;
  });
  expect(registrar).toBe('Example Registrar LLC');
});

test('bounded WHOIS lifecycle and role-based contacts render in Lookup', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'example.com', type: 'domain', registrableDomain: 'example.com',
      availability: { state: 'registered', confidence: 'high', domain: 'example.com' },
      rdap: { upstreamStatus: 404, parsed: {} },
      whois: {
        parsed: {
          domainName: 'EXAMPLE.COM', registryDomainId: 'DOMAIN-1', registrar: 'Example Registrar',
          lifecycle: {
            createdDate: '2020-01-02T03:04:05Z',
            expiryDate: '2030-01-02T03:04:05Z',
            updatedDate: '2026-07-12T01:02:03Z',
          },
          statuses: ['clientTransferProhibited'], nameservers: ['NS1.EXAMPLE.COM'],
          chainStatus: 'complete', fieldsTruncated: ['registrantAddress'],
          contactsByRole: {
            registrant: [{
              handle: 'REG-1', name: 'Example Person', organizations: ['Example Org'],
              emails: ['person@example.com'], phones: ['+61 3 0000 0000'],
              addresses: ['Suite 1, 2 Example Road, Melbourne VIC 3000, AU'],
              publicIds: [{ type: 'Registry contact ID', identifier: 'REG-1' }], links: [],
            }],
            abuse: [{
              handle: null, name: null, organizations: ['Example Registrar'],
              emails: ['abuse@example.com'], phones: [], addresses: [], publicIds: [], links: [],
            }],
          },
        },
        chain: [],
      },
      diagnostics: { rdap: { status: 'not_found' }, whois: { status: 'complete' }, availability: { status: 'complete' } },
    }),
  }));

  await page.locator('#query').fill('example.com');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const whoisSection = page.locator('.sources > details').nth(1);
  await expect(whoisSection.getByText('Published contacts · 2 roles · capped')).toBeVisible();
  await whoisSection.getByText('Published contacts · 2 roles · capped').click();
  await expect(whoisSection.getByText('Example Person', { exact: true })).toBeVisible();
  await expect(whoisSection.getByText('Email: person@example.com')).toBeVisible();
  await expect(whoisSection.getByText('Address: Suite 1, 2 Example Road, Melbourne VIC 3000, AU')).toBeVisible();
  await expect(whoisSection.getByText('IDs: Registry contact ID: REG-1')).toBeVisible();
  await expect(whoisSection.getByText(/Some WHOIS fields exceeded local display limits: registrantAddress/)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('IDN review shows Unicode and ASCII together with cautious profile similarity evidence', async ({ page }) => {
  await page.evaluate(() => {
    const profile = {
      id: 'idn-profile', name: 'Example Brand', officialDomains: ['paypal.com'], productNames: [], tlds: ['com'],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
      createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    };
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify([profile]));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', profile.id);
  });
  await page.reload();
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'xn--ypal-43d9g.com', type: 'domain', registrableDomain: 'xn--ypal-43d9g.com',
      availability: { state: 'registered', confidence: 'high', domain: 'xn--ypal-43d9g.com' },
      rdap: { upstreamStatus: 404, parsed: {} }, whois: { parsed: {}, chain: [] },
      diagnostics: { rdap: { status: 'not_found' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
    }),
  }));

  await page.locator('#query').fill('xn--ypal-43d9g.com');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const card = page.locator('.idn-card');
  await expect(card.getByRole('heading', { name: 'IDN and confusable review' })).toBeVisible();
  await expect(card.getByText('раypal.com', { exact: true })).toBeVisible();
  await expect(card.getByText('xn--ypal-43d9g.com', { exact: true })).toBeVisible();
  await expect(card.getByText('Cyrillic, Latin', { exact: true })).toBeVisible();
  await expect(card.getByText('Mixed writing scripts', { exact: true })).toBeVisible();
  await expect(card.getByText('Confusable with an official domain', { exact: true })).toBeVisible();
  await expect(card.getByText(/similarity indicators and do not establish maliciousness/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('deep DNS evidence distinguishes observed records from partial resolver failure', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'dns-evidence.test', type: 'domain', registrableDomain: 'dns-evidence.test',
      availability: {
        state: 'registered', confidence: 'high', domain: 'dns-evidence.test', dnssec: 'signed',
        dns: {
          status: 'partial', source: 'dns', scanMode: 'deep', complete: false, truncated: false,
          records: {
            a: ['192.0.2.10'], aaaa: ['2001:db8::10'], cname: [], ns: ['ns1.example'],
            mx: [{ priority: 10, exchange: 'mail.example' }], spf: ['v=spf1 -all'],
            dmarc: ['v=DMARC1; p=reject'], caa: [{ critical: 0, tag: 'issue', value: 'ca.example' }],
          },
          diagnostics: { a: { status: 'success' }, aaaa: { status: 'success' }, cname: { status: 'error', error: 'resolver timed out' } },
        },
      },
      rdap: { upstreamStatus: 200, parsed: {} }, whois: { parsed: {}, chain: [] },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
    }),
  }));

  await page.locator('#query').fill('dns-evidence.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const card = page.locator('.dns-card');
  await expect(card.getByRole('heading', { name: 'DNS intelligence' })).toBeVisible();
  await expect(card.getByText('192.0.2.10', { exact: true })).toBeVisible();
  await expect(card.getByText('0 issue ca.example', { exact: true })).toBeVisible();
  await expect(card.getByText(/CNAME: resolver timed out/i)).toBeVisible();
  await expect(card.getByText(/does not prove common ownership or maliciousness/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('HTTP intelligence presents bounded redirect provenance and response metadata', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'http-evidence.test', type: 'domain', registrableDomain: 'http-evidence.test',
      availability: {
        state: 'registered', confidence: 'high', domain: 'http-evidence.test',
        http: {
          version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z', scanMode: 'deep', source: 'http',
          durationMs: 125, complete: true, truncated: false, limitations: ['URL query strings were omitted from retained provenance.'], diagnostics: {},
          requestUrl: 'https://http-evidence.test/', finalUrl: 'https://login.example.test/final', transportSecurity: 'https',
          redirectCount: 1, redirectLimitReached: false, crossOriginRedirect: true, httpsDowngrade: false,
          redirects: [{ from: 'https://http-evidence.test/', to: 'https://login.example.test/final', status: 302, durationMs: 20, queryOmitted: true }],
          attempts: [{ url: 'https://http-evidence.test/', outcome: 'response', httpStatus: 200, error: null }],
          response: {
            status: 200, contentType: 'text/html; charset=utf-8', contentLanguage: 'en', server: 'Example Server',
            declaredContentLength: 4096, capturedBodyBytes: 2048, bodyInspected: true, bodyTruncated: false,
            securityHeaders: { strictTransportSecurity: 'max-age=31536000', contentSecurityPolicy: "default-src 'self'", xFrameOptions: 'DENY', xContentTypeOptions: 'nosniff', referrerPolicy: 'no-referrer' },
          },
        },
      },
      rdap: { upstreamStatus: 200, parsed: {} }, whois: { parsed: {}, chain: [] },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
    }),
  }));

  await page.locator('#query').fill('http-evidence.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const card = page.locator('.http-card');
  await expect(card.getByRole('heading', { name: 'HTTP intelligence' })).toBeVisible();
  await expect(card.getByText('https://login.example.test/final', { exact: true })).toBeVisible();
  await expect(card.getByText('Cross-origin redirect', { exact: true })).toBeVisible();
  await card.getByText('Redirect chain · 1 hop', { exact: true }).click();
  await expect(card.getByText('→ https://login.example.test/final', { exact: true })).toBeVisible();
  await card.getByText('Selected response headers', { exact: true }).click();
  await expect(card.getByText('max-age=31536000', { exact: true })).toBeVisible();
  await expect(card).not.toContainText('secret');
  await expect(card.getByText(/missing security headers do not establish maliciousness/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('IP results use network-specific RDAP labels instead of domain fields', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: '192.0.2.1', type: 'ipv4',
      availability: { applicable: false, type: 'ipv4' },
      rdap: { upstreamStatus: 200, parsed: {
        handle: 'NET-1', name: 'Example Network', startAddress: '192.0.2.0', endAddress: '192.0.2.255',
        cidrs: ['192.0.2.0/24'], country: 'AU', networkType: 'DIRECT ALLOCATION', statuses: ['active'],
        lifecycle: { createdDate: '2001-02-03T04:05:06Z', updatedDate: '2025-06-07T08:09:10Z' },
        events: [{ action: 'registration', date: '2001-02-03T04:05:06Z' }], entitiesByRole: {},
      } },
      whois: { parsed: {}, chain: [] },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'not_applicable' } },
    }),
  }));

  await page.locator('#query').fill('192.0.2.1');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const rdapSection = page.locator('.sources > details').first();
  await expect(rdapSection.getByText('Example Network', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('192.0.2.0 – 192.0.2.255', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('CIDRs')).toBeVisible();
  await expect(rdapSection.getByText('active', { exact: true })).toBeVisible();
  await expect(rdapSection.locator('time[datetime="2001-02-03T04:05:06.000Z"]')).toBeVisible();
  await expect(rdapSection.getByText('Domain', { exact: true })).toHaveCount(0);
});

test('ASN results retain allocation status and lifecycle metadata at narrow widths', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'AS64496', type: 'asn',
      availability: { applicable: false, type: 'asn' },
      rdap: { upstreamStatus: 200, parsed: {
        handle: 'AS64496', name: 'Example Autonomous System', startAutnum: 64496, endAutnum: 64500,
        country: 'AU', autnumType: 'DIRECT ALLOCATION', statuses: ['active'],
        lifecycle: { createdDate: '2003-04-05T06:07:08Z', updatedDate: '2024-05-06T07:08:09Z' },
        events: [{ action: 'registration', date: '2003-04-05T06:07:08Z' }], entitiesByRole: {},
      } },
      whois: { parsed: {}, chain: [] },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'not_applicable' } },
    }),
  }));

  await page.locator('#query').fill('AS64496');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const rdapSection = page.locator('.sources > details').first();
  await expect(rdapSection.getByText('Example Autonomous System', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('64496 – 64500', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('active', { exact: true })).toBeVisible();
  await expect(rdapSection.locator('time[datetime="2003-04-05T06:07:08.000Z"]')).toBeVisible();
  await expect(rdapSection.locator('time[datetime="2024-05-06T07:08:09.000Z"]')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});
