// Shortlist - a lightweight "remember these across sessions" list backed by
// localStorage, deliberately not a backend database: this is meant to hold
// promising finds from active sourcing sessions, not to track/manage an
// owned domain portfolio.

import { escapeHtml } from './utils.js';
import { explainOpportunityScore, scoreTone, formatScoreBreakdown } from './scoring.js';
import { PILL_LABELS } from './render.js';
import { queryInput } from './dom.js';

const SHORTLIST_KEY = 'whois-rdap-shortlist-v1';

export function loadShortlist() {
  try {
    return JSON.parse(localStorage.getItem(SHORTLIST_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveShortlist(list) {
  try {
    localStorage.setItem(SHORTLIST_KEY, JSON.stringify(list));
  } catch {
    /* storage full/unavailable - shortlist just won't persist this time */
  }
}

export function isShortlisted(domain) {
  return loadShortlist().some((r) => r.domain === domain);
}

export function toggleShortlist(record) {
  const list = loadShortlist();
  const idx = list.findIndex((r) => r.domain === record.domain);
  if (idx !== -1) list.splice(idx, 1);
  else list.push(record);
  saveShortlist(list);
  renderShortlistPanel();
}

// Bulk erasure alongside the existing per-domain Remove button - this list
// holds registrant contact data pulled from WHOIS/RDAP, so clearing all of
// it in one step (rather than one at a time) matters for actually acting on
// a deletion request, not just tidying up. See PRIVACY.md.
export function clearShortlist() {
  saveShortlist([]);
  renderShortlistPanel();
}

export function renderShortlistPanel() {
  const list = loadShortlist();
  document.getElementById('shortlist-count').textContent = `${list.length} domain${list.length === 1 ? '' : 's'}`;
  document.getElementById('shortlist-body').innerHTML = list
    .map((r) => {
      const oppExplain = explainOpportunityScore(r);
      const pillLabel = PILL_LABELS[r.availability] || r.availability;
      return `
        <tr>
          <td class="domain-cell">${escapeHtml(r.domain)}</td>
          <td>${oppExplain === null ? '—' : `<span class="signal-chip ${scoreTone(oppExplain.score)}" title="${escapeHtml(formatScoreBreakdown(oppExplain))}">${oppExplain.score}</span>`}</td>
          <td><span class="mini-pill ${escapeHtml(r.availability)}">${escapeHtml(pillLabel)}</span></td>
          <td><button type="button" class="secondary shortlist-remove-btn" data-domain="${escapeHtml(r.domain)}">Remove</button></td>
        </tr>
      `;
    })
    .join('');
}

document.getElementById('shortlist-rescan-btn').addEventListener('click', () => {
  const list = loadShortlist();
  if (list.length === 0) return;
  queryInput.value = list.map((r) => r.domain).join('\n');
});

document.getElementById('shortlist-clear-btn').addEventListener('click', () => {
  if (loadShortlist().length === 0) return;
  if (!window.confirm('Remove every domain from the shortlist? This cannot be undone.')) return;
  clearShortlist();
});

renderShortlistPanel();
