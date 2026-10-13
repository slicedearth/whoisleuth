import { capabilityForSourceId, type CapabilityDefinition } from '../../../../packages/contracts/capability-manifest.mts';
import type { LookupTargetType } from './lookup-page-actions.ts';

export interface CollectionDisclosure {
  status: string;
  data: readonly string[];
  recipients: readonly string[];
  uncertainty: string;
  offline: boolean;
}

// These are presentation labels, not another collection or admission policy.
const DATA_LABELS = {
  none: 'No data sent',
  normalised_target: 'Normalised target: hostname, IP address or ASN',
  normalised_registrable_domain: 'Registrable domain, not the full hostname or URL',
  registry_query: 'Registry query for the registrable domain, IP address or ASN',
  whois_query: 'WHOIS query for the registrable domain, IP address or ASN',
  dns_question: 'DNS question owner name and record type; derived names and types depend on the collector',
  public_ip_address: 'Observed public IP address',
  homepage_request: 'Public web request to the collector-defined path',
  selected_url_request: 'Explicitly selected URL path and query; fragments are not sent',
  tls_handshake: 'TLS connection, including the requested hostname when applicable',
  certificate_search_term: 'Certificate-search term',
  selected_feed_search: 'Selected feed identifiers, exact hostnames, positive and negative literal search terms',
  mail_transport_commands: 'Approved bounded mail-protocol commands; no message or authentication',
  mta_sts_policy_request: 'MTA-STS policy path on the derived policy hostname',
  encrypted_compact_watchlist: 'Encrypted compact watchlist',
  fixed_diagnostic_probe: 'Fixed diagnostic probe',
  operation_control_metadata: 'Operation-control metadata',
  admitted_resource_request: 'Explicitly admitted resource request',
} satisfies Record<CapabilityDefinition['disclosedData'][number], string>;

const RECIPIENT_LABELS = {
  none: 'No downstream recipient',
  registry_service: 'Selected registry or allocation service; eligible registrar/referral services where applicable',
  dns_resolver: 'Configured DNS resolver',
  target_public_service: 'Target public service and any eligible redirect destination',
  certificate_transparency_service: 'Configured certificate-transparency service',
  configured_intelligence_provider: 'Configured intelligence or feed service',
  selected_public_resolver: 'Explicitly selected public resolver',
  selected_mail_endpoint: 'Explicitly selected mail endpoint',
  configured_worker_store: 'Configured worker store',
  configured_control_provider: 'Configured control provider',
} satisfies Record<CapabilityDefinition['recipients'][number], string>;

export function describeCollectionDisclosure(sourceId: string, options: {
  state?: 'included' | 'conditional' | 'optional' | 'disabled' | 'unavailable';
  selectedUrl?: boolean;
  targetType?: LookupTargetType;
} = {}): CollectionDisclosure {
  const definition = capabilityForSourceId(sourceId);
  if (!definition) return {
    status: 'Disclosure metadata unavailable; no request is authorised by this view.',
    data: [], recipients: [], offline: false,
    uncertainty: 'Unknown or unlisted collection must not be treated as offline or private.',
  };
  const offline = definition.networkMode === 'none';
  const selected = options.state === undefined || options.state === 'included' || options.state === 'conditional';
  const target = options.targetType === 'domain'
    ? definition.disclosedData.includes('registry_query') || definition.disclosedData.includes('whois_query')
      ? 'Registrable domain' : 'Normalised hostname; the collector determines derived names'
    : options.targetType === 'asn' ? 'Normalised ASN'
    : options.targetType === 'ipv4' || options.targetType === 'ipv6' ? 'Normalised IP address' : DATA_LABELS.normalised_target;
  const registration = options.targetType === 'domain' ? 'Registrable domain; subdomain labels, URL path and query excluded'
    : options.targetType === 'asn' ? 'Normalised ASN' : options.targetType === 'ipv4' || options.targetType === 'ipv6' ? 'Normalised IP address' : null;
  const data = definition.disclosedData
    .filter(value => value !== 'selected_url_request' || options.selectedUrl === true)
    .filter(value => !(value === 'homepage_request' && options.selectedUrl && definition.disclosedData.includes('selected_url_request')))
    .map(value => value === 'normalised_target' ? target
      : (value === 'registry_query' || value === 'whois_query') && registration ? `${value === 'whois_query' ? 'WHOIS' : 'Registry'} query: ${registration}`
      : value === 'homepage_request' && sourceId === 'website_probe' ? 'Homepage on the exact hostname; entered URL path and query are not selected'
      : DATA_LABELS[value]);
  return {
    status: !selected ? 'Not requested with the current selection. The declared data below applies if this source is enabled and selected.'
      : offline ? 'Offline operation: no collection request.'
      : options.state === 'conditional' || definition.networkMode === 'conditional_bounded_passive'
        ? 'May make network requests when the collection action runs and this source is eligible.'
        : 'Makes network requests when the collection action runs. Viewing this plan does not collect.',
    data, recipients: definition.recipients.map(value => RECIPIENT_LABELS[value]), offline,
    uncertainty: offline ? 'Local review does not establish the current state of a target.'
      : 'Recipient classes are declared capabilities, not a live recipient list. Exact services, referrals, DNS questions and redirects are resolved during collection. An unlisted scan is not private.',
  };
}

export function describeLocalFeedDisclosure(): CollectionDisclosure {
  return {
    status: 'Offline file matching in this browser; no collection request.', offline: true,
    data: ['Selected file contents and matching terms stay on this device.'],
    recipients: ['No application-server, feed-service or candidate-target request for this local file review.'],
    uncertainty: 'This does not verify current feed freshness or target status. Querying the optional feed service is a separate action.',
  };
}
