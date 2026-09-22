import PostalMime, { type Email } from 'postal-mime';
import { parse, defaultTreeAdapter, type DefaultTreeAdapterTypes } from 'parse5';
import { sha256ArtifactBytes } from '../evidence/artifact-integrity.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { createLinkIntake } from './link-intake.mts';
import { AUTHENTICATION_METHODS, addressDomains, authenticationState, authenticationServiceDomains,
  dkimSigningDomains } from './mail-header-identity.mts';
import { reviewIdentityIncident } from './identity-incident-review.mts';
import { requestedActionHints } from './requested-action-hints.mts';
import { MESSAGE_INTAKE_SCHEMA, MESSAGE_INTAKE_VERSION, MESSAGE_INTAKE_KINDS, MAX_MESSAGE_INTAKE_BYTES,
  MAX_MESSAGE_PARTS, MAX_MESSAGE_DEPTH, MAX_MESSAGE_HTML_NODES,
  type IntakeLink, type MessageActionHint, type MessageIdentity, type MessageAuthenticationClaim,
  type MessageIntakeKind, type MessageIntakeResult } from '../contracts/message-intake.mts';


export function assertMessageBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > MAX_MESSAGE_INTAKE_BYTES) {
    throw new TypeError('Select one non-empty input of at most 16 MiB. No input was retained.');
  }
}

/** All parsing is inert. Only HTTP(S) link targets are offered for deliberate collection. */
export async function reviewMessageInput(bytes: Uint8Array, kind: MessageIntakeKind, reviewedAt: string, qrText?: readonly string[]): Promise<MessageIntakeResult> {
  assertMessageBytes(bytes);
  const instant = normalizeExplicitIsoTimestamp(reviewedAt);
  if (!instant) throw new TypeError('Input review requires a timestamp with an explicit timezone.');
  if (!MESSAGE_INTAKE_KINDS.includes(kind)) throw new TypeError('Unsupported message input type.');
  const links = createLinkIntake(), identities: MessageIdentity[] = [], authenticationClaims: MessageAuthenticationClaim[] = [];
  const actionHints = new Set<MessageActionHint>(), bounds = new Set<string>();
  let reviewedParts = 0, unreviewedAttachments = 0, decodedBytes = 0;
  const text = (value: string, source: IntakeLink['source']) => {
    for (const hint of requestedActionHints(value)) actionHints.add(hint);
    links.addText(value, source);
  };
  function html(value: string) {
    // parse5 never renders, loads resources, or runs supplied script.
    let allocated = 0;
    const htmlBound = new Error('HTML work bound');
    const admit = () => { if (++allocated > MAX_MESSAGE_HTML_NODES) throw htmlBound; };
    let tree: DefaultTreeAdapterTypes.Document;
    try {
      tree = parse(value, { treeAdapter: { ...defaultTreeAdapter,
        createElement(...args) { admit(); return defaultTreeAdapter.createElement(...args); },
        createTextNode(...args) { admit(); return defaultTreeAdapter.createTextNode(...args); },
        createCommentNode(...args) { admit(); return defaultTreeAdapter.createCommentNode(...args); },
      } });
    } catch (cause) { if (cause !== htmlBound) throw cause; bounds.add('HTML nodes'); return; }
    const queue: DefaultTreeAdapterTypes.Node[] = [tree];
    let nodes = 0;
    while (queue.length) {
      if (++nodes > MAX_MESSAGE_HTML_NODES) { bounds.add('HTML nodes'); break; }
      const node = queue.pop()!;
      if ('tagName' in node) {
        const attrs = new Map(node.attrs.map(attr => [attr.name, attr.value]));
        if (node.tagName === 'a' && attrs.has('href')) {
          const shown: string[] = [], children = [...node.childNodes];
          let count = 0;
          while (children.length && ++count <= MAX_MESSAGE_HTML_NODES) {
            const child = children.pop()!;
            if ('value' in child) shown.push(child.value);
            if ('childNodes' in child) children.push(...child.childNodes);
          }
          links.add(attrs.get('href')!, 'html_link', shown.reverse().join('').trim());
        }
        if (node.tagName === 'form' && attrs.has('action')) links.add(attrs.get('action')!, 'html_form');
        if ((node.tagName === 'iframe' || node.tagName === 'frame') && attrs.has('src')) links.add(attrs.get('src')!, 'html_frame');
        if (node.tagName === 'script' || node.tagName === 'style') continue;
      }
      if ('value' in node) text(node.value, 'text');
      if ('childNodes' in node) for (let index = node.childNodes.length - 1; index >= 0; index--) queue.push(node.childNodes[index]!);
    }
  }
  function calendar(value: string) {
    const unfolded = value.replace(/\r?\n[ \t]/gu, '');
    // No attendee names, addresses, descriptions or event identifiers enter the report.
    for (const line of unfolded.split(/\r?\n/u)) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const key = line.slice(0, colon).split(';', 1)[0]?.toUpperCase();
      if (['URL', 'DESCRIPTION', 'LOCATION', 'X-ALT-DESC'].includes(key ?? '')) text(line.slice(colon + 1).replace(/\\n/giu, '\n').replace(/\\([,;\\])/gu, '$1'), 'calendar');
    }
  }
  function identity(part: number, role: MessageIdentity['role'], domains: readonly string[]) {
    for (const domain of domains) identities.push({ part, role, domain });
  }
  function headers(mail: Email, part: number) {
    const values = (name: string) => mail.headers.filter(header => header.key === name).map(header => header.value);
    identity(part, 'from', addressDomains(values('from')));
    identity(part, 'reply_to', addressDomains(values('reply-to')));
    identity(part, 'return_path', addressDomains(values('return-path')));
    identity(part, 'dkim', dkimSigningDomains(values('dkim-signature')));
    const reported = values('authentication-results');
    identity(part, 'authentication_service', authenticationServiceDomains(reported));
    for (const method of AUTHENTICATION_METHODS) {
      const claim = authenticationState(reported, method, method === 'spf' ? values('received-spf') : []);
      if (claim.observations) authenticationClaims.push({ part, method, result: claim.state });
    }
  }
  async function message(input: Uint8Array, depth: number): Promise<void> {
    if (depth > MAX_MESSAGE_DEPTH || reviewedParts >= MAX_MESSAGE_PARTS) { bounds.add('Message nesting or parts'); unreviewedAttachments++; return; }
    decodedBytes += input.byteLength;
    if (decodedBytes > MAX_MESSAGE_INTAKE_BYTES * 2) { bounds.add('Decoded message bytes'); unreviewedAttachments++; return; }
    let mail: Email;
    try { mail = await PostalMime.parse(input, { maxNestingDepth: MAX_MESSAGE_DEPTH, maxHeadersSize: 256 * 1024, rfc822Attachments: true, forceRfc822Attachments: true, attachmentEncoding: 'arraybuffer' }); }
    catch { throw new TypeError('The message could not be decoded within the MIME nesting and header limits. No input was retained.'); }
    const part = ++reviewedParts;
    headers(mail, part);
    if (mail.text) text(mail.text, 'text');
    if (mail.html) html(mail.html);
    for (const attachment of mail.attachments) {
      if (reviewedParts >= MAX_MESSAGE_PARTS) { bounds.add('Message parts'); unreviewedAttachments++; continue; }
      const body = typeof attachment.content === 'string' ? new TextEncoder().encode(attachment.content) : new Uint8Array(attachment.content);
      if (attachment.mimeType === 'message/rfc822') await message(body, depth + 1);
      else if (attachment.mimeType === 'text/calendar') { reviewedParts++; calendar(new TextDecoder().decode(body)); }
      else { unreviewedAttachments++; }
    }
  }
  if (kind === 'email') await message(bytes, 0);
  else if (kind === 'qr') {
    if (!Array.isArray(qrText) || qrText.length > MAX_MESSAGE_PARTS || qrText.some(value => typeof value !== 'string' || value.length > 8_192)) throw new TypeError('QR review requires bounded decoded text.');
    reviewedParts = qrText.length;
    for (const value of qrText) text(value, 'qr');
  } else {
    reviewedParts = 1;
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (kind === 'calendar') calendar(value); else text(value, 'text');
  }
  const result = links.result();
  if (result.bounded) bounds.add('Link extraction');
  return { report: { schema: MESSAGE_INTAKE_SCHEMA, schemaVersion: MESSAGE_INTAKE_VERSION, reviewedAt: instant,
    source: { kind, digestSha256: await sha256ArtifactBytes(bytes), byteLength: bytes.byteLength },
    coverage: { state: bounds.size || unreviewedAttachments ? 'partial' : 'reviewed', reviewedParts, unreviewedAttachments, rejectedLinks: result.rejected, boundsReached: [...bounds] },
    identities, authenticationClaims, links: result.links, actionHints: [...actionHints], identityRecovery: reviewIdentityIncident({ reportedActions: [] }) }, targets: result.targets };
}
