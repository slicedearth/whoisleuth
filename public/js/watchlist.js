// Brand watchlist - saves a named snapshot of the current bulk results
// table (typically a typosquat variant scan) in localStorage, same pattern
// as shortlist.js, and lets it be re-scanned later. On re-scan, the new
// results are diffed against the saved snapshot so a domain that moved
// from available/unknown to registered - a fresh potential-squatting
// registration - gets flagged, and the reverse (a lapsed lookalike, a fresh
// acquisition opportunity) is flagged too.

import { escapeHtml, downloadBlob, readFileAsText } from './utils.js';
import { fillQueryInputWithCandidates, bulkStatus } from './dom.js';
import { runBulkLookup, getBulkResults, flagBulkRow } from './bulk.js';

const WATCHLIST_KEY = 'whois-rdap-watchlist-v1';

const REGISTERED_STATES = new Set(['registered', 'for_sale', 'expiring']);
// Deliberately excludes 'unknown'/'error' - those mean "the lookup was
// inconclusive" (a transient RDAP/WHOIS failure or rate limit), not "this
// domain is available". Treating them as open would flag a domain as
// "released" on every hiccup instead of only on a real, confirmed state
// change.
const OPEN_STATES = new Set(['available']);

function loadWatchlists() {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveWatchlists(all) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(all));
  } catch {
    /* storage full/unavailable - watchlist just won't persist this time */
  }
}

function saveWatchlistSnapshot(name, results) {
  const all = loadWatchlists();
  all[name] = { updatedAt: new Date().toISOString(), results };
  saveWatchlists(all);
  renderWatchlistPanel();
}

function deleteWatchlist(name) {
  const all = loadWatchlists();
  delete all[name];
  saveWatchlists(all);
  renderWatchlistPanel();
}

// Bulk erasure alongside the existing per-watchlist Delete button - see
// shortlist.js's clearShortlist() for why this matters beyond tidying up.
function clearAllWatchlists() {
  saveWatchlists({});
  renderWatchlistPanel();
}

// Backup/restore for this browser's saved watchlists - same reasoning as
// shortlist.js's export/import (localStorage-only, no server-side copy).
// Import merges by name rather than replacing outright, so importing an
// old backup can't silently wipe out watchlists saved since then.
function exportWatchlistsJson() {
  downloadBlob(JSON.stringify(loadWatchlists(), null, 2), `domain-watchlists-${Date.now()}.json`, 'application/json;charset=utf-8;');
}

function importWatchlistsJson(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object mapping watchlist names to their saved results.');
  }
  const all = loadWatchlists();
  let added = 0;
  let updated = 0;
  for (const [name, entry] of Object.entries(parsed)) {
    if (!entry || !Array.isArray(entry.results)) continue;
    if (all[name]) updated += 1;
    else added += 1;
    all[name] = entry;
  }
  saveWatchlists(all);
  renderWatchlistPanel();
  return { added, updated };
}

// Compares a previously-saved snapshot against a fresh scan and returns one
// entry per domain whose state crossed the registered/open boundary in
// either direction. Domains with no meaningful state change (including ones
// that simply weren't in the previous snapshot) are left alone.
function diffWatchlist(previousResults, newResults) {
  const previousByDomain = new Map(previousResults.map((r) => [r.domain, r]));
  const changes = [];

  for (const next of newResults) {
    const prev = previousByDomain.get(next.domain);
    if (!prev) continue;

    if (OPEN_STATES.has(prev.availability) && REGISTERED_STATES.has(next.availability)) {
      changes.push({ domain: next.domain, label: 'New registration', tone: 'danger', rowClass: 'newly-registered' });
    } else if (REGISTERED_STATES.has(prev.availability) && OPEN_STATES.has(next.availability)) {
      changes.push({ domain: next.domain, label: 'Released', tone: 'good', rowClass: 'released' });
    }
  }

  return changes;
}

function fmtCheckedDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const watchlistBodyEl = /** @type {HTMLElement} */ (document.getElementById('watchlist-body'));
const watchlistSaveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('watchlist-save-btn'));
const watchlistClearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('watchlist-clear-btn'));
const watchlistExportJsonBtn = /** @type {HTMLButtonElement} */ (document.getElementById('watchlist-export-json-btn'));
const watchlistImportInput = /** @type {HTMLInputElement} */ (document.getElementById('watchlist-import-file'));

function renderWatchlistPanel() {
  const all = loadWatchlists();
  const names = Object.keys(all).sort();
  watchlistBodyEl.innerHTML = names
    .map((name) => {
      const entry = all[name];
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${entry.results.length}</td>
          <td>${escapeHtml(fmtCheckedDate(entry.updatedAt))}</td>
          <td>
            <button type="button" class="secondary watchlist-rescan-btn" data-name="${escapeHtml(name)}">Re-scan</button>
            <button type="button" class="secondary watchlist-delete-btn" data-name="${escapeHtml(name)}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join('');
}

watchlistSaveBtn.addEventListener('click', () => {
  const results = getBulkResults();
  if (results.length === 0) {
    bulkStatus.innerHTML = '<span class="error-text">Run a bulk scan first, then save its results as a watchlist.</span>';
    return;
  }
  const name = (window.prompt('Name this watchlist (e.g. the brand or campaign it covers):') || '').trim();
  if (!name) return;
  saveWatchlistSnapshot(name, results);
  bulkStatus.textContent = `Saved "${name}" as a watchlist (${results.length} domains).`;
});

watchlistClearBtn.addEventListener('click', () => {
  if (Object.keys(loadWatchlists()).length === 0) return;
  if (!window.confirm('Delete every saved watchlist? This cannot be undone.')) return;
  clearAllWatchlists();
});

watchlistExportJsonBtn.addEventListener('click', () => {
  if (Object.keys(loadWatchlists()).length === 0) return;
  exportWatchlistsJson();
});

watchlistImportInput.addEventListener('change', async () => {
  const file = watchlistImportInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await readFileAsText(file));
    const { added, updated } = importWatchlistsJson(parsed);
    bulkStatus.textContent = `Imported ${file.name}: ${added} added, ${updated} updated watchlist${added + updated === 1 ? '' : 's'}.`;
  } catch (err) {
    bulkStatus.innerHTML = `<span class="error-text">Could not import watchlists: ${escapeHtml(err.message)}</span>`;
  } finally {
    watchlistImportInput.value = ''; // consumed - allow re-selecting the same file later
  }
});

document.addEventListener('click', async (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const rescanBtn = target.closest('.watchlist-rescan-btn');
  if (rescanBtn instanceof HTMLElement) {
    const name = rescanBtn.dataset.name;
    if (!name) return;
    const all = loadWatchlists();
    const entry = all[name];
    if (!entry) return;

    const domains = entry.results.map((r) => r.domain);
    fillQueryInputWithCandidates(domains);
    await runBulkLookup(domains, { fast: true, append: false });

    const newResults = getBulkResults();
    const changes = diffWatchlist(entry.results, newResults);
    for (const change of changes) flagBulkRow(change.domain, change);
    saveWatchlistSnapshot(name, newResults);

    const newCount = changes.filter((c) => c.label === 'New registration').length;
    const releasedCount = changes.filter((c) => c.label === 'Released').length;
    bulkStatus.textContent = changes.length === 0
      ? `Re-scanned "${name}" - no state changes since the last check.`
      : `Re-scanned "${name}" - ${newCount} new registration${newCount === 1 ? '' : 's'}, ${releasedCount} released since the last check.`;
    return;
  }

  const deleteBtn = target.closest('.watchlist-delete-btn');
  if (deleteBtn instanceof HTMLElement) {
    deleteWatchlist(deleteBtn.dataset.name);
  }
});

renderWatchlistPanel();
