/** Shared entity vocabulary; importing labels does not load saved-work readers. */
export const INVESTIGATION_ENTITY_LABELS = Object.freeze({
  domain: 'Domain',
  nameserver_set: 'Nameserver set',
  http_origin: 'HTTP origin',
  favicon: 'Favicon',
  certificate: 'Certificate',
  certificate_pattern: 'Certificate name pattern',
  provider: 'Provider observation',
  routing_asn: 'Routing ASN',
  ip_address: 'IP address',
  tracking_identifier: 'Tracking identifier',
  favicon_cluster: 'Favicon relationship',
  official_asset_host: 'Official asset host',
  brand: 'Brand profile',
  case: 'Case',
  campaign: 'Campaign',
});

export type InvestigationEntityType = keyof typeof INVESTIGATION_ENTITY_LABELS;
export const INVESTIGATION_ENTITY_TYPES = Object.freeze(Object.keys(INVESTIGATION_ENTITY_LABELS) as InvestigationEntityType[]);
