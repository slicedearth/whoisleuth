import type { LookupViewModel } from '../analysis/lookup-response.ts';
import type { LookupWebSurfaces } from './lookup-web-surfaces.ts';

/** Rendering and intent loading use the same section-owned eligibility and loader. */
export function lookupSectionSurfaces(
  view: LookupViewModel,
  context: { domainResult: boolean; caseSection: boolean; web: LookupWebSurfaces },
) {
  return {
    registry: {
      access: {
        visible: Boolean(view.registryAccess.suffix),
        load: () => import('./RegistryAccessNotice.svelte'),
      },
      sources: { visible: true, load: () => import('./LookupRegistrySources.svelte') },
      disclosure: {
        visible:
          context.domainResult &&
          Array.isArray(view.rdapParsed.redactions) &&
          view.rdapParsed.redactions.length > 0,
        load: () => import('./RegistrationDisclosurePlanner.svelte'),
      },
    },
    'web-evidence': context.web,
    'relationships-history': {
      workspace: { visible: true, load: () => import('./LookupVisualWorkspace.svelte') },
    },
    'source-quality': {
      quality: { visible: true, load: () => import('./LookupEvidenceQuality.svelte') },
      facts: { visible: true, load: () => import('./LookupOverviewFacts.svelte') },
    },
    'case-response': {
      workspace: {
        visible: context.caseSection,
        load: () => import('./LookupCaseResponse.svelte'),
      },
    },
    'advanced-evidence': {
      intelligence: {
        visible: view.threatIntelligenceProviders.length > 0,
        load: () => import('./LookupExternalIntelligence.svelte'),
      },
    },
  };
}
