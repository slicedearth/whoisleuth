// Orchestrates a single domain/IP/ASN lookup: fetches RDAP, WHOIS, and
// availability in parallel and renders each into its panel/card.

import { escapeHtml } from './utils.js';
import { renderRdap, renderWhois, renderAvailability } from './render.js';
import { rdapOutput, whoisOutput, rdapBadge, whoisBadge, availabilityCard, availabilityScores, submitBtn } from './dom.js';
import { showGate } from './auth.js';

function setLoading(el, badgeEl) {
  el.innerHTML = '<span class="placeholder">Looking up<span class="spinner"></span></span>';
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
  await Promise.allSettled([runRdap(q), runWhois(q), runAvailability(q)]);
  submitBtn.disabled = false;
}

export function clearSingleResults() {
  rdapOutput.innerHTML = '<span class="placeholder">RDAP results will appear here.</span>';
  whoisOutput.innerHTML = '<span class="placeholder">WHOIS referral chain will appear here.</span>';
  rdapBadge.textContent = '';
  whoisBadge.textContent = '';
  availabilityScores.innerHTML = '';
  availabilityCard.classList.remove('visible');
}
