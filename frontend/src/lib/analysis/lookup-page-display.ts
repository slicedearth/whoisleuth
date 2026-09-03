import type { JsonRecord } from './lookup-display-shared.ts';
import { publicationMetadataDisplay } from './lookup-homepage-metadata-display.ts';
import { buildLookupPageIdentityDisplay } from './lookup-page-identity-display.ts';
import {
  buildLookupObservedNetworkDisplay,
  buildLookupPageComparisonDisplay,
} from './lookup-page-network-display.ts';
import {
  buildLookupPageProfileDisplay,
  buildLookupSecurityPostureDisplay,
} from './lookup-page-profile-display.ts';

export type LookupPageDisplayInput = Readonly<{
  pageIdentity: JsonRecord;
  pagePublicationMetadata?: JsonRecord;
  pageCanonical: JsonRecord;
  pageMetaRefresh: JsonRecord;
  pageOpenGraph: JsonRecord;
  pageOpenGraphUrl: JsonRecord;
  pageForms: JsonRecord;
  pageResources: JsonRecord;
  pageResourceTypes: JsonRecord;
  pageDownloads: JsonRecord;
  pageFingerprints: JsonRecord;
  credentialSurfaceProfile: JsonRecord;
  structuredDataIdentity: JsonRecord;
  technologyProfile: JsonRecord;
  browserLibraryProfile: JsonRecord;
  pageRoleProfile: JsonRecord;
  clientBehaviorProfile: JsonRecord;
  observedNetworkContext: JsonRecord;
  observedNetworkEndpoint: JsonRecord;
  observedNetwork: JsonRecord;
  securityPosture: JsonRecord;
  securityPostureSummary: JsonRecord;
  pageComparison: JsonRecord | null;
}>;

export function buildLookupPageDisplay(input: LookupPageDisplayInput) {
  const identity = buildLookupPageIdentityDisplay({
    pageIdentity: input.pageIdentity,
    pageCanonical: input.pageCanonical,
    pageMetaRefresh: input.pageMetaRefresh,
    pageOpenGraph: input.pageOpenGraph,
    pageOpenGraphUrl: input.pageOpenGraphUrl,
    pageForms: input.pageForms,
    pageResources: input.pageResources,
    pageResourceTypes: input.pageResourceTypes,
    pageDownloads: input.pageDownloads,
    pageFingerprints: input.pageFingerprints,
  });
  const profiles = buildLookupPageProfileDisplay({
    credentialSurfaceProfile: input.credentialSurfaceProfile,
    structuredDataIdentity: input.structuredDataIdentity,
    technologyProfile: input.technologyProfile,
    browserLibraryProfile: input.browserLibraryProfile,
    pageRoleProfile: input.pageRoleProfile,
    clientBehaviorProfile: input.clientBehaviorProfile,
  });
  const observedNetwork = buildLookupObservedNetworkDisplay({
    observedNetworkContext: input.observedNetworkContext,
    observedNetworkEndpoint: input.observedNetworkEndpoint,
    observedNetwork: input.observedNetwork,
  });
  const securityPosture = buildLookupSecurityPostureDisplay({
    securityPosture: input.securityPosture,
    securityPostureSummary: input.securityPostureSummary,
  });
  return {
    pagePublicationMetadata: publicationMetadataDisplay(
      Object.keys(input.pagePublicationMetadata ?? {}).length
        ? input.pagePublicationMetadata ?? null
        : null,
    ),
    ...identity,
    ...profiles,
    ...observedNetwork,
    ...securityPosture,
    pageComparison: buildLookupPageComparisonDisplay(input.pageComparison),
  };
}
