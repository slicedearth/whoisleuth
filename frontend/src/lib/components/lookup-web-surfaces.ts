import type { LookupViewModel } from '../analysis/lookup-response.ts';

/** Section-owned eligibility and imports, shared by rendering and intent loading. */
export function lookupWebSurfaces(
  view: LookupViewModel,
  context: {
    serviceDependency: boolean;
    pageComparison: boolean;
    brandMimicry: boolean;
  },
) {
  const dns = () => import('./LookupDnsEvidence.svelte');
  const tls = view.tlsEvidence.source === 'tls';
  return {
    network: {
      visible: view.observedNetworkContext.contextVersion === 1,
      load: () => import('./LookupNetworkContext.svelte'),
    },
    reverseDns: { visible: view.reverseDns.source === 'reverse_dns', load: dns },
    dns: { visible: view.dnsEvidence.source === 'dns', load: dns },
    serviceDependency: {
      visible: view.dnsEvidence.source === 'dns' && context.serviceDependency,
      load: () => import('./LookupServiceDependencyReview.svelte'),
    },
    http: {
      visible: view.httpEvidence.source === 'http',
      load: () => import('./LookupHttpEvidence.svelte'),
    },
    tls: { visible: tls, load: () => import('./LookupTlsEvidence.svelte') },
    certificatePolicy: {
      visible: tls,
      load: () => import('./LookupCertificatePolicyReview.svelte'),
    },
    sslbl: {
      visible: view.sslbl.sslblVersion === 1,
      load: () => import('./LookupSslblEvidence.svelte'),
    },
    disclosure: {
      visible: view.securityTxt.securityTxtVersion === 1,
      load: () => import('./LookupSecurityTxt.svelte'),
    },
    page: {
      visible: view.pageIdentity.source === 'html',
      load: () => import('./LookupPageIdentity.svelte'),
    },
    credentials: {
      visible: view.credentialSurfaceProfile.source === 'html',
      load: () => import('./LookupCredentialSurfaceProfile.svelte'),
    },
    posture: {
      visible: view.securityPosture.source === 'derived',
      load: () => import('./LookupSecurityPosture.svelte'),
    },
    structuredIdentity: {
      visible: view.structuredDataIdentity.source === 'html',
      load: () => import('./LookupStructuredDataIdentity.svelte'),
    },
    technology: {
      visible: view.technologyProfile.source === 'derived',
      load: () => import('./LookupTechnologyProfile.svelte'),
    },
    behaviour: {
      visible:
        view.pageRoleProfile.source === 'derived' &&
        view.clientBehaviorProfile.source === 'derived',
      load: () => import('./LookupPageRoleBehavior.svelte'),
    },
    comparison: {
      visible: context.pageComparison,
      load: () => import('./LookupPageComparison.svelte'),
    },
    brand: {
      visible: context.brandMimicry,
      load: () => import('./LookupBrandMimicryReview.svelte'),
    },
  };
}
export type LookupWebSurfaces = ReturnType<typeof lookupWebSurfaces>;
