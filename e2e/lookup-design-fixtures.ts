import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// Shared deterministic Lookup fixtures for design and interaction specifications.

const INTELLIGENCE_CAPABILITIES = {
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
};


function sectionedLookupFixture(domain: string) {
  return {
    query: domain, type: 'domain', registrableDomain: domain,
    availability: {
      state: 'registered', confidence: 'high', domain,
      source: 'rdap', domainAgeDays: 2_385, expiresInDays: 158,
      createdDateIso: '2020-01-02T00:00:00.000Z',
      expiryDateIso: '2027-01-02T00:00:00.000Z',
      registrar: { name: 'Fixture Registrar LLC' },
      nameservers: [`ns1.${domain}`, `ns2.${domain}`],
      dns: {
        status: 'partial', source: 'dns', scanMode: 'deep', complete: false, truncated: false,
        records: { a: ['192.0.2.10'], aaaa: [], cname: [], ns: [`ns1.${domain}`], mx: [], spf: [], dmarc: [], caa: [] },
        diagnostics: { cname: { status: 'error', error: 'resolver timed out' } },
      },
      http: {
        version: 1, status: 'success', observedAt: '2026-07-13T00:00:00.000Z', scanMode: 'deep', source: 'http',
        durationMs: 100, complete: true, truncated: false, limitations: [], diagnostics: {},
        requestUrl: `https://${domain}/`, finalUrl: `https://www.${domain}/home`, transportSecurity: 'https',
        redirectCount: 1, redirectLimitReached: false, crossOriginRedirect: false, httpsDowngrade: false,
        redirects: [{ status: 301, from: `https://${domain}/`, to: `https://www.${domain}/home`, queryOmitted: true }], attempts: [],
        response: {
          status: 200, contentType: 'text/html', contentLanguage: null, server: null,
          declaredContentLength: null, capturedBodyBytes: 1024, bodyInspected: true, bodyTruncated: false,
          bodyHash: null, securityHeaders: {},
        },
      },
    },
    reverseDns: {
      version: 1, status: 'success', source: 'reverse_dns',
      observedAt: '2026-07-13T00:00:00.000Z', scanMode: 'deep',
      durationMs: 8, complete: true, truncated: false,
      limitations: ['PTR context does not prove hosting control.'],
      diagnostics: { ptr: { status: 'success', count: 1 } },
      records: { ptr: [`edge.${domain}`] },
    },
    rdap: {
      upstreamStatus: 200,
      parsed: { domain, entitiesByRole: {}, lifecycle: { updatedDateIso: '2026-06-10T00:00:00.000Z' } },
      registrarRdap: {
        status: 'success',
        endpoint: 'https://registrar.example.test/domain/sectioned-result.invalid',
        fetchedAt: '2026-07-13T00:00:00.000Z',
        parsed: { domain, entitiesByRole: {} },
      },
    },
    whois: { parsed: {}, chain: [] },
    diagnostics: {
      rdap: { status: 'success', endpoint: 'https://rdap.example.test', registrar: { status: 'success' } },
      whois: { status: 'complete', authoritativeHop: 'whois.registry.example.test' },
      availability: { status: 'complete' },
      reverseDns: { status: 'success' },
    },
    registryInsights: {
      version: 1,
      lifecycle: {
        stage: 'registered',
        label: 'Registered',
        rawStatuses: ['active', 'client transfer prohibited'],
        locks: { client: true, server: false },
      },
      publications: [
        { source: 'registry_rdap', state: 'complete' },
        { source: 'whois', state: 'complete' },
      ],
      contactDisclosure: {
        registryRdap: { state: 'redacted' },
        whois: { state: 'unavailable' },
      },
      abuseRouting: [{
        kind: 'registrar',
        channel: 'email',
        contact: 'abuse@example.test',
        source: 'registrar fixture publication',
      }],
    },
  };
}

async function expectLookupTargetAligned(page: Page, selector: string): Promise<void> {
  await expect.poll(async () => page.locator(selector).evaluate((target) => {
    const targetTop = target.getBoundingClientRect().top;
    const targetDocumentTop = targetTop + window.scrollY;
    const scrollMarginTop = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const maximumScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const expectedScroll = Math.min(Math.max(0, targetDocumentTop - scrollMarginTop), maximumScroll);
    return Math.abs(window.scrollY - expectedScroll);
  }), {
    message: `${selector} should settle at its configured scroll anchor`,
    timeout: 5_000,
  }).toBeLessThanOrEqual(2);
}

export {
  INTELLIGENCE_CAPABILITIES,
  expectLookupTargetAligned,
  sectionedLookupFixture,
};
