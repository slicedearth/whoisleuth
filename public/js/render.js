// Renders RDAP/WHOIS panel content and the single-lookup availability card.
// Shared by single-lookup.js (which fetches the data) and by bulk.js/
// shortlist.js (which only need PILL_LABELS for their own table rendering).

import { escapeHtml, fmtDate, kv, typeText, isRedactionPlaceholder } from './utils.js';
import {
  fmtAge,
  fmtExpiresIn,
  ACTIVITY_LABELS,
  explainOpportunityScore,
  scoreTone,
  explainRiskScore,
  riskTone,
  formatScoreBreakdown,
} from './scoring.js';
import { outreachButtonHtml, outreachRegistrantByDomain } from './outreach.js';
import { abuseButtonHtml, abuseRecordByDomain } from './abuse.js';
import { isDomainAllowlisted, isFaviconHashMatchingProfile, isReusingOfficialAssets } from './brand-profiles.js';
import { compareRegistrySources } from './registry-comparison.js';
import {
  availabilityCard,
  availabilityPrompt,
  availabilityDomain,
  availabilityPill,
  availabilityScores,
  availabilityDetail,
  availabilityConfidence,
  availabilitySignals,
  availabilityOutreach,
  availabilityAbuseReport,
} from './dom.js';

// Same shape as kv() (utils.js), but a field whose value is itself a
// redaction placeholder renders as a visual blackout bar instead of the
// placeholder text - the same information a censored document would give:
// "something was here, you don't get to see it" rather than a sentence
// that reads like real data at a glance.
function kvOrRedacted(label, value) {
  if (value === null || value === undefined || value === '') return '';
  if (isRedactionPlaceholder(value)) {
    return `<dt>${escapeHtml(label)}</dt><dd><span class="redacted-bar"><span class="visually-hidden">Redacted for privacy</span></span></dd>`;
  }
  return kv(label, value);
}

// collapsed: renders as a closed <details> (title in the summary) instead of
// a permanently-visible section - for entities that exist on some registries
// but are rarely what someone's looking for (technical/billing contacts),
// so a data-rich domain's panel doesn't force a long scroll past sections
// most lookups don't need.
function entityBlock(title, entity, { collapsed = false } = {}) {
  if (!entity) return '';
  const rows = [
    kvOrRedacted('Name', entity.name),
    kvOrRedacted('Organisation', entity.org),
    kvOrRedacted('Email', entity.email),
    kvOrRedacted('Phone', entity.phone),
    kvOrRedacted('Address', entity.address),
    kvOrRedacted('Handle', entity.handle),
  ].join('');
  if (!rows) return '';
  const body = `<dl class="kv-grid">${rows}</dl>`;
  if (!collapsed) return `<div class="section-title">${escapeHtml(title)}</div>${body}`;
  return `<details class="section-toggle"><summary>${escapeHtml(title)}</summary>${body}</details>`;
}

// Status codes are dense, jargon-heavy ("client transfer prohibited") and
// rarely what someone's looking for - collapsed by default, with the count
// visible so it's clear there's something there without expanding.
function statusBlock(statuses) {
  if (!statuses || !statuses.length) return '';
  const chips = statuses.map((s) => `<span class="status-chip">${escapeHtml(s)}</span>`).join('');
  return `<details class="section-toggle"><summary>Status (${statuses.length})</summary><div class="badge-list">${chips}</div></details>`;
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

    html += statusBlock(parsed.statuses);

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
    html += entityBlock('Technical contact', parsed.technical, { collapsed: true });
    html += entityBlock('Billing contact', parsed.billing, { collapsed: true });
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
      parsed.adminEmail ||
      parsed.techName ||
      parsed.techOrg ||
      parsed.techEmail ||
      parsed.billingName ||
      parsed.billingOrg ||
      parsed.billingEmail ||
      parsed.eligibilityType ||
      parsed.eligibilityId
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
    html += kv('Eligibility type', parsed.eligibilityType);
    html += kv('Eligibility ID', parsed.eligibilityId);
    html += '</dl>';

    html += statusBlock(parsed.statuses);

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
      phone: parsed.adminPhone,
    });
    html += entityBlock(
      'Technical contact',
      {
        name: parsed.techName,
        org: parsed.techOrg,
        email: parsed.techEmail,
        phone: parsed.techPhone,
      },
      { collapsed: true }
    );
    html += entityBlock(
      'Billing contact',
      {
        name: parsed.billingName,
        org: parsed.billingOrg,
        email: parsed.billingEmail,
        phone: parsed.billingPhone,
      },
      { collapsed: true }
    );
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

// ---------------------------------------------------------------------------
// Summary tab: one merged view instead of two near-duplicate panels. RDAP is
// preferred per field (it's structured/typed), falling back to WHOIS's flat
// fields when RDAP didn't have that field or wasn't available at all (e.g.
// .edu, which has no RDAP support and relies on WHOIS for everything). This
// mirrors the same RDAP-then-WHOIS fallback lib/availability.js already uses
// for scoring - just applied to display instead.
//
// This does NOT flag disagreements between the two sources (e.g. one
// redacting a field the other doesn't) - it silently prefers RDAP. The RDAP
// and WHOIS tabs remain exactly as before for anyone who wants to compare
// the two raw parsed views directly.
// ---------------------------------------------------------------------------

function findEvent(events, action) {
  return (events || []).find((e) => e.action === action) || null;
}

// Builds an entity object (matching the {name, org, email, phone, address}
// shape entityBlock expects) from a WHOIS parsed result's flat
// `${prefix}Name`/`${prefix}Org`/etc. fields - the counterpart to RDAP's
// entities, which already come back in that shape via summarizeEntity() in
// lib/rdap.js.
function entityFromWhoisFields(whois, prefix) {
  const entity = {
    name: whois[`${prefix}Name`] || null,
    org: whois[`${prefix}Org`] || null,
    email: whois[`${prefix}Email`] || null,
    phone: whois[`${prefix}Phone`] || null,
    address: whois[`${prefix}Address`] || null,
  };
  return Object.values(entity).some(Boolean) ? entity : null;
}

function mergeRdapWhois(rdap, whois) {
  const r = rdap || {};
  const w = whois || {};

  const events = r.events || [];
  const created = (findEvent(events, 'registration') || {}).date || w.createdDate || null;
  const expires = (findEvent(events, 'expiration') || {}).date || w.expiryDate || null;
  const updated = (findEvent(events, 'last changed') || {}).date || w.updatedDate || null;

  return {
    domain: r.domain || w.domainName || null,
    dnssec: r.dnssec || w.dnssec || null,
    registrar: r.registrar || (w.registrar ? { name: w.registrar, org: null, email: null, phone: null, address: null } : null),
    registrarUrl: w.registrarUrl || null,
    registrant: r.registrant || entityFromWhoisFields(w, 'registrant'),
    admin: entityFromWhoisFields(w, 'admin'), // RDAP has no equivalent role parsed - WHOIS-only
    technical: r.technical || entityFromWhoisFields(w, 'tech'),
    billing: r.billing || entityFromWhoisFields(w, 'billing'),
    abuse: r.abuse || (w.abuseEmail || w.abusePhone ? { name: null, org: null, email: w.abuseEmail || null, phone: w.abusePhone || null, address: null } : null),
    created,
    expires,
    updated,
    statuses: r.statuses && r.statuses.length ? r.statuses : w.statuses || [],
    nameservers: r.nameservers && r.nameservers.length ? r.nameservers : w.nameservers || [],
    eligibilityType: w.eligibilityType || null, // .au-style eligibility - WHOIS-only, not modeled in RDAP
    eligibilityId: w.eligibilityId || null,
  };
}

// Precise labeling for each status classifyFieldStatus() (registry-
// comparison.js) can produce - a lookup, not derived logic, since the
// comparison module already decided what each field's status means.
const FIELD_STATUS_PRESENTATION = {
  equivalent: { label: 'Equivalent', tone: 'good' },
  conflict: { label: 'Conflict', tone: 'danger' },
  rdap_only: { label: 'RDAP only', tone: 'neutral' },
  whois_only: { label: 'WHOIS only', tone: 'neutral' },
  rdap_redacted: { label: 'RDAP redacted', tone: 'neutral' },
  whois_redacted: { label: 'WHOIS redacted', tone: 'neutral' },
};

function registryComparisonHtml(rdapParsed, whoisParsed) {
  const comparison = compareRegistrySources(rdapParsed, whoisParsed);
  if (comparison.fields.length === 0) return '';

  // The header only needs "present in one source, for whatever reason" as
  // one number - the per-row Assessment column (via FIELD_STATUS_PRESENTATION)
  // already shows the precise reason (RDAP only vs. WHOIS redacted, etc.).
  const sourceOnly = comparison.counts.rdap_only + comparison.counts.whois_only
    + comparison.counts.rdap_redacted + comparison.counts.whois_redacted;
  const summaryParts = [];
  if (comparison.counts.conflict) summaryParts.push(`${comparison.counts.conflict} conflict${comparison.counts.conflict === 1 ? '' : 's'}`);
  if (sourceOnly) summaryParts.push(`${sourceOnly} source-only`);
  if (comparison.counts.equivalent) summaryParts.push(`${comparison.counts.equivalent} equivalent`);

  const rows = comparison.fields.map((field) => {
    const assessment = FIELD_STATUS_PRESENTATION[field.status];
    return `
      <tr class="registry-comparison-${escapeHtml(field.status)}">
        <th scope="row">${escapeHtml(field.label)}</th>
        <td>${escapeHtml(field.rdapDisplay)}</td>
        <td>${escapeHtml(field.whoisDisplay)}</td>
        <td><span class="signal-chip ${assessment.tone}">${escapeHtml(assessment.label)}</span></td>
      </tr>`;
  }).join('');

  const open = comparison.counts.conflict > 0 ? ' open' : '';
  return `
    <details class="registry-comparison"${open}>
      <summary>RDAP / WHOIS comparison (${escapeHtml(summaryParts.join(', '))})</summary>
      <div class="registry-comparison-scroll">
        <table class="registry-comparison-table">
          <thead><tr><th>Field</th><th>RDAP</th><th>WHOIS</th><th>Assessment</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
}

export function renderSummary(rdapParsed, whoisParsed, { comparisonReady = false, lookupType = null } = {}) {
  if (!rdapParsed && !whoisParsed) {
    return `<span class="placeholder">No summary available - see the RDAP/WHOIS tabs for raw responses.</span>`;
  }

  const merged = mergeRdapWhois(rdapParsed, whoisParsed);
  let html = '';

  if (!rdapParsed) {
    html += `<p class="placeholder" style="margin: 0 0 14px;">RDAP has no data for this domain - showing WHOIS only.</p>`;
  } else if (!whoisParsed) {
    html += `<p class="placeholder" style="margin: 0 0 14px;">WHOIS returned no structured data for this domain - showing RDAP only.</p>`;
  }

  html += `<dl class="kv-grid">${kv('Domain', merged.domain)}${kv('Registrar URL', merged.registrarUrl)}${kv('Created', fmtDate(merged.created))}${kv('Expires', fmtDate(merged.expires))}${kv('Last updated', fmtDate(merged.updated))}${kv('DNSSEC', merged.dnssec)}${kv('Eligibility type', merged.eligibilityType)}${kv('Eligibility ID', merged.eligibilityId)}</dl>`;

  html += statusBlock(merged.statuses);

  if (merged.nameservers.length) {
    html += `<div class="section-title">Name servers</div><ul class="ns-list">${merged.nameservers
      .map((ns) => `<li>${escapeHtml(ns)}</li>`)
      .join('')}</ul>`;
  }

  html += entityBlock('Registrar', merged.registrar);
  html += entityBlock('Registrant', merged.registrant);
  html += entityBlock('Admin contact', merged.admin);
  html += entityBlock('Technical contact', merged.technical, { collapsed: true });
  html += entityBlock('Billing contact', merged.billing, { collapsed: true });
  html += entityBlock('Abuse contact', merged.abuse);

  // Only domain records share enough lifecycle fields for a meaningful
  // protocol comparison. Waiting for both requests prevents a slow source
  // from being mislabeled as missing while it is still in flight.
  if (comparisonReady && lookupType === 'domain') {
    html += registryComparisonHtml(rdapParsed, whoisParsed);
  }

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

  if (body.faviconMatch) chips.push(signalChip('Favicon match', 'danger'));
  if (body.reusesOfficialAssets) chips.push(signalChip('Reuses official assets', 'danger'));
  if (body.phishingLanguageMatch) chips.push(signalChip('Phishing language', 'danger'));
  if (body.hasPasswordField) chips.push(signalChip('Password field', 'warn'));
  if (isDomainAllowlisted(body.domain)) chips.push(signalChip('Allowlisted', 'good'));

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

  const mailParts = [];
  if (body.hasMx) mailParts.push('MX');
  if (body.hasSpf) mailParts.push('SPF');
  if (body.hasDmarc) mailParts.push('DMARC');
  if (mailParts.length) chips.push(signalChip(`Mail: ${mailParts.join('+')}`, 'warn'));

  return chips.join('');
}

export function renderAvailability(body) {
  if (!body || body.applicable === false) {
    availabilityCard.classList.remove('visible');
    return;
  }

  availabilityCard.classList.add('visible');
  typeText(availabilityPrompt, `$ whois ${body.domain || ''}`);
  availabilityDomain.textContent = body.domain || '';

  const state = body.state || 'unknown';
  availabilityCard.dataset.state = state;
  availabilityPill.className = `status-pill ${state}`;
  availabilityPill.textContent = PILL_LABELS[state] || state;
  availabilityDetail.textContent = body.detail || '';

  // Same rule as bulk.js's toBulkRecord(): never true for a domain the
  // allowlist already covers - your own official site "matches" its own
  // favicon (or its own assets) trivially, which isn't a finding.
  const notAllowlisted = !isDomainAllowlisted(body.domain);
  body.faviconMatch = notAllowlisted && isFaviconHashMatchingProfile(body.faviconHash);
  body.reusesOfficialAssets = notAllowlisted && isReusingOfficialAssets(body.externalAssetHosts);

  const oppExplain = explainOpportunityScore(body);
  const riskExplain = explainRiskScore(body);
  const scoreChips = [];
  if (oppExplain) {
    scoreChips.push(
      `<span class="signal-chip ${scoreTone(oppExplain.score)}" title="${escapeHtml(formatScoreBreakdown(oppExplain))}">Opportunity: ${oppExplain.score}</span>`
    );
  }
  if (riskExplain) {
    scoreChips.push(
      `<span class="signal-chip ${riskTone(riskExplain.score)}" title="${escapeHtml(formatScoreBreakdown(riskExplain))}">Risk: ${riskExplain.score}</span>`
    );
  }
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
