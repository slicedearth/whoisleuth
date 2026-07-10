// Orchestrates a single domain/IP/ASN lookup: fetches RDAP, WHOIS, and
// availability in parallel and renders each into its panel/card.

import { escapeHtml } from './utils.js';
import { renderRdap, renderWhois, renderSummary, renderAvailability } from './render.js';
import {
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
  submitBtn,
} from './dom.js';
import { showGate } from './auth.js';

// Summary is derived from whichever of RDAP/WHOIS has come back so far, not
// its own fetch - each of runRdap/runWhois updates its own slot here and
// re-renders Summary, so it fills in progressively the same way the RDAP/
// WHOIS panels already do.
let lastRdapParsed = null;
let lastWhoisParsed = null;
let rdapSettled = false;
let whoisSettled = false;
let lastLookupType = null;

function updateSummary() {
  summaryOutput.innerHTML = renderSummary(lastRdapParsed, lastWhoisParsed, {
    comparisonReady: rdapSettled && whoisSettled,
    lookupType: lastLookupType,
  });
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

async function runRdap(q) {
  setLoading(rdapOutput, rdapBadge);
  try {
    const res = await fetch(`/api/rdap?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    if (res.status === 401) return showGate();
    if (!res.ok) {
      rdapOutput.innerHTML = `<span class="error-text">${escapeHtml(body.error || 'RDAP lookup failed')}</span>`;
      lastRdapParsed = null;
      return;
    }
    lastLookupType = body.type || lastLookupType;
    rdapBadge.textContent = body.rdapServer || '';
    rdapOutput.innerHTML = renderRdap(body.type, body.parsed, body.data);
    lastRdapParsed = body.parsed;
  } catch (err) {
    rdapOutput.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
    lastRdapParsed = null;
  } finally {
    rdapSettled = true;
    updateSummary();
  }
}

async function runWhois(q) {
  setLoading(whoisOutput, whoisBadge);
  try {
    const res = await fetch(`/api/whois?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    if (res.status === 401) return showGate();
    if (!res.ok) {
      whoisOutput.innerHTML = `<span class="error-text">${escapeHtml(body.error || 'WHOIS lookup failed')}</span>`;
      lastWhoisParsed = null;
      return;
    }
    lastLookupType = body.type || lastLookupType;
    const chain = body.chain || [];
    whoisBadge.textContent = chain.map((h) => h.server).join(' → ');
    whoisOutput.innerHTML = renderWhois(body.parsed, chain);
    lastWhoisParsed = body.parsed;
  } catch (err) {
    whoisOutput.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
    lastWhoisParsed = null;
  } finally {
    whoisSettled = true;
    updateSummary();
  }
}

async function runAvailability(q) {
  availabilityCard.classList.remove('visible');
  try {
    const res = await fetch(`/api/availability?q=${encodeURIComponent(q)}`);
    if (res.status === 401) return showGate();
    const body = await res.json();
    if (!res.ok) return;
    renderAvailability(body);
  } catch {
    /* availability is best-effort; silently skip on failure */
  }
}

export async function runSingleLookup(q) {
  submitBtn.disabled = true;
  panels.classList.add('visible');
  selectTab('summary');
  lastRdapParsed = null;
  lastWhoisParsed = null;
  rdapSettled = false;
  whoisSettled = false;
  lastLookupType = null;
  setLoading(summaryOutput, null);
  await Promise.allSettled([runRdap(q), runWhois(q), runAvailability(q)]);
  submitBtn.disabled = false;
}

export function clearSingleResults() {
  lastRdapParsed = null;
  lastWhoisParsed = null;
  rdapSettled = false;
  whoisSettled = false;
  lastLookupType = null;
  summaryOutput.innerHTML = emptyStateHtml('A merged RDAP/WHOIS summary will appear here.');
  rdapOutput.innerHTML = emptyStateHtml('RDAP results will appear here.');
  whoisOutput.innerHTML = emptyStateHtml('WHOIS referral chain will appear here.');
  rdapBadge.textContent = '';
  whoisBadge.textContent = '';
  selectTab('summary');
  availabilityScores.innerHTML = '';
  availabilityCard.classList.remove('visible');
  panels.classList.remove('visible');
}
