export type AcquisitionReviewState = 'authoritative' | 'observed' | 'review' | 'unavailable';

export type AcquisitionReviewItem = Readonly<{
  id: 'availability' | 'contacts' | 'lifecycle' | 'mail' | 'nameservers' | 'operations' | 'policy_eligibility' | 'policy_lifecycle' | 'policy_transfer' | 'tls' | 'transfer' | 'web';
  label: string;
  state: AcquisitionReviewState;
  detail: string;
  provenance: string;
}>;

export type AcquisitionDueDiligence = Readonly<{
  version: 2;
  label: string;
  state: 'incomplete' | 'registered' | 'review_transition' | 'sale_signal' | 'unregistered_observation';
  items: readonly AcquisitionReviewItem[];
  transitionDependencies: readonly AcquisitionReviewItem[];
  policyChecks: readonly AcquisitionReviewItem[];
  nextSteps: readonly string[];
  limitations: readonly string[];
}>;

type UnknownRecord = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const REGISTERED_STATES = new Set(['registered', 'expiring', 'for_sale']);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown, maximum = 120): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function records(value: unknown, maximum = 8): UnknownRecord[] {
  return Array.isArray(value)
    ? value.slice(0, maximum).map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function strings(value: unknown, maximum = 40): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value.slice(0, maximum * 2)) {
    const normalized = text(item, 160);
    if (normalized) unique.add(normalized);
    if (unique.size >= maximum) break;
  }
  return [...unique];
}

function availabilityItem(availability: UnknownRecord): AcquisitionReviewItem {
  const state = text(availability.state, 40).toLowerCase();
  const confidence = text(availability.confidence, 24).toLowerCase();
  const source = text(availability.source, 24).toLowerCase();
  if (state === 'available' && source === 'rdap' && confidence === 'high') {
    return {
      id: 'availability',
      label: 'Registry non-existence response observed',
      state: 'authoritative',
      detail: 'The registry RDAP service returned no record at collection time.',
      provenance: 'Registry RDAP availability decision',
    };
  }
  if (state === 'available') {
    return {
      id: 'availability',
      label: 'No registration record reported',
      state: 'review',
      detail: 'The available source reported no matching registration. Confirm current eligibility and registration state through an appropriate registrar or registry.',
      provenance: source === 'whois' ? 'WHOIS availability decision' : 'Availability decision',
    };
  }
  if (REGISTERED_STATES.has(state)) {
    return {
      id: 'availability',
      label: state === 'for_sale' ? 'Registered with a sale signal' : state === 'expiring' ? 'Registered in a lifecycle transition' : 'Registration observed',
      state: state === 'registered' ? 'observed' : 'review',
      detail: state === 'for_sale'
        ? 'A bounded page or infrastructure signal suggested a sale listing; it is not a verified offer, price, or ownership statement.'
        : state === 'expiring'
          ? 'Registry status evidence indicates redemption or pending deletion; this does not establish release timing or acquisition success.'
          : 'Current registry, WHOIS, or authoritative DNS evidence supports a registered state.',
      provenance: source ? `${source.toUpperCase()} registration evidence` : 'Registration evidence',
    };
  }
  return {
    id: 'availability',
    label: 'Registration state unresolved',
    state: 'unavailable',
    detail: 'No enabled authoritative registration source produced a conclusive decision.',
    provenance: 'Availability source health',
  };
}

function lifecycleItem(
  availability: UnknownRecord,
  lifecycle: UnknownRecord,
  publications: UnknownRecord[],
): AcquisitionReviewItem {
  const stage = text(lifecycle.stage, 40).toLowerCase();
  const statuses = strings(lifecycle.rawStatuses);
  const expiresInDays = finite(availability.expiresInDays);
  const expiry = text(availability.expiryDateIso || availability.expiryDate, 64);
  const completePublication = publications.some((item) => item.state === 'complete');
  if (stage === 'pending_delete' || stage === 'redemption' || stage === 'pending_transfer' || stage === 'hold') {
    return {
      id: 'lifecycle',
      label: text(lifecycle.label, 80) || 'Lifecycle transition observed',
      state: 'review',
      detail: `${statuses.length ? `${statuses.join(', ')}. ` : ''}The transition can change or be reversed and does not guarantee deletion, release, or transfer.`,
      provenance: 'Registry lifecycle statuses',
    };
  }
  if (expiry) {
    const timing = expiresInDays === null
      ? 'A published expiry date was observed.'
      : expiresInDays < 0
        ? 'The published expiry date has passed; refresh authoritative evidence before drawing a conclusion.'
        : expiresInDays <= 30
          ? `The published expiry date is within ${Math.max(0, Math.ceil(expiresInDays))} days.`
          : `The published expiry date is approximately ${Math.ceil(expiresInDays)} days away.`;
    return {
      id: 'lifecycle',
      label: 'Lifecycle date observed',
      state: expiresInDays !== null && expiresInDays <= 30 ? 'review' : 'observed',
      detail: timing,
      provenance: 'Normalised RDAP or WHOIS lifecycle',
    };
  }
  return {
    id: 'lifecycle',
    label: completePublication ? 'Expiry date not published' : 'Lifecycle timing unavailable',
    state: completePublication ? 'observed' : 'unavailable',
    detail: completePublication
      ? 'A usable publication was collected without a normalised expiry date. Registry policy and renewal state still require manual confirmation.'
      : 'Incomplete or unavailable registry publications cannot establish an expiry or release window.',
    provenance: 'Registry publication quality',
  };
}

function transferItem(lifecycle: UnknownRecord, publications: UnknownRecord[]): AcquisitionReviewItem {
  const locks = record(lifecycle.locks);
  const statuses = strings(lifecycle.rawStatuses);
  const client = locks.client === true;
  const server = locks.server === true;
  const completePublication = publications.some((item) => item.state === 'complete');
  if (client || server) {
    return {
      id: 'transfer',
      label: 'Transfer or update constraints observed',
      state: 'observed',
      detail: `${client ? 'Client-side registry lock status is present. ' : ''}${server ? 'Server-side registry lock status is present.' : ''}`.trim(),
      provenance: 'EPP status interpretation',
    };
  }
  if (statuses.length || completePublication) {
    return {
      id: 'transfer',
      label: 'No interpreted lock status observed',
      state: 'review',
      detail: 'The collected statuses did not contain a recognised client or server lock. This does not prove transfer eligibility or that other policy restrictions are absent.',
      provenance: 'EPP status interpretation',
    };
  }
  return {
    id: 'transfer',
    label: 'Transfer constraints unavailable',
    state: 'unavailable',
    detail: 'No complete status publication was available for transfer-policy review.',
    provenance: 'Registry publication quality',
  };
}

function operationsItem(activation: UnknownRecord): AcquisitionReviewItem {
  const web = record(activation.web);
  const mail = record(activation.mail);
  const webState = text(web.state, 40);
  const mailState = text(mail.state, 40);
  const webObserved = ['page_observed', 'response_observed', 'tls_only'].includes(webState);
  const mailObserved = ['authenticated_mail', 'mail_auth_gap', 'mail_observed'].includes(mailState);
  if (webObserved || mailObserved) {
    return {
      id: 'operations',
      label: 'Current service dependencies observed',
      state: 'observed',
      detail: `${webObserved ? text(web.label, 100) || 'Web evidence was observed' : 'Web state was inconclusive'}; ${mailObserved ? text(mail.label, 100) || 'mail evidence was observed' : text(mail.label, 100) || 'mail state was inconclusive'}.`,
      provenance: 'Point-in-time DNS, HTTP, TLS, and page evidence',
    };
  }
  return {
    id: 'operations',
    label: 'Service continuity unresolved',
    state: 'unavailable',
    detail: 'The available point-in-time evidence does not establish current web or mail dependencies.',
    provenance: 'Point-in-time service evidence',
  };
}

function contactsItem(insights: UnknownRecord): AcquisitionReviewItem {
  const routes = records(insights.abuseRouting);
  const disclosure = record(insights.contactDisclosure);
  const rdap = record(disclosure.registryRdap);
  const whois = record(disclosure.whois);
  if (routes.length) {
    return {
      id: 'contacts',
      label: `${routes.length} published escalation route${routes.length === 1 ? '' : 's'}`,
      state: 'observed',
      detail: 'Published registry or registrar contact routes can support manual verification, but reachability and suitability remain unconfirmed.',
      provenance: 'Separately attributed RDAP and WHOIS contacts',
    };
  }
  if (rdap.state || whois.state) {
    return {
      id: 'contacts',
      label: 'No usable escalation route observed',
      state: 'review',
      detail: 'Disclosure, redaction, or publication state was interpreted without a usable abuse or registrar route. Use official registry or registrar support channels for manual review.',
      provenance: 'RDAP and WHOIS disclosure states',
    };
  }
  return {
    id: 'contacts',
    label: 'Contact routing unavailable',
    state: 'unavailable',
    detail: 'No usable contact publication was available from the collected sources.',
    provenance: 'Registry source health',
  };
}

function sourceComplete(evidence: UnknownRecord): boolean {
  return evidence.source === 'dns' && evidence.complete === true;
}

function transitionDependencies(
  availability: UnknownRecord,
  activation: UnknownRecord,
  dnsEvidence: UnknownRecord,
  dnsRecords: UnknownRecord,
  tlsEvidence: UnknownRecord,
): AcquisitionReviewItem[] {
  const dnsComplete = sourceComplete(dnsEvidence);
  const nameservers = strings(dnsRecords.ns);
  const addresses = [...strings(dnsRecords.a), ...strings(dnsRecords.aaaa)];
  const aliases = strings(dnsRecords.cname);
  const mx = records(dnsRecords.mx);
  const spf = strings(dnsRecords.spf);
  const dmarc = strings(dnsRecords.dmarc);
  const web = record(activation.web);
  const mail = record(activation.mail);
  const tlsState = text(tlsEvidence.status, 40).toLowerCase();
  const tlsObserved = tlsEvidence.source === 'tls' && !['', 'error', 'skipped', 'unsupported'].includes(tlsState);

  return [
    nameservers.length
      ? {
          id: 'nameservers',
          label: `${nameservers.length} nameserver dependenc${nameservers.length === 1 ? 'y' : 'ies'} observed`,
          state: 'observed',
          detail: `Preserve or deliberately replace the observed delegation: ${nameservers.slice(0, 4).join(', ')}${nameservers.length > 4 ? ', …' : ''}.`,
          provenance: 'Point-in-time DNS nameserver answers',
        }
      : {
          id: 'nameservers',
          label: dnsComplete ? 'No nameserver answer observed' : 'Nameserver dependencies unavailable',
          state: dnsComplete ? 'review' : 'unavailable',
          detail: dnsComplete
            ? 'The complete resolver capture retained no nameserver answer. Confirm the authoritative delegation before any transition.'
            : 'Incomplete DNS evidence cannot establish the current authoritative delegation.',
          provenance: 'Point-in-time DNS nameserver source health',
        },
    addresses.length || aliases.length || ['page_observed', 'response_observed', 'tls_only'].includes(text(web.state, 40))
      ? {
          id: 'web',
          label: 'Web-routing dependencies observed',
          state: 'observed',
          detail: `${addresses.length} address answer${addresses.length === 1 ? '' : 's'} and ${aliases.length} alias answer${aliases.length === 1 ? '' : 's'} were retained. Preserve the intended HTTP origin, redirects, and application routing before changing DNS.`,
          provenance: 'Point-in-time DNS and HTTP activation evidence',
        }
      : {
          id: 'web',
          label: dnsComplete ? 'No web-routing answer observed' : 'Web-routing dependencies unavailable',
          state: dnsComplete ? 'review' : 'unavailable',
          detail: dnsComplete
            ? 'The complete DNS capture retained no address or CNAME answer. Confirm whether a web service is expected before transition.'
            : 'Incomplete DNS and activation evidence cannot establish current web routing.',
          provenance: 'Point-in-time DNS and HTTP source health',
        },
    mx.length || spf.length || dmarc.length || ['authenticated_mail', 'mail_auth_gap', 'mail_observed'].includes(text(mail.state, 40))
      ? {
          id: 'mail',
          label: 'Mail dependencies observed',
          state: 'observed',
          detail: `${mx.length} MX answer${mx.length === 1 ? '' : 's'}, ${spf.length} SPF polic${spf.length === 1 ? 'y' : 'ies'}, and ${dmarc.length} DMARC polic${dmarc.length === 1 ? 'y' : 'ies'} were retained. Preserve intended delivery and authentication before delegation changes.`,
          provenance: 'Point-in-time DNS mail evidence',
        }
      : {
          id: 'mail',
          label: dnsComplete ? 'No mail dependency observed' : 'Mail dependencies unavailable',
          state: dnsComplete ? 'observed' : 'unavailable',
          detail: dnsComplete
            ? 'The complete resolver capture retained no MX, SPF, or DMARC publication. Confirm whether the domain is intentionally mail-disabled.'
            : 'Incomplete DNS evidence cannot establish current mail routing or authentication.',
          provenance: 'Point-in-time DNS mail source health',
        },
    tlsObserved
      ? {
          id: 'tls',
          label: 'TLS service evidence observed',
          state: tlsEvidence.complete === true ? 'observed' : 'review',
          detail: 'A TLS service observation exists. Plan certificate issuance, private-key custody, hostname coverage, and renewal before cutover.',
          provenance: 'Point-in-time TLS evidence',
        }
      : {
          id: 'tls',
          label: 'TLS transition evidence unavailable',
          state: 'unavailable',
          detail: 'No usable TLS observation was available to describe certificate or hostname dependencies.',
          provenance: 'TLS source health',
        },
  ];
}

function registryPolicyChecks(
  availability: UnknownRecord,
  lifecycle: UnknownRecord,
  publications: UnknownRecord[],
): AcquisitionReviewItem[] {
  const domain = text(availability.domain, 253).toLowerCase().replace(/\.$/u, '');
  const suffix = domain.includes('.') ? domain.slice(domain.lastIndexOf('.') + 1) : '';
  const statuses = strings(lifecycle.rawStatuses);
  const locks = record(lifecycle.locks);
  const publicationAvailable = publications.some((item) => ['complete', 'partial'].includes(text(item.state, 24).toLowerCase()));

  return [
    {
      id: 'policy_eligibility',
      label: suffix ? `Confirm .${suffix} eligibility and registration policy` : 'Confirm registry eligibility and registration policy',
      state: 'review',
      detail: 'Check current registry and registrar rules for registrant eligibility, reserved names, disputes, documentation, renewal, and transfer before committing funds.',
      provenance: 'Manual policy check prompted by the observed domain suffix',
    },
    {
      id: 'policy_lifecycle',
      label: statuses.length ? 'Confirm lifecycle-policy interpretation' : 'Resolve lifecycle-policy context',
      state: publicationAvailable ? 'review' : 'unavailable',
      detail: statuses.length
        ? `The collected publication included ${statuses.slice(0, 6).join(', ')}${statuses.length > 6 ? ', …' : ''}. Confirm current registry timing and restoration or deletion rules; WHOISleuth does not predict release.`
        : publicationAvailable
          ? 'No recognised lifecycle status was retained. Confirm renewal, grace, redemption, restoration, and deletion rules with the current registry or registrar.'
          : 'No usable registry publication was available for a current lifecycle-policy review.',
      provenance: 'Separately attributed RDAP and WHOIS lifecycle publications',
    },
    {
      id: 'policy_transfer',
      label: locks.client === true || locks.server === true ? 'Confirm observed transfer constraints' : 'Confirm transfer and change-of-control requirements',
      state: publicationAvailable ? 'review' : 'unavailable',
      detail: locks.client === true || locks.server === true
        ? 'Recognised client or server lock evidence was observed. Confirm authorisation codes, lock removal, waiting periods, identity checks, and any registrar change-of-control process.'
        : publicationAvailable
          ? 'No recognised lock was retained, but that does not establish transfer eligibility. Confirm authorisation, waiting periods, identity checks, and registrar requirements.'
          : 'No usable status publication was available to describe current transfer constraints.',
      provenance: 'EPP status interpretation and manual policy requirements',
    },
  ];
}

function summaryState(availability: UnknownRecord): AcquisitionDueDiligence['state'] {
  const state = text(availability.state, 40).toLowerCase();
  if (state === 'for_sale') return 'sale_signal';
  if (state === 'expiring') return 'review_transition';
  if (state === 'registered') return 'registered';
  if (
    state === 'available'
    && text(availability.source, 24).toLowerCase() === 'rdap'
    && text(availability.confidence, 24).toLowerCase() === 'high'
  ) return 'unregistered_observation';
  return 'incomplete';
}

export function buildAcquisitionDueDiligence(input: Readonly<{
  activationContext?: unknown;
  availability?: unknown;
  dnsEvidence?: unknown;
  dnsRecords?: unknown;
  registryInsights?: unknown;
  tlsEvidence?: unknown;
}>): AcquisitionDueDiligence {
  const availability = record(input.availability);
  const insights = record(input.registryInsights);
  const lifecycle = record(insights.lifecycle);
  const publications = records(insights.publications);
  const registration = availabilityItem(availability);
  const items = [
    registration,
    lifecycleItem(availability, lifecycle, publications),
    transferItem(lifecycle, publications),
    operationsItem(record(input.activationContext)),
    contactsItem(insights),
  ];
  const dependencies = transitionDependencies(
    availability,
    record(input.activationContext),
    record(input.dnsEvidence),
    record(input.dnsRecords),
    record(input.tlsEvidence),
  );
  const policyChecks = registryPolicyChecks(availability, lifecycle, publications);
  const unavailable = items.filter((item) => item.state === 'unavailable').length;
  const review = items.filter((item) => item.state === 'review').length;
  const nextSteps = [
    registration.state === 'unavailable'
      ? 'Refresh authoritative registration evidence before making an acquisition decision.'
      : 'Confirm current registration eligibility, price, and contractual terms with an appropriate registrar or registry.',
    items[1]?.state === 'review' || items[2]?.state === 'review'
      ? 'Review current registry lifecycle and transfer-policy statuses immediately before acting.'
      : 'Recheck lifecycle and transfer-policy statuses at the point of action.',
    items[3]?.state === 'observed'
      ? 'Inventory observed web, mail, certificate, and DNS dependencies before planning a transition.'
      : 'Determine whether current DNS, web, mail, and certificate services must be preserved.',
    items[4]?.state === 'observed'
      ? 'Validate the appropriate published contact route before sending any request.'
      : 'Resolve official registry and registrar support channels manually.',
    'Review trade mark, eligibility, dispute, tax, escrow, and legal requirements outside WHOISleuth.',
  ].slice(0, 6);
  return {
    version: 2,
    label: unavailable
      ? `${unavailable} due-diligence area${unavailable === 1 ? '' : 's'} unavailable`
      : review
        ? `${review} due-diligence area${review === 1 ? '' : 's'} require review`
        : 'Collected due-diligence areas observed',
    state: summaryState(availability),
    items,
    transitionDependencies: dependencies,
    policyChecks,
    nextSteps,
    limitations: [
      'This workspace organises observed evidence; it does not value a domain or establish that it can be acquired.',
      'Expiry dates, EPP statuses, sale signals, and contact routes can change after collection.',
      'WHOISleuth does not assess legal rights, registry eligibility, registrar terms, escrow, tax, or payment risk.',
    ],
  };
}
