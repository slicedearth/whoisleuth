import type { LookupViewModel } from '../analysis/lookup-response.ts';
import { lookupWebEvidenceSources } from '../analysis/lookup-route-projections.ts';

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
  const sources = lookupWebEvidenceSources(view);
  return {
    network: {
      visible: sources.network,
      load: () => import('./LookupNetworkContext.svelte'),
    },
    reverseDns: { visible: sources.reverseDns, load: dns },
    dns: { visible: sources.dns, load: dns },
    serviceDependency: {
      visible: sources.dns && context.serviceDependency,
      load: () => import('./LookupServiceDependencyReview.svelte'),
    },
    http: {
      visible: sources.http,
      load: () => import('./LookupHttpEvidence.svelte'),
    },
    tls: { visible: sources.tls, load: () => import('./LookupTlsEvidence.svelte') },
    certificatePolicy: {
      visible: sources.tls,
      load: () => import('./LookupCertificatePolicyReview.svelte'),
    },
    sslbl: {
      visible: sources.sslbl,
      load: () => import('./LookupSslblEvidence.svelte'),
    },
    disclosure: {
      visible: sources.disclosure,
      load: () => import('./LookupSecurityTxt.svelte'),
    },
    page: {
      visible: sources.page,
      load: () => import('./LookupPageIdentity.svelte'),
    },
    credentials: {
      visible: sources.credentials,
      load: () => import('./LookupCredentialSurfaceProfile.svelte'),
    },
    posture: {
      visible: sources.posture,
      load: () => import('./LookupSecurityPosture.svelte'),
    },
    structuredIdentity: {
      visible: sources.structuredIdentity,
      load: () => import('./LookupStructuredDataIdentity.svelte'),
    },
    technology: {
      visible: sources.technology,
      load: () => import('./LookupTechnologyProfile.svelte'),
    },
    behaviour: {
      visible: sources.pageRole && sources.clientBehaviour,
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
