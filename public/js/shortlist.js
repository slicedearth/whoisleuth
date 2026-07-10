// Shortlist - a lightweight "remember these across sessions" list backed by
// localStorage, deliberately not a backend database: this is meant to hold
// promising finds from active sourcing sessions, not to track/manage an
// owned domain portfolio.

import { escapeHtml, exportJsonFile, readFileAsText, createLocalStore } from './utils.js';
import { explainOpportunityScore, scoreTone, formatScoreBreakdown } from './scoring.js';
import { PILL_LABELS } from './render.js';
import { queryInput, bulkStatus } from './dom.js';

const SHORTLIST_KEY = 'whois-rdap-shortlist-v1';
const shortlistStore = createLocalStore(SHORTLIST_KEY, []);

export function loadShortlist() {
  return shortlistStore.load();
}

function saveShortlist(list) {
  shortlistStore.save(list);
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

// Backup/restore for this browser's shortlist, since it's localStorage-only
// (see the module comment above) - lets you move it to another browser or
// device without any server-side storage. Import merges by domain rather
// than replacing outright, so re-importing an old backup can't silently
// undo more recent shortlist changes.
function exportShortlistJson() {
  exportJsonFile(loadShortlist(), 'domain-shortlist');
}

function importShortlistJson(parsed) {
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of shortlist entries.');
  const byDomain = new Map(loadShortlist().map((r) => [r.domain, r]));
  let added = 0;
  let updated = 0;
  for (const entry of parsed) {
    if (!entry || typeof entry.domain !== 'string' || !entry.domain) continue;
    if (byDomain.has(entry.domain)) updated += 1;
    else added += 1;
    byDomain.set(entry.domain, entry);
  }
  saveShortlist([...byDomain.values()]);
  renderShortlistPanel();
  return { added, updated };
}

const shortlistCountEl = /** @type {HTMLElement} */ (document.getElementById('shortlist-count'));
const shortlistBodyEl = /** @type {HTMLElement} */ (document.getElementById('shortlist-body'));
const shortlistRescanBtn = /** @type {HTMLButtonElement} */ (document.getElementById('shortlist-rescan-btn'));
const shortlistClearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('shortlist-clear-btn'));
const shortlistExportJsonBtn = /** @type {HTMLButtonElement} */ (document.getElementById('shortlist-export-json-btn'));
const shortlistImportInput = /** @type {HTMLInputElement} */ (document.getElementById('shortlist-import-file'));

function renderShortlistPanel() {
  const list = loadShortlist();
  shortlistCountEl.textContent = `${list.length} domain${list.length === 1 ? '' : 's'}`;
  shortlistBodyEl.innerHTML = list
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

shortlistRescanBtn.addEventListener('click', () => {
  const list = loadShortlist();
  if (list.length === 0) return;
  queryInput.value = list.map((r) => r.domain).join('\n');
});

shortlistClearBtn.addEventListener('click', () => {
  if (loadShortlist().length === 0) return;
  if (!window.confirm('Remove every domain from the shortlist? This cannot be undone.')) return;
  clearShortlist();
});

shortlistExportJsonBtn.addEventListener('click', () => {
  if (loadShortlist().length === 0) return;
  exportShortlistJson();
});

shortlistImportInput.addEventListener('change', async () => {
  const file = shortlistImportInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await readFileAsText(file));
    const { added, updated } = importShortlistJson(parsed);
    bulkStatus.textContent = `Imported ${file.name}: ${added} added, ${updated} updated in the shortlist.`;
  } catch (err) {
    bulkStatus.innerHTML = `<span class="error-text">Could not import shortlist: ${escapeHtml(err.message)}</span>`;
  } finally {
    shortlistImportInput.value = ''; // consumed - allow re-selecting the same file later
  }
});

renderShortlistPanel();
