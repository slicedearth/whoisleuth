import { expect, test } from './fixtures';
import { expandLookupFamilies, expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, holdBrowserLocalReads, migrateLegacyBrowserData, readBrowserLocalCollection } from './helpers';

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
            soa: [{
              nsname: 'ns1.example', hostmaster: 'hostmaster.example', serial: 2026072701,
              refresh: 3600, retry: 600, expire: 1209600, minttl: 300,
            }],
            https: [{
              type: 'HTTPS', owner: 'dns-evidence.test', ttl: 300, priority: 1, mode: 'service',
              target: 'dns-evidence.test', targetIsOwner: true, serviceUnavailable: false,
              compatible: true, parametersIgnored: false,
              parameters: {
                mandatory: [1, 3], alpn: ['h2', 'h3'], noDefaultAlpn: false, port: 443,
                ipv4hint: ['192.0.2.10'], ipv6hint: ['2001:db8::10'],
                opaque: [{ key: 5, name: 'ech', length: 48 }],
                unknownKeys: [], unsupportedMandatoryKeys: [],
              },
            }],
          },
          diagnostics: {
            a: { status: 'success' }, aaaa: { status: 'success' },
            cname: { status: 'error', error: 'resolver timed out' },
            soa: { status: 'success' },
            https: { status: 'success' },
            delegation: { status: 'partial', truncated: false, count: 2 },
          },
          delegation: {
            delegationHealthVersion: 1, version: 1, status: 'partial',
            observedAt: '2026-07-30T02:03:04.000Z', scanMode: 'deep', source: 'dns_delegation',
            durationMs: 125, complete: false, truncated: false,
            detail: 'The delegation-health collection is partial; review each source state before changing DNS.',
            limitations: [
              'DNS health does not decide registration availability, ownership, control, intent, safety, or maliciousness.',
            ],
            parent: { state: 'success', nameservers: ['ns1.example', 'ns2.example'], error: null },
            registry: { nameservers: ['ns1.example', 'ns3.example'], nameserverDetails: [], delegationSigned: true, dsRecordCount: 1, truncated: false },
            authorities: [
              { nameserver: 'ns1.example', addressSource: 'registry_glue', addresses: ['192.0.2.53'], state: 'success', nameservers: ['ns1.example', 'ns2.example'], soaPrimary: 'ns1.example', attempts: [] },
              { nameserver: 'ns2.example', addressSource: 'recursive_address', addresses: [], state: 'unreachable', nameservers: [], soaPrimary: null, attempts: [] },
            ],
            recordMatrix: [{
              type: 'A', state: 'partial', observations: [
                {
                  nameserver: 'ns1.example', state: 'partial',
                  values: ['192.0.2.10', '192.0.2.11'], error: null, truncated: true, discarded: 2,
                },
                {
                  nameserver: 'ns2.example', state: 'error', values: [],
                  error: 'record query timed out', truncated: false, discarded: 0,
                },
              ],
            }],
            findings: [
              { id: 'parent_registry_ns', label: 'Parent and registry nameservers', state: 'warning', summary: 'Parent view and registry publication differ', detail: 'Parent view: ns1.example, ns2.example. Registry publication: ns1.example, ns3.example.', remediation: 'Confirm the intended delegation before changing nameservers.' },
              { id: 'authority_reachability', label: 'Direct nameserver reachability', state: 'warning', summary: '1 nameserver could not be confirmed', detail: 'Successful: 1. Lame or refused: 0. Unreachable or unresolved: 1.', remediation: 'Restore authoritative service on every delegated nameserver.' },
            ],
          },
        },
      },
      rdap: { upstreamStatus: 200, parsed: {} }, whois: { parsed: {}, chain: [] },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
    }),
  }));

  await page.locator('#query').fill('dns-evidence.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const card = page.locator('.dns-card');
  await expect(card).not.toHaveAttribute('open', '');
  await expect(card.getByRole('heading', { name: 'DNS intelligence' })).toBeVisible();
  await expect(card.locator(':scope > summary .evidence-status')).toHaveText('partial');
  await expect(card.getByText('192.0.2.10', { exact: true })).toBeHidden();
  await card.locator(':scope > summary').click();
  await expect(card.getByText('192.0.2.10', { exact: true })).toBeVisible();
  await expect(card.getByText('0 issue ca.example', { exact: true })).toBeVisible();
  await expect(card.getByText(/ns1\.example.*serial 2026072701/i)).toBeVisible();
  await expect(card.getByText(/Service priority 1 → owner · ALPN h2, h3 · port 443 · IPv4 hints 192\.0\.2\.10.*Published ech/i)).toBeVisible();
  await expect(card.getByText(/does not follow or connect to them/i)).toBeVisible();
  await expect(card.getByText(/CNAME: resolver timed out/i)).toBeVisible();
  await expect(card.getByText(/does not prove common ownership or maliciousness/i)).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Authoritative DNS health' })).toBeVisible();
  await expect(card.getByText('Parent view and registry publication differ', { exact: true })).toBeVisible();
  await expect(card.getByText('1 nameserver could not be confirmed', { exact: true })).toBeVisible();
  const directObservations = card.locator('.authority-detail').first();
  await directObservations.getByText('Direct nameserver observations', { exact: true }).click();
  await expect(directObservations.getByText('ns2.example', { exact: true })).toBeVisible();
  await card.getByText('Authoritative record agreement', { exact: true }).click();
  await expect(card.locator('.record-matrix .matrix-partial')).toHaveText('partial');
  await expect(card.getByText('192.0.2.10 · 192.0.2.11', { exact: true })).toBeVisible();
  await expect(card.getByText('Retained values are incomplete · 2 discarded.', { exact: true })).toBeVisible();
  await expect(card.getByText('record query timed out', { exact: true })).toBeVisible();
  await expect(card.getByText(/does not decide registration availability/i)).toBeVisible();
  await card.getByText('Plan a domain control change', { exact: true }).click();
  await card.getByLabel('Intended nameservers').fill('ns3.example.net\nns4.example.net');
  await card.getByLabel(/Relevant TTL preparation/).check();
  await card.getByLabel(/Proposed authorities already serve/).check();
  await card.getByRole('button', { name: 'Evaluate rehearsal' }).click();
  await expect(card.getByText('Plan has unresolved gates', { exact: true })).toBeVisible();
  await expect(card.getByText('Current evidence is incomplete', { exact: true })).toBeVisible();
  await expect(card.getByText(/does not change DNS/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('HTTP intelligence presents bounded redirect provenance and response metadata', async ({ page }) => {
  test.slow();
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
  await migrateLegacyBrowserData(page, {});
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
            securityHeaders: { strictTransportSecurity: 'observed', contentSecurityPolicy: 'observed', xFrameOptions: 'observed', xContentTypeOptions: 'observed', referrerPolicy: 'observed' },
            deliveryMetadata: {
              version: 1, status: 'success', complete: true, truncated: false,
              limitations: ['Selected-response headers are point-in-time declarations and do not prove intermediary caching, compression effectiveness, or page performance.'],
              contentEncoding: { status: 'observed', codings: ['br', 'gzip'], encoded: true, unknownCodingCount: 0 },
              cachePolicy: {
                status: 'observed', noStore: false, noCache: false, mustRevalidate: true,
                public: true, private: false, immutable: false,
                maxAgeSeconds: 3600, sMaxAgeSeconds: null, ageSeconds: 12, unknownDirectiveCount: 0,
                maxAgePresent: true, sMaxAgePresent: false, agePresent: true,
                etag: { present: true, valid: true }, lastModified: { present: false, valid: null }, expires: { present: true, valid: true },
              },
            },
          },
        },
        tls: {
          version: 1, profileVersion: 2, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
          scanMode: 'deep', source: 'tls', durationMs: 42, complete: true, truncated: false,
          limitations: ['This is a point-in-time TLS handshake fixture.'],
          authorization: { authorized: true, error: null },
          hostname: { matches: true, error: null },
          validity: { status: 'valid' },
          certificate: {
            subject: { commonNames: ['http-evidence.test'], organizations: [] },
            issuer: { commonNames: ['Fixture issuing authority'], organizations: [] },
            serialNumber: 'a1b2c3',
            validFrom: '2026-07-01T00:00:00.000Z',
            validTo: '2026-08-01T00:00:00.000Z',
            fingerprintSha256: '7'.repeat(64),
            publicKey: { fingerprintSha256: '8'.repeat(64) },
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
          publicationMetadata: {
            version: 1, status: 'partial', complete: false, truncated: true,
            limitations: [
              'Counts and declarations describe only the captured static homepage HTML; they are not a full accessibility, indexing, or performance audit.',
              'Static HTML token or attribute bounds were reached; publication metadata is partial.',
            ],
            robots: { status: 'partial', complete: false, truncated: true, directives: ['index', 'nofollow'], recognizedDirectiveCount: 2, unknownDirectiveCount: 0, conflicting: false },
            twitterCard: {
              status: 'observed', complete: true, truncated: false, cardType: 'summary_large_image', declarationCount: 3,
              titlePresent: true, descriptionPresent: false, imagePresent: true, imageAltPresent: true,
              sitePresent: false, creatorPresent: false, playerPresent: false, appPresent: false,
            },
            headings: { complete: true, truncated: false, total: 3, h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
            images: { totalComplete: true, classificationComplete: true, truncated: false, total: 3, altMissing: 1, altEmpty: 1, altNonEmpty: 1, altUnclassified: 0 },
            renderBlockingCandidates: { complete: true, truncated: false, script: 1, stylesheet: 1, total: 2, scope: 'explicit-head-static-v1' },
          },
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
        credentialSurfaceProfile: {
          credentialSurfaceVersion: 1, version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
          scanMode: 'deep', source: 'html', durationMs: null, complete: true, truncated: false,
          limitations: [
            'Fixed semantic categories and counts only.',
            'External form submission is a review pivot, not a finding of unsafe or deceptive behaviour.',
          ],
          diagnostics: { formsObserved: 2, inputsObserved: 4, classifiedInputs: 3, unclassifiedActions: 0 },
          forms: {
            count: 2,
            methods: { missing: 0, get: 1, post: 1, dialog: 0, other: 0 },
            actions: { sameOrigin: 1, external: 1, missing: 0, cleartext: 0, unclassified: 0 },
          },
          inputs: {
            count: 4,
            classifiedCount: 3,
            categories: { password: 1, email: 1, username: 1, one_time_code: 0, payment: 0 },
          },
        },
        structuredDataIdentity: {
          structuredDataVersion: 1, version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
          scanMode: 'deep', source: 'html', durationMs: null, complete: true, truncated: false,
          limitations: ['Publisher-declared metadata does not prove identity, ownership, control, safety, or maliciousness.'],
          diagnostics: { scriptsObserved: 1, scriptsExamined: 1, entities: 1 },
          entities: [{
            types: ['Organization', 'WebSite'],
            name: 'Example publisher',
            declaredOrigin: 'https://login.example.test',
            sameAsHosts: ['social.example.test'],
          }],
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
          browserLibraryProfile: {
            profileVersion: 1, version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
            scanMode: 'deep', source: 'derived', durationMs: null, complete: true, truncated: false,
            catalog: { name: 'Retire.js', version: 'retire.js-5.4.3', sourceRevision: '56ea22d889656f4fbfe47b7df58d410a06ea59b7' },
            limitations: ['A fixture advisory match does not establish reachability or exploitability.'],
            diagnostics: { scriptsExamined: 1, referencesExamined: 1, inlineScriptsExamined: 0, findings: 1, advisoryMatches: 1 },
            findings: [{
              id: 'fixture-library', name: 'fixture library', apparentVersion: '1.2.3',
              detectionMethods: ['script filename'], advisoryCount: 1, highestSeverity: 'medium',
              advisoryIdentifiers: ['CVE-0000-0000'], weaknessClasses: ['CWE-000'],
            }],
          },
        },
        pageRoleProfile: {
          pageRoleProfileVersion: 1, version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
          scanMode: 'deep', source: 'derived', durationMs: null, complete: true, truncated: false,
          limitations: ['Fixture roles are heuristic review labels.'],
          diagnostics: { rolesObserved: 2, formsObserved: 2, tagsExamined: 20 },
          primaryRole: 'authentication',
          findings: [
            { role: 'authentication', label: 'Authentication', confidence: 'high', evidence: ['Password-purpose input observed'] },
            { role: 'support_contact', label: 'Support or contact', confidence: 'low', evidence: ['Static support or contact marker observed'] },
          ],
        },
        clientBehaviorProfile: {
          clientBehaviorProfileVersion: 1, version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
          scanMode: 'deep', source: 'derived', durationMs: null, complete: true, truncated: false,
          limitations: ['Referenced scripts were not fetched or executed.'],
          diagnostics: { indicatorsObserved: 1, scriptElementsExamined: 2, inlineCharactersExamined: 120 },
          scriptSummary: { elementsObserved: 2, referencedScripts: 1, inlineScripts: 1, moduleScripts: 1 },
          indicators: [{
            id: 'browser_storage',
            label: 'Browser storage access',
            evidenceClass: 'inline_script',
            occurrences: 2,
            explanation: 'Inline script references a browser-local storage API.',
          }],
        },
        securityPosture: {
          postureVersion: 1, version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z',
          scanMode: 'deep', source: 'derived', durationMs: null, complete: true, truncated: false,
          limitations: ['This is a passive fixture interpretation, not an active vulnerability assessment.'],
          diagnostics: { findings: 3, observed: 1, potentialExposure: 0, observedAbsence: 2, unavailable: 0 },
          summary: { observed: 1, potentialExposure: 0, observedAbsence: 2, unavailable: 0 },
          findings: [
            { id: 'fixture-https', category: 'transport', state: 'observed', tone: 'configured', label: 'HTTPS transport observed', detail: 'The selected homepage response was reached over HTTPS.', evidence: ['HTTP response'] },
            { id: 'fixture-csp', category: 'response headers', state: 'observed_absence', tone: 'review', label: 'Content Security Policy not observed', detail: 'The selected response did not include the header.', evidence: ['Selected HTTP response headers'] },
            { id: 'fixture-cleartext-resources', category: 'forms and resources', state: 'observed_absence', tone: 'configured', label: 'No cleartext resource origin observed', detail: 'No retained resource origin used cleartext HTTP.', evidence: ['Static page evidence'] },
          ],
        },
      },
      sslbl: {
        sslblVersion: 1,
        source: 'sslbl',
        status: 'success',
        verdict: 'listed',
        complete: true,
        observedAt: '2026-07-13T00:00:00.000Z',
        fingerprintSha1: '3'.repeat(40),
        referenceUrl: `https://sslbl.abuse.ch/ssl-certificates/sha1/${'3'.repeat(40)}/`,
        snapshot: {
          sourceUpdatedAt: '2026-07-13T00:00:00.000Z',
          generatedAt: '2026-07-13T00:05:00.000Z',
          ageSeconds: 300,
          entryCount: 10_000,
          digestSha256: '4'.repeat(64),
        },
        detail: 'The observed leaf certificate appears in the local fixture snapshot.',
        limitations: ['A match is a review lead and does not establish current activity or maliciousness.'],
      },
      rdap: { upstreamStatus: 200, parsed: {} }, whois: { parsed: {}, chain: [] },
      diagnostics: {
        rdap: { status: 'success' },
        whois: { status: 'partial' },
        availability: { status: 'complete' },
        sslbl: { status: 'success' },
      },
    }),
  }));

  await page.locator('#query').fill('http-evidence.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('heading', { name: 'http-evidence.test' })).toBeVisible();
  await holdBrowserLocalReads(page, 8_000, '.family-web button.family-summary');
  const snapshots = page.locator('.snapshot-manager');
  await expect(snapshots.getByRole('button', { name: 'Save current snapshot' })).toBeDisabled();
  await expect(snapshots.getByRole('button', { name: 'Save current snapshot' })).toBeEnabled({ timeout: 12_000 });
  const sslblReviewLead = page.getByRole('complementary', { name: 'The observed leaf certificate matched the local SSLBL snapshot' });
  await expect(sslblReviewLead).toBeVisible();
  await expect(sslblReviewLead).toContainText('does not change Risk scoring');
  await expect(sslblReviewLead.getByRole('link', { name: 'Review certificate evidence' })).toHaveAttribute('href', '#evidence-sslbl');
  const card = page.locator('.http-card');
  await expect(card).not.toHaveAttribute('open', '');
  await expect(card.getByRole('heading', { name: 'HTTP intelligence' })).toBeVisible();
  const httpStatus = card.locator(':scope > summary .evidence-status');
  await expect(httpStatus).toHaveText('success');
  await expect(httpStatus).toHaveClass(/\bsuccess\b/u);
  const successColour = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--success)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  await expect(httpStatus).toHaveCSS('color', successColour);
  await expect(card.getByText('https://login.example.test/final', { exact: true })).toBeHidden();
  await card.locator(':scope > summary').click();
  await expect(card.getByText('https://login.example.test/final', { exact: true })).toBeVisible();
  await expect(card.getByText('Cross-origin redirect', { exact: true })).toBeVisible();
  await card.getByText('Redirect chain · 1 hop', { exact: true }).click();
  await expect(card.getByText('→ https://login.example.test/final', { exact: true })).toBeVisible();
  await card.getByText('Selected response metadata', { exact: true }).click();
  await expect(card.getByText('Observed', { exact: true }).first()).toBeVisible();
  await expect(card).not.toContainText('max-age=31536000');
  await expect(card).not.toContainText("default-src 'self'");
  await expect(card.getByText('a'.repeat(64), { exact: true })).toBeVisible();
  await expect(card.getByText('Complete captured body (2.0 KiB)', { exact: true })).toBeVisible();
  const delivery = card.locator('details.metadata-disclosure');
  await expect(delivery.locator(':scope > summary')).toContainText('Observed HTTP delivery metadata');
  await expect(delivery.locator(':scope > summary')).toContainText('Complete');
  await delivery.locator(':scope > summary').focus();
  await delivery.locator(':scope > summary').press('Enter');
  await expect(delivery.getByText('br, gzip', { exact: true })).toBeVisible();
  await expect(delivery.getByText('3600 seconds', { exact: true })).toBeVisible();
  await expect(delivery).toContainText('ETag Syntactically valid');
  await expect(delivery).not.toContainText('fixture-private-etag');
  await expect(card).not.toContainText('secret');
  await expect(card.getByText(/missing security headers do not establish maliciousness/i)).toBeVisible();

  const pageCard = page.locator('.page-card');
  await expect(pageCard).not.toHaveAttribute('open', '');
  await expect(pageCard.getByRole('heading', { name: 'Page identity' })).toBeVisible();
  await expect(pageCard.locator(':scope > summary .evidence-status')).toHaveText('partial');
  await expect(pageCard.getByText('https://login.example.test/account', { exact: true })).toBeHidden();
  await pageCard.locator(':scope > summary').click();
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
  await expect(pageCard.getByText(/normalised markup, and visible text are not retained/i)).toBeVisible();
  const publication = pageCard.locator('details.metadata-disclosure');
  await expect(publication.locator(':scope > summary')).toContainText('Publisher-declared publication metadata');
  await expect(publication.locator(':scope > summary')).toContainText('Partial');
  await publication.locator(':scope > summary').focus();
  await publication.locator(':scope > summary').press('Enter');
  await expect(publication.getByText('index, nofollow', { exact: true })).toBeVisible();
  await expect(publication.getByText(/3 images · missing 1 · empty 1 · non-empty 1/u)).toBeVisible();
  await expect(publication.getByText(/Static homepage declarations and candidates do not prove indexing/u)).toBeVisible();
  await expect(publication).not.toContainText('private-twitter-title');

  const roleBehaviorCard = page.locator('details').filter({ has: page.getByRole('heading', { name: 'Page role and client behaviour' }) });
  await expect(roleBehaviorCard).not.toHaveAttribute('open', '');
  await expect(roleBehaviorCard.locator(':scope > summary')).toContainText('Authentication · 1 static behaviour indicator');
  await roleBehaviorCard.locator(':scope > summary').click();
  await expect(roleBehaviorCard.getByText('Password-purpose input observed', { exact: true })).toBeVisible();
  await expect(roleBehaviorCard.getByText('Browser storage access', { exact: true })).toBeVisible();
  await expect(roleBehaviorCard.getByText('Inline script references a browser-local storage API.', { exact: true })).toBeVisible();
  await expect(roleBehaviorCard).not.toContainText('private');

  const structuredCard = page.locator('.structured-card');
  await expect(structuredCard).not.toHaveAttribute('open', '');
  await expect(structuredCard.getByRole('heading', { name: 'Structured identity metadata' })).toBeVisible();
  await expect(structuredCard.getByRole('heading', { name: 'Example publisher' })).toBeHidden();
  await structuredCard.locator(':scope > summary').click();
  await expect(structuredCard.getByRole('heading', { name: 'Example publisher' })).toBeVisible();
  await expect(structuredCard.getByText('Organization, WebSite', { exact: true })).toBeVisible();
  await expect(structuredCard.getByText('https://login.example.test', { exact: true })).toBeVisible();
  await expect(structuredCard.getByText('social.example.test', { exact: true })).toBeVisible();
  await expect(structuredCard.getByText(/does not use this evidence for availability or Risk scoring/i)).toBeVisible();

  const credentialCard = page.locator('.credential-card');
  await expect(credentialCard).not.toHaveAttribute('open', '');
  await expect(credentialCard.getByRole('heading', { name: 'Credential collection surface' })).toBeVisible();
  await expect(credentialCard.getByText(/3 classified inputs across 2 forms/)).toBeVisible();
  await credentialCard.locator(':scope > summary').click();
  await expect(credentialCard.locator('section').filter({ hasText: 'Input purposes' }).getByText('Password')).toBeVisible();
  await expect(credentialCard.locator('section').filter({ hasText: 'Action relationships' }).getByText('External origin')).toBeVisible();
  await expect(credentialCard.getByText(/external form submission is common for legitimate/i)).toBeVisible();
  await expect(credentialCard.getByText(/does not retain field names or content/i)).toBeVisible();
  await expect(credentialCard).not.toContainText('secret');

  const technologyCard = page.locator('.technology-card');
  await expect(technologyCard).not.toHaveAttribute('open', '');
  await expect(technologyCard.getByRole('heading', { name: 'Technology indicators' })).toBeVisible();
  await expect(technologyCard.getByRole('heading', { name: 'Fixture CMS' })).toBeHidden();
  const technologySummary = technologyCard.locator(':scope > summary');
  await technologySummary.focus();
  await technologySummary.press('Enter');
  await expect(technologyCard.getByRole('heading', { name: 'Fixture CMS' })).toBeVisible();
  await expect(technologyCard.getByText('high confidence', { exact: true })).toBeVisible();
  await expect(technologyCard.getByText('Generator metadata identifies the fixture CMS.', { exact: true })).toBeVisible();
  await expect(technologyCard.getByRole('heading', { name: 'Fixture Edge' })).toBeVisible();
  await expect(technologyCard.getByRole('heading', { name: 'Observed browser libraries' })).toBeVisible();
  await expect(technologyCard.getByRole('heading', { name: /Fixture Library 1\.2\.3/i })).toBeVisible();
  await expect(technologyCard.getByText('1 advisory match', { exact: true })).toBeVisible();
  await expect(technologyCard.getByText(/does not download or execute referenced scripts/i)).toBeVisible();
  await expect(technologyCard.getByText(/make no additional request and do not affect availability or Risk scoring/i)).toBeVisible();

  const postureCard = page.locator('.security-posture-card');
  await expect(postureCard).not.toHaveAttribute('open', '');
  await expect(postureCard.getByRole('heading', { name: 'Passive security posture' })).toBeVisible();
  await expect(postureCard.locator(':scope > summary .evidence-status')).toHaveText('success');
  await expect(postureCard.getByText('HTTPS transport observed', { exact: true })).toBeHidden();
  const postureSummary = postureCard.locator(':scope > summary');
  await postureSummary.focus();
  await postureSummary.press('Enter');
  await expect(postureCard).toHaveAttribute('open', '');
  await expect(postureCard.getByText('HTTPS transport observed', { exact: true })).toBeVisible();
  await expect(postureCard.getByText('Content Security Policy not observed', { exact: true })).toBeVisible();
  await expect(postureCard.getByText('Not observed', { exact: true }).last()).toBeVisible();
  await expect(postureCard.getByText('No exposure observed', { exact: true })).toBeVisible();
  await expect(postureCard.getByText('Review', { exact: true }).first()).toBeVisible();
  await expect(postureCard.getByText(/review signals, not confirmed vulnerabilities/i)).toBeVisible();

  const pageComparison = page.locator('.page-comparison');
  await expect(pageComparison.getByRole('heading', { name: 'Official-site comparison' })).toBeVisible();
  await expect(pageComparison.getByText('official.example', { exact: true })).toBeVisible();
  await expect(pageComparison.locator('article').filter({ hasText: 'Normalised HTML' }).getByText('Same captured digest', { exact: true })).toBeVisible();
  await expect(pageComparison.locator('article').filter({ hasText: 'Visible text' }).getByText('100% bit agreement', { exact: true })).toBeVisible();
  await expect(pageComparison.locator('article').filter({ hasText: 'DOM structure' }).getByText('Different captured structure', { exact: true })).toBeVisible();
  await expect(pageComparison.locator('article').filter({ hasText: 'External resource hosts' }).getByText('1 host shared', { exact: true })).toBeVisible();
  await expect(pageComparison.getByText('Shared: assets.example', { exact: true })).toBeVisible();
  await expect(pageComparison.getByText(/there is no overall page-similarity score/i)).toBeVisible();
  await expect(pageComparison.getByText(/related matches cannot corroborate one another/i)).toBeVisible();

  await expect(snapshots.getByRole('heading', { name: 'Website profile snapshots' })).toBeVisible();
  await expect(snapshots.getByText(/A change is a review lead, not evidence of compromise/)).toBeVisible();
  await snapshots.getByRole('button', { name: 'Save current snapshot' }).click();
  await expect(snapshots.getByRole('status')).toContainText('Saved a compact website-profile snapshot');
  const retainedSnapshots = await readBrowserLocalCollection(page, 'website_snapshots', { minimumRecords: 1 });
  expect(retainedSnapshots.records).toHaveLength(1);
  expect(retainedSnapshots.records[0]?.value).toMatchObject({
    domain: 'http-evidence.test',
    complete: false,
    truncated: true,
    certificate: {
      fingerprintSha256: '7'.repeat(64),
      spkiFingerprintSha256: '8'.repeat(64),
      issuer: 'Fixture issuing authority',
      subject: 'http-evidence.test',
      complete: true,
      truncated: false,
    },
  });
  expect(JSON.stringify(retainedSnapshots.records[0]?.value)).not.toContain('secret');
  expect(JSON.stringify(retainedSnapshots.records[0]?.value)).not.toContain('publicationMetadata');
  expect(JSON.stringify(retainedSnapshots.records[0]?.value)).not.toContain('deliveryMetadata');
  const certificateInventory = snapshots.getByRole('region', { name: 'Observed certificate inventory' });
  await expect(certificateInventory).toContainText('1 observation · 1 domain');
  await expect(certificateInventory).toContainText('http-evidence.test');
  await certificateInventory.locator('summary').click();
  await expect(certificateInventory.getByText('7'.repeat(64), { exact: true })).toBeVisible();
  await expect(certificateInventory.getByText('8'.repeat(64), { exact: true })).toBeVisible();
  await snapshots.getByText(/Manage 1 saved snapshot/).click();
  await failNextBrowserLocalManifestWrite(page, 'website_snapshots');
  page.once('dialog', (dialog) => dialog.accept());
  await snapshots.getByRole('button', { name: 'Delete' }).click();
  await expect(snapshots.getByRole('status')).toContainText(/storage|quota|delete/iu);
  await expect(snapshots.getByText(/Manage 1 saved snapshot/)).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await snapshots.getByRole('button', { name: 'Delete' }).click();
  await expect(snapshots.getByRole('status')).toContainText('Deleted the selected website-profile snapshot');
  await expect(snapshots.getByText('No website-profile snapshot is retained for this domain.')).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('completed technology analysis distinguishes an unmatched catalogue from source success', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'unmatched-technology.test',
      type: 'domain',
      registrableDomain: 'unmatched-technology.test',
      availability: {
        state: 'registered',
        confidence: 'high',
        domain: 'unmatched-technology.test',
        technologyProfile: {
          profileVersion: 1,
          version: 1,
          status: 'success',
          observedAt: '2026-07-27T00:00:00.000Z',
          scanMode: 'deep',
          source: 'derived',
          durationMs: null,
          complete: true,
          truncated: false,
          limitations: ['Curated signature matching is selective; an unmatched technology may still be present.'],
          diagnostics: { findings: 0, htmlEvaluated: true, generatorEvaluated: true, serverEvaluated: true, resourceOriginsEvaluated: 0 },
          findings: [],
          browserLibraryProfile: {
            profileVersion: 1,
            version: 1,
            status: 'success',
            observedAt: '2026-07-27T00:00:00.000Z',
            scanMode: 'deep',
            source: 'derived',
            durationMs: null,
            complete: true,
            truncated: false,
            catalog: { name: 'Retire.js', version: 'fixture-catalogue', sourceRevision: 'fixture-revision' },
            limitations: ['Static signatures are selective.'],
            diagnostics: { scriptsExamined: 1, referencesExamined: 1, inlineScriptsExamined: 0, findings: 0, advisoryMatches: 0 },
            findings: [],
          },
        },
      },
      rdap: { upstreamStatus: 200, parsed: {} },
      whois: { parsed: {}, chain: [] },
      diagnostics: {
        rdap: { status: 'success' },
        whois: { status: 'partial' },
        availability: { status: 'complete' },
      },
    }),
  }));

  await page.locator('#query').fill('unmatched-technology.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);

  const technologyCard = page.locator('.technology-card');
  await expect(technologyCard.locator(':scope > summary .evidence-status')).toHaveText('No recognised matches');
  await expect(technologyCard.getByText(/Analysis complete; no curated signatures matched/u)).toBeVisible();
  await technologyCard.locator(':scope > summary').click();
  await expect(technologyCard.getByText(/does not mean that no framework, service, or delivery platform is present/i)).toBeVisible();
  await expect(technologyCard.locator('.library-profile .evidence-status')).toHaveText('No catalogue matches');
  await expect(technologyCard.getByText('success', { exact: true })).toHaveCount(0);

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
            { id: 'certificate_unauthorized', tone: 'warning', label: 'Certificate not authorised', detail: 'The runtime trust store did not authorise the observed chain.' },
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
  await expandLookupFamilies(page);
  const card = page.locator('.tls-card');
  await expect(card).not.toHaveAttribute('open', '');
  await expect(card.getByRole('heading', { name: 'TLS and certificate intelligence' })).toBeVisible();
  await expect(card.locator(':scope > summary .evidence-status')).toHaveText('success');
  await expect(card.getByText('93.184.216.34', { exact: true })).toBeHidden();
  await card.locator(':scope > summary').click();
  await expect(card.getByText('93.184.216.34', { exact: true })).toBeVisible();
  await expect(card.getByText('TLSv1.3', { exact: true })).toBeVisible();
  await expect(card.getByText('Not authorised', { exact: true })).toBeVisible();
  await expect(card.getByText('Certificate not authorised', { exact: true })).toBeVisible();
  const leafCertificate = card.locator('.tls-detail').nth(0);
  await leafCertificate.locator('summary').click();
  await expect(leafCertificate.getByText('a'.repeat(64), { exact: true })).toBeVisible();
  await card.locator('.tls-detail').nth(1).locator('summary').click();
  await expect(card.getByText('*.example.test', { exact: true })).toBeVisible();
  await card.locator('.tls-detail').last().locator('summary').click();
  await expect(card.getByText('UNABLE_TO_VERIFY_LEAF_SIGNATURE', { exact: true })).toBeVisible();
  await expect(card.getByText(/one connection to one validated public address/i)).toBeVisible();

  const policyCard = page.locator('#evidence-certificate-policy');
  await expect(policyCard).not.toHaveAttribute('open', '');
  await expect(policyCard.getByRole('heading', { name: 'Certificate policy context' })).toBeVisible();
  await expect(policyCard.locator(':scope > summary .chevron')).toHaveCount(0);
  await expect(policyCard.locator(':scope > summary .evidence-status')).toHaveText('partial');
  await expect(policyCard.locator(':scope > summary .evidence-summary-detail')).toHaveText('Current CAA, observed issuer, and reviewed expectations');
  await expect(policyCard.getByText('CAA collection was incomplete, unavailable, or truncated, so no current-policy comparison is available.', { exact: true })).toBeHidden();
  await policyCard.locator(':scope > summary').click();
  await expect(policyCard.getByText('CAA collection was incomplete, unavailable, or truncated, so no current-policy comparison is available.', { exact: true })).toBeVisible();
  await expect(policyCard.getByText('Partial', { exact: true })).toBeVisible();

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
      reverseDns: {
        version: 1, status: 'success', source: 'reverse_dns',
        observedAt: '2026-07-27T00:00:00.000Z', scanMode: 'deep',
        durationMs: 8, complete: true, truncated: false,
        limitations: ['PTR names are operator-published routing context and do not prove hosting control.'],
        diagnostics: { ptr: { status: 'success', count: 1 } },
        records: { ptr: ['edge.example.test'] },
      },
      whois: { parsed: {}, chain: [] },
      diagnostics: {
        rdap: { status: 'success' }, whois: { status: 'partial' },
        availability: { status: 'not_applicable' }, reverseDns: { status: 'success' },
      },
    }),
  }));

  await page.locator('#query').fill('192.0.2.1');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expandLookupFamilies(page);
  const rdapSection = page.locator('.sources > details').first();
  await expect(rdapSection).not.toHaveAttribute('open', '');
  await rdapSection.locator(':scope > summary').click();
  await expect(rdapSection.getByText('Example Network', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('192.0.2.0 – 192.0.2.255', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('CIDRs')).toBeVisible();
  await expect(rdapSection.getByText('active', { exact: true })).toBeVisible();
  await expect(rdapSection.locator('time[datetime="2001-02-03T04:05:06.000Z"]')).toBeVisible();
  await expect(rdapSection.getByText('Domain', { exact: true })).toHaveCount(0);
  const reverseDnsCard = page.locator('.dns-card');
  await expect(reverseDnsCard).not.toHaveAttribute('open', '');
  await expect(reverseDnsCard.getByRole('heading', { name: 'Reverse DNS context' })).toBeVisible();
  await expect(reverseDnsCard.locator(':scope > summary .evidence-status')).toHaveText('success');
  await expect(reverseDnsCard.getByText('edge.example.test', { exact: true })).toBeHidden();
  await expect(
    page.getByRole('link', { name: 'Reverse DNS network success' }).locator('[data-icon="dns"]'),
  ).toBeVisible();
  await reverseDnsCard.locator(':scope > summary').click();
  await expect(reverseDnsCard.getByText('edge.example.test', { exact: true })).toBeVisible();
  await expect(reverseDnsCard.getByText(/does not prove hosting control/i)).toBeVisible();
  await page.locator('.export-menu > summary').click();
  await expect(page.getByRole('button', { name: 'Download report' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
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
  await expandLookupFamilies(page);
  const rdapSection = page.locator('.sources > details').first();
  await expect(rdapSection).not.toHaveAttribute('open', '');
  await rdapSection.locator(':scope > summary').click();
  await expect(rdapSection.getByText('Example Autonomous System', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('64496 – 64500', { exact: true })).toBeVisible();
  await expect(rdapSection.getByText('active', { exact: true })).toBeVisible();
  await expect(rdapSection.locator('time[datetime="2003-04-05T06:07:08.000Z"]')).toBeVisible();
  await expect(rdapSection.locator('time[datetime="2024-05-06T07:08:09.000Z"]')).toBeVisible();
  await page.locator('.export-menu > summary').click();
  await expect(page.getByRole('button', { name: 'Download report' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});
