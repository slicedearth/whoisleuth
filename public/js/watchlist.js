// Brand watchlist - saves a named snapshot of the current bulk results
// table (typically a typosquat variant scan) in localStorage, same pattern
// as shortlist.js, and lets it be re-scanned later. On re-scan, the new
// results are diffed against the saved snapshot so a domain that moved
// from available/unknown to registered - a fresh potential-squatting
// registration - gets flagged, and the reverse (a lapsed lookalike, a fresh
// acquisition opportunity) is flagged too.

import { escapeHtml } from './utils.js';
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

export function loadWatchlists() {
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

export function saveWatchlistSnapshot(name, results) {
  const all = loadWatchlists();
  all[name] = { updatedAt: new Date().toISOString(), results };
  saveWatchlists(all);
  renderWatchlistPanel();
}

export function deleteWatchlist(name) {
  const all = loadWatchlists();
  delete all[name];
  saveWatchlists(all);
  renderWatchlistPanel();
}

// Bulk erasure alongside the existing per-watchlist Delete button - see
// shortlist.js's clearShortlist() for why this matters beyond tidying up.
export function clearAllWatchlists() {
  saveWatchlists({});
  renderWatchlistPanel();
}

// Compares a previously-saved snapshot against a fresh scan and returns one
// entry per domain whose state crossed the registered/open boundary in
// either direction. Domains with no meaningful state change (including ones
// that simply weren't in the previous snapshot) are left alone.
export function diffWatchlist(previousResults, newResults) {
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

export function renderWatchlistPanel() {
  const all = loadWatchlists();
  const names = Object.keys(all).sort();
  document.getElementById('watchlist-body').innerHTML = names
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

document.getElementById('watchlist-save-btn').addEventListener('click', () => {
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

document.getElementById('watchlist-clear-btn').addEventListener('click', () => {
  if (Object.keys(loadWatchlists()).length === 0) return;
  if (!window.confirm('Delete every saved watchlist? This cannot be undone.')) return;
  clearAllWatchlists();
});

document.addEventListener('click', async (e) => {
  const rescanBtn = e.target.closest('.watchlist-rescan-btn');
  if (rescanBtn) {
    const name = rescanBtn.dataset.name;
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

  const deleteBtn = e.target.closest('.watchlist-delete-btn');
  if (deleteBtn) {
    deleteWatchlist(deleteBtn.dataset.name);
  }
});

renderWatchlistPanel();
