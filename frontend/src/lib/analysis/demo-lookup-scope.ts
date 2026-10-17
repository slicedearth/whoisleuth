import { syntheticDemoCandidate, syntheticDemoLookupView } from './demo-model-core.ts';
import { buildLookupEvidenceScope } from './lookup-evidence-scope.ts';
import type { LookupHttpResponse } from './lookup-response.ts';

/** Adapt fixed fixture fields, not the editable query or a reconstructed response. */
export function syntheticDemoEvidenceScope(id: string) {
  const candidate = syntheticDemoCandidate(id);
  const view = syntheticDemoLookupView(id);
  if (!candidate || !view) return null;
  const publication = view.registry.insights.publications.find(item => item.source === 'registry_rdap');
  const original: LookupHttpResponse = {
    query: candidate.domain, type: 'domain', inputHostname: candidate.domain,
    registrableDomain: candidate.domain,
    rdap: {
      parsed: view.registry.rdapError ? {} : view.registry.rdapParsed,
      fetchedAt: publication?.state === 'complete' ? publication.observedAt : null,
    },
    whois: { parsed: view.registry.whoisParsed },
    diagnostics: {
      rdap: { status: view.registry.rdapError ? 'unavailable' : 'success' },
      whois: { status: view.registry.whoisError ? 'unavailable' : 'success' },
    },
    availability: {
      domain: candidate.domain,
      dns: { status: view.dns.status.toLowerCase(), records: { ns: [...candidate.evidence.dns.nameservers] } },
      http: { status: view.http.status.toLowerCase(), requestUrl: null, finalUrl: null },
      tls: {
        status: view.tls.status.toLowerCase(),
        observedAt: view.tls.complete ? view.tls.observedAt : null,
        certificate: { subjectAltNames: { dnsNames: view.tls.alternativeNames.map(item => item.value) } },
      },
    },
  };
  return buildLookupEvidenceScope(original);
}
