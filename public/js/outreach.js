// Outreach draft - only meaningful once a registrant with a real (non-
// privacy-protected) email has been found, which today only happens after
// a deep check. A plain mailto: link plus a copy-to-clipboard fallback,
// since not everyone has a desktop mail client configured to handle mailto.

import { escapeHtml, wireCopyToClipboard, isRedactionPlaceholder } from './utils.js';

function buildOutreachDraftText(domain, registrant) {
  const greetingName = (registrant && (registrant.name || registrant.org)) || 'there';
  return [
    `Hi ${greetingName},`,
    '',
    `I came across ${domain} and wanted to reach out to see if you'd be open to discussing a potential sale.`,
    '',
    "Would you be willing to share your asking price, or are you open to receiving an offer?",
    '',
    'Looking forward to hearing from you.',
    '',
    'Best regards,',
  ].join('\n');
}

export function buildOutreachMailto(domain, registrant) {
  if (!registrant || !registrant.email || isRedactionPlaceholder(registrant.email)) return null;
  const query = new URLSearchParams({
    subject: `Inquiry about ${domain}`,
    body: buildOutreachDraftText(domain, registrant),
  }).toString();
  return `mailto:${registrant.email}?${query}`;
}

export function outreachButtonHtml(domain, registrant) {
  const mailto = buildOutreachMailto(domain, registrant);
  if (!mailto) return '';
  return `
    <div class="section-title">Outreach</div>
    <a class="chip" href="${escapeHtml(mailto)}">Draft email to ${escapeHtml(registrant.email)}</a>
    <button type="button" class="secondary outreach-copy-btn" data-domain="${escapeHtml(domain)}" style="margin-left:6px;">Copy draft</button>
  `;
}

// registrant data for the currently-rendered outreach copy buttons, keyed by
// domain (the delegated click handler below needs this since it fires well
// after the row/card was rendered).
export const outreachRegistrantByDomain = new Map();

wireCopyToClipboard('outreach-copy-btn', (domain) => buildOutreachDraftText(domain, outreachRegistrantByDomain.get(domain)));
