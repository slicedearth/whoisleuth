import {
  boundedTechnologyText,
  datedRow,
  formatDate,
  rec,
  records,
  show,
  stringList,
  type JsonRecord,
} from './lookup-display-shared.ts';

export function buildLookupObservedNetworkDisplay(input: {
  observedNetworkContext: JsonRecord;
  observedNetworkEndpoint: JsonRecord;
  observedNetwork: JsonRecord;
}) {
  const { observedNetworkContext, observedNetworkEndpoint, observedNetwork } = input;
  return {
    observedNetworkSourceLabel: (
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
            value: stringList(observedNetwork.cidrs)
              .slice(0, 16)
              .map((item) => boundedTechnologyText(item, 96))
              .filter(Boolean)
              .join(', ') || '—',
          },
          {
            label: 'Address range',
            value: [
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
  };
}

export function buildLookupPageComparisonDisplay(pageComparison: JsonRecord | null) {
  return pageComparison
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
    : null;
}
