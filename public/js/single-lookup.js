// Orchestrates a single domain/IP/ASN lookup: fetches RDAP, WHOIS, and
// availability in parallel and renders each into its panel/card.

import { escapeHtml } from './utils.js';
import { renderRdap, renderWhois, renderAvailability } from './render.js';
import { panels, rdapOutput, whoisOutput, rdapBadge, whoisBadge, availabilityCard, availabilityScores, submitBtn } from './dom.js';
import { showGate } from './auth.js';

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
      return;
    }
    rdapBadge.textContent = body.rdapServer || '';
    rdapOutput.innerHTML = renderRdap(body.type, body.parsed, body.data);
  } catch (err) {
    rdapOutput.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
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
      return;
    }
    const chain = body.chain || [];
    whoisBadge.textContent = chain.map((h) => h.server).join(' → ');
    whoisOutput.innerHTML = renderWhois(body.parsed, chain);
  } catch (err) {
    whoisOutput.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
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
  await Promise.allSettled([runRdap(q), runWhois(q), runAvailability(q)]);
  submitBtn.disabled = false;
}

export function clearSingleResults() {
  rdapOutput.innerHTML = emptyStateHtml('RDAP results will appear here.');
  whoisOutput.innerHTML = emptyStateHtml('WHOIS referral chain will appear here.');
  rdapBadge.textContent = '';
  whoisBadge.textContent = '';
  availabilityScores.innerHTML = '';
  availabilityCard.classList.remove('visible');
  panels.classList.remove('visible');
}
