// Browser-local brand monitoring. Each watchlist keeps the latest complete
// bulk records for rescanning, a compact last-known baseline for reliable
// comparisons, and a bounded change timeline for investigation history.

import { escapeHtml, exportJsonFile, readFileAsText, createLocalStore } from './utils.js';
import { fillQueryInputWithCandidates, bulkStatus } from './dom.js';
import { runBulkLookup, getBulkResults, flagBulkRow, MAX_DEEP_BULK_DOMAINS } from './bulk.js';
import { isDomainAllowlisted } from './brand-profiles.js';
import {
  appendWatchlistScan,
  normalizeWatchlistEntry,
  watchlistFieldLabel,
  formatWatchlistValue,
  MAX_WATCHLIST_HISTORY_EVENTS,
} from './watchlist-history.js';

const WATCHLIST_KEY = 'whois-rdap-watchlist-v1';
const watchlistStore = createLocalStore(WATCHLIST_KEY, {});

let selectedHistoryName = null;
let showChangedHistoryOnly = false;

function loadWatchlists() {
  const stored = watchlistStore.load();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const normalized = {};
  for (const [name, entry] of Object.entries(stored)) {
    if (!entry || !Array.isArray(entry.results)) continue;
    normalized[name] = normalizeWatchlistEntry(entry);
  }
  return normalized;
}

function saveWatchlists(all) {
  watchlistStore.save(all);
}

function inferSaveMode(results) {
  return results.some((result) => result.scanDepth === 'deep') ? 'deep' : 'saved';
}

function saveWatchlistSnapshot(name, results, { mode = inferSaveMode(results) } = {}) {
  const all = loadWatchlists();
  const ignoredDomains = new Set(results.filter((result) => isDomainAllowlisted(result.domain)).map((result) => result.domain));
  const { entry, changes } = appendWatchlistScan(all[name] || null, results, { mode, ignoredDomains });
  all[name] = entry;
  saveWatchlists(all);
  renderWatchlistPanel();
  return changes;
}

function deleteWatchlist(name) {
  const all = loadWatchlists();
  delete all[name];
  saveWatchlists(all);
  if (selectedHistoryName === name) selectedHistoryName = null;
  renderWatchlistPanel();
}

function clearAllWatchlists() {
  saveWatchlists({});
  selectedHistoryName = null;
  renderWatchlistPanel();
}

function exportWatchlistsJson() {
  exportJsonFile(loadWatchlists(), 'domain-watchlists');
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
    all[name] = normalizeWatchlistEntry(entry);
  }
  saveWatchlists(all);
  renderWatchlistPanel();
  return { added, updated };
}

function fmtCheckedDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function modeLabel(mode) {
  if (mode === 'deep') return 'Deep scan';
  if (mode === 'fast') return 'Fast scan';
  return 'Saved snapshot';
}

function changesToRowFlags(changes) {
  const byDomain = new Map();
  for (const change of changes) {
    if (!byDomain.has(change.domain)) byDomain.set(change.domain, []);
    byDomain.get(change.domain).push(change);
  }
  return [...byDomain.entries()].map(([domain, domainChanges]) => {
    if (domainChanges.some((change) => change.kind === 'new_registration')) {
      return { domain, label: 'New registration', tone: 'danger', rowClass: 'newly-registered' };
    }
    if (domainChanges.some((change) => change.kind === 'released')) {
      return { domain, label: 'Released', tone: 'good', rowClass: 'released' };
    }
    if (domainChanges.some((change) => change.tone === 'danger')) {
      return { domain, label: 'New risk signal', tone: 'danger', rowClass: 'new-risk-signal' };
    }
    return { domain, label: 'Changed', tone: 'warn', rowClass: 'watchlist-changed' };
  });
}

const watchlistBodyEl = /** @type {HTMLElement} */ (document.getElementById('watchlist-body'));
const watchlistNameInput = /** @type {HTMLInputElement} */ (document.getElementById('watchlist-name-input'));
const watchlistSaveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('watchlist-save-btn'));
const watchlistClearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('watchlist-clear-btn'));
const watchlistExportJsonBtn = /** @type {HTMLButtonElement} */ (document.getElementById('watchlist-export-json-btn'));
const watchlistImportInput = /** @type {HTMLInputElement} */ (document.getElementById('watchlist-import-file'));
const historyPanelEl = /** @type {HTMLElement} */ (document.getElementById('watchlist-history-panel'));
const historyHeadingEl = /** @type {HTMLElement} */ (document.getElementById('watchlist-history-heading'));
const historySummaryEl = /** @type {HTMLElement} */ (document.getElementById('watchlist-history-summary'));
const historyListEl = /** @type {HTMLElement} */ (document.getElementById('watchlist-history-list'));
const historyChangedOnlyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('watchlist-history-changed-only'));
const historyCloseBtn = /** @type {HTMLButtonElement} */ (document.getElementById('watchlist-history-close'));

function renderHistoryEvent(event, eventIndex) {
  const changes = Array.isArray(event.changes) ? event.changes : [];
  const isInitial = eventIndex === 0 && event.changeCount === 0;
  const changeHtml = changes.length
    ? `<ul class="watchlist-change-list">${changes.map((change) => `
        <li class="watchlist-change ${escapeHtml(change.tone)}">
          <span class="watchlist-change-domain">${escapeHtml(change.domain)}</span>
          <span class="watchlist-change-field">${escapeHtml(watchlistFieldLabel(change.field))}</span>
          <span class="watchlist-change-values">${escapeHtml(formatWatchlistValue(change.field, change.before))} <span aria-hidden="true">&rarr;</span><span class="visually-hidden"> changed to </span> ${escapeHtml(formatWatchlistValue(change.field, change.after))}</span>
        </li>`).join('')}</ul>`
    : `<p class="watchlist-no-change">${isInitial ? 'Initial snapshot - no earlier check to compare.' : 'No material changes detected.'}</p>`;
  const omitted = event.omittedChanges > 0
    ? `<p class="watchlist-history-note">${event.omittedChanges} additional changes were counted but not retained to keep browser storage bounded.</p>`
    : '';
  return `
    <article class="watchlist-history-event" data-has-changes="${event.changeCount > 0}">
      <div class="watchlist-history-event-heading">
        <time datetime="${escapeHtml(event.checkedAt)}">${escapeHtml(fmtCheckedDate(event.checkedAt))}</time>
        <span class="signal-chip neutral">${escapeHtml(modeLabel(event.mode))}</span>
        <span class="signal-chip ${event.changeCount > 0 ? 'warn' : 'good'}">${event.changeCount} change${event.changeCount === 1 ? '' : 's'}</span>
        <span class="watchlist-history-result-count">${event.conclusiveCount}/${event.resultCount} conclusive</span>
      </div>
      ${changeHtml}${omitted}
    </article>`;
}

function renderWatchlistHistory(all = loadWatchlists()) {
  const entry = selectedHistoryName ? all[selectedHistoryName] : null;
  if (!entry) {
    historyPanelEl.hidden = true;
    historyListEl.innerHTML = '';
    return;
  }

  const history = entry.history || [];
  const visibleEvents = showChangedHistoryOnly ? history.filter((event) => event.changeCount > 0) : history;
  historyPanelEl.hidden = false;
  historyHeadingEl.textContent = `${selectedHistoryName} history`;
  historySummaryEl.textContent = `${history.length} retained check${history.length === 1 ? '' : 's'} (maximum ${MAX_WATCHLIST_HISTORY_EVENTS}) · ${entry.results.length} domains`;
  historyChangedOnlyBtn.setAttribute('aria-pressed', String(showChangedHistoryOnly));
  historyListEl.innerHTML = visibleEvents.length
    ? visibleEvents.map((event) => renderHistoryEvent(event, history.indexOf(event))).reverse().join('')
    : '<div class="empty-state"><span class="placeholder">No checks with material changes.</span></div>';
}

function renderWatchlistPanel() {
  const all = loadWatchlists();
  const names = Object.keys(all).sort();
  watchlistBodyEl.innerHTML = names
    .map((name) => {
      const entry = all[name];
      const latest = entry.history.at(-1);
      const latestChanges = latest?.changeCount || 0;
      const deepDisabled = entry.results.length > MAX_DEEP_BULK_DOMAINS
        ? ` disabled title="Deep re-scan is limited to ${MAX_DEEP_BULK_DOMAINS} domains; use a fast re-scan and deep-check a selected subset instead"`
        : '';
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${entry.results.length}</td>
          <td>${entry.history.length}</td>
          <td><span class="signal-chip ${latestChanges > 0 ? 'warn' : 'good'}">${latestChanges}</span></td>
          <td>${escapeHtml(fmtCheckedDate(entry.updatedAt))}</td>
          <td class="watchlist-actions-cell">
            <button type="button" class="secondary watchlist-rescan-btn" data-mode="fast" data-name="${escapeHtml(name)}">Re-scan</button>
            <button type="button" class="secondary watchlist-rescan-btn" data-mode="deep" data-name="${escapeHtml(name)}"${deepDisabled}>Deep re-scan</button>
            <button type="button" class="secondary watchlist-history-btn" data-name="${escapeHtml(name)}">History</button>
            <button type="button" class="secondary watchlist-delete-btn" data-name="${escapeHtml(name)}">Delete</button>
          </td>
        </tr>`;
    })
    .join('');
  renderWatchlistHistory(all);
}

watchlistSaveBtn.addEventListener('click', () => {
  const results = getBulkResults();
  if (results.length === 0) {
    bulkStatus.innerHTML = '<span class="error-text">Run a bulk scan first, then save its results as a watchlist.</span>';
    return;
  }
  const name = watchlistNameInput.value.trim();
  if (!name) {
    bulkStatus.innerHTML = '<span class="error-text">Enter a watchlist name before saving.</span>';
    watchlistNameInput.focus();
    return;
  }
  const changes = saveWatchlistSnapshot(name, results);
  watchlistNameInput.value = '';
  bulkStatus.textContent = changes.length
    ? `Updated "${name}" (${results.length} domains) and recorded ${changes.length} material change${changes.length === 1 ? '' : 's'}.`
    : `Saved "${name}" as a watchlist (${results.length} domains).`;
});

watchlistClearBtn.addEventListener('click', () => {
  if (Object.keys(loadWatchlists()).length === 0) return;
  if (!window.confirm('Delete every saved watchlist and its history? This cannot be undone.')) return;
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
    watchlistImportInput.value = '';
  }
});

historyChangedOnlyBtn.addEventListener('click', () => {
  showChangedHistoryOnly = !showChangedHistoryOnly;
  renderWatchlistHistory();
});

historyCloseBtn.addEventListener('click', () => {
  selectedHistoryName = null;
  renderWatchlistHistory();
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

    const mode = rescanBtn.dataset.mode === 'deep' ? 'deep' : 'fast';
    const domains = entry.results.map((result) => result.domain);
    const provenance = entry.results.filter((result) => Array.isArray(result.mutationTypes) && result.mutationTypes.length > 0);
    fillQueryInputWithCandidates(domains, provenance);
    await runBulkLookup(domains, { fast: mode === 'fast', append: false });

    const newResults = getBulkResults();
    const changes = saveWatchlistSnapshot(name, newResults, { mode });
    for (const flag of changesToRowFlags(changes)) flagBulkRow(flag.domain, flag);

    const newCount = changes.filter((change) => change.kind === 'new_registration').length;
    const releasedCount = changes.filter((change) => change.kind === 'released').length;
    const otherCount = changes.length - newCount - releasedCount;
    bulkStatus.textContent = changes.length === 0
      ? `${mode === 'deep' ? 'Deep re-scanned' : 'Re-scanned'} "${name}" - no material changes since the last comparable check.`
      : `${mode === 'deep' ? 'Deep re-scanned' : 'Re-scanned'} "${name}" - ${newCount} new registration${newCount === 1 ? '' : 's'}, ${releasedCount} released, ${otherCount} other material change${otherCount === 1 ? '' : 's'}.`;
    return;
  }

  const historyBtn = target.closest('.watchlist-history-btn');
  if (historyBtn instanceof HTMLElement) {
    selectedHistoryName = historyBtn.dataset.name || null;
    showChangedHistoryOnly = false;
    renderWatchlistHistory();
    historyPanelEl.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    return;
  }

  const deleteBtn = target.closest('.watchlist-delete-btn');
  if (deleteBtn instanceof HTMLElement && deleteBtn.dataset.name) deleteWatchlist(deleteBtn.dataset.name);
});

renderWatchlistPanel();
