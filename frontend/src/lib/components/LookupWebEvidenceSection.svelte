<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LookupWebSurfaces } from './lookup-web-surfaces.ts';
  import type { CheckpointFact } from '$lib/analysis/case-evidence-checkpoint.ts';
  import { lookupObservationHostname } from '../../../../packages/evidence/lookup-target.mts';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import LookupFamilySummary from '$lib/components/LookupFamilySummary.svelte';
  import WebsiteSnapshotManager from '$lib/components/WebsiteSnapshotManager.svelte';
  import type { BrandProfile } from '$lib/brand-profiles';
  import {
    boundedTechnologyText,
    dateTimeAttribute,
    rec,
    show,
    statusLabel,
    stringList,
    type JsonRecord,
  } from '$lib/analysis/lookup-display-model.ts';
  import type { createLookupViewModel, LookupHttpResponse } from '$lib/analysis/lookup-response.ts';
  import type { buildLookupRouteAnalysis } from '$lib/analysis/lookup-route-analysis.ts';
  import type { ServiceDependencyReview } from '$lib/analysis/service-dependency-review.ts';
  import { lookupTlsProps } from '$lib/analysis/lookup-tls-display.ts';
  import {
    MAX_OBSERVATION_LIMITATIONS,
    MAX_OBSERVATION_LIMITATION_LENGTH,
  } from '../../../../packages/evidence/observation.mts';

  type LookupView = ReturnType<typeof createLookupViewModel>;
  type LookupAnalysis = ReturnType<typeof buildLookupRouteAnalysis>;

  let {
    result,
    view,
    surfaces,
    analysis,
    serviceDependencyReview,
    profile,
    caseDomain,
    lookupEvidenceDepth,
    lookupObservedAt,
    loading,
    expanded,
    serviceDependencyScope,
    serviceDependencyFalsePositives,
    buildSnapshot,
    onpreload,
    onshow,
    onhide,
    onready,
    setServiceDependencyScope,
    setServiceDependencyFalsePositives,
    sourceCheckpoint,
  }: {
    result: LookupHttpResponse | null;
    view: LookupView;
    surfaces: LookupWebSurfaces;
    analysis: LookupAnalysis;
    serviceDependencyReview: ServiceDependencyReview | null;
    profile: BrandProfile | null;
    caseDomain: string;
    lookupEvidenceDepth: LookupAnalysis['lookupEvidenceDepth'];
    lookupObservedAt: string | null;
    loading: boolean;
    expanded: boolean;
    serviceDependencyScope: string;
    serviceDependencyFalsePositives: string;
    buildSnapshot: () => unknown;
    onpreload: () => void;
    onshow: () => void | Promise<void>;
    onhide: () => void | Promise<void>;
    onready: () => void | Promise<void>;
    setServiceDependencyScope: (value: string) => void;
    setServiceDependencyFalsePositives: (value: string) => void;
    sourceCheckpoint?: Snippet<[CheckpointFact['category'], string]>;
  } = $props();

  const availability = $derived(view.availability);
  const observationHostname = $derived(lookupObservationHostname(availability) ?? caseDomain);
  const reverseDns = $derived(view.reverseDns);
  const observedNetworkContext = $derived(view.observedNetworkContext);
  const observedNetworkEndpoint = $derived(view.observedNetworkEndpoint);
  const observedNetworkRdap = $derived(view.observedNetworkRdap);
  const dnsEvidence = $derived(view.dnsEvidence);
  const httpEvidence = $derived(view.httpEvidence);
  const sslbl = $derived(view.sslbl);
  const sslblSnapshot = $derived(rec(sslbl.snapshot));
  const securityTxt = $derived(view.securityTxt);
  const pageIdentity = $derived(view.pageIdentity);
  const pageForms = $derived(view.pageForms);
  const pageResources = $derived(view.pageResources);
  const pageDownloads = $derived(view.pageDownloads);
  const credentialSurfaceProfile = $derived(view.credentialSurfaceProfile);
  const structuredDataIdentity = $derived(view.structuredDataIdentity);
  const technologyProfile = $derived(view.technologyProfile);
  const pageRoleProfile = $derived(view.pageRoleProfile);
  const clientBehaviorProfile = $derived(view.clientBehaviorProfile);
  const browserLibraryProfile = $derived(rec(technologyProfile.browserLibraryProfile));
  const securityPosture = $derived(view.securityPosture);

  const networkDisplay = $derived(analysis.networkDisplay);
  const dnsRehearsalEvidence = $derived(analysis.dnsRehearsalEvidence);
  const pageComparison = $derived(analysis.pageComparison);
  const pageDisplay = $derived(analysis.pageDisplay);
  const brandMimicryReview = $derived(analysis.brandMimicryReview);
  const certificatePolicyReview = $derived(analysis.certificatePolicyReview);
  const webSources = $derived(analysis.evidenceCoverage.entries.filter((entry) => entry.category === 'network' || entry.category === 'web'));
  const limitedSources = $derived(webSources.filter((entry) => entry.manualReviewSuggested));
</script>

<section class="result-section family-web" id="web-evidence" aria-labelledby="web-evidence-title">
  <h3 id="web-evidence-title">{result?.type === 'domain' ? 'Web and DNS evidence' : 'DNS evidence'}</h3>
  <LookupFamilySummary
    label={result?.type === 'domain' ? 'Web and DNS evidence' : 'DNS evidence'}
    description={limitedSources.length
      ? `Limited ${limitedSources.length === 1 ? 'source' : 'sources'}: ${limitedSources.map((entry) => `${entry.label} (${entry.statusLabel.toLowerCase()})`).join(', ')}.`
      : 'Review point-in-time network registration, DNS, HTTP, TLS, page identity, technology and passive posture evidence.'}
    metrics={[
      `${webSources.length} source records`,
      `${limitedSources.length} limited`,
    ]}
    {expanded}
    {onpreload}
    {onshow}
    {onhide}
  />
  {#if expanded}
    {#if surfaces.network.visible}
      <div class="evidence-component" id="evidence-network"><DeferredSurface
        load={surfaces.network.load}
        loadingLabel="Loading observed network context…"
        unavailableLabel="Observed network context could not be loaded."
        {onready}
        props={{
          status: statusLabel(boundedTechnologyText(observedNetworkContext.status || 'unsupported', 40)),
          detail: boundedTechnologyText(observedNetworkContext.detail || 'Observed network context was unavailable.', 300),
          address: boundedTechnologyText(observedNetworkEndpoint.address, 64),
          addressSource: pageDisplay.observedNetworkSourceLabel,
          rdapEndpoint: boundedTechnologyText(observedNetworkRdap.endpoint, 2048),
          httpStatus: observedNetworkRdap.httpStatus ? String(observedNetworkRdap.httpStatus) : '',
          fetchedAt: dateTimeAttribute(observedNetworkRdap.fetchedAt) || '',
          rows: pageDisplay.observedNetworkRows,
          limitations: pageDisplay.observedNetworkLimitations,
        }}
      /></div>
      {@render sourceCheckpoint?.('network', 'Network')}
    {/if}

    {#if sslbl.sslblVersion === 1 && sslbl.verdict === 'listed'}
      <aside class="sslbl-review-lead" aria-labelledby="sslbl-review-lead-title">
        <div>
          <p class="eyebrow">Certificate review lead</p>
          <h4 id="sslbl-review-lead-title">The observed leaf certificate matched the local SSLBL snapshot</h4>
          <p>This attributed warning data supports review and does not change Risk scoring.</p>
        </div>
        <a class="button secondary" href="#evidence-sslbl">Review certificate evidence</a>
      </aside>
    {/if}

    {#if result?.type === 'domain'}
      <WebsiteSnapshotManager
        domain={observationHostname}
        canSave={!loading && lookupEvidenceDepth === 'deep' && Boolean(caseDomain) && technologyProfile.source === 'derived' && securityPosture.source === 'derived'}
        {buildSnapshot}
      />
    {/if}

    {#if surfaces.reverseDns.visible}
      <div class="evidence-component" id="evidence-reverse-dns"><DeferredSurface
        load={surfaces.reverseDns.load}
        loadingLabel="Loading reverse-DNS evidence…"
        unavailableLabel="Reverse-DNS evidence could not be loaded."
        {onready}
        props={{headingId: 'reverse-dns-title', title: 'Reverse DNS context', summaryDetail: 'Expand for PTR names, provenance, and limitations', status: show(reverseDns.status), complete: reverseDns.complete !== false, rows: networkDisplay.reverseDnsRows, failureDetail: networkDisplay.reverseDnsFailure, truncated: Boolean(reverseDns.truncated), note: 'Point-in-time PTR evidence is controlled by the address operator and may be absent, stale, generic or misleading.'}}
      /></div>
    {/if}

    {#if surfaces.dns.visible}
      <div class="evidence-component" id="evidence-dns"><DeferredSurface
        load={surfaces.dns.load}
        loadingLabel="Loading DNS evidence…"
        unavailableLabel="DNS evidence could not be loaded."
        {onready}
        props={{headingId: 'dns-title', status: show(dnsEvidence.status), complete: dnsEvidence.complete !== false, rows: networkDisplay.dnsRows, failureDetail: networkDisplay.dnsQueryFailures, truncated: Boolean(dnsEvidence.truncated), delegation: networkDisplay.dnsDelegation, rehearsalEvidence: dnsRehearsalEvidence, domain: caseDomain, allowRehearsal: result?.type === 'domain', note: `Point-in-time resolver evidence for ${observationHostname}. Registration-delegation checks retain their separately named domain. Service-binding targets and address hints are displayed but not followed. Verify shared infrastructure independently.`}}
      /></div>
      {@render sourceCheckpoint?.('dns', 'DNS')}
      {#if surfaces.serviceDependency.visible && serviceDependencyReview}
        <div class="evidence-component"><DeferredSurface
          load={surfaces.serviceDependency.load}
          loadingLabel="Loading service-dependency review…"
          unavailableLabel="Service-dependency review could not be loaded."
          props={{review: serviceDependencyReview, target: observationHostname, technologies: pageDisplay.technologyFindings, libraries: pageDisplay.browserLibraries, authorizedScope: serviceDependencyScope, falsePositiveTargets: serviceDependencyFalsePositives, setAuthorizedScope: setServiceDependencyScope, setFalsePositiveTargets: setServiceDependencyFalsePositives}}
        /></div>
      {/if}
    {/if}

    {#if surfaces.http.visible}
      <div class="evidence-component" id="evidence-http"><DeferredSurface
        load={surfaces.http.load}
        loadingLabel="Loading HTTP evidence…"
        unavailableLabel="HTTP evidence could not be loaded."
        {onready}
        props={{status: statusLabel(show(httpEvidence.status)), complete: httpEvidence.complete !== false, rows: networkDisplay.httpRows, crossOriginRedirect: Boolean(httpEvidence.crossOriginRedirect), httpsDowngrade: Boolean(httpEvidence.httpsDowngrade), redirects: networkDisplay.httpRedirects, attempts: networkDisplay.httpAttempts, metadata: networkDisplay.httpMetadata, deliveryMetadata: networkDisplay.httpDeliveryMetadata, limitations: stringList(httpEvidence.limitations, MAX_OBSERVATION_LIMITATIONS, MAX_OBSERVATION_LIMITATION_LENGTH)}}
      /></div>
      {@render sourceCheckpoint?.('http', 'HTTP')}
    {/if}

    {#if surfaces.tls.visible}
      <div class="evidence-component" id="evidence-tls"><DeferredSurface
        load={surfaces.tls.load}
        loadingLabel="Loading TLS evidence…"
        unavailableLabel="TLS evidence could not be loaded."
        {onready}
        props={{...lookupTlsProps(networkDisplay), observedAt: lookupObservedAt}}
      /></div>
      {@render sourceCheckpoint?.('tls', 'TLS')}
      <div class="evidence-component"><DeferredSurface
        load={surfaces.certificatePolicy.load}
        loadingLabel="Loading certificate-policy review…"
        unavailableLabel="Certificate-policy review could not be loaded."
        props={{review: certificatePolicyReview}}
      /></div>
    {/if}

    {#if surfaces.sslbl.visible}
      <div class="evidence-component" id="evidence-sslbl"><DeferredSurface
        load={surfaces.sslbl.load}
        loadingLabel="Loading certificate warning-data evidence…"
        unavailableLabel="Certificate warning data could not be loaded."
        {onready}
        props={{status: boundedTechnologyText(sslbl.status || 'unavailable', 40), verdict: boundedTechnologyText(sslbl.verdict || 'inconclusive', 40), complete: sslbl.complete === true, detail: boundedTechnologyText(sslbl.detail || 'Certificate warning-data comparison was unavailable.', 500), fingerprint: boundedTechnologyText(sslbl.fingerprintSha1, 40), referenceUrl: boundedTechnologyText(sslbl.referenceUrl, 2048), sourceUpdatedAt: dateTimeAttribute(sslblSnapshot.sourceUpdatedAt) || '', generatedAt: dateTimeAttribute(sslblSnapshot.generatedAt) || '', entryCount: Number.isSafeInteger(sslblSnapshot.entryCount) ? Number(sslblSnapshot.entryCount) : null, digest: boundedTechnologyText(sslblSnapshot.digestSha256, 64), limitations: stringList(sslbl.limitations).slice(0, 8)}}
      /></div>
    {/if}

    {#if surfaces.disclosure.visible}
      <div class="evidence-component" id="evidence-security-txt"><DeferredSurface
        load={surfaces.disclosure.load}
        loadingLabel="Loading disclosure-contact evidence…"
        unavailableLabel="Disclosure-contact evidence could not be loaded."
        {onready}
        props={{state: boundedTechnologyText(securityTxt.state || 'unavailable', 40), detail: boundedTechnologyText(securityTxt.detail || 'Disclosure contact collection was unavailable.', 300), endpoint: boundedTechnologyText(securityTxt.finalUrl, 2048), httpStatus: securityTxt.httpStatus ? String(securityTxt.httpStatus) : '', observedAt: dateTimeAttribute(securityTxt.observedAt) || '', expiresAt: dateTimeAttribute(securityTxt.expiresAt) || '', contacts: stringList(securityTxt.contacts).slice(0, 10), policies: stringList(securityTxt.policies).slice(0, 10), encryption: stringList(securityTxt.encryption).slice(0, 10), languages: stringList(securityTxt.preferredLanguages).slice(0, 10), limitations: stringList(securityTxt.limitations).slice(0, 10)}}
      /></div>
      {@render sourceCheckpoint?.('disclosure', 'Disclosure contact')}
    {/if}

    {#if surfaces.page.visible}
      <div class="evidence-component" id="evidence-page"><DeferredSurface
        load={surfaces.page.load}
        loadingLabel="Loading page-identity evidence…"
        unavailableLabel="Page-identity evidence could not be loaded."
        {onready}
        props={{status: statusLabel(show(pageIdentity.status)), complete: Boolean(pageIdentity.complete), facts: pageDisplay.pageIdentityFacts, externalFormOrigins: stringList(pageForms.externalActionOrigins, 10, 2048), resourceCount: Number(pageResources.count) || 0, resourceSummary: pageDisplay.resourceSummary, embeddedOrigins: stringList(pageIdentity.embeddedOrigins, 20, 2048), contactDomains: stringList(pageIdentity.contactDomains, 20, 253), downloadCount: Number(pageDownloads.count) || 0, downloadSummary: pageDisplay.downloadSummary, trackingIdentifiers: pageDisplay.trackingIdentifiers, fingerprints: pageDisplay.fingerprints, publicationMetadata: pageDisplay.pagePublicationMetadata, limitations: stringList(pageIdentity.limitations, MAX_OBSERVATION_LIMITATIONS, MAX_OBSERVATION_LIMITATION_LENGTH)}}
      /></div>
      {@render sourceCheckpoint?.('page_identity', 'Page identity')}
    {/if}

    {#if surfaces.credentials.visible}
      {@const credentialSurface = pageDisplay.credentialSurface}
      <div class="evidence-component" id="evidence-credential-surface"><DeferredSurface
        load={surfaces.credentials.load}
        loadingLabel="Loading credential-surface evidence…"
        unavailableLabel="Credential-surface evidence could not be loaded."
        {onready}
        props={{status: statusLabel(show(credentialSurfaceProfile.status)), complete: Boolean(credentialSurfaceProfile.complete), formCount: credentialSurface.formCount, inputCount: credentialSurface.inputCount, classifiedCount: credentialSurface.classifiedCount, categories: credentialSurface.categories, methods: credentialSurface.methods, actions: credentialSurface.actions, limitations: pageDisplay.credentialSurfaceLimitations}}
      /></div>
    {/if}

    {#if surfaces.posture.visible}
      <div class="evidence-component" id="evidence-posture"><DeferredSurface
        load={surfaces.posture.load}
        loadingLabel="Loading passive posture evidence…"
        unavailableLabel="Passive posture evidence could not be loaded."
        {onready}
        props={{status: statusLabel(show(securityPosture.status)), complete: Boolean(securityPosture.complete), findings: pageDisplay.securityPostureFindings, limitations: pageDisplay.securityPostureLimitations}}
      /></div>
    {/if}

    {#if surfaces.structuredIdentity.visible}
      <div class="evidence-component" id="evidence-structured-identity"><DeferredSurface
        load={surfaces.structuredIdentity.load}
        loadingLabel="Loading structured-identity evidence…"
        unavailableLabel="Structured-identity evidence could not be loaded."
        {onready}
        props={{status: statusLabel(show(structuredDataIdentity.status)), complete: Boolean(structuredDataIdentity.complete), entities: pageDisplay.structuredIdentities, limitations: pageDisplay.structuredIdentityLimitations}}
      /></div>
    {/if}

    {#if surfaces.technology.visible}
      <div class="evidence-component" id="evidence-technology"><DeferredSurface
        load={surfaces.technology.load}
        loadingLabel="Loading technology-profile evidence…"
        unavailableLabel="Technology-profile evidence could not be loaded."
        {onready}
        props={{status: statusLabel(show(technologyProfile.status)), complete: Boolean(technologyProfile.complete), observedAt: technologyProfile.observedAt, findings: pageDisplay.technologyFindings, authoritativeNameservers: Array.isArray(availability.nameservers) ? availability.nameservers.filter((value): value is string => typeof value === 'string').slice(0, 50) : [], limitations: pageDisplay.technologyLimitations, libraryAvailable: browserLibraryProfile.profileVersion === 1 || browserLibraryProfile.profileVersion === 2, libraryStatus: statusLabel(show(browserLibraryProfile.status)), libraryComplete: Boolean(browserLibraryProfile.complete), libraryObservedAt: browserLibraryProfile.observedAt, libraryCatalog: boundedTechnologyText((browserLibraryProfile.catalog as JsonRecord)?.version, 80), libraries: pageDisplay.browserLibraries, libraryLimitations: pageDisplay.browserLibraryLimitations}}
      /></div>
    {/if}

    {#if surfaces.behaviour.visible}
      <div class="evidence-component" id="evidence-page-role"><DeferredSurface
        load={surfaces.behaviour.load}
        loadingLabel="Loading page-role and behaviour evidence…"
        unavailableLabel="Page-role and behaviour evidence could not be loaded."
        {onready}
        props={{roleStatus: statusLabel(show(pageRoleProfile.status)), roleComplete: Boolean(pageRoleProfile.complete), primaryRole: pageDisplay.primaryPageRole, roles: pageDisplay.pageRoles, roleLimitations: pageDisplay.pageRoleLimitations, behaviorStatus: statusLabel(show(clientBehaviorProfile.status)), behaviorComplete: Boolean(clientBehaviorProfile.complete), scripts: pageDisplay.clientScriptSummary, indicators: pageDisplay.clientBehaviorIndicators, behaviorLimitations: pageDisplay.clientBehaviorLimitations}}
      /></div>
    {/if}

    {#if surfaces.comparison.visible}
      <div class="evidence-component"><DeferredSurface
        load={surfaces.comparison.load}
        loadingLabel="Loading saved page-baseline comparison…"
        unavailableLabel="The page-baseline comparison could not be loaded."
        props={{comparison: pageDisplay.pageComparison, unavailable: Boolean(!pageComparison && profile?.pageBaseline && result?.type === 'domain')}}
      /></div>
    {/if}
    {#if surfaces.brand.visible && brandMimicryReview}
      <div class="evidence-component"><DeferredSurface
        load={surfaces.brand.load}
        loadingLabel="Loading brand-mimicry review…"
        unavailableLabel="Brand-mimicry review could not be loaded."
        props={{review: brandMimicryReview}}
      /></div>
    {/if}
  {/if}
</section>

<style>
  .result-section{--section-accent:var(--evidence-web);margin-top:26px}
  .result-section>h3{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--section-accent);font:700 var(--text-2xs) var(--mono);letter-spacing:.09em;text-transform:uppercase}
  .result-section>h3::before{content:"//";color:var(--muted)}
  .result-section>h3::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,color-mix(in srgb,var(--section-accent) 60%,var(--border)),var(--border) 42%)}
  .result-section>.evidence-component{margin-top:12px}
  .result-section>:nth-child(2){margin-top:0}
  .evidence-component[id]{position:relative;scroll-margin-top:var(--local-nav-anchor-offset,88px)}
  .sslbl-review-lead{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:12px;padding:16px;border:1px solid color-mix(in srgb,var(--danger) 42%,var(--border));border-radius:var(--radius-md);background:color-mix(in srgb,var(--danger) 5%,var(--surface))}
  .sslbl-review-lead .eyebrow{margin:0 0 5px;color:var(--danger)}
  .sslbl-review-lead h4{margin:0;color:var(--text);font-size:var(--text-sm);line-height:1.35}
  .sslbl-review-lead p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .sslbl-review-lead .button{flex:0 0 auto}

  @media(max-width:700px){
    .sslbl-review-lead{align-items:stretch;flex-direction:column}
    .sslbl-review-lead .button{width:100%}
  }
</style>
