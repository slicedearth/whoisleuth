// Abuse-report draft - for a registered lookalike/typosquat domain, drafts
// a takedown request to its published abuse contact (RDAP/WHOIS abuse
// fields, already surfaced by lib/availability.js), referencing the same
// risk signals shown in the Risk column. Mirrors outreach.js's mailto +
// copy-to-clipboard pattern, but targets a different recipient and purpose
// (reporting abuse, not making an acquisition offer).

import { escapeHtml, wireCopyToClipboard, isRedactionPlaceholder, isValidEmailAddress } from './utils.js';
import { fmtAge } from './scoring.js';

function buildAbuseDraftText(domain, record) {
  const signals = [];
  if (record.hasMx) signals.push('configured to send/receive email');
  if (record.activityStatus === 'active') signals.push('actively serving a website');
  if (record.privacyProtected) signals.push('registrant identity hidden behind privacy protection');
  const age = fmtAge(record.domainAgeDays);
  if (age) signals.push(`registered ${age}`);

  const lines = [
    'Hello,',
    '',
    `I'm reporting the domain ${domain} as a suspected phishing/brand-impersonation (typosquatting) registration.`,
  ];
  if (signals.length) lines.push('', `Observed risk indicators: ${signals.join('; ')}.`);
  lines.push(
    '',
    'This domain closely resembles a trademark/brand I am responsible for and does not appear to be affiliated with it. Please investigate and take appropriate action under your Acceptable Use Policy.',
    '',
    'Thank you,'
  );
  return lines.join('\n');
}

export function buildAbuseMailto(domain, record) {
  if (!record || !record.abuseEmail || isRedactionPlaceholder(record.abuseEmail)) return null;
  if (!isValidEmailAddress(record.abuseEmail)) return null;
  const query = new URLSearchParams({
    subject: `Abuse report - suspected typosquat/phishing domain: ${domain}`,
    body: buildAbuseDraftText(domain, record),
  }).toString();
  return `mailto:${record.abuseEmail}?${query}`;
}

export function abuseButtonHtml(domain, record) {
  const mailto = buildAbuseMailto(domain, record);
  if (!mailto) return '';
  return `
    <div class="section-title">Report abuse</div>
    <a class="chip" href="${escapeHtml(mailto)}">Draft report to ${escapeHtml(record.abuseEmail)}</a>
    <button type="button" class="secondary abuse-copy-btn" data-domain="${escapeHtml(domain)}" style="margin-left:6px;">Copy draft</button>
  `;
}

// Record data for the currently-rendered abuse copy buttons, keyed by
// domain - same reasoning as outreach.js's outreachRegistrantByDomain (the
// delegated click handler fires well after the row/card was rendered).
export const abuseRecordByDomain = new Map();

wireCopyToClipboard('abuse-copy-btn', (domain) => {
  const record = abuseRecordByDomain.get(domain);
  return record ? buildAbuseDraftText(domain, record) : null;
});
