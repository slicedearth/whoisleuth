// Orchestrates a single domain/IP/ASN lookup through the unified backend and
// renders its RDAP, WHOIS, and availability sections into their panels/cards.

import { downloadBlob, escapeHtml } from './utils.js';
import { buildLookupEvidence, evidenceFilename } from './evidence-export.js';
import { renderRdap, renderWhois, renderSummary, renderAvailability } from './render.js';
import {
  lookupScopeNote,
  panels,
  summaryOutput,
  rdapOutput,
  whoisOutput,
  rdapBadge,
  whoisBadge,
  tabSummary,
  tabRdap,
  tabWhois,
  panelSummary,
  panelRdap,
  panelWhois,
  availabilityCard,
  availabilityScores,
  lookupExportBtn,
  submitBtn,
} from './dom.js';
import { showGate } from './auth.js';

// Summary is derived from the RDAP/WHOIS sections in the unified response.
let lastRdapParsed = null;
let lastWhoisParsed = null;
let rdapSettled = false;
let whoisSettled = false;
let lastLookupType = null;
let lastLookupResponse = null;

lookupExportBtn.addEventListener('click', () => {
  if (!lastLookupResponse) return;
  const evidence = buildLookupEvidence(lastLookupResponse);
  downloadBlob(
    JSON.stringify(evidence, null, 2),
    evidenceFilename(lastLookupResponse),
    'application/json;charset=utf-8'
  );
});

function updateSummary() {
  summaryOutput.innerHTML = renderSummary(lastRdapParsed, lastWhoisParsed, {
    comparisonReady: rdapSettled && whoisSettled,
    lookupType: lastLookupType,
  });
}

// A subdomain query is resolved to its registrable domain for RDAP/WHOIS (a
// registry has no record for an arbitrary subdomain - see lib/classify.js).
// Surface that plainly so the user isn't confused about why they searched
// login.example.com but the panels show example.com.
function updateScopeNote(body) {
  if (!body || !body.inputHostname || !body.registrableDomain
    || body.inputHostname === body.registrableDomain) {
    return;
  }
  lookupScopeNote.innerHTML =
    `Showing results for the registrable domain <strong>${escapeHtml(body.registrableDomain)}</strong> `
    + `— you searched <strong>${escapeHtml(body.inputHostname)}</strong>, and registries publish records at the registrable-domain level.`;
  lookupScopeNote.hidden = false;
}

function clearScopeNote() {
  lookupScopeNote.hidden = true;
  lookupScopeNote.innerHTML = '';
}

const TAB_IDS = ['summary', 'rdap', 'whois'];
const tabButtons = [tabSummary, tabRdap, tabWhois];
const tabPanels = [panelSummary, panelRdap, panelWhois];

function selectTab(id) {
  const index = TAB_IDS.indexOf(id);
  tabButtons.forEach((btn, i) => {
    const isActive = i === index;
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
    tabPanels[i].hidden = !isActive;
  });
}

// Roving-tabindex arrow-key navigation per the WAI-ARIA tabs pattern - plain
// click/Enter/Space already works for free via these being real <button>s.
tabButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => selectTab(TAB_IDS[i]));
  btn.addEventListener('keydown', (e) => {
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (i + 1) % tabButtons.length;
    else if (e.key === 'ArrowLeft') nextIndex = (i - 1 + tabButtons.length) % tabButtons.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabButtons.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    selectTab(TAB_IDS[nextIndex]);
    tabButtons[nextIndex].focus();
  });
});

const EMPTY_STATE_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

function emptyStateHtml(text) {
  return `<div class="empty-state">${EMPTY_STATE_ICON}<span class="placeholder">${text}</span></div>`;
}

function setLoading(el, badgeEl) {
  el.innerHTML =
    '<div class="skeleton-lines" aria-hidden="true"><div class="skeleton-line" style="width:35%;"></div><div class="skeleton-line" style="width:70%;"></div><div class="skeleton-line" style="width:55%;"></div><div class="skeleton-line" style="width:60%;"></div></div><span class="visually-hidden">Looking up…</span>';
  if (badgeEl) badgeEl.textContent = '';
}

function formatSourceTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export async function runSingleLookup(q) {
  submitBtn.disabled = true;
  panels.classList.add('visible');
  selectTab('summary');
  clearScopeNote();
  lastRdapParsed = null;
  lastWhoisParsed = null;
  rdapSettled = false;
  whoisSettled = false;
  lastLookupType = null;
  lastLookupResponse = null;
  lookupExportBtn.hidden = true;
  setLoading(summaryOutput, null);
  setLoading(rdapOutput, rdapBadge);
  setLoading(whoisOutput, whoisBadge);
  availabilityCard.classList.remove('visible');

  try {
    const res = await fetch(`/api/lookup?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    if (res.status === 401) return showGate();
    if (!res.ok) {
      const message = escapeHtml(body.error || 'Lookup failed');
      rdapOutput.innerHTML = `<span class="error-text">${message}</span>`;
      whoisOutput.innerHTML = `<span class="error-text">${message}</span>`;
      return;
    }

    lastLookupType = body.type || null;
    updateScopeNote(body);

    const rdap = body.rdap || {};
    if (rdap.error) {
      rdapOutput.innerHTML = `<span class="error-text">${escapeHtml(rdap.error)}</span>`;
    } else {
      const fetchedAt = formatSourceTime(rdap.fetchedAt);
      const rdapMeta = [
        rdap.rdapServer,
        rdap.upstreamStatus ? `HTTP ${rdap.upstreamStatus}` : null,
        fetchedAt ? `fetched ${fetchedAt}` : null,
      ].filter(Boolean);
      rdapBadge.textContent = rdapMeta.join(' · ');
      rdapOutput.innerHTML = renderRdap(body.type, rdap.parsed, rdap.data);
      lastRdapParsed = rdap.parsed || null;
    }

    const whois = body.whois || {};
    if (whois.error) {
      whoisOutput.innerHTML = `<span class="error-text">${escapeHtml(whois.error)}</span>`;
    } else {
      const chain = whois.chain || [];
      const queriedAt = formatSourceTime(chain[0] && chain[0].queriedAt);
      const whoisMeta = [
        chain.map((hop) => hop.server).join(' → '),
        whois.parsed && whois.parsed.chainStatus ? `${whois.parsed.chainStatus} chain` : null,
        queriedAt ? `queried ${queriedAt}` : null,
      ].filter(Boolean);
      whoisBadge.textContent = whoisMeta.join(' · ');
      whoisOutput.innerHTML = renderWhois(whois.parsed, chain);
      lastWhoisParsed = whois.parsed || null;
    }

    renderAvailability(body.availability);
    lastLookupResponse = body;
    lookupExportBtn.hidden = false;
  } catch (err) {
    const message = escapeHtml(err.message || 'Lookup failed');
    rdapOutput.innerHTML = `<span class="error-text">${message}</span>`;
    whoisOutput.innerHTML = `<span class="error-text">${message}</span>`;
  } finally {
    rdapSettled = true;
    whoisSettled = true;
    updateSummary();
    submitBtn.disabled = false;
  }
}

export function clearSingleResults() {
  lastRdapParsed = null;
  lastWhoisParsed = null;
  rdapSettled = false;
  whoisSettled = false;
  lastLookupType = null;
  lastLookupResponse = null;
  lookupExportBtn.hidden = true;
  summaryOutput.innerHTML = emptyStateHtml('A merged RDAP/WHOIS summary will appear here.');
  rdapOutput.innerHTML = emptyStateHtml('RDAP results will appear here.');
  whoisOutput.innerHTML = emptyStateHtml('WHOIS referral chain will appear here.');
  rdapBadge.textContent = '';
  whoisBadge.textContent = '';
  clearScopeNote();
  selectTab('summary');
  availabilityScores.innerHTML = '';
  availabilityCard.classList.remove('visible');
  panels.classList.remove('visible');
}
