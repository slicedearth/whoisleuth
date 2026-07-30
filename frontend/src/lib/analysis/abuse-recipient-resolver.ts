// Resolves only contact routes already present in a completed Lookup response.
// It makes no requests, does not test deliverability, and never infers a route
// from an infrastructure provider name or a generic domain pattern.

export type AbuseRecipientKind = 'network_hosting' | 'registrar' | 'registry' | 'security_txt';
export type AbuseRecipientChannel = 'email' | 'phone' | 'url';
export type AbuseRecipientCoverageState = 'found' | 'not_collected' | 'unavailable';

export type ResolvedAbuseRecipient = Readonly<{
  id: string;
  kind: AbuseRecipientKind;
  channel: AbuseRecipientChannel;
  contact: string;
  source: string;
  limitations: readonly string[];
  actionType:
    | 'network_hosting_report'
    | 'registrar_report'
    | 'registry_report'
    | 'security_contact_report';
}>;

export type AbuseRecipientResolution = Readonly<{
  version: 1;
  recipients: readonly ResolvedAbuseRecipient[];
  coverage: readonly Readonly<{
    kind: AbuseRecipientKind;
    state: AbuseRecipientCoverageState;
    detail: string;
  }>[];
  limitations: readonly string[];
}>;

const MAX_RECIPIENTS = 12;
const MAX_CONTACT_LENGTH = 320;
const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;
const EMAIL_RE = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/u;
const KINDS = ['registrar', 'registry', 'security_txt', 'network_hosting'] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
        item !== null && typeof item === 'object' && !Array.isArray(item)
      ))
    : [];
}

function text(value: unknown, maximum = MAX_CONTACT_LENGTH): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_REPLACE_RE, ' ').trim().slice(0, maximum)
    : '';
}

function channelAndContact(value: unknown, hintedChannel: unknown = ''): {
  channel: AbuseRecipientChannel;
  contact: string;
} | null {
  if (typeof value === 'string' && value.length > MAX_CONTACT_LENGTH) return null;
  const raw = text(value);
  const hint = text(hintedChannel, 20).toLowerCase();
  if (!raw) return null;
  if (EMAIL_RE.test(raw)) return { channel: 'email', contact: raw.toLowerCase() };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'mailto:' && EMAIL_RE.test(parsed.pathname)) {
      return { channel: 'email', contact: parsed.pathname.toLowerCase() };
    }
    if (parsed.protocol === 'tel:' && /^[+\d][\d ().-]{4,63}$/u.test(parsed.pathname)) {
      return { channel: 'phone', contact: parsed.pathname };
    }
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password) {
      parsed.hash = '';
      const normalized = parsed.toString();
      return normalized.length <= MAX_CONTACT_LENGTH
        ? { channel: 'url', contact: normalized }
        : null;
    }
  } catch {
    if (hint === 'phone' && /^[+\d][\d ().-]{4,63}$/u.test(raw)) {
      return { channel: 'phone', contact: raw };
    }
  }
  return null;
}

function actionType(kind: AbuseRecipientKind): ResolvedAbuseRecipient['actionType'] {
  if (kind === 'registrar') return 'registrar_report';
  if (kind === 'registry') return 'registry_report';
  if (kind === 'network_hosting') return 'network_hosting_report';
  return 'security_contact_report';
}

function recipient(
  kind: AbuseRecipientKind,
  contactRaw: unknown,
  sourceRaw: unknown,
  channelRaw: unknown,
  limitations: readonly string[],
): ResolvedAbuseRecipient | null {
  const resolved = channelAndContact(contactRaw, channelRaw);
  if (!resolved) return null;
  const source = text(sourceRaw, 120) || 'published lookup evidence';
  const id = `${kind}:${resolved.channel}:${resolved.contact.toLowerCase()}`;
  return {
    id,
    kind,
    channel: resolved.channel,
    contact: resolved.contact,
    source,
    limitations: [...new Set(limitations.map((item) => text(item, 240)).filter(Boolean))].slice(0, 8),
    actionType: actionType(kind),
  };
}

function registryRecipients(registryInsightsRaw: unknown): ResolvedAbuseRecipient[] {
  const registryInsights = record(registryInsightsRaw);
  return records(registryInsights.abuseRouting).slice(0, MAX_RECIPIENTS).flatMap((route) => {
    const kind = route.kind === 'registry' ? 'registry' : route.kind === 'registrar' ? 'registrar' : null;
    if (!kind) return [];
    const resolved = recipient(
      kind,
      route.contact,
      route.source,
      route.channel,
      [
        ...records(route.limitations).map((item) => text(item.detail)),
        ...(Array.isArray(route.limitations) ? route.limitations.map((item) => text(item)) : []),
        'Publication does not verify that the destination is monitored or appropriate for this incident.',
      ],
    );
    return resolved ? [resolved] : [];
  });
}

function fallbackRegistrarRecipient(availabilityAbuseRaw: unknown): ResolvedAbuseRecipient[] {
  const abuse = record(availabilityAbuseRaw);
  return [
    recipient('registrar', abuse.email, 'availability registrar abuse field', 'email', [
      'This compact field may duplicate a separately attributed RDAP or WHOIS route.',
      'Mailbox monitoring and incident scope are not verified.',
    ]),
    recipient('registrar', abuse.phone, 'availability registrar abuse field', 'phone', [
      'Phone reachability and incident scope are not verified.',
    ]),
  ].filter((item): item is ResolvedAbuseRecipient => Boolean(item));
}

function securityTxtRecipients(securityTxtRaw: unknown): ResolvedAbuseRecipient[] {
  const securityTxt = record(securityTxtRaw);
  if (securityTxt.securityTxtVersion !== 1 || securityTxt.state !== 'present') return [];
  const source = text(securityTxt.finalUrl || securityTxt.endpoint, 320) || 'security.txt';
  const publishedLimitations = Array.isArray(securityTxt.limitations)
    ? securityTxt.limitations.map((item) => text(item, 240))
    : [];
  return (Array.isArray(securityTxt.contacts) ? securityTxt.contacts : [])
    .slice(0, MAX_RECIPIENTS)
    .flatMap((contact) => {
      const resolved = recipient('security_txt', contact, source, '', [
        ...publishedLimitations,
        'security.txt expresses a disclosure route, not necessarily the correct destination for an abuse report.',
      ]);
      return resolved ? [resolved] : [];
    });
}

function networkRecipients(networkContextRaw: unknown): ResolvedAbuseRecipient[] {
  const networkContext = record(networkContextRaw);
  if (networkContext.contextVersion !== 1) return [];
  return records(networkContext.abuseRouting).slice(0, MAX_RECIPIENTS).flatMap((route) => {
    const selectedAddress = text(route.selectedAddress, 64);
    const observedAt = text(route.observedAt, 64);
    const endpoint = text(route.rdapEndpoint, 320);
    const routeLimitations = Array.isArray(route.limitations)
      ? route.limitations.map((item) => text(item, 240))
      : [];
    const resolved = recipient(
      'network_hosting',
      route.contact,
      route.source,
      route.channel,
      [
        ...routeLimitations,
        ...(selectedAddress ? [`Selected endpoint address: ${selectedAddress}.`] : []),
        ...(observedAt ? [`IP RDAP observed at ${observedAt}.`] : []),
        ...(endpoint ? [`IP RDAP source endpoint: ${endpoint}.`] : []),
        ...(route.complete === false || route.truncated === true
          ? ['The network observation was incomplete; other published routes may exist.']
          : []),
      ],
    );
    return resolved ? [resolved] : [];
  });
}

export function resolveAbuseRecipients(input: Readonly<{
  registryInsights?: unknown;
  availabilityAbuse?: unknown;
  securityTxt?: unknown;
  networkContext?: unknown;
}>): AbuseRecipientResolution {
  const byId = new Map<string, ResolvedAbuseRecipient>();
  for (const item of [
    ...registryRecipients(input.registryInsights),
    ...fallbackRegistrarRecipient(input.availabilityAbuse),
    ...securityTxtRecipients(input.securityTxt),
    ...networkRecipients(input.networkContext),
  ]) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const candidates = [...byId.values()];
  const recipients: ResolvedAbuseRecipient[] = [];
  for (const kind of KINDS) {
    const item = candidates.find((candidate) => candidate.kind === kind);
    if (item) recipients.push(item);
  }
  for (const item of candidates) {
    if (recipients.some((candidate) => candidate.id === item.id)) continue;
    recipients.push(item);
    if (recipients.length >= MAX_RECIPIENTS) break;
  }
  const registryInsights = record(input.registryInsights);
  const securityTxt = record(input.securityTxt);
  const networkContext = record(input.networkContext);
  const coverage = KINDS.map((kind) => {
    const count = recipients.filter((item) => item.kind === kind).length;
    if (count) return {
      kind,
      state: 'found' as const,
      detail: `${count} published route${count === 1 ? '' : 's'} retained for analyst review.`,
    };
    if (kind === 'network_hosting') return {
      kind,
      state: networkContext.contextVersion === 1 ? 'unavailable' as const : 'not_collected' as const,
      detail: networkContext.contextVersion === 1
        ? networkContext.status === 'partial' || networkContext.truncated === true
          ? 'The IP RDAP observation was incomplete and contained no usable bounded abuse route.'
          : 'No usable published network-registration route was present in the selected endpoint IP RDAP evidence.'
        : 'IP RDAP network contact evidence was not collected for this lookup.',
    };
    if (kind === 'security_txt' && securityTxt.securityTxtVersion !== 1) return {
      kind,
      state: 'not_collected' as const,
      detail: 'security.txt was not requested for this lookup.',
    };
    if ((kind === 'registrar' || kind === 'registry') && registryInsights.version !== 1) return {
      kind,
      state: 'unavailable' as const,
      detail: 'Registry publication routing evidence was unavailable.',
    };
    return {
      kind,
      state: 'unavailable' as const,
      detail: 'No usable published route was present in the collected evidence.',
    };
  });
  return {
    version: 1,
    recipients,
    coverage,
    limitations: [
      'Recipient resolution uses only already-collected publication fields and performs no contact discovery or reachability check.',
      'A published route does not prove responsibility, ownership, monitoring, policy scope, or that a report should be sent.',
      'An IP RDAP route belongs to the registered network of one observed endpoint and does not establish hosting responsibility or identify an origin server.',
      'Select and record a route in a case before preparing a human-reviewed response packet.',
    ],
  };
}
