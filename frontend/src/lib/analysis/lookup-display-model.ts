import type { LookupHttpResponse } from './lookup-response.ts';
import {
  boundedCredentialCount,
  boundedPostureCount,
  boundedTechnologyText,
  datedRow,
  dateTimeAttribute,
  firstText,
  formatDate,
  rec,
  records,
  show,
  statusLabel,
  stringList,
  textOrNull,
  trackingIdentifierLabel,
  type JsonRecord,
  type PublicationComparison,
  type RegistryComparison,
  type SourceStatus,
} from './lookup-display-shared.ts';

export {
  boundedTechnologyText,
  dateTimeAttribute,
  formatDate,
  isRecord,
  rec,
  records,
  show,
  statusLabel,
  stringList,
  type JsonRecord,
  type SourceStatus,
} from './lookup-display-shared.ts';

export function buildLookupLifecycleDates(input: {
  availability: JsonRecord;
  rdapParsed: JsonRecord;
  whoisParsed: JsonRecord;
}) {
  const { availability, rdapParsed, whoisParsed } = input;
  const eventDate = (action: string) =>
    textOrNull(records(rdapParsed.events).find((item) => item.action === action)?.date);
  const rdapLifecycle = rec(rdapParsed.lifecycle);
  const whoisLifecycle = rec(whoisParsed.lifecycle);

  return {
    created: firstText(
      availability.createdDateIso,
      availability.createdDate,
      rdapLifecycle.createdDateIso,
      rdapLifecycle.createdDate,
      eventDate('registration'),
      whoisParsed.createdDateIso,
      whoisLifecycle.createdDateIso,
      whoisParsed.createdDate,
    ),
    expires: firstText(
      availability.expiryDateIso,
      availability.expiryDate,
      rdapLifecycle.expiryDateIso,
      rdapLifecycle.expiryDate,
      eventDate('expiration'),
      whoisParsed.expiryDateIso,
      whoisLifecycle.expiryDateIso,
      whoisParsed.expiryDate,
    ),
    updated: firstText(
      rdapLifecycle.updatedDateIso,
      rdapLifecycle.updatedDate,
      eventDate('last changed'),
      whoisParsed.updatedDateIso,
      whoisLifecycle.updatedDateIso,
      whoisParsed.updatedDate,
    ),
  };
}

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
      label: 'Normalized HTML',
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
  const securityPostureFindings = records(securityPosture.findings)
    .slice(0, 20)
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
        state: states.has(String(finding.state)) ? String(finding.state) : 'unavailable',
        tone: tones.has(String(finding.tone)) ? String(finding.tone) : 'neutral',
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
        value: stringList(pageResources.externalOrigins).join(', ') || 'None observed',
      }),
    downloadSummary: [
      { label: 'Explicit links', value: show(pageDownloads.explicitCount) },
      {
        label: 'Review file types',
        value: stringList(pageDownloads.riskyFileTypes).join(', ') || 'None observed',
      },
      {
        label: 'External origins',
        value: stringList(pageDownloads.externalOrigins).join(', ') || 'None observed',
      },
    ],
    trackingIdentifiers: records(pageIdentity.trackingIdentifiers).map((identifier) => ({
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

function assessment(status: string): string {
  return (
    {
      equivalent: 'Equivalent',
      conflict: 'Conflict',
      rdap_only: 'RDAP only',
      whois_only: 'WHOIS only',
      rdap_redacted: 'RDAP redacted',
      whois_redacted: 'WHOIS redacted',
      rdap_unavailable: 'RDAP unavailable',
      whois_unavailable: 'WHOIS unavailable',
      rdap_incomplete: 'RDAP incomplete',
      whois_incomplete: 'WHOIS incomplete',
    } as Record<string, string>
  )[status] || status;
}

function publicationAssessment(status: string): string {
  return (
    {
      equivalent: 'Equivalent',
      conflict: 'Conflict',
      registry_only: 'Registry only',
      registrar_only: 'Registrar only',
      registry_redacted: 'Registry redacted',
      registrar_redacted: 'Registrar redacted',
      registry_unavailable: 'Registry unavailable',
      registrar_unavailable: 'Registrar unavailable',
      registry_incomplete: 'Registry incomplete',
      registrar_incomplete: 'Registrar incomplete',
    } as Record<string, string>
  )[status] || status;
}

function diagnosticLabel(source: SourceStatus): string {
  return source.status ? statusLabel(source.status) : 'unknown';
}

function attemptSummary(source: SourceStatus): string | null {
  return Array.isArray(source.attempts) && source.attempts.length
    ? `attempts: ${source.attempts
        .map((item) => statusLabel(String(item.outcome || 'unknown')))
        .join(' → ')}`
    : null;
}

function diagnosticDetail(source: SourceStatus): string {
  return (
    [
      source.endpoint,
      source.transportSecurity === 'http' ? 'transport: cleartext HTTP' : null,
      source.httpStatus ? `HTTP ${source.httpStatus}` : null,
      attemptSummary(source),
      source.resultState ? `result: ${source.resultState}` : null,
      source.errorCode,
      source.authoritativeHop ? `authoritative: ${show(source.authoritativeHop)}` : null,
      source.failedHop ? `failed: ${show(source.failedHop)}` : null,
      source.fetchedAt ? `fetched ${formatDate(source.fetchedAt)}` : null,
      source.queriedAt ? `queried ${formatDate(source.queriedAt)}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'No additional source detail'
  );
}

function contactIdentity(contact: JsonRecord): string {
  return show(contact.name || contact.org || contact.handle);
}

function contactDetails(contact: JsonRecord): string[] {
  return [
    Array.isArray(contact.organizations) && contact.organizations.length
      ? `Organizations: ${contact.organizations.join(', ')}`
      : null,
    Array.isArray(contact.emails) && contact.emails.length
      ? `Email: ${contact.emails.join(', ')}`
      : null,
    Array.isArray(contact.phones) && contact.phones.length
      ? `Phone: ${contact.phones.join(', ')}`
      : null,
    Array.isArray(contact.addresses) && contact.addresses.length
      ? `Address: ${contact.addresses.join(' · ')}`
      : null,
    records(contact.publicIds).length
      ? `IDs: ${records(contact.publicIds)
          .map((item) => `${item.type}: ${item.identifier}`)
          .join(', ')}`
      : null,
    records(contact.links).length
      ? `Links: ${records(contact.links)
          .map((item) => item.href)
          .join(', ')}`
      : null,
  ].filter(Boolean) as string[];
}

export function buildLookupRegistryDisplay(input: {
  result: LookupHttpResponse | null;
  rdapParsed: JsonRecord;
  whoisParsed: JsonRecord;
  whoisContactsByRole: JsonRecord;
  populatedWhoisRoles: string[];
  comparison: RegistryComparison;
  registrarRdap: SourceStatus;
  registrarRdapParsed: JsonRecord;
  registrarPublicationComparison: PublicationComparison;
}) {
  const {
    result,
    rdapParsed,
    whoisParsed,
    whoisContactsByRole,
    populatedWhoisRoles,
    comparison,
    registrarRdap,
    registrarRdapParsed,
    registrarPublicationComparison,
  } = input;
  const matrixState = (sourceState: string | undefined, comparisonStatus: string): string => {
    if (sourceState === 'value') {
      if (comparisonStatus === 'equivalent') return 'equal';
      if (comparisonStatus === 'conflict') return 'conflict';
      return 'observed';
    }
    if (sourceState === 'redacted' || sourceState === 'incomplete') return 'partial';
    if (sourceState === 'unavailable') return 'unavailable';
    if (sourceState === 'absent') return 'not_collected';
    return comparisonStatus;
  };
  const comparisonRows = comparison.fields.map((field) => ({
    label: field.label,
    rdapValue: field.rdapDisplay,
    whoisValue: field.whoisDisplay,
    status: field.status,
    rdapMatrixState: matrixState(field.rdapState, field.status),
    whoisMatrixState: matrixState(field.whoisState, field.status),
    assessment: assessment(field.status),
    tone:
      field.status === 'conflict'
        ? 'danger'
        : field.status === 'equivalent'
          ? 'good'
          : ['rdap_unavailable', 'whois_unavailable', 'rdap_incomplete', 'whois_incomplete'].includes(
                field.status,
              )
            ? 'warn'
            : '',
  }));
  const publicationRows = registrarPublicationComparison.fields.map((field) => ({
    label: field.label,
    registryValue: field.registryDisplay,
    registrarValue: field.registrarDisplay,
    status: field.status,
    registryMatrixState: matrixState(field.registryState, field.status),
    registrarMatrixState: matrixState(field.registrarState, field.status),
    assessment: publicationAssessment(field.status),
    tone:
      field.status === 'conflict'
        ? 'danger'
        : field.status === 'equivalent'
          ? 'good'
          : [
                'registry_unavailable',
                'registrar_unavailable',
                'registry_incomplete',
                'registrar_incomplete',
              ].includes(field.status)
            ? 'warn'
            : '',
  }));
  const rows: Array<{ label: string; value: string; datetime?: string }> = [];
  if (result?.type === 'ipv4' || result?.type === 'ipv6') {
    rows.push(
      { label: 'Handle', value: show(rdapParsed.handle) },
      { label: 'Name', value: show(rdapParsed.name) },
      {
        label: 'Range',
        value: `${show(rdapParsed.startAddress)} – ${show(rdapParsed.endAddress)}`,
      },
      {
        label: 'CIDRs',
        value: `${show(rdapParsed.cidrs)}${rdapParsed.cidrsTruncated ? ' (capped)' : ''}`,
      },
      { label: 'Country', value: show(rdapParsed.country) },
      { label: 'Type', value: show(rdapParsed.networkType) },
      {
        label: 'Status',
        value: `${show(rdapParsed.statuses)}${rdapParsed.statusesTruncated ? ' (capped)' : ''}`,
      },
      datedRow('Registered', rec(rdapParsed.lifecycle).createdDate),
      datedRow('Updated', rec(rdapParsed.lifecycle).updatedDate),
    );
  } else if (result?.type === 'asn') {
    rows.push(
      { label: 'Handle', value: show(rdapParsed.handle) },
      { label: 'Name', value: show(rdapParsed.name) },
      {
        label: 'AS range',
        value: `${show(rdapParsed.startAutnum)} – ${show(rdapParsed.endAutnum)}`,
      },
      { label: 'Country', value: show(rdapParsed.country) },
      { label: 'Type', value: show(rdapParsed.autnumType) },
      {
        label: 'Status',
        value: `${show(rdapParsed.statuses)}${rdapParsed.statusesTruncated ? ' (capped)' : ''}`,
      },
      datedRow('Registered', rec(rdapParsed.lifecycle).createdDate),
      datedRow('Updated', rec(rdapParsed.lifecycle).updatedDate),
    );
  }
  rows.push(
    { label: 'Object class', value: show(rdapParsed.objectClassName) },
    { label: 'Language', value: show(rdapParsed.language) },
    {
      label: 'Conformance',
      value: `${show(rdapParsed.conformance)}${rdapParsed.conformanceTruncated ? ' (capped)' : ''}`,
    },
    {
      label: 'Lifecycle events',
      value: `${Array.isArray(rdapParsed.events) ? rdapParsed.events.length : 0}${
        rdapParsed.eventsTruncated ? ' (capped)' : ''
      }`,
    },
    {
      label: 'RDAP database updated',
      value: formatDate(rec(rdapParsed.lifecycle).databaseUpdatedDate),
    },
    { label: 'Port 43', value: show(rdapParsed.port43) },
    { label: 'Parent handle', value: show(rdapParsed.parentHandle) },
  );

  return {
    comparisonRows,
    rdapPartialDetail: rdapParsed.serverTruncated
      ? `The registry reported that some RDAP data was omitted.${
          stringList(rdapParsed.serverTruncationReasons).length
            ? ` ${stringList(rdapParsed.serverTruncationReasons).join(' · ')}.`
            : ''
        }`
      : '',
    rdapRows: rows,
    whoisRows: [
      { label: 'Domain', value: show(whoisParsed.domainName) },
      { label: 'Registry ID', value: show(whoisParsed.registryDomainId) },
      { label: 'Registrar', value: show(whoisParsed.registrar) },
      { label: 'Registrar ID', value: show(whoisParsed.registrarIanaId) },
      { label: 'Registrar WHOIS', value: show(whoisParsed.registrarWhoisServer) },
      { label: 'Reseller', value: show(whoisParsed.reseller) },
      { label: 'Created', value: formatDate(rec(whoisParsed.lifecycle).createdDate) },
      { label: 'Expires', value: formatDate(rec(whoisParsed.lifecycle).expiryDate) },
      { label: 'Updated', value: formatDate(rec(whoisParsed.lifecycle).updatedDate) },
      { label: 'DNSSEC', value: show(whoisParsed.dnssec) },
      { label: 'Status', value: show(whoisParsed.statuses) },
      { label: 'Nameservers', value: show(whoisParsed.nameservers) },
      { label: 'Chain', value: show(whoisParsed.chainStatus) },
    ],
    whoisContactRoles: populatedWhoisRoles.map((role) => ({
      role,
      contacts: records(whoisContactsByRole[role]).map((contact) => ({
        identity: contactIdentity(contact),
        details: contactDetails(contact),
      })),
    })),
    registrarRdap: {
      visible: Boolean(registrarRdap.status),
      label: diagnosticLabel(registrarRdap),
      endpoint: registrarRdap.endpoint ? String(registrarRdap.endpoint) : '',
      detail: [
        registrarRdap.upstreamStatus ? `HTTP ${registrarRdap.upstreamStatus}` : null,
        registrarRdap.fetchedAt ? `Fetched ${formatDate(registrarRdap.fetchedAt)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      stateDetail: show(registrarRdap.detail),
      error: registrarRdap.status === 'error',
      success: registrarRdap.status === 'success',
      parsed: registrarRdapParsed,
      comparisonSummary: `Registry / registrar publication comparison · ${registrarPublicationComparison.counts.conflict} conflicts · ${
        registrarPublicationComparison.counts.registry_only +
        registrarPublicationComparison.counts.registrar_only
      } source-only · ${
        registrarPublicationComparison.counts.registry_redacted +
        registrarPublicationComparison.counts.registrar_redacted
      } redacted · ${
        registrarPublicationComparison.counts.registry_unavailable +
        registrarPublicationComparison.counts.registrar_unavailable +
        registrarPublicationComparison.counts.registry_incomplete +
        registrarPublicationComparison.counts.registrar_incomplete
      } unavailable/incomplete · ${registrarPublicationComparison.counts.equivalent} equivalent`,
      comparisonRows: publicationRows,
    },
    diagnosticLabel,
    diagnosticDetail,
  };
}

function httpsServiceBindingValue(value: unknown): string {
  const record = rec(value);
  const parameters = rec(record.parameters);
  const mode = record.mode === 'alias' ? 'Alias' : 'Service';
  const target =
    record.serviceUnavailable === true
      ? 'advisory unavailable'
      : record.targetIsOwner === true
        ? 'owner'
        : boundedTechnologyText(record.target, 253) || 'target unavailable';
  return [
    `${mode} priority ${
      Number.isInteger(Number(record.priority)) ? Number(record.priority) : '—'
    } → ${target}`,
    stringList(parameters.alpn).length
      ? `ALPN ${stringList(parameters.alpn)
          .slice(0, 16)
          .map((item) => boundedTechnologyText(item, 132))
          .join(', ')}`
      : '',
    parameters.port !== null &&
    parameters.port !== undefined &&
    Number.isInteger(Number(parameters.port))
      ? `port ${Number(parameters.port)}`
      : '',
    stringList(parameters.ipv4hint).length
      ? `IPv4 hints ${stringList(parameters.ipv4hint)
          .slice(0, 8)
          .map((item) => boundedTechnologyText(item, 64))
          .join(', ')}`
      : '',
    stringList(parameters.ipv6hint).length
      ? `IPv6 hints ${stringList(parameters.ipv6hint)
          .slice(0, 8)
          .map((item) => boundedTechnologyText(item, 64))
          .join(', ')}`
      : '',
    records(parameters.opaque).length
      ? `Published ${records(parameters.opaque)
          .slice(0, 24)
          .map((item) => boundedTechnologyText(item.name || `key ${item.key}`, 63))
          .filter(Boolean)
          .join(', ')}`
      : '',
    Array.isArray(parameters.unsupportedMandatoryKeys) &&
    parameters.unsupportedMandatoryKeys.length
      ? `unsupported mandatory keys ${parameters.unsupportedMandatoryKeys
          .slice(0, 24)
          .map(Number)
          .join(', ')}`
      : '',
    record.compatible === false ? 'not compatible with this parser' : '',
    Number.isInteger(Number(record.ttl)) ? `TTL ${Number(record.ttl)}s` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;
}

function tlsName(value: JsonRecord): string {
  const common = Array.isArray(value.commonNames) ? value.commonNames : [];
  const organizations = Array.isArray(value.organizations) ? value.organizations : [];
  return [...common, ...organizations].join(' · ') || '—';
}

function tlsMetadataCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 999) : 0;
}

function tlsCountSummary(value: unknown, labels: Array<[string, string]>): string {
  const source = rec(value);
  return labels
    .map(([key, label]) => [label, tlsMetadataCount(source[key])] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ');
}

export function buildLookupNetworkDisplay(input: {
  availability: JsonRecord;
  reverseDns: JsonRecord;
  reverseDnsRecords: JsonRecord;
  dnsEvidence: JsonRecord;
  dnsRecords: JsonRecord;
  httpEvidence: JsonRecord;
  httpResponse: JsonRecord;
  httpSecurityHeaders: JsonRecord;
  tlsEvidence: JsonRecord;
  tlsCertificate: JsonRecord;
  tlsSubject: JsonRecord;
  tlsIssuer: JsonRecord;
  tlsAltNames: JsonRecord;
  tlsPublicKey: JsonRecord;
  tlsCipher: JsonRecord;
  tlsAuthorization: JsonRecord;
  tlsHostname: JsonRecord;
  tlsValidity: JsonRecord;
  tlsDiagnostics: JsonRecord;
}) {
  const {
    availability,
    reverseDns,
    reverseDnsRecords,
    dnsEvidence,
    dnsRecords,
    httpEvidence,
    httpResponse,
    httpSecurityHeaders,
    tlsEvidence,
    tlsCertificate,
    tlsSubject,
    tlsIssuer,
    tlsAltNames,
    tlsPublicKey,
    tlsCipher,
    tlsAuthorization,
    tlsHostname,
    tlsValidity,
    tlsDiagnostics,
  } = input;
  const dnsValues = (name: string) => {
    const values = Array.isArray(dnsRecords[name]) ? dnsRecords[name] : [];
    return values
      .map((value) => {
        if (typeof value === 'string') return value;
        const record = rec(value);
        if (name === 'mx') return `${record.priority} ${record.exchange || '.'}`;
        if (name === 'caa') return `${record.critical} ${record.tag} ${record.value}`;
        if (name === 'soa') {
          return `${record.nsname} · hostmaster ${record.hostmaster} · serial ${record.serial} · refresh ${record.refresh}s · retry ${record.retry}s · expire ${record.expire}s · minimum TTL ${record.minttl}s`;
        }
        return name === 'https' ? httpsServiceBindingValue(record) : String(value);
      })
      .filter(Boolean)
      .join(' | ');
  };
  const dnsDisplay = (name: string) =>
    dnsEvidence.status === 'skipped' ? 'Not evaluated' : dnsValues(name) || 'Not observed';
  const dnsRows: Array<{ label: string; value: string }> = [
    { label: 'DNSSEC', value: show(availability.dnssec) },
  ];
  for (const [label, name] of [
    ['A', 'a'],
    ['AAAA', 'aaaa'],
    ['CNAME', 'cname'],
    ['Nameservers', 'ns'],
    ['MX', 'mx'],
    ['SPF', 'spf'],
    ['DMARC', 'dmarc'],
    ['CAA', 'caa'],
  ] as const) {
    dnsRows.push({ label, value: dnsDisplay(name) });
  }
  if (Array.isArray(dnsRecords.soa) || rec(dnsEvidence.diagnostics).soa) {
    dnsRows.push({ label: 'SOA', value: dnsDisplay('soa') });
  }
  if (Array.isArray(dnsRecords.https) || rec(dnsEvidence.diagnostics).https) {
    dnsRows.push({ label: 'HTTPS service binding', value: dnsDisplay('https') });
  }
  const delegation = rec(dnsEvidence.delegation);
  const delegationFindings = records(delegation.findings).slice(0, 8).map((item) => ({
    id: boundedTechnologyText(item.id, 80),
    label: boundedTechnologyText(item.label, 120),
    state: ['healthy', 'warning', 'danger', 'unknown'].includes(String(item.state))
      ? String(item.state)
      : 'unknown',
    summary: boundedTechnologyText(item.summary, 240),
    detail: boundedTechnologyText(item.detail, 800),
    remediation: boundedTechnologyText(item.remediation, 400),
  }));
  const delegationAuthorities = records(delegation.authorities).slice(0, 4).map((item) => ({
    nameserver: boundedTechnologyText(item.nameserver, 253),
    state: ['success', 'lame', 'unreachable'].includes(String(item.state))
      ? String(item.state)
      : 'unreachable',
    addressSource: item.addressSource === 'registry_glue' ? 'Registry glue' : 'Recursive address',
    addresses: stringList(item.addresses).slice(0, 2),
    nameservers: stringList(item.nameservers).slice(0, 16),
    soaPrimary: boundedTechnologyText(item.soaPrimary, 253),
  }));
  const dnsDelegation = delegation.delegationHealthVersion === 1
    ? {
        status: statusLabel(show(delegation.status)),
        complete: delegation.complete === true,
        detail: boundedTechnologyText(delegation.detail, 300),
        parentNameservers: stringList(rec(delegation.parent).nameservers).slice(0, 16),
        registryNameservers: stringList(rec(delegation.registry).nameservers).slice(0, 16),
        findings: delegationFindings,
        authorities: delegationAuthorities,
        limitations: stringList(delegation.limitations).slice(0, 8),
      }
    : null;
  const httpSecurityRows: Array<[string, unknown]> = [
    ['HSTS', httpSecurityHeaders.strictTransportSecurity],
    ['Content Security Policy', httpSecurityHeaders.contentSecurityPolicy],
    ['Frame protection', httpSecurityHeaders.xFrameOptions],
    ['Content-type protection', httpSecurityHeaders.xContentTypeOptions],
    ['Referrer policy', httpSecurityHeaders.referrerPolicy],
  ];
  const httpMetadata: Array<{ label: string; value: string; hash?: boolean }> = [];
  if (httpResponse.status) {
    httpMetadata.push(
      ...httpSecurityRows.map(([label, value]) => ({
        label,
        value: value === 'observed' ? 'Observed' : show(value),
      })),
      { label: 'Server', value: show(httpResponse.server) },
      { label: 'Content language', value: show(httpResponse.contentLanguage) },
      {
        label: 'Declared length',
        value:
          httpResponse.declaredContentLength === null ||
          httpResponse.declaredContentLength === undefined
            ? '—'
            : formatBytes(httpResponse.declaredContentLength),
      },
    );
    const bodyHash = rec(httpResponse.bodyHash);
    if (bodyHash.value) {
      httpMetadata.push(
        { label: 'Body SHA-256', value: show(bodyHash.value), hash: true },
        {
          label: 'Hash scope',
          value:
            bodyHash.scope === 'captured-prefix'
              ? `Captured prefix (${formatBytes(bodyHash.bytes)})`
              : `Complete captured body (${formatBytes(bodyHash.bytes)})`,
        },
      );
    }
  }
  const leafCertificate: Array<{ label: string; value: string; hash?: boolean }> = [];
  if (tlsCertificate.fingerprintSha256) {
    leafCertificate.push(
      { label: 'Subject', value: tlsName(tlsSubject) },
      { label: 'Issuer', value: tlsName(tlsIssuer) },
      { label: 'Serial number', value: show(tlsCertificate.serialNumber), hash: true },
      { label: 'Valid from', value: formatDate(tlsCertificate.validFrom) },
      { label: 'Valid to', value: formatDate(tlsCertificate.validTo) },
      {
        label: 'Certificate SHA-256',
        value: show(tlsCertificate.fingerprintSha256),
        hash: true,
      },
      {
        label: 'Public key',
        value: `${show(tlsPublicKey.type)}${
          tlsPublicKey.bits ? ` · ${tlsPublicKey.bits} bits` : ''
        }${tlsPublicKey.curve ? ` · ${tlsPublicKey.curve}` : ''}`,
      },
    );
    if (tlsPublicKey.fingerprintSha256) {
      leafCertificate.push({
        label: 'Public-key SHA-256',
        value: show(tlsPublicKey.fingerprintSha256),
        hash: true,
      });
    }
    const signature = rec(tlsCertificate.signature);
    if (signature.algorithm || signature.oid) {
      leafCertificate.push({
        label: 'Signature',
        value: [signature.algorithm, signature.oid ? `(${signature.oid})` : null]
          .filter(Boolean)
          .join(' '),
      });
    }
    const purposes = rec(tlsCertificate.extendedKeyUsage);
    if (Object.keys(purposes).length) {
      const values = records(purposes.values)
        .slice(0, 8)
        .map((purpose) => `${show(purpose.name)} (${show(purpose.oid)})`);
      const omitted = Array.isArray(purposes.values)
        ? Math.max(0, purposes.values.length - values.length)
        : 0;
      leafCertificate.push({
        label: 'Certificate purposes',
        value: `${values.join(' · ') || 'None declared'}${
          omitted ? ` · +${omitted} more` : ''
        }${purposes.truncated ? ' · source truncated' : ''}`,
      });
    }
    const sanClasses = tlsCountSummary(tlsAltNames.classes, [
      ['dns', 'DNS'],
      ['ip', 'IP'],
      ['email', 'email'],
      ['uri', 'URI'],
      ['directoryName', 'directory name'],
      ['registeredId', 'registered ID'],
      ['otherName', 'other name'],
      ['unclassified', 'other'],
    ]);
    if (Object.keys(rec(tlsAltNames.classes)).length) {
      leafCertificate.push({
        label: 'SAN classes',
        value: `${sanClasses || 'None observed'}${tlsAltNames.truncated ? ' · truncated' : ''}`,
      });
    }
    const aia = rec(tlsCertificate.authorityInformationAccess);
    if (Object.keys(aia).length) {
      const ocsp = rec(aia.ocsp);
      const issuers = rec(aia.caIssuers);
      const values = [
        tlsMetadataCount(ocsp.total)
          ? `OCSP ${tlsMetadataCount(ocsp.total)} (${tlsMetadataCount(
              ocsp.https,
            )} HTTPS, ${tlsMetadataCount(ocsp.http)} HTTP, ${tlsMetadataCount(ocsp.other)} other)`
          : null,
        tlsMetadataCount(issuers.total)
          ? `CA issuers ${tlsMetadataCount(issuers.total)} (${tlsMetadataCount(
              issuers.https,
            )} HTTPS, ${tlsMetadataCount(issuers.http)} HTTP, ${tlsMetadataCount(
              issuers.other,
            )} other)`
          : null,
        tlsMetadataCount(aia.unknownMethods)
          ? `Unknown methods ${tlsMetadataCount(aia.unknownMethods)}`
          : null,
      ].filter(Boolean);
      leafCertificate.push({
        label: 'AIA presence',
        value: `${values.join(' · ') || 'None declared'}${aia.truncated ? ' · truncated' : ''}`,
      });
    }
  }

  return {
    dnsRows,
    dnsDelegation,
    dnsQueryFailures: Object.entries(rec(dnsEvidence.diagnostics))
      .filter(([, item]) => rec(item).status === 'error')
      .map(([name, item]) => `${name.toUpperCase()}: ${rec(item).error || 'query failed'}`)
      .join(' · '),
    reverseDnsRows: [
      {
        label: 'PTR names',
        value:
          (Array.isArray(reverseDnsRecords.ptr) ? reverseDnsRecords.ptr.map(String) : []).join(
            ' · ',
          ) || 'Not observed',
      },
    ],
    reverseDnsFailure: (() => {
      const diagnostic = rec(rec(reverseDns.diagnostics).ptr);
      return diagnostic.status === 'error' ? String(diagnostic.error || 'query failed') : '';
    })(),
    httpRows: [
      { label: 'Final URL', value: show(httpEvidence.finalUrl || httpEvidence.requestUrl) },
      {
        label: 'Response',
        value: httpResponse.status ? `HTTP ${httpResponse.status}` : 'Not observed',
      },
      {
        label: 'Transport',
        value:
          httpEvidence.transportSecurity === 'https'
            ? 'HTTPS'
            : httpEvidence.transportSecurity === 'http'
              ? 'Cleartext HTTP'
              : 'Not observed',
      },
      { label: 'Redirects', value: show(httpEvidence.redirectCount) },
      { label: 'Content type', value: show(httpResponse.contentType) },
      {
        label: 'Body captured',
        value: `${formatBytes(httpResponse.capturedBodyBytes)}${
          httpResponse.bodyTruncated ? ' · capped' : ''
        }`,
      },
    ],
    httpRedirects: records(httpEvidence.redirects).map((redirect) => ({
      status: show(redirect.status),
      from: show(redirect.from),
      to: show(redirect.to),
      queryOmitted: Boolean(redirect.queryOmitted),
    })),
    httpAttempts: (() => {
      const attempts = records(httpEvidence.attempts);
      return attempts.some((attempt) => attempt.error)
        ? attempts.map((attempt) => ({
            url: show(attempt.url),
            detail: attempt.error ? String(attempt.error) : `HTTP ${show(attempt.httpStatus)}`,
          }))
        : [];
    })(),
    httpMetadata,
    tlsRows: [
      { label: 'Connected address', value: show(tlsEvidence.connectedAddress) },
      { label: 'SNI hostname', value: show(tlsEvidence.sniHost) },
      { label: 'Protocol', value: show(tlsEvidence.protocol) },
      { label: 'Cipher', value: show(tlsCipher.standardName || tlsCipher.name) },
      { label: 'ALPN', value: show(tlsEvidence.alpnProtocol) },
      {
        label: 'Chain trust',
        value:
          tlsAuthorization.authorized === true
            ? 'Authorized'
            : tlsAuthorization.authorized === false
              ? 'Not authorized'
              : 'Not observed',
        danger: tlsAuthorization.authorized === false,
      },
      {
        label: 'Hostname',
        value:
          tlsHostname.matches === true
            ? 'Matches SNI'
            : tlsHostname.matches === false
              ? 'Mismatch'
              : 'Not observed',
        danger: tlsHostname.matches === false,
      },
      {
        label: 'Validity',
        value:
          tlsValidity.status === 'valid'
            ? 'Valid now'
            : tlsValidity.status === 'expired'
              ? 'Expired'
              : tlsValidity.status === 'not_yet_valid'
                ? 'Not yet valid'
                : 'Unknown',
        danger:
          tlsValidity.status === 'expired' || tlsValidity.status === 'not_yet_valid',
      },
    ],
    tlsFindings: records(tlsEvidence.findings).map((finding) => ({
      label: show(finding.label),
      detail: show(finding.detail),
      tone: String(finding.tone || ''),
    })),
    leafCertificate,
    alternativeNames: [
      ...(Array.isArray(tlsAltNames.dnsNames)
        ? tlsAltNames.dnsNames.map((value) => ({ type: 'DNS', value: show(value) }))
        : []),
      ...(Array.isArray(tlsAltNames.ipAddresses)
        ? tlsAltNames.ipAddresses.map((value) => ({
            type: 'IP address',
            value: show(value),
          }))
        : []),
    ],
    tlsChain: records(tlsEvidence.chain).map((certificate, index) => ({
      label: index === 0 ? 'Leaf certificate' : `Chain certificate ${index + 1}`,
      subject: tlsName(rec(certificate.subject)),
      fingerprint: show(certificate.fingerprintSha256),
    })),
    tlsValidation: [
      ...(tlsDiagnostics.error
        ? [{ label: 'Collection', value: String(tlsDiagnostics.error) }]
        : []),
      ...(tlsAuthorization.error
        ? [{ label: 'Authorization', value: String(tlsAuthorization.error) }]
        : []),
      ...(tlsHostname.error ? [{ label: 'Hostname', value: String(tlsHostname.error) }] : []),
    ],
  };
}
