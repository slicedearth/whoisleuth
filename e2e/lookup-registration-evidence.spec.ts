import { expect, test } from './fixtures';
import { expandLookupFamilies, expectNoHorizontalOverflow, lookupDomainIdentity, migrateLegacyBrowserData, readBrowserLocalCollection } from './helpers';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/evidence-export';
import {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_SCHEMA,
} from '../lib/threat-intelligence-types.mts';

const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

// Every value here is deliberately dotless (no TLD), so classifyQuery on the
// server rejects it with a 400 before any RDAP/WHOIS/DNS call - these tests
// never trigger a live lookup, only client-side parsing/navigation.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('whoisleuth:lookup-presentation:v1', JSON.stringify({
      version: 1,
      density: 'standard',
      task: 'general',
    }));
  });
  await page.goto('/lookup');
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
  await expandLookupFamilies(page);
  const rdapSection = page.locator('.sources > details').first();
  await expect(rdapSection).not.toHaveAttribute('open', '');
  const publishedContacts = rdapSection.getByText('Published contacts · 2 roles', { exact: true });
  await expect(publishedContacts).toHaveCount(1);
  await expect(publishedContacts).toBeHidden();
  await rdapSection.locator(':scope > summary').click();
  await expect(rdapSection).toHaveAttribute('open', '');
  await expect(publishedContacts).toBeVisible();
  const contactInventory = rdapSection.locator('details.contact-inventory');
  const contactSummary = contactInventory.locator(':scope > summary');
  await expect(contactSummary).toBeVisible();
  await contactSummary.dispatchEvent('click');
  await expect(contactInventory).toHaveAttribute('open', '');
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
  await page.locator('details.detailed-assessment > summary').click();
  const capsule = page.locator('details.capsule');
  await expect(capsule.getByText('Portable investigation capsule')).toBeVisible();
  await capsule.locator(':scope > summary').click();
  await expect(capsule.getByRole('button', { name: 'Download capsule' })).toBeEnabled();
  await expect(capsule.getByRole('checkbox')).toBeDisabled();
  const capsuleDownloadPromise = page.waitForEvent('download');
  await capsule.getByRole('button', { name: 'Download capsule' }).click();
  const capsuleDownload = await capsuleDownloadPromise;
  const capsulePath = await capsuleDownload.path();
  expect(capsulePath).not.toBeNull();
  const capsuleArtifact = JSON.parse(await readFile(capsulePath!, 'utf8'));
  expect(capsuleArtifact.schemaVersion).toBe(3);
  expect(capsuleArtifact.investigationBrief.schemaVersion).toBe(2);
  expect(capsuleArtifact.sourceContracts.find((item: { id: string }) => item.id === 'investigation-brief')?.version).toBe(2);
  const capsuleFacts = capsuleArtifact.investigationBrief.decisionFacts;
  expect(capsuleFacts.total).toBe(capsuleFacts.displayed + capsuleFacts.omitted);
  expect(capsuleFacts.facts).toHaveLength(capsuleFacts.displayed);
  expect(capsuleFacts.total).toBeGreaterThan(0);
  expect(capsuleArtifact.investigationBrief).not.toHaveProperty('verifiedFacts');
  const comparison = page.locator('.comparison');
  await expect(comparison.getByText(/0 source-only · 0 redacted · 4 unavailable\/incomplete/)).toBeVisible();
  await comparison.locator('summary').click();
  await expect(comparison.getByText('WHOIS incomplete').first()).toBeVisible();

  const disclosurePlanner = page.locator('details.disclosure-planner');
  await expect(disclosurePlanner).not.toHaveAttribute('open', '');
  await disclosurePlanner.locator(':scope > summary').click();
  await expect(disclosurePlanner.getByText(/1 structured redaction declaration observed/)).toBeVisible();
  await expect(disclosurePlanner.getByRole('button', { name: 'Export review packet' })).toBeDisabled();
  await disclosurePlanner.getByLabel('Request purpose').selectOption('cybersecurity-investigation');
  await disclosurePlanner.getByLabel('Analyst justification').fill('The selected contact is necessary to review a documented domain impersonation incident.');
  await disclosurePlanner.getByLabel('Registrant email').check();
  await disclosurePlanner.getByLabel(/Available public registration evidence/).check();
  await disclosurePlanner.getByLabel(/Every requested field is necessary/).check();
  await disclosurePlanner.getByLabel(/Privacy and rights impacts/).check();
  await disclosurePlanner.getByLabel(/Current service instructions/).check();
  await disclosurePlanner.getByLabel(/current nonpublic gTLD service scope/).check();
  await disclosurePlanner.getByLabel(/Current registrar participation/).check();
  await disclosurePlanner.getByLabel(/Requester identity, authority/).check();
  await expect(disclosurePlanner.getByText('review cautions')).toBeVisible();
  await expect(disclosurePlanner.getByRole('button', { name: 'Export review packet' })).toBeEnabled();
  await expect(disclosurePlanner.getByRole('link', { name: 'Review current service information' })).toHaveAttribute('href', 'https://www.icann.org/rdrs-en/');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('deep Lookup presents registrar and observed network RDAP as separate sources', async ({ page }) => {
  test.slow();
  const lookupOrigin = new URL(page.url()).origin;
  const thirdPartyRequests: string[] = [];
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== lookupOrigin && !['data:', 'blob:'].includes(requestUrl.protocol)) {
      thirdPartyRequests.push(request.url());
    }
  });
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'registrar-source.example', type: 'domain', registrableDomain: 'registrar-source.example',
      availability: { state: 'registered', confidence: 'high', domain: 'registrar-source.example' },
      networkContext: {
        contextVersion: 1, version: 1, status: 'success', observedAt: '2026-07-14T01:02:04.000Z',
        scanMode: 'deep', source: 'ip_rdap', durationMs: 22, complete: true, truncated: false,
        limitations: ['The selected address may represent shared edge infrastructure.'],
        diagnostics: { requestCount: 1, addressSource: 'tls_connection', httpStatus: 200, cidrCount: 1 },
        detail: 'The selected public endpoint address was mapped to its separately attributed IP RDAP registration.',
        endpoint: { address: '93.184.216.34', family: 4, selectedFrom: 'tls_connection' },
        rdap: {
          endpoint: 'https://network.example/rdap/ip/93.184.216.34/with-a-deliberately-long-provenance-segment-for-wrapping',
          transportSecurity: 'https', httpStatus: 200, fetchedAt: '2026-07-14T01:02:04.000Z',
          attempts: [],
        },
        network: {
          handle: 'NET-EXAMPLE', name: 'Example edge network', holder: 'Example network holder',
          cidrs: ['93.184.216.0/24'], startAddress: '93.184.216.0', endAddress: '93.184.216.255',
          country: 'AU', networkType: 'ALLOCATED', databaseUpdatedAt: '2026-07-13T00:00:00.000Z',
        },
        abuseRouting: [{
          kind: 'network_hosting', channel: 'email', contact: 'abuse@network.example',
          source: 'IP RDAP abuse entity',
          rdapEndpoint: 'https://network.example/rdap/ip/93.184.216.34/',
          observedAt: '2026-07-14T01:02:04.000Z',
          selectedAddress: '93.184.216.34', selectedFrom: 'tls_connection',
          complete: true, truncated: false,
          limitations: [
            'The route is published for the registered network of one observed endpoint address.',
            'Network registration does not prove hosting responsibility.',
          ],
        }],
      },
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
        version: 7,
        rdap: { status: 'success', registrar: { status: 'success' } },
        whois: { status: 'partial' }, availability: { status: 'complete' },
      },
    }),
  }));

  await page.locator('#query').fill('registrar-source.example');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);

  const evidenceQuality = page.locator('#evidence-quality');
  await evidenceQuality.locator(':scope > details').first().locator(':scope > summary').click();
  await expect(evidenceQuality).not.toContainText('Observation time unavailable');

  const agreementMatrix = page.locator('.agreement-matrix');
  await expect(agreementMatrix.locator('title').filter({
    hasText: 'Registry object ID, Registry RDAP ↔ WHOIS, Registry RDAP: source state value',
  })).toHaveCount(1);
  await expect(agreementMatrix.locator('title').filter({
    hasText: 'Registry object ID, Registry RDAP ↔ WHOIS, WHOIS: source state incomplete',
  })).toHaveCount(1);
  await expect(agreementMatrix.locator('title').filter({
    hasText: 'Registry object ID, Registry RDAP ↔ Registrar RDAP',
  })).toHaveCount(0);
  const exactAgreement = agreementMatrix.getByRole('table', { name: 'Exact pairwise registration publication comparisons' });
  await expect(exactAgreement.getByRole('row', { name: /Registry object ID Registry RDAP ↔ WHOIS/u })).toContainText('Source state value');
  await expect(exactAgreement.getByRole('row', { name: /Registry object ID Registry RDAP ↔ WHOIS/u })).toContainText('Source state incomplete');
  await expect(agreementMatrix.locator('title').filter({ hasText: 'Expires, Registry RDAP ↔ WHOIS' })).toHaveCount(2);
  await expect(agreementMatrix.locator('title').filter({ hasText: 'Expires, Registry RDAP ↔ Registrar RDAP' })).toHaveCount(2);
  const whoisExpiryLane = exactAgreement.getByRole('row', { name: /Expires Registry RDAP ↔ WHOIS/u });
  const registrarExpiryLane = exactAgreement.getByRole('row', { name: /Expires Registry RDAP ↔ Registrar RDAP/u });
  await expect(whoisExpiryLane).toContainText('2030-01-01T00:00:00Z');
  await expect(whoisExpiryLane).toContainText('Not observed (partial source)');
  await expect(whoisExpiryLane.getByText('value', { exact: true })).toHaveCount(1);
  await expect(whoisExpiryLane.getByText('incomplete', { exact: true })).toHaveCount(1);
  await expect(registrarExpiryLane).toContainText('2030-01-01T00:00:00Z');
  await expect(registrarExpiryLane).toContainText('2031-01-01');
  await expect(registrarExpiryLane.getByText('value', { exact: true })).toHaveCount(2);
  await expect(registrarExpiryLane.getByText('conflict', { exact: true })).toHaveCount(1);
  const observedPlotMarker = agreementMatrix.locator('.agreement-node.state-observed rect').first();
  await expect(observedPlotMarker).toBeVisible();
  const observedLegendMarker = agreementMatrix.locator('.matrix-legend .state-observed span');
  await expect(observedLegendMarker).toBeVisible();
  expect(await observedLegendMarker.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('3px');

  await page.getByRole('tab', { name: /^Relationships/ }).click();
  const analystPivots = page.locator('details.analyst-pivots');
  await expect(analystPivots).not.toHaveAttribute('open', '');
  await expect(analystPivots.getByText('External evidence pivots', { exact: true })).toBeVisible();
  await expect(analystPivots.getByText('Compare registration data', { exact: true })).toBeHidden();
  await analystPivots.locator(':scope > summary').click();
  await expect(analystPivots.getByText(/does not contact these destinations/i)).toBeVisible();
  await expect(analystPivots.getByRole('link', { name: /Open ICANN Lookup/u })).toHaveAttribute(
    'href',
    'https://lookup.icann.org/en/lookup?name=registrar-source.example',
  );
  await expect(analystPivots.getByRole('link', { name: /Open IANA Root Zone Database/u })).toHaveAttribute(
    'href',
    'https://www.iana.org/domains/root/db/example.html',
  );
  await expect(analystPivots.getByRole('link', { name: /Open RIPEstat/u })).toHaveAttribute(
    'href',
    'https://stat.ripe.net/app/launchpad/93.184.216.0%2F24',
  );
  const pivotLinks = await analystPivots.getByRole('link').all();
  expect(pivotLinks).toHaveLength(6);
  for (const link of pivotLinks) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  expect(thirdPartyRequests).toEqual([]);

  const section = page.locator('details.registrar-rdap');
  await expect(section).not.toHaveAttribute('open', '');
  const summary = section.locator(':scope > summary');
  await expect(summary.getByRole('heading', { name: 'Registrar RDAP' })).toBeVisible();
  await expect(summary.locator('.evidence-summary-detail')).toHaveText('Separately attributed sponsoring-registrar publication');
  await expect(summary.locator('.evidence-status')).toHaveText('success');
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

  const network = page.locator('.network-context');
  await expect(network).not.toHaveAttribute('open', '');
  await expect(network.getByRole('heading', { name: 'Observed network context' })).toBeVisible();
  await expect(network.getByText('93.184.216.34', { exact: true })).toBeHidden();
  await network.locator(':scope > summary').click();
  await expect(network.getByText('93.184.216.34', { exact: true })).toBeVisible();
  await expect(network.getByText('TLS connection', { exact: true })).toBeVisible();
  await expect(network.getByText('Example network holder', { exact: true })).toBeVisible();
  await expect(network.getByText('93.184.216.0/24', { exact: true })).toBeVisible();
  await expect(network.getByText(/does not prove hosting control, ownership, intent, or maliciousness/i)).toBeVisible();
  await network.getByText('IP RDAP source', { exact: true }).click();
  await expect(network.getByText(/deliberately-long-provenance-segment-for-wrapping/)).toBeVisible();
  const responseRoutes = page.locator('.response');
  await expect(responseRoutes.getByText('network hosting route', { exact: true })).toBeVisible();
  await expect(responseRoutes.getByText('abuse@network.example', { exact: true })).toBeVisible();
  await expect(responseRoutes.getByText(/does not prove hosting responsibility/i)).toBeVisible();
  await expect(responseRoutes.getByRole('button', { name: 'Record in case' })).toBeDisabled();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.export-menu > summary').click();
  await page.getByRole('button', { name: 'Export evidence JSON' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, 'utf8'));
  expect(exported.schemaVersion).toBe(LOOKUP_EVIDENCE_SCHEMA_VERSION);
  expect(exported.application).toEqual({
    name: 'WHOISleuth',
    version: packageVersion,
    projectUrl: 'https://github.com/slicedearth/whoisleuth',
  });
  expect(exported.analysis.registrarPublicationComparison.counts.conflict).toBe(1);
  expect(exported.analysis.registrarPublicationComparison.counts.equivalent).toBe(6);
  expect(exported.sources.network.endpoint.address).toBe('93.184.216.34');
  expect(exported.sources.network.network.holder).toBe('Example network holder');
  expect(JSON.stringify(exported)).not.toContain('registrar-object-handle');
  expect(JSON.stringify(exported)).not.toContain('abuse@registrar.example');
  expect(JSON.stringify(exported)).not.toContain('abuse@network.example');
  expect(JSON.stringify(exported)).not.toContain('stat.ripe.net');

  const reportDownloadPromise = page.waitForEvent('download');
  await page.locator('.export-menu > summary').click();
  await page.getByRole('button', { name: 'Download report' }).click();
  const reportDownload = await reportDownloadPromise;
  expect(reportDownload.suggestedFilename()).toMatch(
    /^whoisleuth-lookup-report-registrar-source\.example-.+\.md$/,
  );
  const reportPath = await reportDownload.path();
  expect(reportPath).not.toBeNull();
  const report = await readFile(reportPath!, 'utf8');
  expect(report).toContain('# Lookup evidence report');
  expect(report).toContain('### Registrar RDAP');
  expect(report).not.toContain('abuse@network.example');
  expect(report).toContain('## Registry / registrar RDAP comparison');
  expect(report).toContain('Example network holder');
  expect(report).toContain('Risk score:');
  expect(report).toContain('## Canonical Decision Facts');
  expect(report).toContain('whoisleuth\\.lookup\\-readable\\-report v3');
  expect(report).toMatch(/\*\*Fact counts:\*\* \d+ of \d+ included; \d+ omitted\./u);
  expect(report).toContain(`Generated with WHOISleuth ${packageVersion}`);

  const briefDownloadPromise = page.waitForEvent('download');
  await page.locator('.export-menu > summary').click();
  await page.getByRole('button', { name: 'Download brief' }).click();
  const briefDownload = await briefDownloadPromise;
  const briefPath = await briefDownload.path();
  expect(briefPath).not.toBeNull();
  const brief = await readFile(briefPath!, 'utf8');
  expect(brief).toContain('## Canonical Decision Facts');
  expect(brief).toMatch(/Displaying \d+ of \d+ canonical Decision Facts; \d+ omitted/u);
  expect(brief).toContain('**Fact ID:**');

  const reportWithoutFooterPromise = page.waitForEvent('download');
  await page.locator('.export-menu > summary').click();
  await page.getByLabel('Include generator footer').uncheck();
  await page.getByRole('button', { name: 'Download report' }).click();
  const reportWithoutFooter = await reportWithoutFooterPromise;
  const reportWithoutFooterPath = await reportWithoutFooter.path();
  expect(reportWithoutFooterPath).not.toBeNull();
  const reportWithoutFooterText = await readFile(reportWithoutFooterPath!, 'utf8');
  expect(reportWithoutFooterText).toContain(`**Generator:** WHOISleuth ${packageVersion.replaceAll('.', '\\.')}`);
  expect(reportWithoutFooterText).not.toContain('Generated with WHOISleuth');
  expect(reportWithoutFooterText).toContain('## Canonical Decision Facts');
  expect(report).toContain('heuristic review priority');
  expect(report).not.toContain('registrar-object-handle');
  expect(report).not.toContain('abuse@registrar.example');
  expect(report).not.toContain('stat.ripe.net');

  await page.setViewportSize({ width: 360, height: 780 });
  const equivalentBadge = agreementMatrix.locator(".lane-cards li[data-comparison-state='equivalent'] .lane-status").first();
  const registrarEquivalentBadge = comparison.locator('.chip.good').first();
  await expect(equivalentBadge).toBeVisible();
  await expect(registrarEquivalentBadge).toBeVisible();
  expect(await equivalentBadge.evaluate((element) => getComputedStyle(element).color)).toBe(
    await registrarEquivalentBadge.evaluate((element) => getComputedStyle(element).color),
  );
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Create case' }).click();
  const checkpoint = page.locator('.checkpoint');
  await expect(checkpoint.getByRole('heading', { name: 'Retain selected normalised facts' })).toBeVisible();
  await checkpoint.getByRole('checkbox', { name: /Registrar/u }).check();
  await checkpoint.getByRole('checkbox', { name: /Registration statuses/u }).check();
  await checkpoint.getByRole('button', { name: 'Save 2 checkpoint facts' }).click();
  await expect(page.locator('.case-status')).toContainText('Saved 2 analyst-selected checkpoint facts');
  await checkpoint.getByText(/Compare with latest saved checkpoint/u).click();
  await expect(checkpoint).toContainText('equal');
  await checkpoint.getByRole('checkbox', { name: /Plan an acquisition transition/u }).check();
  await checkpoint.getByRole('checkbox', { name: /Registrar/u }).check();
  await checkpoint.getByRole('checkbox', { name: /Registration statuses/u }).check();
  await checkpoint.getByLabel('Transition expectation for Registration statuses').selectOption('change');
  await checkpoint.getByRole('button', { name: 'Save 2 checkpoint facts' }).click();
  await expect(page.locator('.case-status')).toContainText('with a reviewed transition plan');
  await expect(checkpoint.getByRole('heading', { name: 'Reviewed transition plan' })).toBeVisible();
  await expect(checkpoint).toContainText('verified preserved');
  await expect(checkpoint).toContainText('change not observed');
  await expectNoHorizontalOverflow(page);
});

test('registrar RDAP unsupported and error states remain neutral source rows', async ({ page }) => {
  for (const state of [
    { status: 'unsupported', detail: 'The registry did not publish a registrar RDAP link for this domain.' },
    { status: 'error', detail: 'The registrar RDAP request failed.' },
  ]) {
    await page.setViewportSize({ width: 1280, height: 800 });
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
    await expandLookupFamilies(page);
    await expect(page.getByRole('heading', { name: `${state.status}.example`, exact: true })).toBeVisible();
    const section = page.locator('details.registrar-rdap');
    const summary = section.locator(':scope > summary');
    await expect(summary).toBeVisible();
    await summary.focus();
    await summary.press('Enter');
    await expect(section).toHaveAttribute('open', '');
    await expect(section.getByText(state.detail, { exact: true })).toBeVisible();
    const agreementMatrix = page.locator('.agreement-matrix');
    const unavailablePlotMarker = agreementMatrix.locator('.agreement-node.state-unavailable circle').first();
    await expect(unavailablePlotMarker).toBeVisible();
    expect(await unavailablePlotMarker.evaluate((element) => getComputedStyle(element).strokeDasharray)).not.toBe('none');
    const unavailableLegendMarker = agreementMatrix.locator('.matrix-legend .state-unavailable span');
    await expect(unavailableLegendMarker).toBeVisible();
    expect(await unavailableLegendMarker.evaluate((element) => getComputedStyle(element).borderStyle)).toBe('dotted');
    if (state.status === 'unsupported') {
      const sourceDiagnostics = page.getByRole('group', { name: 'Source diagnostics' });
      const unsupportedStatus = sourceDiagnostics.locator('article').filter({ hasText: 'registrar RDAP' }).locator(':scope > strong');
      const registrationValue = page.locator('.summaries article').filter({ hasText: 'Registration' }).first().locator(':scope > strong');
      await expect(unsupportedStatus).toHaveText('unsupported');
      expect(await unsupportedStatus.evaluate((element) => getComputedStyle(element).color)).toBe(
        await registrationValue.evaluate((element) => getComputedStyle(element).color),
      );
    }
    await page.setViewportSize({ width: 360, height: 780 });
    const unavailableBadge = agreementMatrix.locator(".lane-cards li[data-comparison-state*='unavailable'] .lane-status").first();
    await expect(unavailableBadge).toBeVisible();
    expect(await unavailableBadge.evaluate((element) => getComputedStyle(element).borderStyle)).toBe('dotted');
    expect(await unavailableLegendMarker.evaluate((element) => getComputedStyle(element).borderStyle)).toBe('dotted');
    const notCollectedLegendMarker = agreementMatrix.locator('.matrix-legend .state-not_collected span');
    await expect(notCollectedLegendMarker).toBeVisible();
    expect(await notCollectedLegendMarker.evaluate((element) => getComputedStyle(element).borderStyle)).toBe('dotted');
    await page.unroute('**/api/lookup?*');
  }
});

test('registry access constraints remain neutral, explicit, and mobile-safe', async ({ page }) => {
  test.slow();
  await page.route('**/api/lookup?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    const suffix = query === 'mismatch.dev'
      ? 'gt'
      : query.endsWith('.unknown')
      ? 'unknown'
      : query.endsWith('.vn')
      ? 'vn'
      : query.endsWith('.ch')
        ? 'ch'
        : query.endsWith('.gt')
          ? 'gt'
          : query.endsWith('.dev') ? 'dev' : 'es';
    const isEs = suffix === 'es';
    const isCh = suffix === 'ch';
    const isDev = suffix === 'dev';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: `example.${suffix}`, type: 'domain', registrableDomain: `example.${suffix}`,
        availability: { state: 'unknown', confidence: 'low', domain: `example.${suffix}`, detail: 'Registry sources were inconclusive.' },
        rdap: isDev
          ? { parsed: { domain: `example.${suffix}` } }
          : { error: 'No RDAP registry found for this query via IANA bootstrap' },
        whois: { parsed: {}, chain: [] },
        diagnostics: {
          version: 5,
          registryAccess: {
            suffix, coverageState: 'access_documented',
            whoisAccessProfile: isEs
              ? 'source-ip-authorization-required'
              : isCh ? 'registry-policy-restricted' : 'no-iana-service',
            rdapAccessProfile: isDev ? 'iana-bootstrap' : 'no-iana-service', authority: 'context_only',
            ...(isEs
              ? { officialLookupUrl: 'https://www.dominios.es/es' }
              : isCh
                ? { officialLookupUrl: 'https://www.nic.ch/whois/' }
                : suffix === 'vn'
                  ? { officialLookupUrl: 'https://whois.vnnic.vn/' }
                  : suffix === 'gt'
                    ? { officialLookupUrl: 'https://unrelated.invalid/not-the-registry' }
                    : {}),
            limitation: isEs
              ? 'The registry WHOIS service requires advance source-IP authorisation. A failed or unavailable query is not evidence that the domain is unregistered.'
              : isCh
                ? 'The registry may restrict ordinary port-43 clients and direct them to its official lookup. Its non-standard-port Domain Check is not integrated, and IANA publishes no RDAP service. Missing registry data is not evidence that the domain is unregistered.'
                : isDev
                  ? 'IANA publishes an RDAP bootstrap service but no domain WHOIS referral for this suffix. Missing WHOIS data is contextual only and is not evidence that the domain is unregistered.'
                  : 'IANA publishes no domain WHOIS or RDAP service for this suffix. The official browser lookup is not integrated, and missing registry data is not evidence that the domain is unregistered.',
          },
          rdap: { status: isDev ? 'success' : 'unsupported' }, whois: { status: isDev ? 'unsupported' : 'partial' }, availability: { status: 'complete' },
        },
      }),
    });
  });

  await page.locator('#query').fill('example.es');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const notice = page.getByRole('region', { name: '.ES collection constraints' });
  await expect(notice.getByText('Restricted access')).toBeVisible();
  await expect(notice.getByText('Source-IP authorisation required')).toBeVisible();
  await expect(notice.getByText(/does not decide registration, availability, safety, or maliciousness/i)).toBeVisible();

  await page.locator('#query').fill('example.ch');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const chNotice = page.getByRole('region', { name: '.CH collection constraints' });
  await expect(chNotice.getByText('Restricted access')).toBeVisible();
  await expect(chNotice.getByText('Registry policy restricted')).toBeVisible();
  await expect(chNotice.getByText('No service published by IANA')).toBeVisible();

  await page.locator('#query').fill('example.vn');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const vnNotice = page.getByRole('region', { name: '.VN collection constraints' });
  await expect(vnNotice.getByText('No IANA service')).toBeVisible();
  await expect(vnNotice.getByText('No service published by IANA')).toHaveCount(2);
  await expect(vnNotice.getByText(/official browser lookup is not integrated/i)).toBeVisible();
  await expect(vnNotice.getByRole('link', { name: /Open official .VN registry lookup/ })).toHaveAttribute('href', 'https://whois.vnnic.vn/');

  await page.locator('#query').fill('example.gt');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const gtNotice = page.getByRole('region', { name: '.GT collection constraints' });
  const gtLookup = gtNotice.getByRole('link', { name: /Open official .GT registry lookup/ });
  await expect(gtLookup).toHaveAttribute('href', 'https://www.gt/sitio/');
  await expect(gtLookup).toHaveAttribute('target', '_blank');
  await expect(gtLookup).toHaveAttribute('rel', /\bnoreferrer\b/);
  await expect(gtNotice.getByText(/domain is not added to this link/i)).toBeVisible();

  await page.locator('#query').fill('example.dev');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
  await page.locator('#console-navigation').getByRole('link', { name: /^Lookup/u }).click();
  await expandLookupFamilies(page);
  await expect(page.getByRole('region', { name: '.GT collection constraints' })
    .getByRole('link', { name: /Open official .GT registry lookup/ })).toHaveAttribute('href', 'https://www.gt/sitio/');

  await page.locator('#query').fill('mismatch.dev');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  await expect(page.getByRole('region', { name: '.GT collection constraints' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open official .* registry lookup/ })).toHaveCount(0);

  await page.locator('#query').fill('example.unknown');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const unknownNotice = page.getByRole('region', { name: '.UNKNOWN collection constraints' });
  await expect(unknownNotice.getByRole('link', { name: /official .* registry lookup/i })).toHaveCount(0);

  await page.locator('#query').fill('example.dev');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const devNotice = page.getByRole('region', { name: '.DEV collection constraints' });
  await expect(devNotice.getByText('RDAP only')).toBeVisible();
  await expect(devNotice.getByText(/WHOIS absence is expected and does not make the lookup incomplete/i)).toBeVisible();
  await expect(devNotice).toHaveClass(/expected/);

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
            schema: THREAT_INTELLIGENCE_SCHEMA,
            version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
            provider: { id: 'urlscan_search', label: 'Fixture archived verdicts' },
            target: { type: 'domain', value: 'archive-review.example', exposure: 'registrable_domain' },
            state: 'success', detail: 'Found one archived malicious-verdict match.',
            findings: [{
              id: '11111111-1111-4111-8111-111111111111', category: 'phishing',
              providerVerdict: 'malicious verdict match', detail: 'Archived scan page title: Fixture sign-in',
              lastObservedAt: '2026-07-14T01:02:03.000Z',
              referenceUrl: 'https://urlscan.io/result/11111111-1111-4111-8111-111111111111/',
            }],
            observation: {
              observedAt: '2026-07-15T01:02:03.000Z',
              limitations: ['No matching provider record is not evidence that the target is safe.'],
            },
          }, {
            schema: THREAT_INTELLIGENCE_SCHEMA,
            version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
            provider: { id: 'urlhaus_host', label: 'Fixture malware-host records' },
            target: { type: 'domain', value: 'archive-review.example', exposure: 'registrable_domain' },
            state: 'partial', detail: 'Found one bounded malware-distribution record before the provider result limit.',
            findings: [{
              id: '123456', category: 'malware',
              providerVerdict: 'malware distribution · online',
              detail: 'The provider labels an archived malware-distribution URL on this host as online.',
              lastObservedAt: '2026-07-13T01:02:03.000Z',
              referenceUrl: 'https://urlhaus.abuse.ch/url/123456/',
            }],
            observation: {
              observedAt: '2026-07-15T01:02:03.000Z',
              limitations: ['A listed host may have been compromised or cleaned.'],
            },
          }, {
            schema: THREAT_INTELLIGENCE_SCHEMA,
            version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
            provider: { id: 'threatfox_domain_ioc', label: 'Fixture malware-IOC records' },
            target: { type: 'domain', value: 'archive-review.example', exposure: 'registrable_domain' },
            state: 'skipped', detail: 'The optional source was not queried for this fixture.',
            findings: [],
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
  await expandLookupFamilies(page);

  const section = page.locator('.threat-intelligence');
  await expect(section.getByRole('heading', { name: 'Archived provider verdicts' })).toBeVisible();
  await expect(section.getByText('URLscan archived verdicts', { exact: true })).toBeVisible();
  await expect(section.getByText('URLhaus malware-host records', { exact: true })).toBeVisible();
  await expect(section.getByText('ThreatFox malware IOCs', { exact: true })).toBeVisible();
  await expect(section.locator('article').filter({ hasText: 'URLscan archived verdicts' }).locator('.chip')).toHaveClass(/\bgood\b/);
  await expect(section.locator('article').filter({ hasText: 'URLhaus malware-host records' }).locator('.chip')).toHaveClass(/\bwarn\b/);
  await expect(section.locator('article').filter({ hasText: 'ThreatFox malware IOCs' }).locator('.chip')).toHaveClass(/\bunavailable\b/);
  await expect(section.getByText(/never affect availability/i)).toBeVisible();
  await expect(section.getByText(/2 independent publisher families contributed \+18 under model v7/i)).toBeVisible();
  const riskExplanation = page.locator('.risk-band details.score-detail > summary');
  await riskExplanation.focus();
  await expect(riskExplanation).toBeFocused();
  await riskExplanation.press('Enter');
  await expect(page.locator('.risk-band .exact-score')).toContainText('24/100');
  await expect(page.locator('.factor-chart .factor-label').getByText('Corroborated recent external phishing/malware records')).toBeVisible();
  const exactRiskFactors = page.locator('.risk-band .factor-list');
  await expect(exactRiskFactors).toBeVisible();
  await expect(section.getByText('phishing', { exact: true })).toBeVisible();
  await expect(section.getByText('malware', { exact: true })).toHaveCount(1);
  const attributedRecords = section.getByRole('link', { name: 'View attributed provider record' });
  await expect(attributedRecords).toHaveCount(2);
  for (const link of await attributedRecords.all()) {
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }

  await page.setViewportSize({ width: 360, height: 780 });
  await expect(page.locator('.risk-band .factor-chart')).toBeHidden();
  await expect(exactRiskFactors).toBeVisible();
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
  await expandLookupFamilies(page);
  await page.getByRole('button', { name: 'Create case' }).click();

  const registrar = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]?.value?.evidenceHistory?.[0]?.registrar;
  expect(registrar).toBe('Example Registrar LLC');
});

test('only deliberate Case creation and refresh retain the exact submitted hostname', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    const identity = lookupDomainIdentity(query);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...identity,
        availability: {
          applicable: true,
          state: 'registered',
          confidence: 'high',
          domain: identity.registrableDomain,
          deepScanComplete: true,
        },
        rdap: { parsed: { domain: identity.registrableDomain } },
        whois: { parsed: {}, chain: [] },
        diagnostics: {
          rdap: { status: 'success' },
          whois: { status: 'complete' },
          availability: { status: 'complete' },
        },
      }),
    });
  });

  const runLookup = async (hostname: string) => {
    await page.locator('#query').fill(hostname);
    await page.getByRole('button', { name: 'Run lookup' }).click();
    await expect(page.getByRole('heading', { name: 'scope.test', exact: true })).toBeVisible();
    await expandLookupFamilies(page);
  };
  const retainedCase = async (minimumRevision = 1) => {
    const collection = await readBrowserLocalCollection(page, 'cases', {
      minimumRecords: 1,
      minimumRevision,
    });
    const record = collection.records[0]?.value as {
      domain?: unknown;
      evidenceHistory?: Array<{ inputHostname?: unknown }>;
    } | undefined;
    expect(collection.records).toHaveLength(1);
    expect(record?.domain).toBe('scope.test');
    return { collection, record };
  };

  await runLookup('login.scope.test');
  await page.getByRole('button', { name: 'Create case' }).click();
  const created = await retainedCase();
  expect(created.record?.evidenceHistory?.map((snapshot) => snapshot.inputHostname)).toEqual([
    'login.scope.test',
  ]);

  await runLookup('account.scope.test');
  const refresh = page.getByRole('button', {
    name: 'Refresh retained Case evidence for scope.test',
  });
  await expect(refresh).toBeVisible();
  const beforeRefresh = await retainedCase(created.collection.manifest.revision);
  expect(beforeRefresh.collection.manifest.revision).toBe(created.collection.manifest.revision);
  expect(beforeRefresh.record?.evidenceHistory).toHaveLength(1);

  await refresh.click();
  const refreshed = await retainedCase(beforeRefresh.collection.manifest.revision + 1);
  expect(refreshed.record?.evidenceHistory?.map((snapshot) => snapshot.inputHostname).sort()).toEqual([
    'account.scope.test',
    'login.scope.test',
  ]);

  await runLookup('transient.scope.test');
  await expect(refresh).toBeVisible();
  const afterTransientLookup = await retainedCase(refreshed.collection.manifest.revision);
  expect(afterTransientLookup.collection.manifest.revision).toBe(refreshed.collection.manifest.revision);
  expect(afterTransientLookup.record?.evidenceHistory?.map((snapshot) => snapshot.inputHostname).sort()).toEqual([
    'account.scope.test',
    'login.scope.test',
  ]);
});

test('published response routes can be recorded in a local case with their provenance', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'response-route.invalid',
      type: 'domain',
      registrableDomain: 'response-route.invalid',
      availability: {
        state: 'registered',
        confidence: 'high',
        domain: 'response-route.invalid',
        deepScanComplete: true,
      },
      rdap: { parsed: {} },
      whois: { parsed: {}, chain: [] },
      diagnostics: {
        rdap: { status: 'success' },
        whois: { status: 'success' },
        availability: { status: 'complete' },
      },
      registryInsights: {
        version: 1,
        abuseRouting: [{
          kind: 'registrar',
          channel: 'email',
          contact: 'abuse@example.test',
          source: 'registrar RDAP entity',
          limitations: ['Mailbox monitoring is not verified.'],
        }],
      },
    }),
  }));

  await page.locator('#query').fill('response-route.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const response = page.locator('section.response');
  await expect(response.getByRole('heading', { name: 'Published routes and reviewed drafts' })).toBeVisible();
  await expect(response).toContainText('abuse@example.test');
  await page.getByRole('button', { name: 'Create case' }).click();
  const recordRoute = response.getByRole('button', { name: 'Record in case' });
  await expect(recordRoute).toBeEnabled();
  await recordRoute.click();
  await expect(page.locator('.case-status')).toContainText('Recorded the registrar route');

  const stored = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]?.value;
  expect(stored?.actions).toEqual([
    expect.objectContaining({
      type: 'registrar_report',
      recipient: 'abuse@example.test',
      contactSource: 'registrar RDAP entity',
      state: 'drafting',
    }),
  ]);

  const reviewPacket = response.getByRole('link', { name: 'Review response packet' });
  const expectedCaseId = encodeURIComponent(String(stored?.id));
  await expect(reviewPacket).toHaveAttribute(
    'href',
    `/monitor?view=cases&case=${expectedCaseId}#case-response-${expectedCaseId}`,
  );
  await reviewPacket.click();
  await expect(page).toHaveURL(new RegExp(`/monitor\\?view=cases&case=${expectedCaseId}#case-response-${expectedCaseId}$`));
  const responseWorkspace = page.locator(`#case-response-${expectedCaseId}`);
  await expect(responseWorkspace).toBeVisible();
  await expect(responseWorkspace).toBeFocused();
  await expect(responseWorkspace.getByRole('heading', { name: 'Evidence, reasoning, and actions' })).toBeVisible();
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
  const runLookup = page.getByRole('button', { name: 'Run lookup' });
  await runLookup.click();
  await expect(runLookup).toBeEnabled();
  await expandLookupFamilies(page);
  const whoisSection = page.locator('.sources > details').nth(1);
  await expect(whoisSection).not.toHaveAttribute('open', '');
  await expect(whoisSection.getByText('Published contacts · 2 roles · capped')).toBeHidden();
  await whoisSection.locator(':scope > summary').click();
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
      id: 'idn-profile', name: 'Example Brand', officialDomains: ['sample.example'], productNames: [], tlds: ['example'],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
      createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    };
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify([profile]));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', profile.id);
  });
  await migrateLegacyBrowserData(page, {});
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'xn--smple-4ve.example', type: 'domain', registrableDomain: 'xn--smple-4ve.example',
      availability: { state: 'registered', confidence: 'high', domain: 'xn--smple-4ve.example' },
      rdap: { upstreamStatus: 404, parsed: {} }, whois: { parsed: {}, chain: [] },
      diagnostics: { rdap: { status: 'not_found' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
    }),
  }));

  await page.locator('#query').fill('xn--smple-4ve.example');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const card = page.locator('.idn-card');
  await expect(card.getByRole('heading', { name: 'IDN and confusable review' })).toBeVisible();
  await expect(card.getByText('tr39-17.0.0-bounded-ascii-v3', { exact: true })).toBeVisible();
  await expect(card.getByText('sаmple.example', { exact: true })).toBeVisible();
  await expect(card.getByText('xn--smple-4ve.example', { exact: true })).toBeVisible();
  await expect(card.getByText('Cyrillic, Latin', { exact: true })).toBeVisible();
  await expect(card.getByText('Mixed writing scripts', { exact: true })).toBeVisible();
  await expect(card.getByText('Confusable with an official domain', { exact: true })).toBeVisible();
  await expect(card.getByText(/similarity indicators and do not establish maliciousness/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});
