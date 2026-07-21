import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow } from './helpers';
import { readFile } from 'node:fs/promises';

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
          lifecycle: { databaseUpdatedDate: '2026-07-13T03:04:05.000Z' },
          serverTruncated: true,
          serverTruncationReasons: ['object truncated due to authorization'],
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
  await expect(rdapSection.getByText(/Server-declared partial response/)).toBeVisible();
  await expect(rdapSection.getByText(/object truncated due to authorization/)).toBeVisible();
  await expect(rdapSection.locator('time[datetime="2026-07-13T03:04:05.000Z"]')).toBeVisible();
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

test('deep Lookup presents registrar RDAP as a separate collapsed source', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'registrar-source.example', type: 'domain', registrableDomain: 'registrar-source.example',
      availability: { state: 'registered', confidence: 'high', domain: 'registrar-source.example' },
      rdap: {
        upstreamStatus: 200,
        rdapServer: 'https://registry.example/domain/registrar-source.example',
        parsed: {
          domain: 'REGISTRAR-SOURCE.EXAMPLE', handle: 'registry-object-handle',
          registrar: { name: 'Example Registrar' }, registrarIanaId: '999',
          lifecycle: { createdDate: '2025-01-01T00:00:00Z', expiryDate: '2030-01-01T00:00:00Z' },
          dnssec: 'signed', statuses: ['clientTransferProhibited'],
          nameservers: ['NS2.REGISTRAR-SOURCE.EXAMPLE.', 'ns1.registrar-source.example'], entitiesByRole: {},
        },
        registrarRdap: {
          status: 'success', detail: null,
          endpoint: 'https://registrar.example/very/long/path/domain/registrar-source.example',
          transportSecurity: 'https', upstreamStatus: 200, fetchedAt: '2026-07-14T01:02:03.000Z',
          parsed: {
            objectClassName: 'domain', domain: 'registrar-source.example', handle: 'registrar-object-handle',
            registrar: { name: 'EXAMPLE REGISTRAR' }, registrarIanaId: '999',
            lifecycle: { createdDate: '2025-01-01', expiryDate: '2031-01-01' },
            dnssec: 'secure', statuses: ['transfer prohibited'],
            nameservers: ['NS1.REGISTRAR-SOURCE.EXAMPLE.', 'ns2.registrar-source.example'],
            entitiesByRole: {
              abuse: [{ name: 'Registrar abuse desk', organizations: [], emails: ['abuse@registrar.example'], phones: [], addresses: [], publicIds: [], links: [] }],
            },
          },
        },
      },
      whois: { parsed: {}, chain: [] },
      diagnostics: {
        version: 4,
        rdap: { status: 'success', registrar: { status: 'success' } },
        whois: { status: 'partial' }, availability: { status: 'complete' },
      },
    }),
  }));

  await page.locator('#query').fill('registrar-source.example');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const section = page.locator('details.registrar-rdap');
  await expect(section).not.toHaveAttribute('open', '');
  const summary = section.locator(':scope > summary');
  await expect(summary).toHaveText('Registrar RDAP · success');
  await summary.focus();
  await summary.press('Enter');
  await expect(section).toHaveAttribute('open', '');
  await expect(section.getByText(/Published by the sponsoring registrar's RDAP service, not the registry/)).toBeVisible();
  const comparison = section.locator('.publication-comparison');
  await expect(comparison.getByText(/1 conflicts · 0 source-only · 0 redacted · 0 unavailable\/incomplete · 7 equivalent/)).toBeVisible();
  await expect(comparison.getByText(/difference can reflect update timing or disclosure policy/)).toBeVisible();
  await expect(comparison.getByRole('row', { name: /Expires/ })).toContainText('2030-01-01T00:00:00Z');
  await expect(comparison.getByRole('row', { name: /Expires/ })).toContainText('2031-01-01');
  await expect(comparison.getByRole('row', { name: /Expires/ })).toContainText('Conflict');
  await expect(comparison.getByRole('row', { name: /Statuses/ })).toContainText('Equivalent');
  await expect(comparison.getByText('Registry object ID', { exact: true })).toHaveCount(0);
  await expect(section.getByText('REGISTRAR-SOURCE.EXAMPLE', { exact: true })).toBeVisible();
  await section.getByText('Published contacts · 1 role').click();
  await expect(section.getByText('Email: abuse@registrar.example')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export evidence JSON' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, 'utf8'));
  expect(exported.schemaVersion).toBe(13);
  expect(exported.analysis.registrarPublicationComparison.counts.conflict).toBe(1);
  expect(exported.analysis.registrarPublicationComparison.counts.equivalent).toBe(7);
  expect(JSON.stringify(exported)).not.toContain('registrar-object-handle');
  expect(JSON.stringify(exported)).not.toContain('abuse@registrar.example');

  await page.setViewportSize({ width: 360, height: 780 });
  await expectNoHorizontalOverflow(page);
});

test('registrar RDAP unsupported and error states remain neutral source rows', async ({ page }) => {
  for (const state of [
    { status: 'unsupported', detail: 'The registry did not publish a registrar RDAP link for this domain.' },
    { status: 'error', detail: 'The registrar RDAP request failed.' },
  ]) {
    await page.route('**/api/lookup?*', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: `${state.status}.example`, type: 'domain', registrableDomain: `${state.status}.example`,
        availability: { state: 'registered', confidence: 'high', domain: `${state.status}.example` },
        rdap: {
          upstreamStatus: 200, parsed: { domain: `${state.status}.example`, entitiesByRole: {} },
          registrarRdap: { ...state, endpoint: null, upstreamStatus: null, fetchedAt: null },
        },
        whois: { parsed: {}, chain: [] },
        diagnostics: { version: 4, rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
      }),
    }));
    await page.locator('#query').fill(`${state.status}.example`);
    await page.getByRole('button', { name: 'Run lookup' }).click();
    await expect(page.getByRole('heading', { name: `${state.status}.example`, exact: true })).toBeVisible();
    const section = page.locator('details.registrar-rdap');
    await section.locator(':scope > summary').click();
    await expect(section.getByText(state.detail, { exact: true })).toBeVisible();
    await page.unroute('**/api/lookup?*');
  }
});

test('registry access constraints remain neutral, explicit, and mobile-safe', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    const suffix = query.endsWith('.vn') ? 'vn' : query.endsWith('.ch') ? 'ch' : 'es';
    const isEs = suffix === 'es';
    const isCh = suffix === 'ch';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: `example.${suffix}`, type: 'domain', registrableDomain: `example.${suffix}`,
        availability: { state: 'unknown', confidence: 'low', domain: `example.${suffix}`, detail: 'Registry sources were inconclusive.' },
        rdap: { error: 'No RDAP registry found for this query via IANA bootstrap' },
        whois: { parsed: {}, chain: [] },
        diagnostics: {
          version: 5,
          registryAccess: {
            suffix, coverageState: 'access_documented',
            whoisAccessProfile: isEs
              ? 'source-ip-authorization-required'
              : isCh ? 'registry-policy-restricted' : 'no-iana-service',
            rdapAccessProfile: 'no-iana-service', authority: 'context_only',
            limitation: isEs
              ? 'The registry WHOIS service requires advance source-IP authorization. A failed or unavailable query is not evidence that the domain is unregistered.'
              : isCh
                ? 'The registry may restrict ordinary port-43 clients and direct them to its official lookup. Its non-standard-port Domain Check is not integrated, and IANA publishes no RDAP service. Missing registry data is not evidence that the domain is unregistered.'
                : 'IANA publishes no domain WHOIS or RDAP service for this suffix. The official browser lookup is not integrated, and missing registry data is not evidence that the domain is unregistered.',
          },
          rdap: { status: 'unsupported' }, whois: { status: 'partial' }, availability: { status: 'complete' },
        },
      }),
    });
  });

  await page.locator('#query').fill('example.es');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const notice = page.getByRole('region', { name: '.ES collection constraints' });
  await expect(notice.getByText('Restricted access')).toBeVisible();
  await expect(notice.getByText('Source-IP authorization required')).toBeVisible();
  await expect(notice.getByText(/does not decide registration, availability, safety, or maliciousness/i)).toBeVisible();

  await page.locator('#query').fill('example.ch');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const chNotice = page.getByRole('region', { name: '.CH collection constraints' });
  await expect(chNotice.getByText('Restricted access')).toBeVisible();
  await expect(chNotice.getByText('Registry policy restricted')).toBeVisible();
  await expect(chNotice.getByText('No service published by IANA')).toBeVisible();

  await page.locator('#query').fill('example.vn');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const vnNotice = page.getByRole('region', { name: '.VN collection constraints' });
  await expect(vnNotice.getByText('Service not published')).toBeVisible();
  await expect(vnNotice.getByText('No service published by IANA')).toHaveCount(2);
  await expect(vnNotice.getByText(/official browser lookup is not integrated/i)).toBeVisible();

  await page.setViewportSize({ width: 360, height: 780 });
  await expectNoHorizontalOverflow(page);
});

test('optional external intelligence searches are explicit, attributed, and mobile-safe', async ({ page }) => {
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      runtime: 'express',
      authoritative: true,
      features: [
        { id: 'lookup', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
        { id: 'urlscan_search', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
        { id: 'urlhaus_host', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
        { id: 'threatfox_domain_ioc', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
      ],
      controls: null,
      limitations: [],
    }),
  }));
  await page.reload();
  await page.route('**/api/lookup?*', async (route) => {
    const requested = new URL(route.request().url());
    expect(requested.searchParams.get('intelligence')).toBe('1');
    expect(requested.searchParams.get('malware')).toBe('1');
    expect(requested.searchParams.get('ioc')).toBe('1');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'archive-review.example', type: 'domain', registrableDomain: 'archive-review.example',
        availability: { state: 'registered', confidence: 'high', domain: 'archive-review.example' },
        rdap: { parsed: {} }, whois: { parsed: {}, chain: [] },
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
        threatIntelligence: {
          version: 1,
          providers: [{
            provider: { id: 'urlscan_search', label: 'Fixture archived verdicts' },
            target: { type: 'domain', value: 'archive-review.example', exposure: 'registrable_domain' },
            state: 'success', detail: 'Found one archived malicious-verdict match.',
            findings: [{
              id: '11111111-1111-4111-8111-111111111111', category: 'phishing',
              providerVerdict: 'malicious verdict match', detail: 'Archived scan page title: Fixture sign-in',
              lastObservedAt: '2026-07-14T01:02:03.000Z',
              referenceUrl: 'https://provider.invalid/result/11111111-1111-4111-8111-111111111111/',
            }],
            observation: {
              observedAt: '2026-07-15T01:02:03.000Z',
              limitations: ['No matching provider record is not evidence that the target is safe.'],
            },
          }, {
            provider: { id: 'urlhaus_host', label: 'Fixture malware-host records' },
            target: { type: 'domain', value: 'archive-review.example', exposure: 'registrable_domain' },
            state: 'success', detail: 'Found one bounded malware-distribution record.',
            findings: [{
              id: '123456', category: 'malware',
              providerVerdict: 'malware distribution · online',
              detail: 'The provider labels an archived malware-distribution URL on this host as online.',
              lastObservedAt: '2026-07-13T01:02:03.000Z',
              referenceUrl: 'https://provider.invalid/result/123456/',
            }],
            observation: {
              observedAt: '2026-07-15T01:02:03.000Z',
              limitations: ['A listed host may have been compromised or cleaned.'],
            },
          }, {
            provider: { id: 'threatfox_domain_ioc', label: 'Fixture malware-IOC records' },
            target: { type: 'domain', value: 'archive-review.example', exposure: 'registrable_domain' },
            state: 'success', detail: 'Found one retained malware-IOC record.',
            findings: [{
              id: '654321', category: 'malware',
              providerVerdict: 'Botnet command and control · Fixture family',
              detail: 'The provider associates this domain with botnet command and control.',
              lastObservedAt: '2026-07-12T01:02:03.000Z',
              referenceUrl: 'https://provider.invalid/result/654321/',
            }],
            observation: {
              observedAt: '2026-07-15T01:02:03.000Z',
              limitations: ['The provider retains malware-associated indicators for a limited period.'],
            },
          }],
        },
      }),
    });
  });

  const option = page.getByRole('checkbox', { name: /Search archived URLscan verdicts/ });
  const malwareOption = page.getByRole('checkbox', { name: /Search malware-distribution records/ });
  const iocOption = page.getByRole('checkbox', { name: /Search malware infrastructure records/ });
  await expect(option).toBeVisible();
  await expect(malwareOption).toBeVisible();
  await expect(iocOption).toBeVisible();
  await expect(page.getByText(/does not submit the domain for scanning/i)).toBeVisible();
  await expect(page.getByText(/does not submit a URL or sample/i)).toBeVisible();
  await expect(page.getByText(/does not submit an IOC, URL, or sample/i)).toBeVisible();
  await option.check();
  await malwareOption.check();
  await iocOption.check();
  await page.locator('#query').fill('archive-review.example');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const section = page.locator('.threat-intelligence');
  await expect(section.getByRole('heading', { name: 'Archived provider verdicts' })).toBeVisible();
  await expect(section.getByText('Fixture archived verdicts', { exact: true })).toBeVisible();
  await expect(section.getByText('Fixture malware-host records', { exact: true })).toBeVisible();
  await expect(section.getByText('Fixture malware-IOC records', { exact: true })).toBeVisible();
  await expect(section.getByText(/never affect availability/i)).toBeVisible();
  await expect(section.getByText(/2 independent publisher families contributed \+18 under model v5/i)).toBeVisible();
  await page.getByText('Why the risk score is 28', { exact: true }).click();
  await expect(page.getByText('Corroborated recent external phishing/malware records')).toBeVisible();
  await expect(section.getByText('phishing', { exact: true })).toBeVisible();
  await expect(section.getByText('malware', { exact: true })).toHaveCount(2);
  for (const link of await section.getByRole('link', { name: 'View attributed provider record' }).all()) {
    await expect(link).toHaveAttribute('rel', 'noopener');
  }

  await page.setViewportSize({ width: 360, height: 780 });
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
  await expect(card.getByText('tr39-17.0-curated-ascii-v2', { exact: true })).toBeVisible();
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
  await page.evaluate(() => {
    const observedAt = '2026-07-12T00:00:00.000Z';
    const profile = {
      id: 'comparison-profile', name: 'Comparison profile', officialDomains: ['official.example'], productNames: [], tlds: [],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [], trademarkOwner: '', trademarkRegistration: '',
      officialFaviconHash: '', officialFaviconPHash: '', createdAt: observedAt, updatedAt: observedAt,
      pageBaseline: {
        baselineVersion: 1, domain: 'official.example', lookupDomain: 'official.example', observedAt,
        pageIdentityVersion: 3, fingerprintVersion: 1, pageTitle: 'Official account centre', canonicalHost: 'official.example',
        faviconHash: null, faviconPHash: null,
        normalizedHtml: { algorithm: 'sha256', value: 'b'.repeat(64), tokenCount: 40, truncated: false },
        visibleText: { algorithm: 'simhash64-v1', value: 'c'.repeat(16), tokenCount: 16, featureCount: 14, truncated: false },
        domStructure: { algorithm: 'sha256', value: '9'.repeat(64), nodeCount: 28, parser: 'static-tag-sequence-v1', truncated: false },
        formStructure: { algorithm: 'sha256', value: 'e'.repeat(64), formCount: 2, controlCount: 5, truncated: false },
        resourceHosts: { algorithm: 'set-sha256', value: '8'.repeat(64), values: ['assets.example', 'cdn.example'], truncated: false },
        trackingIdentifiers: { algorithm: 'set-sha256', value: '1'.repeat(64), values: [{ type: 'tag-container', value: 'GTM-AB12' }], truncated: false },
        complete: true, truncated: false,
      },
    };
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify([profile]));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', profile.id);
  });
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
            bodyHash: { algorithm: 'sha256', value: 'a'.repeat(64), scope: 'complete-body', bytes: 2048 },
            securityHeaders: { strictTransportSecurity: 'max-age=31536000', contentSecurityPolicy: "default-src 'self'", xFrameOptions: 'DENY', xContentTypeOptions: 'nosniff', referrerPolicy: 'no-referrer' },
          },
        },
        pageIdentity: {
          identityVersion: 3, version: 1, status: 'partial', observedAt: '2026-07-13T00:00:00.000Z', scanMode: 'deep', source: 'html',
          durationMs: null, complete: false, truncated: true,
          limitations: ['Static HTML metadata only; JavaScript-rendered changes are not evaluated.', 'Query strings and fragments were omitted from retained page-identity URLs.'],
          diagnostics: { tagsExamined: 8, discardedUrls: 1, formsObserved: 2 },
          documentLanguage: 'en',
          canonical: { url: 'https://login.example.test/account', queryOmitted: true, pathTruncated: false },
          metaRefresh: null,
          openGraph: { title: 'Account centre', siteName: 'Example portal', url: { url: 'https://login.example.test/', queryOmitted: false, pathTruncated: false } },
          generator: 'Example CMS',
          forms: { count: 2, postCount: 1, insecureActionCount: 1, externalActionOrigins: ['https://collect.example'], truncated: false },
          resources: { count: 4, byType: { image: 1, script: 1, stylesheet: 1, link: 0, frame: 1, media: 0, object: 0 }, externalOrigins: ['https://assets.example'], truncated: false },
          embeddedOrigins: ['https://frame.example'],
          contactDomains: ['support.example'],
          downloads: { count: 1, explicitCount: 0, riskyCount: 1, externalOrigins: ['https://files.example'], riskyFileTypes: ['zip'], truncated: false },
          trackingIdentifiers: [{ type: 'tag-container', value: 'GTM-AB12' }],
          fingerprints: {
            fingerprintVersion: 1,
            exact: { algorithm: 'sha256', value: 'a'.repeat(64), scope: 'complete-body', bytes: 2048, source: 'captured-response-bytes' },
            normalizedHtml: { algorithm: 'sha256', value: 'b'.repeat(64), tokenCount: 42, truncated: false },
            visibleText: { algorithm: 'simhash64-v1', value: 'c'.repeat(16), tokenCount: 18, featureCount: 16, truncated: false },
            domStructure: { algorithm: 'sha256', value: 'd'.repeat(64), nodeCount: 30, parser: 'static-tag-sequence-v1', truncated: false },
            formStructure: { algorithm: 'sha256', value: 'e'.repeat(64), formCount: 2, controlCount: 5, truncated: false },
            resourceHosts: { algorithm: 'set-sha256', value: 'f'.repeat(64), values: ['assets.example'], truncated: false },
            identifiers: { algorithm: 'set-sha256', value: '1'.repeat(64), values: [{ type: 'tag-container', value: 'GTM-AB12' }], truncated: false },
            complete: true, truncated: false, limitations: [],
          },
        },
        technologyProfile: {
          profileVersion: 1, version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
          scanMode: 'deep', source: 'derived', durationMs: null, complete: true, truncated: false,
          limitations: ['Curated signature matching is selective; an unmatched technology may still be present.'],
          diagnostics: { findings: 2, htmlEvaluated: true, generatorEvaluated: true, serverEvaluated: true, resourceOriginsEvaluated: 1 },
          findings: [
            { id: 'fixture-cms', name: 'Fixture CMS', category: 'content management', confidence: 'high', evidence: [{ source: 'generator metadata', description: 'Generator metadata identifies the fixture CMS.' }] },
            { id: 'fixture-edge', name: 'Fixture Edge', category: 'delivery platform', confidence: 'medium', evidence: [{ source: 'resource origin', description: 'A retained resource origin uses fixture delivery infrastructure.' }] },
          ],
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
  await card.getByText('Selected response metadata', { exact: true }).click();
  await expect(card.getByText('max-age=31536000', { exact: true })).toBeVisible();
  await expect(card.getByText('a'.repeat(64), { exact: true })).toBeVisible();
  await expect(card.getByText('Complete captured body (2.0 KiB)', { exact: true })).toBeVisible();
  await expect(card).not.toContainText('secret');
  await expect(card.getByText(/missing security headers do not establish maliciousness/i)).toBeVisible();

  const pageCard = page.locator('.page-card');
  await expect(pageCard.getByRole('heading', { name: 'Page identity' })).toBeVisible();
  await expect(pageCard.getByText('https://login.example.test/account', { exact: true })).toBeVisible();
  await expect(pageCard.getByText('Account centre', { exact: true })).toBeVisible();
  await expect(pageCard.getByText('Example portal', { exact: true })).toBeVisible();
  await expect(pageCard.locator('article').filter({ hasText: 'POST forms' }).getByText('1', { exact: true })).toBeVisible();
  await expect(pageCard.locator('article').filter({ hasText: 'External resources' }).getByText('1', { exact: true })).toBeVisible();
  await expect(pageCard.locator('article').filter({ hasText: 'Tracking identifiers' }).getByText('1', { exact: true })).toBeVisible();
  await pageCard.getByText('External form destinations · 1', { exact: true }).click();
  await expect(pageCard.getByText('https://collect.example', { exact: true })).toBeVisible();
  await pageCard.getByText('Resource summary · 4', { exact: true }).click();
  await expect(pageCard.getByText('https://assets.example', { exact: true })).toBeVisible();
  await pageCard.getByText('Embedded origins · 1', { exact: true }).click();
  await expect(pageCard.getByText('https://frame.example', { exact: true })).toBeVisible();
  await pageCard.getByText('Contact domains · 1', { exact: true }).click();
  await expect(pageCard.getByText('support.example', { exact: true })).toBeVisible();
  await pageCard.getByText('Download context · 1', { exact: true }).click();
  await expect(pageCard.getByText('https://files.example', { exact: true })).toBeVisible();
  await pageCard.getByText('Tracking identifiers · 1', { exact: true }).click();
  await expect(pageCard.getByText('GTM-AB12', { exact: true })).toBeVisible();
  await expect(pageCard.locator('article').filter({ hasText: 'Page fingerprints' }).getByText('7', { exact: true })).toBeVisible();
  await pageCard.getByText('Page fingerprints · 7', { exact: true }).click();
  await expect(pageCard.getByText('b'.repeat(64), { exact: true })).toBeVisible();
  await expect(pageCard.getByText('c'.repeat(16), { exact: true })).toBeVisible();
  await expect(pageCard.getByText(/visible-text SimHash is fuzzy comparison data/i)).toBeVisible();
  await expect(pageCard).not.toContainText('secret');
  await expect(pageCard.getByText(/normalized markup, and visible text are not retained/i)).toBeVisible();

  const technologyCard = page.locator('.technology-card');
  await expect(technologyCard.getByRole('heading', { name: 'Technology indicators' })).toBeVisible();
  await expect(technologyCard.getByRole('heading', { name: 'Fixture CMS' })).toBeVisible();
  await expect(technologyCard.getByText('high confidence', { exact: true })).toBeVisible();
  await expect(technologyCard.getByText('Generator metadata identifies the fixture CMS.', { exact: true })).toBeVisible();
  await expect(technologyCard.getByRole('heading', { name: 'Fixture Edge' })).toBeVisible();
  await expect(technologyCard.getByText(/make no additional request and do not affect availability or Risk scoring/i)).toBeVisible();

  const pageComparison = page.locator('.page-comparison');
  await expect(pageComparison.getByRole('heading', { name: 'Official-site comparison' })).toBeVisible();
  await expect(pageComparison.getByText('official.example', { exact: true })).toBeVisible();
  await expect(pageComparison.locator('article').filter({ hasText: 'Normalized HTML' }).getByText('Same captured digest', { exact: true })).toBeVisible();
  await expect(pageComparison.locator('article').filter({ hasText: 'Visible text' }).getByText('100% bit agreement', { exact: true })).toBeVisible();
  await expect(pageComparison.locator('article').filter({ hasText: 'DOM structure' }).getByText('Different captured digest', { exact: true })).toBeVisible();
  await expect(pageComparison.locator('article').filter({ hasText: 'External resource hosts' }).getByText('1 host shared', { exact: true })).toBeVisible();
  await expect(pageComparison.getByText('Shared: assets.example', { exact: true })).toBeVisible();
  await expect(pageComparison.getByText(/does not combine these observations into a page-similarity score or use them to change the Risk score/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('TLS intelligence presents one-connection certificate evidence without narrow-width overflow', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'tls-evidence.test', type: 'domain', registrableDomain: 'tls-evidence.test',
      availability: {
        state: 'registered', confidence: 'high', domain: 'tls-evidence.test',
        tls: {
          version: 1, profileVersion: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
          scanMode: 'deep', source: 'tls', durationMs: 42, complete: true, truncated: false,
          limitations: ['This is a point-in-time TLS handshake to one validated public address.'],
          connectedAddress: '93.184.216.34', connectedFamily: 4, port: 443, sniHost: 'tls-evidence.test',
          protocol: 'TLSv1.3', alpnProtocol: 'h2',
          cipher: { name: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
          ephemeralKey: { type: 'ECDH', name: 'X25519', size: 253 },
          authorization: { authorized: false, error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
          hostname: { matches: true, error: null }, validity: { status: 'valid' },
          certificate: {
            subject: { commonNames: ['tls-evidence.test'], organizations: ['Example service'], organizationalUnits: [], countries: [], localities: [], states: [] },
            issuer: { commonNames: ['Example issuing CA'], organizations: ['Example CA'], organizationalUnits: [], countries: [], localities: [], states: [] },
            serialNumber: 'a1b2c3', validFrom: '2026-07-01T00:00:00.000Z', validTo: '2026-08-01T00:00:00.000Z',
            fingerprintSha256: 'a'.repeat(64), isCertificateAuthority: false,
            subjectAltNames: { dnsNames: ['*.example.test', 'tls-evidence.test'], ipAddresses: [], truncated: false },
            publicKey: { type: 'rsa', bits: 2048, curve: null, fingerprintSha256: 'b'.repeat(64) },
          },
          chain: [{
            subject: { commonNames: ['tls-evidence.test'], organizations: ['Example service'] },
            issuer: { commonNames: ['Example issuing CA'], organizations: ['Example CA'] },
            serialNumber: 'a1b2c3', validFrom: '2026-07-01T00:00:00.000Z', validTo: '2026-08-01T00:00:00.000Z',
            fingerprintSha256: 'a'.repeat(64), isCertificateAuthority: false,
          }],
          chainTruncated: false,
          findings: [
            { id: 'certificate_unauthorized', tone: 'warning', label: 'Certificate not authorized', detail: 'The runtime trust store did not authorize the observed chain.' },
            { id: 'wildcard_certificate', tone: 'neutral', label: 'Wildcard certificate', detail: 'Wildcard use is common.' },
          ],
        },
      },
      rdap: { upstreamStatus: 200, parsed: {} }, whois: { parsed: {}, chain: [] },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
    }),
  }));

  await page.locator('#query').fill('tls-evidence.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  const card = page.locator('.tls-card');
  await expect(card.getByRole('heading', { name: 'TLS and certificate intelligence' })).toBeVisible();
  await expect(card.getByText('93.184.216.34', { exact: true })).toBeVisible();
  await expect(card.getByText('TLSv1.3', { exact: true })).toBeVisible();
  await expect(card.getByText('Not authorized', { exact: true })).toBeVisible();
  await expect(card.getByText('Certificate not authorized', { exact: true })).toBeVisible();
  const leafCertificate = card.locator('.tls-detail').nth(0);
  await leafCertificate.locator('summary').click();
  await expect(leafCertificate.getByText('a'.repeat(64), { exact: true })).toBeVisible();
  await card.locator('.tls-detail').nth(1).locator('summary').click();
  await expect(card.getByText('*.example.test', { exact: true })).toBeVisible();
  await card.locator('.tls-detail').last().locator('summary').click();
  await expect(card.getByText('UNABLE_TO_VERIFY_LEAF_SIGNATURE', { exact: true })).toBeVisible();
  await expect(card.getByText(/one connection to one validated public address/i)).toBeVisible();

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
