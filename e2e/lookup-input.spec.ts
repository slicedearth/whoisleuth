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
  await expect(page.getByText('Email: first@example.com, second@example.com')).toBeVisible();
  await expect(page.getByText('Phone: +61 1, +61 2')).toBeVisible();
  await expect(page.getByText('Email: abuse@example.com')).toBeVisible();
  await expect(page.getByText(/attempts: rate limited → success/)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
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

test('IP results use network-specific RDAP labels instead of domain fields', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: '192.0.2.1', type: 'ipv4',
      availability: { applicable: false, type: 'ipv4' },
      rdap: { upstreamStatus: 200, parsed: {
        handle: 'NET-1', name: 'Example Network', startAddress: '192.0.2.0', endAddress: '192.0.2.255',
        cidrs: ['192.0.2.0/24'], country: 'AU', networkType: 'DIRECT ALLOCATION', entitiesByRole: {},
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
  await expect(rdapSection.getByText('Domain', { exact: true })).toHaveCount(0);
});
