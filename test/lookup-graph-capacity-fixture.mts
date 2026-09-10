import { createObservation } from '../packages/evidence/observation.mts';
import { MAX_LOOKUP_DNS_RECORDS_PER_TYPE, MAX_LOOKUP_TLS_ALT_NAMES } from '../lib/lookup-network-evidence-bounds.mts';
import { extractPageIdentity, MAX_FORM_ACTION_ORIGINS, MAX_RESOURCE_ORIGINS, MAX_TRACKING_IDENTIFIERS } from '../lib/html-signals.mts';
import { analyzeStructuredDataIdentity, MAX_STRUCTURED_DATA_ENTITIES, MAX_STRUCTURED_DATA_SAME_AS_HOSTS } from '../lib/structured-data-identity.mts';
import { buildTlsObservation } from '../lib/tls-intelligence.mts';

export function lookupGraphCapacityFixture() {
  const domain = 'example.test';
  const observedAt = '2026-09-01T00:00:00.000Z';
  const values = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}${index}.example.test`);
  const entities = Array.from({ length: MAX_STRUCTURED_DATA_ENTITIES }, (_, index) => ({
    '@type': 'Organization', name: `Publisher ${index}`, url: `https://publisher${index}.example/`,
    sameAs: Array.from({ length: MAX_STRUCTURED_DATA_SAME_AS_HOSTS }, (_, other) => `https://identity${index}-${other}.example/`),
  }));
  const html = '<!doctype html><html><head><title>Example evidence</title></head><body>'
    + Array.from({ length: MAX_RESOURCE_ORIGINS }, (_, index) => `<img src="https://resource${index}.example/image.png">`).join('')
    + Array.from({ length: MAX_FORM_ACTION_ORIGINS }, (_, index) => `<form action="https://form${index}.example/submit" method="post"></form>`).join('')
    + `<script>${Array.from({ length: MAX_TRACKING_IDENTIFIERS }, (_, index) => `'GTM-TEST${String(index).padStart(2, '0')}'`).join(';')}</script>`
    + `<script type="application/ld+json">${JSON.stringify(entities)}</script></body></html>`;
  const pageIdentity = extractPageIdentity(html, domain, { observedAt });
  const structuredDataIdentity = analyzeStructuredDataIdentity({ html, baseUrl: `https://${domain}/`, observedAt });
  const tls = buildTlsObservation({
    connectedAddress: '192.0.2.10', sniHost: domain, protocol: 'TLSv1.3',
    cipher: { name: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
    authorized: true, hostnameMatches: true,
    peerCertificate: {
      subject: { CN: domain }, issuer: { O: 'Example Certificate Authority', CN: 'Example Issuer' },
      subjectaltname: values(MAX_LOOKUP_TLS_ALT_NAMES, 'san').map(value => `DNS:${value}`).join(', '),
      serialNumber: '01', valid_from: 'Sep 1 00:00:00 2026 GMT', valid_to: 'Oct 1 00:00:00 2026 GMT',
      fingerprint256: Array.from({ length: 32 }, () => 'AA').join(':'), bits: 2048, ca: false,
    },
  }, { observedAt, now: new Date(observedAt) });
  return {
    query: domain, type: 'domain', registrableDomain: domain, observedAt,
    rdap: { upstreamStatus: 200, fetchedAt: observedAt, parsed: { domain, registrar: { name: 'Example Registrar' }, entitiesByRole: {} } },
    whois: {}, diagnostics: {},
    availability: {
      state: 'registered', confidence: 'high', domain,
      dns: { ...createObservation({ source: 'dns', status: 'success', complete: true, observedAt, scanMode: 'deep' }), records: {
        a: Array.from({ length: MAX_LOOKUP_DNS_RECORDS_PER_TYPE }, (_, index) => `192.0.2.${index + 1}`),
        aaaa: Array.from({ length: MAX_LOOKUP_DNS_RECORDS_PER_TYPE }, (_, index) => `2001:db8::${index + 1}`),
        cname: values(MAX_LOOKUP_DNS_RECORDS_PER_TYPE, 'alias'), ns: values(MAX_LOOKUP_DNS_RECORDS_PER_TYPE, 'ns'),
        mx: values(MAX_LOOKUP_DNS_RECORDS_PER_TYPE, 'mx').map(exchange => ({ exchange, priority: 10 })),
      } },
      tls, pageIdentity, structuredDataIdentity,
    },
  };
}
