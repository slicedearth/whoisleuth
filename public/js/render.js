// Renders RDAP/WHOIS panel content and the single-lookup availability card.
// Shared by single-lookup.js (which fetches the data) and by bulk.js/
// shortlist.js (which only need PILL_LABELS for their own table rendering).

import { escapeHtml, fmtDate, kv } from './utils.js';
import {
  fmtAge,
  fmtExpiresIn,
  ACTIVITY_LABELS,
  computeOpportunityScore,
  scoreTone,
  computeRiskScore,
  riskTone,
} from './scoring.js';
import { outreachButtonHtml, outreachRegistrantByDomain } from './outreach.js';
import { abuseButtonHtml, abuseRecordByDomain } from './abuse.js';
import {
  availabilityCard,
  availabilityDomain,
  availabilityPill,
  availabilityScores,
  availabilityDetail,
  availabilityConfidence,
  availabilitySignals,
  availabilityOutreach,
  availabilityAbuseReport,
} from './dom.js';

function entityBlock(title, entity) {
  if (!entity) return '';
  const rows = [
    entity.name ? kv('Name', entity.name) : '',
    entity.org ? kv('Organisation', entity.org) : '',
    entity.email ? kv('Email', entity.email) : '',
    entity.phone ? kv('Phone', entity.phone) : '',
    entity.address ? kv('Address', entity.address) : '',
    entity.handle ? kv('Handle', entity.handle) : '',
  ].join('');
  if (!rows) return '';
  return `<div class="section-title">${escapeHtml(title)}</div><dl class="kv-grid">${rows}</dl>`;
}

function rawBlock(rawData) {
  return `<details class="raw"><summary>Show raw RDAP JSON</summary><pre>${escapeHtml(
    JSON.stringify(rawData, null, 2)
  )}</pre></details>`;
}

export function renderRdap(type, parsed, rawData) {
  if (!parsed) {
    return `<span class="placeholder">No structured RDAP data available for this record.</span>` + rawBlock(rawData);
  }

  let html = '';

  if (type === 'domain') {
    html += `<dl class="kv-grid">${kv('Domain', parsed.domain)}${kv('Handle', parsed.handle)}${kv('DNSSEC', parsed.dnssec)}</dl>`;

    if (parsed.statuses && parsed.statuses.length) {
      html += `<div class="section-title">Status</div><div class="badge-list">${parsed.statuses
        .map((s) => `<span class="status-chip">${escapeHtml(s)}</span>`)
        .join('')}</div>`;
    }

    if (parsed.events && parsed.events.length) {
      const rows = parsed.events.map((e) => kv(e.action, fmtDate(e.date))).join('');
      html += `<div class="section-title">Dates</div><dl class="kv-grid">${rows}</dl>`;
    }

    if (parsed.nameservers && parsed.nameservers.length) {
      html += `<div class="section-title">Name servers</div><ul class="ns-list">${parsed.nameservers
        .map((ns) => `<li>${escapeHtml(ns)}</li>`)
        .join('')}</ul>`;
    }

    html += entityBlock('Registrar', parsed.registrar);
    html += entityBlock('Registrant', parsed.registrant);
    html += entityBlock('Abuse contact', parsed.abuse);
  } else if (type === 'ipv4' || type === 'ipv6') {
    html += `<dl class="kv-grid">${kv('Name', parsed.name)}${kv('Handle', parsed.handle)}${kv(
      'Range',
      parsed.startAddress && parsed.endAddress ? `${parsed.startAddress} – ${parsed.endAddress}` : null
    )}${kv('CIDR', (parsed.cidrs || []).join(', '))}${kv('Country', parsed.country)}${kv('Type', parsed.networkType)}</dl>`;

    if (parsed.events && parsed.events.length) {
      const rows = parsed.events.map((e) => kv(e.action, fmtDate(e.date))).join('');
      html += `<div class="section-title">Dates</div><dl class="kv-grid">${rows}</dl>`;
    }

    html += entityBlock('Organisation', parsed.org);
    html += entityBlock('Abuse contact', parsed.abuse);
  } else if (type === 'asn') {
    html += `<dl class="kv-grid">${kv('Name', parsed.name)}${kv('Handle', parsed.handle)}${kv(
      'Range',
      parsed.startAutnum != null ? `AS${parsed.startAutnum} – AS${parsed.endAutnum}` : null
    )}${kv('Country', parsed.country)}${kv('Type', parsed.autnumType)}</dl>`;

    if (parsed.events && parsed.events.length) {
      const rows = parsed.events.map((e) => kv(e.action, fmtDate(e.date))).join('');
      html += `<div class="section-title">Dates</div><dl class="kv-grid">${rows}</dl>`;
    }

    html += entityBlock('Organisation', parsed.org);
    html += entityBlock('Abuse contact', parsed.abuse);
  }

  return html + rawBlock(rawData);
}

// True once at least one field worth showing its own kv-grid/section came
// back - a thin-registry hop (e.g. a root WHOIS server that only confirms a
// referral, no per-domain data) parses to an object with none of these set,
// which otherwise rendered as a near-blank panel next to a fully populated
// RDAP one, indistinguishable from a rendering bug.
function hasParsedWhoisFields(parsed) {
  return Boolean(
    parsed.domainName ||
      parsed.registrar ||
      parsed.registrarUrl ||
      parsed.createdDate ||
      parsed.expiryDate ||
      parsed.updatedDate ||
      parsed.abuseEmail ||
      parsed.abusePhone ||
      parsed.dnssec ||
      (parsed.statuses && parsed.statuses.length) ||
      (parsed.nameservers && parsed.nameservers.length) ||
      parsed.registrantName ||
      parsed.registrantOrg ||
      parsed.registrantEmail ||
      parsed.adminName ||
      parsed.adminOrg ||
      parsed.adminEmail
  );
}

export function renderWhois(parsed, chain) {
  if (!parsed) return `<span class="placeholder">No WHOIS data.</span>`;

  let html = '';

  if (!hasParsedWhoisFields(parsed)) {
    html += `<span class="placeholder">No structured WHOIS fields were found in this response - see the raw response below.</span>`;
  } else {
    html += '<dl class="kv-grid">';
    html += kv('Domain', parsed.domainName);
    html += kv('Registrar', parsed.registrar);
    html += kv('Registrar URL', parsed.registrarUrl);
    html += kv('Created', fmtDate(parsed.createdDate));
    html += kv('Expires', fmtDate(parsed.expiryDate));
    html += kv('Last updated', fmtDate(parsed.updatedDate));
    html += kv('Abuse email', parsed.abuseEmail);
    html += kv('Abuse phone', parsed.abusePhone);
    html += kv('DNSSEC', parsed.dnssec);
    html += '</dl>';

    if (parsed.statuses && parsed.statuses.length) {
      html += `<div class="section-title">Status</div><div class="badge-list">${parsed.statuses
        .map((s) => `<span class="status-chip">${escapeHtml(s)}</span>`)
        .join('')}</div>`;
    }

    if (parsed.nameservers && parsed.nameservers.length) {
      html += `<div class="section-title">Name servers</div><ul class="ns-list">${parsed.nameservers
        .map((ns) => `<li>${escapeHtml(ns)}</li>`)
        .join('')}</ul>`;
    }

    html += entityBlock('Registrant', {
      name: parsed.registrantName,
      org: parsed.registrantOrg,
      email: parsed.registrantEmail,
      phone: parsed.registrantPhone,
      address: parsed.registrantAddress,
    });
    html += entityBlock('Admin contact', {
      name: parsed.adminName,
      org: parsed.adminOrg,
      email: parsed.adminEmail,
    });
  }

  const rawChain = (chain || [])
    .map((hop) => {
      if (hop.error) {
        return `<div class="hop"><span class="hop-server">${escapeHtml(hop.server)}</span><span class="error-text">${escapeHtml(hop.error)}</span></div>`;
      }
      return `<div class="hop"><span class="hop-server">${escapeHtml(hop.server)}</span><pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtml(hop.response || '(empty response)')}</pre></div>`;
    })
    .join('');

  html += `<details class="raw"><summary>Show raw WHOIS responses (${(chain || []).length} hop${(chain || []).length === 1 ? '' : 's'})</summary>${rawChain}</details>`;

  return html;
}

export const PILL_LABELS = {
  available: 'Available to register',
  registered: 'Registered (active)',
  for_sale: 'For sale',
  expiring: 'Expiring / pending delete',
  unknown: 'Status unknown',
  error: 'Lookup failed',
};

function signalChip(label, tone) {
  return `<span class="signal-chip ${tone}">${escapeHtml(label)}</span>`;
}

function buildSignalChips(body) {
  const chips = [];

  const age = fmtAge(body.domainAgeDays);
  if (age) chips.push(signalChip(age, 'neutral'));

  const expiresIn = fmtExpiresIn(body.expiresInDays);
  if (expiresIn) {
    chips.push(signalChip(expiresIn, body.expiresInDays !== null && body.expiresInDays <= 60 ? 'warn' : 'neutral'));
  }

  if (body.privacyProtected === true) chips.push(signalChip('Privacy protected', 'warn'));
  else if (body.privacyProtected === false) chips.push(signalChip('Contact public', 'good'));

  if (body.activityStatus && ACTIVITY_LABELS[body.activityStatus]) {
    const tone = body.activityStatus === 'active' ? 'good' : body.activityStatus === 'parked' ? 'warn' : 'neutral';
    chips.push(signalChip(ACTIVITY_LABELS[body.activityStatus], tone));
  }

  if (body.hasMx) chips.push(signalChip('Mail configured', 'warn'));

  return chips.join('');
}

export function renderAvailability(body) {
  if (!body || body.applicable === false) {
    availabilityCard.classList.remove('visible');
    return;
  }

  availabilityCard.classList.add('visible');
  availabilityDomain.textContent = body.domain || '';

  const state = body.state || 'unknown';
  availabilityPill.className = `status-pill ${state}`;
  availabilityPill.textContent = PILL_LABELS[state] || state;
  availabilityDetail.textContent = body.detail || '';

  const score = computeOpportunityScore(body);
  const risk = computeRiskScore(body);
  const scoreChips = [];
  if (score !== null) scoreChips.push(`<span class="signal-chip ${scoreTone(score)}" title="Opportunity score">Opportunity: ${score}</span>`);
  if (risk !== null) scoreChips.push(`<span class="signal-chip ${riskTone(risk)}" title="Phishing-risk score">Risk: ${risk}</span>`);
  availabilityScores.innerHTML = scoreChips.join(' ');

  availabilityConfidence.innerHTML = body.confidence
    ? `<span class="confidence-note">confidence: ${escapeHtml(body.confidence)}</span>`
    : '';

  availabilitySignals.innerHTML = buildSignalChips(body);

  if (body.registrant && body.registrant.email) outreachRegistrantByDomain.set(body.domain, body.registrant);
  availabilityOutreach.innerHTML = outreachButtonHtml(body.domain, body.registrant);

  const abuseRecord = body.abuse && body.abuse.email
    ? {
        abuseEmail: body.abuse.email,
        hasMx: body.hasMx,
        activityStatus: body.activityStatus,
        privacyProtected: body.privacyProtected,
        domainAgeDays: body.domainAgeDays,
      }
    : null;
  if (abuseRecord) abuseRecordByDomain.set(body.domain, abuseRecord);
  availabilityAbuseReport.innerHTML = abuseButtonHtml(body.domain, abuseRecord);
}
