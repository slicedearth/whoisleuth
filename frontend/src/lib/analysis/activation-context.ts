import type { LifecycleEventInput } from './visualization-models.ts';

export type ActivationContextInput = Readonly<{
  registryCreated?: unknown;
  registryUpdated?: unknown;
  registryExpires?: unknown;
  tlsValidFrom?: unknown;
  tlsValidTo?: unknown;
  observedAt?: unknown;
  dnsStatus?: unknown;
  dnsComplete?: unknown;
  hasMx?: unknown;
  hasSpf?: unknown;
  hasDmarc?: unknown;
  httpStatus?: unknown;
  pageObserved?: unknown;
  tlsObserved?: unknown;
}>;

export type MailObservationState =
  | 'authenticated_mail'
  | 'inconclusive'
  | 'mail_auth_gap'
  | 'mail_observed'
  | 'no_mail_observed';
export type WebObservationState = 'inconclusive' | 'page_observed' | 'response_observed' | 'tls_only';
export type ServiceRelationshipState = 'both_observed' | 'inconclusive' | 'web_without_mail';

export type ActivationContext = Readonly<{
  version: 1;
  events: readonly LifecycleEventInput[];
  mail: Readonly<{ state: MailObservationState; label: string; detail: string }>;
  web: Readonly<{ state: WebObservationState; label: string; detail: string }>;
  relationship: Readonly<{
    state: ServiceRelationshipState;
    label: string;
    detail: string;
  }>;
  limitations: readonly string[];
}>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const COMPLETE_DNS_STATES = new Set(['complete', 'success']);

function boundedText(value: unknown, maximum = 80): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum);
  return text || null;
}

function validDate(value: unknown): string | null {
  const text = boundedText(value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function event(
  id: string,
  label: string,
  date: unknown,
  detail: string,
  kind: Exclude<LifecycleEventInput['kind'], undefined>,
): LifecycleEventInput | null {
  const normalized = validDate(date);
  return normalized ? { id, label, date: normalized, detail, kind } : null;
}

function mailObservation(input: ActivationContextInput): ActivationContext['mail'] {
  const dnsConclusive = input.dnsComplete !== false
    && COMPLETE_DNS_STATES.has(String(input.dnsStatus ?? '').toLowerCase());
  if (input.hasMx === true) {
    if (input.hasSpf === true && input.hasDmarc === true) {
      return {
        state: 'authenticated_mail',
        label: 'Mail and core authentication observed',
        detail: 'MX, SPF, and DMARC records were present in this DNS observation.',
      };
    }
    if (dnsConclusive && (input.hasSpf === false || input.hasDmarc === false)) {
      const missing = [
        input.hasSpf === false ? 'SPF' : null,
        input.hasDmarc === false ? 'DMARC' : null,
      ].filter(Boolean).join(' and ');
      return {
        state: 'mail_auth_gap',
        label: 'Mail authentication gap',
        detail: `MX was observed, while ${missing} was not observed in the completed DNS collection.`,
      };
    }
    return {
      state: 'mail_observed',
      label: 'Mail routing observed',
      detail: 'MX was observed, but the authentication comparison is incomplete.',
    };
  }
  if (input.hasMx === false && dnsConclusive) {
    return {
      state: 'no_mail_observed',
      label: 'No mail routing observed',
      detail: 'The completed DNS collection did not observe an MX record. This does not prove that mail can never be delivered.',
    };
  }
  return {
    state: 'inconclusive',
    label: 'Mail state inconclusive',
    detail: 'The available DNS evidence cannot support a complete mail-routing comparison.',
  };
}

function webObservation(input: ActivationContextInput): ActivationContext['web'] {
  const status = Number(input.httpStatus);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return {
      state: 'response_observed',
      label: 'Web response observed',
      detail: `The bounded HTTP collection received status ${status}.`,
    };
  }
  if (input.pageObserved === true) {
    return {
      state: 'page_observed',
      label: 'Page evidence observed',
      detail: 'Static page identity evidence was present in this lookup.',
    };
  }
  if (input.tlsObserved === true) {
    return {
      state: 'tls_only',
      label: 'TLS endpoint observed',
      detail: 'TLS evidence was collected, but no HTTP response or page identity was available.',
    };
  }
  return {
    state: 'inconclusive',
    label: 'Web state inconclusive',
    detail: 'The available evidence does not establish whether a web service was responding.',
  };
}

function serviceRelationship(
  mail: ActivationContext['mail'],
  web: ActivationContext['web'],
): ActivationContext['relationship'] {
  const webObserved = web.state === 'response_observed' || web.state === 'page_observed';
  const mailObserved = mail.state === 'authenticated_mail'
    || mail.state === 'mail_auth_gap'
    || mail.state === 'mail_observed';
  if (webObserved && mailObserved) {
    return {
      state: 'both_observed',
      label: 'Web and mail observed',
      detail: 'Both service layers were observed in this point-in-time lookup. Their activation dates remain unknown.',
    };
  }
  if (webObserved && mail.state === 'no_mail_observed') {
    return {
      state: 'web_without_mail',
      label: 'Web observed without MX',
      detail: 'A web response or page was observed while the completed DNS collection did not observe MX.',
    };
  }
  return {
    state: 'inconclusive',
    label: 'Cross-layer timing inconclusive',
    detail: 'Current evidence does not support a complete web-versus-mail comparison.',
  };
}

export function buildActivationContext(input: ActivationContextInput): ActivationContext {
  const events = [
    event('domain-created', 'Domain created', input.registryCreated, 'Registry lifecycle', 'registry'),
    event('domain-updated', 'Registry updated', input.registryUpdated, 'Most recent registry change', 'registry'),
    event('tls-valid-from', 'Certificate valid', input.tlsValidFrom, 'Observed leaf certificate', 'certificate'),
    event('lookup-observed', 'Lookup observed', input.observedAt, 'Point-in-time collection', 'observation'),
    event('tls-valid-to', 'Certificate expires', input.tlsValidTo, 'Observed leaf certificate', 'certificate'),
    event('domain-expires', 'Domain expires', input.registryExpires, 'Registry lifecycle', 'registry'),
  ].filter((candidate): candidate is LifecycleEventInput => candidate !== null);
  const mail = mailObservation(input);
  const web = webObservation(input);
  return {
    version: 1,
    events,
    mail,
    web,
    relationship: serviceRelationship(mail, web),
    limitations: [
      'Registry and certificate dates do not reveal when DNS, mail, or page content first became active.',
      'DNS, HTTP, TLS, and page findings are point-in-time observations and may change after collection.',
      'Observed services do not establish ownership, operator identity, intent, or maliciousness.',
    ],
  };
}
