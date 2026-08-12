import {
  boundedCredentialCount,
  boundedPostureCount,
  boundedTechnologyText,
  datedRow,
  formatDate,
  rec,
  records,
  show,
  statusLabel,
  stringList,
  trackingIdentifierLabel,
  type JsonRecord,
} from './lookup-display-shared.ts';
import { MAX_SECURITY_POSTURE_FINDINGS } from '../../../../lib/website-security-posture.mts';

export function buildLookupPageDisplay(input: {
  pageIdentity: JsonRecord;
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
}) {
  const {
    pageIdentity,
    pageCanonical,
    pageMetaRefresh,
    pageOpenGraph,
    pageOpenGraphUrl,
    pageForms,
    pageResources,
    pageResourceTypes,
    pageDownloads,
    pageFingerprints,
    credentialSurfaceProfile,
    structuredDataIdentity,
    technologyProfile,
    browserLibraryProfile,
    pageRoleProfile,
    clientBehaviorProfile,
    observedNetworkContext,
    observedNetworkEndpoint,
    observedNetwork,
    securityPosture,
    securityPostureSummary,
    pageComparison,
  } = input;
  const credentialSurfaceForms = rec(credentialSurfaceProfile.forms);
  const clientScriptSummary = rec(clientBehaviorProfile.scriptSummary);
  const credentialSurfaceMethods = rec(credentialSurfaceForms.methods);
  const credentialSurfaceActions = rec(credentialSurfaceForms.actions);
  const credentialSurfaceInputs = rec(credentialSurfaceProfile.inputs);
  const credentialSurfaceCategories = rec(credentialSurfaceInputs.categories);
  const exact = rec(pageFingerprints.exact);
  const normalizedHtml = rec(pageFingerprints.normalizedHtml);
  const visibleText = rec(pageFingerprints.visibleText);
  const domStructure = rec(pageFingerprints.domStructure);
  const formStructure = rec(pageFingerprints.formStructure);
  const resourceHosts = rec(pageFingerprints.resourceHosts);
  const identifiers = rec(pageFingerprints.identifiers);
  const resourceHostValues = Array.isArray(resourceHosts.values) ? resourceHosts.values : [];
  const identifierValues = Array.isArray(identifiers.values) ? identifiers.values : [];
  const fingerprints = [
    {
      label: 'Exact captured body',
      value: exact.value,
      detail: exact.scope === 'captured-prefix' ? 'Captured prefix' : 'Complete captured body',
    },
    {
      label: 'Normalised HTML',
      value: normalizedHtml.value,
      detail: `${show(normalizedHtml.tokenCount)} tokens`,
    },
    {
      label: 'Visible text',
      value: visibleText.value,
      detail: visibleText.value ? `${show(visibleText.tokenCount)} tokens · fuzzy SimHash` : null,
    },
    {
      label: 'Static tag structure',
      value: domStructure.value,
      detail: `${show(domStructure.nodeCount)} nodes`,
    },
    {
      label: 'Form structure',
      value: formStructure.value,
      detail: formStructure.value
        ? `${show(formStructure.formCount)} forms · ${show(formStructure.controlCount)} controls`
        : null,
    },
    {
      label: 'External resource hosts',
      value: resourceHosts.value,
      detail: resourceHosts.value ? `${resourceHostValues.length} hosts` : null,
    },
    {
      label: 'Tracking identifiers',
      value: identifiers.value,
      detail: identifiers.value ? `${identifierValues.length} identifiers` : null,
    },
  ]
    .filter((row) => row.value)
    .map((row) => ({ ...row, value: String(row.value) }));
  const technologyFindings = records(technologyProfile.findings)
    .slice(0, 24)
    .map((finding) => ({
      id: boundedTechnologyText(finding.id, 80),
      name: boundedTechnologyText(finding.name || 'Unknown indicator', 120),
      category: statusLabel(boundedTechnologyText(finding.category || 'technology', 80)),
      confidence: boundedTechnologyText(finding.confidence || 'unknown', 20),
      evidence: records(finding.evidence)
        .slice(0, 4)
        .map((item) => ({
          source: statusLabel(boundedTechnologyText(item.source || 'evidence', 80)),
          description: boundedTechnologyText(
            item.description || 'Observed signature matched.',
            300,
          ),
        })),
    }));
  const securityPostureFindings = records(
    securityPosture.findings,
    MAX_SECURITY_POSTURE_FINDINGS,
  )
    .map((finding) => {
      const states = new Set([
        'observed',
        'potential_exposure',
        'observed_absence',
        'unavailable',
      ]);
      const tones = new Set(['configured', 'review', 'neutral']);
      return {
        id: boundedTechnologyText(finding.id, 80),
        category: statusLabel(boundedTechnologyText(finding.category || 'posture', 80)),
        state: states.has(boundedTechnologyText(finding.state, 40))
          ? boundedTechnologyText(finding.state, 40)
          : 'unavailable',
        tone: tones.has(boundedTechnologyText(finding.tone, 40))
          ? boundedTechnologyText(finding.tone, 40)
          : 'neutral',
        label: boundedTechnologyText(finding.label || 'Posture finding', 160),
        detail: boundedTechnologyText(
          finding.detail || 'No additional detail is available.',
          300,
        ),
        evidence: stringList(finding.evidence)
          .slice(0, 4)
          .map((item) => boundedTechnologyText(item, 120))
          .filter(Boolean),
      };
    });
  const pageRoles = records(pageRoleProfile.findings)
    .slice(0, 4)
    .map((finding) => ({
      role: boundedTechnologyText(finding.role, 40),
      label: boundedTechnologyText(finding.label || 'Unclassified', 80),
      confidence: statusLabel(boundedTechnologyText(finding.confidence || 'low', 20)),
      evidence: stringList(finding.evidence)
        .slice(0, 4)
        .map((item) => boundedTechnologyText(item, 180))
        .filter(Boolean),
    }));

  return {
    pageIdentityFacts: [
      { label: 'Document language', value: show(pageIdentity.documentLanguage) },
      { label: 'Canonical URL', value: show(pageCanonical.url) },
      { label: 'Meta refresh target', value: show(pageMetaRefresh.url) },
      { label: 'Open Graph title', value: show(pageOpenGraph.title) },
      { label: 'Open Graph site', value: show(pageOpenGraph.siteName) },
      { label: 'Open Graph URL', value: show(pageOpenGraphUrl.url) },
      { label: 'Generator', value: show(pageIdentity.generator) },
      {
        label: 'Forms observed',
        value: `${show(pageForms.count)}${pageForms.truncated ? ' · capped' : ''}`,
      },
      { label: 'POST forms', value: show(pageForms.postCount) },
      {
        label: 'Insecure actions',
        value: show(pageForms.insecureActionCount),
        danger: Number(pageForms.insecureActionCount) > 0,
      },
      {
        label: 'Resource references',
        value: `${show(pageResources.count)}${pageResources.truncated ? ' · capped' : ''}`,
      },
      {
        label: 'External resources',
        value: Array.isArray(pageResources.externalOrigins)
          ? String(pageResources.externalOrigins.length)
          : '—',
      },
      {
        label: 'Embedded origins',
        value: Array.isArray(pageIdentity.embeddedOrigins)
          ? String(pageIdentity.embeddedOrigins.length)
          : '—',
      },
      {
        label: 'Contact domains',
        value: Array.isArray(pageIdentity.contactDomains)
          ? String(pageIdentity.contactDomains.length)
          : '—',
      },
      {
        label: 'Download links',
        value: `${show(pageDownloads.count)}${
          Number(pageDownloads.riskyCount) > 0 ? ` · ${pageDownloads.riskyCount} review` : ''
        }`,
      },
      {
        label: 'Tracking identifiers',
        value: Array.isArray(pageIdentity.trackingIdentifiers)
          ? String(pageIdentity.trackingIdentifiers.length)
          : '—',
      },
      {
        label: 'Page fingerprints',
        value: `${fingerprints.length}${pageFingerprints.truncated ? ' · partial' : ''}`,
      },
    ],
    resourceSummary: [
      ['Images', pageResourceTypes.image],
      ['Scripts', pageResourceTypes.script],
      ['Stylesheets', pageResourceTypes.stylesheet],
      ['Other links', pageResourceTypes.link],
      ['Frames', pageResourceTypes.frame],
      ['Media', pageResourceTypes.media],
      ['Objects', pageResourceTypes.object],
    ]
      .filter(([, value]) => Boolean(value))
      .map(([label, value]) => ({ label: String(label), value: show(value) }))
      .concat({
        label: 'External origins',
        value: stringList(pageResources.externalOrigins, 30, 2_048).join(', ') || 'None observed',
      }),
    downloadSummary: [
      { label: 'Explicit links', value: show(pageDownloads.explicitCount) },
      {
        label: 'Review file types',
        value: stringList(pageDownloads.riskyFileTypes, 20, 80).join(', ') || 'None observed',
      },
      {
        label: 'External origins',
        value: stringList(pageDownloads.externalOrigins, 20, 2_048).join(', ') || 'None observed',
      },
    ],
    trackingIdentifiers: records(pageIdentity.trackingIdentifiers, 30).map((identifier) => ({
      label: trackingIdentifierLabel(identifier.type),
      value: show(identifier.value),
    })),
    fingerprints,
    credentialSurface: {
      formCount: boundedCredentialCount(credentialSurfaceForms.count, 50),
      inputCount: boundedCredentialCount(credentialSurfaceInputs.count),
      classifiedCount: boundedCredentialCount(credentialSurfaceInputs.classifiedCount),
      categories: {
        password: boundedCredentialCount(credentialSurfaceCategories.password),
        email: boundedCredentialCount(credentialSurfaceCategories.email),
        username: boundedCredentialCount(credentialSurfaceCategories.username),
        oneTimeCode: boundedCredentialCount(credentialSurfaceCategories.one_time_code),
        payment: boundedCredentialCount(credentialSurfaceCategories.payment),
      },
      methods: {
        missing: boundedCredentialCount(credentialSurfaceMethods.missing, 50),
        get: boundedCredentialCount(credentialSurfaceMethods.get, 50),
        post: boundedCredentialCount(credentialSurfaceMethods.post, 50),
        dialog: boundedCredentialCount(credentialSurfaceMethods.dialog, 50),
        other: boundedCredentialCount(credentialSurfaceMethods.other, 50),
      },
      actions: {
        sameOrigin: boundedCredentialCount(credentialSurfaceActions.sameOrigin, 50),
        external: boundedCredentialCount(credentialSurfaceActions.external, 50),
        missing: boundedCredentialCount(credentialSurfaceActions.missing, 50),
        cleartext: boundedCredentialCount(credentialSurfaceActions.cleartext, 50),
        unclassified: boundedCredentialCount(credentialSurfaceActions.unclassified, 50),
      },
    },
    credentialSurfaceLimitations: stringList(credentialSurfaceProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    structuredIdentities: records(structuredDataIdentity.entities)
      .slice(0, 16)
      .map((entity) => ({
        types: stringList(entity.types)
          .slice(0, 8)
          .map((item) => boundedTechnologyText(item, 80))
          .filter(Boolean)
          .join(', '),
        name: boundedTechnologyText(entity.name, 160),
        declaredOrigin: boundedTechnologyText(entity.declaredOrigin, 2048),
        sameAsHosts: stringList(entity.sameAsHosts)
          .slice(0, 12)
          .map((item) => boundedTechnologyText(item, 253))
          .filter(Boolean)
          .join(', '),
      })),
    structuredIdentityLimitations: stringList(structuredDataIdentity.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    technologyFindings,
    technologyLimitations: stringList(technologyProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    pageRoles,
    primaryPageRole: pageRoles.find((role) => role.role === pageRoleProfile.primaryRole)?.label
      || pageRoles[0]?.label
      || 'Unclassified',
    pageRoleLimitations: stringList(pageRoleProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    clientScriptSummary: {
      elementsObserved: boundedCredentialCount(clientScriptSummary.elementsObserved),
      referencedScripts: boundedCredentialCount(clientScriptSummary.referencedScripts),
      inlineScripts: boundedCredentialCount(clientScriptSummary.inlineScripts),
      moduleScripts: boundedCredentialCount(clientScriptSummary.moduleScripts),
    },
    clientBehaviorIndicators: records(clientBehaviorProfile.indicators)
      .slice(0, 12)
      .map((indicator) => ({
        id: boundedTechnologyText(indicator.id, 80),
        label: boundedTechnologyText(indicator.label || 'Static indicator', 120),
        evidenceClass: statusLabel(boundedTechnologyText(indicator.evidenceClass || 'static evidence', 40)),
        occurrences: boundedCredentialCount(indicator.occurrences, 999),
        explanation: boundedTechnologyText(indicator.explanation || 'Static indicator observed.', 240),
      })),
    clientBehaviorLimitations: stringList(clientBehaviorProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    browserLibraries: records(browserLibraryProfile.findings)
      .slice(0, 16)
      .map((finding) => ({
        id: boundedTechnologyText(finding.id, 80),
        name: statusLabel(boundedTechnologyText(finding.name || 'unknown library', 80)),
        version: boundedTechnologyText(finding.apparentVersion || 'unknown', 64),
        detection: stringList(finding.detectionMethods).slice(0, 4).map(statusLabel).join(', '),
        advisoryCount: Math.max(0, Math.min(128, Number(finding.advisoryCount) || 0)),
        severity: boundedTechnologyText(finding.highestSeverity, 16),
        identifiers: stringList(finding.advisoryIdentifiers).slice(0, 16).join(', '),
        knownExploitedIdentifiers: stringList(finding.knownExploitedIdentifiers).slice(0, 16).join(', '),
        knownExploitedCount: Math.max(0, Math.min(16, Number(finding.knownExploitedCount) || 0)),
        weaknesses: stringList(finding.weaknessClasses).slice(0, 12).join(', '),
      })),
    browserLibraryLimitations: stringList(browserLibraryProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    observedNetworkSourceLabel:
      (
        {
          tls_connection: 'TLS connection',
          dns_a: 'DNS A fallback',
          dns_aaaa: 'DNS AAAA fallback',
        } as Record<string, string>
      )[String(observedNetworkEndpoint.selectedFrom)] || 'Unavailable',
    observedNetworkRows: Object.keys(observedNetwork).length
      ? [
          { label: 'Registered network', value: show(observedNetwork.name) },
          { label: 'Network holder', value: show(observedNetwork.holder) },
          { label: 'Handle', value: show(observedNetwork.handle) },
          {
            label: 'CIDR ranges',
            value:
              stringList(observedNetwork.cidrs)
                .slice(0, 16)
                .map((item) => boundedTechnologyText(item, 96))
                .filter(Boolean)
                .join(', ') || '—',
          },
          {
            label: 'Address range',
            value:
              [
                boundedTechnologyText(observedNetwork.startAddress, 64),
                boundedTechnologyText(observedNetwork.endAddress, 64),
              ]
                .filter(Boolean)
                .join(' to ') || '—',
          },
          { label: 'Country', value: show(observedNetwork.country) },
          { label: 'Network type', value: show(observedNetwork.networkType) },
          datedRow('RDAP database updated', observedNetwork.databaseUpdatedAt),
        ]
      : [],
    observedNetworkLimitations: stringList(observedNetworkContext.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    securityPostureSummary: {
      observed: boundedPostureCount(securityPostureSummary.observed),
      potentialExposure: boundedPostureCount(securityPostureSummary.potentialExposure),
      observedAbsence: boundedPostureCount(securityPostureSummary.observedAbsence),
      unavailable: boundedPostureCount(securityPostureSummary.unavailable),
    },
    securityPostureFindings,
    securityPostureLimitations: stringList(securityPosture.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    pageComparison: pageComparison
      ? {
          partial: Boolean(pageComparison.partial),
          referenceDomain: String(rec(pageComparison.reference).domain),
          referenceObservedAt: String(rec(pageComparison.reference).observedAt),
          referenceObservedLabel: formatDate(rec(pageComparison.reference).observedAt),
          components: records(pageComparison.components).map((item) => ({
            label: String(item.label),
            method: String(item.method),
            outcome: String(item.outcome),
            detail: String(item.detail),
            status: String(item.status),
            sharedValues: stringList(item.sharedValues),
          })),
        }
      : null,
  };
}
