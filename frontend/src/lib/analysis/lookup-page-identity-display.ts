import {
  rec,
  records,
  show,
  stringList,
  trackingIdentifierLabel,
  type JsonRecord,
} from './lookup-display-shared.ts';

export function buildLookupPageIdentityDisplay(input: {
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
  } = input;
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
  };
}
