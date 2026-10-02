import { canonicalRegistrableDomain } from '../analysis/registrable-domain.mts';
import { parseCredentialFreeHttpUrl } from '../evidence/lookup-target.mts';
import { MAX_INTAKE_LINKS, MAX_INTAKE_URL_LENGTH, MAX_EMBEDDED_LINK_DEPTH, MAX_AUTH_SCOPES,
  type AuthorisationLinkReview, type IntakeLink, type IntakeTarget } from '../contracts/message-intake.mts';
export type LinkIntake = Readonly<{
  links: readonly IntakeLink[];
  targets: readonly IntakeTarget[];
  rejected: number;
  bounded: boolean;
  limitations: readonly string[];
}>;

const EXCLUDED_INPUTS = {
  malformed: 'Malformed or overlong links were not reviewed',
  credentials: 'Links containing credentials were not reviewed',
  protocol: 'Non-HTTP(S) links were not reviewed',
  port: 'Links using non-default ports were not reviewed',
  host: 'IP-address or non-registrable-host links were not reviewed',
  qrNetwork: 'QR network settings were not interpreted',
  qrContact: 'QR contact details were not interpreted',
  qrProtocol: 'QR non-HTTP(S) payloads were not interpreted',
  qrHost: 'QR hostnames without an HTTP(S) scheme were not offered for collection',
  qrText: 'QR text without an HTTP(S) link was not interpreted',
} as const;
type ExcludedInput = keyof typeof EXCLUDED_INPUTS;

const AUTH_KEYS = ['client_id', 'scope', 'redirect_uri', 'response_type', 'prompt'] as const;
const EMBEDDED_KEYS = new Set(['url', 'u', 'target', 'redirect', 'redirect_uri', 'redirect_url', 'return', 'returnurl', 'continue', 'next', 'dest', 'destination']);
const safeIdentifier = (value: string | null): string | null => value && /^[a-zA-Z0-9._~:-]{1,160}$/u.test(value) ? value : null;
const tokens = (value: string | null): string[] => (value ?? '').split(/\s+/u).filter(Boolean);

export function reviewAuthorisationLink(url: URL): AuthorisationLinkReview | null {
  const params = url.searchParams;
  const authorisation = params.has('client_id') && (params.has('scope') || params.has('response_type') || params.has('redirect_uri'));
  const device = /\/(?:device|devicecode|devicelogin)(?:\/|$)/iu.test(url.pathname);
  if (!authorisation && !device) return null;
  const duplicateParameters = AUTH_KEYS.filter(key => params.getAll(key).length > 1);
  const single = (key: typeof AUTH_KEYS[number]) => duplicateParameters.includes(key) ? null : params.get(key);
  const scopes = tokens(single('scope'));
  const retainedScopes = scopes.filter(scope => /^[a-zA-Z0-9._:/-]{1,160}$/u.test(scope)).slice(0, MAX_AUTH_SCOPES);
  const redirect = parseCredentialFreeHttpUrl(single('redirect_uri'), MAX_INTAKE_URL_LENGTH);
  const responseTypes = tokens(single('response_type')).filter(value => ['code', 'token', 'id_token', 'none'].includes(value));
  const prompt = tokens(single('prompt')).filter(value => ['none', 'login', 'consent', 'select_account', 'create'].includes(value));
  return {
    kind: authorisation ? 'authorisation_parameters' : 'device_code_reference',
    clientId: safeIdentifier(single('client_id')), scopes: retainedScopes,
    redirectOrigin: redirect?.origin ?? null, responseTypes, prompt, duplicateParameters,
    omittedParameters: scopes.length !== retainedScopes.length || (params.has('client_id') && !safeIdentifier(single('client_id')))
      || (params.has('redirect_uri') && !redirect) || tokens(single('response_type')).length !== responseTypes.length
      || tokens(single('prompt')).length !== prompt.length,
  };
}

export function refangIntakeUrl(raw: string): string {
  return raw.replace(/^hxxps:/iu, 'https:').replace(/^hxxp:/iu, 'http:').replace(/\[\.\]|\(\.\)/gu, '.');
}

function displayedHost(value: string): string | null {
  const bounded = value.trim();
  if (bounded.length > MAX_INTAKE_URL_LENGTH || /\s/u.test(bounded)) return null;
  const parsed = parseCredentialFreeHttpUrl(refangIntakeUrl(/^(?:https?|hxxps?):/iu.test(bounded) ? bounded : `https://${bounded}`), MAX_INTAKE_URL_LENGTH);
  return parsed && canonicalRegistrableDomain(parsed.hostname) ? parsed.hostname : null;
}

/** No resolution or request occurs here; embedded targets remain supplied text. */
export function createLinkIntake() {
  const links: IntakeLink[] = [], targets: IntakeTarget[] = [];
  const seen = new Set<string>();
  const exclusions = new Map<ExcludedInput, number>();
  let rejected = 0, bounded = false;
  function exclude(reason: ExcludedInput, isLink = true): void {
    if (isLink) rejected++;
    exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);
  }
  function add(raw: string, source: IntakeLink['source'], displayed = '', parentId: string | null = null, depth = 0, location?: IntakeLink['location']): void {
    if (links.length >= MAX_INTAKE_LINKS) { bounded = true; return; }
    const value = refangIntakeUrl(raw.trim());
    const url = parseCredentialFreeHttpUrl(value, MAX_INTAKE_URL_LENGTH);
    if (!url) {
      let reason: ExcludedInput = 'malformed';
      if (value.length <= MAX_INTAKE_URL_LENGTH && !/[\x00-\x20\x7f]/u.test(value)) {
        try {
          const parsed = new URL(value);
          if (!['http:', 'https:'].includes(parsed.protocol)) reason = 'protocol';
          else if (parsed.username || parsed.password) reason = 'credentials';
        } catch { /* Retain only the fixed malformed-input category. */ }
      }
      exclude(reason); return;
    }
    if (url.port) { exclude('port'); return; }
    if (!canonicalRegistrableDomain(url.hostname)) { exclude('host'); return; }
    const shown = displayedHost(displayed);
    const key = JSON.stringify([url.href, source, parentId, shown, location ?? null]);
    if (seen.has(key)) return;
    seen.add(key);
    const id = `link-${links.length + 1}`;
    links.push({ id, origin: url.origin, hostname: url.hostname, registrationDomain: canonicalRegistrableDomain(url.hostname),
      source, ...(location ? { location } : {}), parentId, displayedHostname: shown, displayedDestination: shown ? shown === url.hostname ? 'same_host' : 'different_host' : 'not_a_hostname',
      hasPrivateLocation: url.pathname !== '/' || Boolean(url.search || url.hash), authorisation: reviewAuthorisationLink(url) });
    targets.push({ id, exactUrl: url.href });
    for (const [name, value] of url.searchParams) {
      if (!EMBEDDED_KEYS.has(name.toLowerCase()) || !/^(?:https?|hxxps?):\/\//iu.test(value)) continue;
      if (depth >= MAX_EMBEDDED_LINK_DEPTH) { bounded = true; continue; }
      add(value, 'embedded_parameter', '', id, depth + 1, location);
    }
  }
  function addText(text: string, source: IntakeLink['source'] = 'text', location?: IntakeLink['location']): void {
    // The caller admits bytes before this scan; iteration stops at the work bound.
    for (const match of text.matchAll(/(?:https?|hxxps?):\/\/[^\s<>"'`]+/giu)) {
      add(match[0].replace(/[.,;!?]+$/u, ''), source, '', null, 0, location);
      if (links.length >= MAX_INTAKE_LINKS) { bounded = true; break; }
    }
  }
  function addQr(text: string, source: 'qr' | 'document_qr' = 'qr', location?: IntakeLink['location']): void {
    const value = refangIntakeUrl(text.trim());
    const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(value)?.[1]?.toLowerCase();
    if (/^WIFI:/iu.test(value)) { exclude('qrNetwork', false); return; }
    if (/^(?:BEGIN:VCARD|MECARD:)/iu.test(value)) { exclude('qrContact', false); return; }
    if (scheme && !['http', 'https'].includes(scheme)) { exclude('qrProtocol', false); return; }
    if (!/(?:https?|hxxps?):\/\//iu.test(value)) {
      exclude(displayedHost(value) ? 'qrHost' : 'qrText', false); return;
    }
    addText(value, source, location);
  }
  return { add, addText, addQr, result: (): LinkIntake => ({ links: [...links], targets: [...targets], rejected, bounded,
    limitations: (Object.keys(EXCLUDED_INPUTS) as ExcludedInput[]).flatMap(reason => {
      const count = exclusions.get(reason);
      return count ? [`${EXCLUDED_INPUTS[reason]} (${count}).`] : [];
    }),
  }) };
}
