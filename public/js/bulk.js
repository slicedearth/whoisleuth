// Bulk CSV lookup: fast RDAP-only scans over large candidate lists, with an
// explicit deep-check follow-up (registrar/registrant, parking/for-sale
// detection) reserved for a shortlist. Also owns the results table's
// checkbox selection, opportunity-score sorting, CSV export, and the CSV
// upload flow (which loads into the query box rather than tracking the
// file separately until submit).

import { escapeHtml, toCsvValue, readFileAsText, parseDomainsFromText, downloadBlob } from './utils.js';
import {
  fmtAge,
  fmtExpiresIn,
  formatPrivacyCell,
  formatActivityCell,
  computeOpportunityScore,
  explainOpportunityScore,
  scoreTone,
  computeRiskScore,
  explainRiskScore,
  riskTone,
  formatScoreBreakdown,
} from './scoring.js';
import { PILL_LABELS } from './render.js';
import { buildOutreachMailto, outreachRegistrantByDomain } from './outreach.js';
import { buildAbuseMailto, abuseRecordByDomain } from './abuse.js';
import { isShortlisted, toggleShortlist, loadShortlist } from './shortlist.js';
import { showGate } from './auth.js';
import {
  bulkFileInput,
  bulkCancelBtn,
  bulkDeepCheckBtn,
  bulkExportBtn,
  bulkDensityBtn,
  bulkStatus,
  bulkProgressWrap,
  bulkProgressTrack,
  bulkProgressFill,
  bulkProgressLabel,
  bulkResultsWrap,
  bulkResultsBody,
  bulkSelectAll,
  submitBtn,
  fillQueryInputWithCandidates,
} from './dom.js';

export const MAX_BULK_DOMAINS = 200;
export const MAX_FAST_BULK_DOMAINS = 2000;
const BULK_CONCURRENCY = 6;
// Fast scans (RDAP-only, no WHOIS/homepage fetch) are cheap enough on both
// this backend and upstream registries to run much larger, more concurrent
// batches - meant for sourcing/screening large candidate lists, with the
// deep (default) mode reserved for a shortlist.
const FAST_BULK_CONCURRENCY = 20;

let bulkResults = [];
let bulkAbortController = null;
const bulkSelected = new Set();

// Runs `worker` over `items` with up to `concurrency` in flight at once.
// Concurrency lives here (client-side) rather than in a single long-lived
// server request/stream, so a bulk scan is just N independent
// /api/availability calls - the same shape whether the backend is a
// long-running Express server or a short-lived serverless function, which
// only ever handles one domain per invocation.
async function runPool(items, concurrency, worker) {
  let idx = 0;
  const size = Math.min(concurrency, items.length) || 1;
  const runners = new Array(size).fill(0).map(async () => {
    while (idx < items.length) {
      const current = idx++;
      await worker(items[current]);
    }
  });
  await Promise.allSettled(runners);
}

// Maps a raw /api/availability response into the flat row shape the bulk
// results table (and CSV export) expect.
function toBulkRecord(domain, body) {
  if (!body.applicable) {
    return {
      domain,
      availability: 'error',
      availabilityDetail: 'Not a domain name (bulk lookup only supports domains, not IPs/ASNs)',
    };
  }
  return {
    domain: body.domain || domain,
    availability: body.state,
    availabilityDetail: body.detail,
    registrarName: body.registrar ? body.registrar.name || body.registrar.org : null,
    registrarEmail: body.registrar ? body.registrar.email : null,
    registrantName: body.registrant ? body.registrant.name : null,
    registrantOrg: body.registrant ? body.registrant.org : null,
    registrantEmail: body.registrant ? body.registrant.email : null,
    createdDate: body.createdDate || null,
    expiryDate: body.expiryDate || null,
    nameservers: Array.isArray(body.nameservers) ? body.nameservers.join('; ') : '',
    domainAgeDays: body.domainAgeDays ?? null,
    expiresInDays: body.expiresInDays ?? null,
    privacyProtected: body.privacyProtected ?? null,
    activityStatus: body.activityStatus || null,
    hasMx: body.hasMx ?? null,
    hasSpf: body.hasSpf ?? null,
    hasDmarc: body.hasDmarc ?? null,
    abuseEmail: body.abuse ? body.abuse.email : null,
  };
}

// Read-only accessor for the watchlist feature, which needs to snapshot/diff
// the current table contents without reaching into this module's private
// state.
export function getBulkResults() {
  return bulkResults;
}

// Appends a small badge to an already-rendered row's domain cell - used by
// the watchlist feature to flag rows whose state changed since a previous
// scan, without bulk.js needing to know anything about watchlists.
export function flagBulkRow(domain, { label, tone, rowClass }) {
  const tr = bulkResultsBody.querySelector(`tr[data-domain="${CSS.escape(domain)}"]`);
  if (!tr) return;
  if (rowClass) tr.classList.add(rowClass);
  const cell = tr.querySelector('td.domain-cell');
  if (cell && !cell.querySelector('.watch-flag')) {
    cell.insertAdjacentHTML('beforeend', `<span class="watch-flag ${escapeHtml(tone)}">${escapeHtml(label)}</span>`);
  }
}

function updateDeepCheckButton() {
  bulkDeepCheckBtn.disabled = bulkSelected.size === 0;
}

function exportCsv(records, filename) {
  if (records.length === 0) return;
  const headers = [
    'Domain',
    'Opportunity Score',
    'Opportunity Score Breakdown',
    'Risk Score',
    'Risk Score Breakdown',
    'Availability',
    'Availability Detail',
    'Domain Age (days)',
    'Expires In (days)',
    'Privacy Protected',
    'Activity Status',
    'MX Records',
    'SPF Record',
    'DMARC Record',
    'Abuse Email',
    'Registrar Name',
    'Registrar Email',
    'Registrant Name',
    'Registrant Org',
    'Registrant Email',
    'Created Date',
    'Expiry Date',
    'Nameservers',
  ];
  const rows = records.map((r) => [
    r.domain,
    computeOpportunityScore(r),
    formatScoreBreakdown(explainOpportunityScore(r), '; '),
    computeRiskScore(r),
    formatScoreBreakdown(explainRiskScore(r), '; '),
    r.availability,
    r.availabilityDetail,
    r.domainAgeDays,
    r.expiresInDays,
    formatPrivacyCell(r.privacyProtected),
    formatActivityCell(r.activityStatus),
    r.hasMx === true ? 'Yes' : r.hasMx === false ? 'No' : '',
    r.hasSpf === true ? 'Yes' : r.hasSpf === false ? 'No' : '',
    r.hasDmarc === true ? 'Yes' : r.hasDmarc === false ? 'No' : '',
    r.abuseEmail,
    r.registrarName,
    r.registrarEmail,
    r.registrantName,
    r.registrantOrg,
    r.registrantEmail,
    r.createdDate,
    r.expiryDate,
    r.nameservers,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(',')).join('\r\n');
  downloadBlob(csv, filename, 'text/csv;charset=utf-8;');
}

function bulkRowCellsHtml(r) {
  const pillLabel = PILL_LABELS[r.availability] || r.availability;
  const registrar = [r.registrarName].filter(Boolean).join(' ') || '—';
  const registrant = [r.registrantName, r.registrantOrg].filter(Boolean).join(', ') || '—';
  const oppExplain = explainOpportunityScore(r);
  const riskExplain = explainRiskScore(r);

  const registrantObj = r.registrantEmail
    ? { name: r.registrantName, org: r.registrantOrg, email: r.registrantEmail }
    : null;
  if (registrantObj) outreachRegistrantByDomain.set(r.domain, registrantObj);
  const mailto = buildOutreachMailto(r.domain, registrantObj);
  const outreachCell = mailto
    ? `<a href="${escapeHtml(mailto)}" title="Draft email to ${escapeHtml(r.registrantEmail)}" aria-label="Draft email to ${escapeHtml(r.registrantEmail)}">&#9993;</a> <button type="button" class="secondary outreach-copy-btn" data-domain="${escapeHtml(r.domain)}" style="padding:2px 8px;font-size:0.72rem;">Copy</button>`
    : '—';

  const abuseRecord = r.abuseEmail
    ? { abuseEmail: r.abuseEmail, hasMx: r.hasMx, activityStatus: r.activityStatus, privacyProtected: r.privacyProtected, domainAgeDays: r.domainAgeDays }
    : null;
  if (abuseRecord) abuseRecordByDomain.set(r.domain, abuseRecord);
  const abuseMailto = buildAbuseMailto(r.domain, abuseRecord);
  const abuseCell = abuseMailto
    ? `<a href="${escapeHtml(abuseMailto)}" title="Draft abuse report to ${escapeHtml(r.abuseEmail)}" aria-label="Draft abuse report to ${escapeHtml(r.abuseEmail)}">&#9888;</a> <button type="button" class="secondary abuse-copy-btn" data-domain="${escapeHtml(r.domain)}" style="padding:2px 8px;font-size:0.72rem;">Copy</button>`
    : '—';

  const starred = isShortlisted(r.domain);
  const starLabel = `${starred ? 'Remove from' : 'Add to'} shortlist`;
  const star = `<button type="button" class="star-btn" data-domain="${escapeHtml(r.domain)}" title="${starLabel}" aria-label="${starLabel}" aria-pressed="${starred}" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 6px 0 0;font-size:0.95rem;">${starred ? '★' : '☆'}</button>`;

  return `
    <td class="domain-cell">${star}${escapeHtml(r.domain)}</td>
    <td>${oppExplain === null ? '—' : `<span class="signal-chip ${scoreTone(oppExplain.score)}" title="${escapeHtml(formatScoreBreakdown(oppExplain))}">${oppExplain.score}</span>`}</td>
    <td>${riskExplain === null ? '—' : `<span class="signal-chip ${riskTone(riskExplain.score)}" title="${escapeHtml(formatScoreBreakdown(riskExplain))}">${riskExplain.score}</span>`}</td>
    <td><span class="mini-pill ${escapeHtml(r.availability)}">${escapeHtml(pillLabel)}</span></td>
    <td>${escapeHtml(fmtAge(r.domainAgeDays) || '—')}</td>
    <td>${escapeHtml(fmtExpiresIn(r.expiresInDays) || '—')}</td>
    <td>${escapeHtml(formatPrivacyCell(r.privacyProtected))}</td>
    <td>${escapeHtml(formatActivityCell(r.activityStatus, r.hasMx, r.hasSpf, r.hasDmarc))}</td>
    <td>${escapeHtml(registrar)}</td>
    <td>${escapeHtml(registrant)}</td>
    <td>${escapeHtml(r.nameservers || '—')}</td>
    <td>${outreachCell}</td>
    <td>${abuseCell}</td>
  `;
}

function wireBulkRowCheckbox(tr, domain) {
  const checkbox = tr.querySelector('input[type="checkbox"]');
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) bulkSelected.add(domain);
    else bulkSelected.delete(domain);
    updateDeepCheckButton();
  });
}

// Used both for a fresh scan (every domain is new) and a deep-check
// follow-up (updates the existing row for a domain in place instead of
// adding a duplicate).
function upsertBulkRow(r) {
  const existingIdx = bulkResults.findIndex((existing) => existing.domain === r.domain);
  if (existingIdx !== -1) bulkResults[existingIdx] = r;
  else bulkResults.push(r);

  const existingTr = bulkResultsBody.querySelector(`tr[data-domain="${CSS.escape(r.domain)}"]`);
  if (existingTr) {
    const checked = /** @type {HTMLInputElement | null} */ (existingTr.querySelector('input[type="checkbox"]'))?.checked;
    existingTr.innerHTML = `<td><input type="checkbox" ${checked ? 'checked' : ''}/></td>${bulkRowCellsHtml(r)}`;
    wireBulkRowCheckbox(existingTr, r.domain);
    return;
  }

  const tr = document.createElement('tr');
  tr.dataset.domain = r.domain;
  tr.innerHTML = `<td><input type="checkbox" /></td>${bulkRowCellsHtml(r)}`;
  wireBulkRowCheckbox(tr, r.domain);
  bulkResultsBody.appendChild(tr);
}

export function clearBulkResults() {
  bulkResultsBody.innerHTML = '';
  bulkResults = [];
  bulkSelected.clear();
  bulkSelectAll.checked = false;
  updateDeepCheckButton();
  bulkResultsWrap.classList.remove('visible');
  bulkProgressWrap.classList.remove('visible');
  bulkExportBtn.disabled = true;
  bulkDeepCheckBtn.style.display = 'none';
  bulkExportBtn.style.display = 'none';
  bulkDensityBtn.style.display = 'none';
}

bulkDensityBtn.addEventListener('click', () => {
  const nowCompact = bulkResultsWrap.classList.toggle('compact');
  bulkDensityBtn.textContent = nowCompact ? 'Comfortable rows' : 'Compact rows';
  bulkDensityBtn.setAttribute('aria-pressed', String(nowCompact));
});

bulkSelectAll.addEventListener('change', () => {
  bulkResultsBody.querySelectorAll('input[type="checkbox"]').forEach((cbEl) => {
    const cb = /** @type {HTMLInputElement} */ (cbEl);
    cb.checked = bulkSelectAll.checked;
    const domain = /** @type {HTMLElement | null} */ (cb.closest('tr'))?.dataset.domain;
    if (!domain) return;
    if (cb.checked) bulkSelected.add(domain);
    else bulkSelected.delete(domain);
  });
  updateDeepCheckButton();
});

// Star/unstar a bulk row (shortlist toggle), and remove-from-shortlist
// clicks from the shortlist panel table (which needs to revert that row's
// star here if it's currently visible in the bulk results too).
document.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const starBtn = target.closest('.star-btn');
  if (starBtn instanceof HTMLElement) {
    const record = bulkResults.find((r) => r.domain === starBtn.dataset.domain);
    if (record) {
      toggleShortlist(record);
      const nowStarred = isShortlisted(record.domain);
      const label = `${nowStarred ? 'Remove from' : 'Add to'} shortlist`;
      starBtn.textContent = nowStarred ? '★' : '☆';
      starBtn.title = label;
      starBtn.setAttribute('aria-label', label);
      starBtn.setAttribute('aria-pressed', String(nowStarred));
    }
    return;
  }
  const removeBtn = target.closest('.shortlist-remove-btn');
  if (removeBtn instanceof HTMLElement) {
    const removeDomain = removeBtn.dataset.domain;
    toggleShortlist({ domain: removeDomain });
    // re-render any visible bulk row for this domain so its star reverts
    const tr = bulkResultsBody.querySelector(`tr[data-domain="${CSS.escape(removeDomain ?? '')}"]`);
    const record = bulkResults.find((r) => r.domain === removeDomain);
    if (tr && record) {
      const checked = /** @type {HTMLInputElement | null} */ (tr.querySelector('input[type="checkbox"]'))?.checked;
      tr.innerHTML = `<td><input type="checkbox" ${checked ? 'checked' : ''}/></td>${bulkRowCellsHtml(record)}`;
      wireBulkRowCheckbox(tr, record.domain);
    }
  }
});

// Sorts the results table by a given score function (opportunity or risk),
// toggling ascending/descending independently per column.
function wireSortableColumn(headerEl, scoreFn) {
  let descending = true;
  headerEl.addEventListener('click', () => {
    const byDomain = new Map(bulkResults.map((r) => [r.domain, r]));
    const rows = /** @type {HTMLElement[]} */ ([...bulkResultsBody.querySelectorAll('tr[data-domain]')]);
    rows.sort((a, b) => {
      const scoreA = scoreFn(byDomain.get(a.dataset.domain ?? '') || {}) ?? -1;
      const scoreB = scoreFn(byDomain.get(b.dataset.domain ?? '') || {}) ?? -1;
      return descending ? scoreB - scoreA : scoreA - scoreB;
    });
    rows.forEach((tr) => bulkResultsBody.appendChild(tr));
    descending = !descending;
  });
}

wireSortableColumn(/** @type {HTMLElement} */ (document.getElementById('bulk-sort-score')), computeOpportunityScore);
wireSortableColumn(/** @type {HTMLElement} */ (document.getElementById('bulk-sort-risk')), computeRiskScore);

// fast: RDAP-only scan (default for a fresh run over a candidate list).
// append: true means this is a deep-check follow-up on an existing table -
// update matching rows in place instead of clearing/rebuilding it.
export async function runBulkLookup(domains, { fast = true, append = false } = {}) {
  if (!append) {
    bulkResultsBody.innerHTML = '';
    bulkResults = [];
  }

  const seen = new Set();
  const uniqueDomains = [];
  for (const raw of domains) {
    const trimmed = (raw || '').toString().trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueDomains.push(trimmed);
  }

  bulkResultsWrap.classList.add('visible');
  bulkExportBtn.disabled = true;
  bulkDeepCheckBtn.style.display = 'inline-block';
  bulkExportBtn.style.display = 'inline-block';
  bulkDensityBtn.style.display = 'inline-block';
  bulkProgressWrap.classList.add('visible');
  bulkProgressFill.style.width = '0%';
  bulkProgressTrack.setAttribute('aria-valuenow', '0');
  bulkProgressLabel.textContent = `Processed 0 / ${uniqueDomains.length}`;
  submitBtn.disabled = true;
  bulkDeepCheckBtn.disabled = true;
  bulkCancelBtn.style.display = 'inline-block';
  bulkStatus.innerHTML = '';

  bulkAbortController = new AbortController();
  const { signal } = bulkAbortController;
  const total = uniqueDomains.length;
  let processed = 0;

  await runPool(uniqueDomains, fast ? FAST_BULK_CONCURRENCY : BULK_CONCURRENCY, async (domain) => {
    if (signal.aborted) return;
    let record;
    try {
      const res = await fetch(`/api/availability?q=${encodeURIComponent(domain)}${fast ? '&fast=1' : ''}`, { signal });
      if (res.status === 401) {
        if (!signal.aborted) {
          bulkAbortController.abort();
          showGate();
        }
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Lookup failed (${res.status})`);
      record = toBulkRecord(domain, body);
    } catch (err) {
      if (signal.aborted) return; // cancelled - don't show a spurious error row
      record = { domain, availability: 'error', availabilityDetail: err.message };
    }
    processed += 1;
    upsertBulkRow(record);
    const percent = Math.round((processed / total) * 100);
    bulkProgressLabel.textContent = `Processed ${processed} / ${total}`;
    bulkProgressFill.style.width = `${percent}%`;
    bulkProgressTrack.setAttribute('aria-valuenow', String(percent));
  });

  if (signal.aborted) {
    bulkStatus.textContent = 'Cancelled.';
  } else {
    bulkExportBtn.disabled = bulkResults.length === 0;
    const verb = fast ? 'scanned' : 'deep-checked';
    bulkStatus.textContent = `Done — ${total} domain${total === 1 ? '' : 's'} ${verb}.`;
  }

  submitBtn.disabled = false;
  updateDeepCheckButton();
  bulkCancelBtn.style.display = 'none';
  bulkAbortController = null;
}

// Uploading a CSV loads its domains straight into the query box (same
// "generate/load, review, then click Lookup" pattern as the generators and
// the shortlist) rather than being tracked separately until submit - so
// there's exactly one place that decides what gets scanned.
bulkFileInput.addEventListener('change', async () => {
  const file = bulkFileInput.files?.[0];
  if (!file) return;

  let text;
  try {
    text = await readFileAsText(file);
  } catch (err) {
    bulkStatus.innerHTML = `<span class="error-text">Could not read file: ${escapeHtml(err.message)}</span>`;
    bulkFileInput.value = '';
    return;
  }

  const entries = parseDomainsFromText(text);
  bulkFileInput.value = ''; // consumed - avoid re-reading it on a later submit
  if (entries.length === 0) {
    bulkStatus.innerHTML = '<span class="error-text">No domains found in that file.</span>';
    return;
  }

  fillQueryInputWithCandidates(entries);
  bulkStatus.textContent = `Loaded ${entries.length} domain${entries.length === 1 ? '' : 's'} from ${file.name} - click Lookup to scan.`;
});

bulkCancelBtn.addEventListener('click', () => {
  if (bulkAbortController) bulkAbortController.abort();
});

bulkExportBtn.addEventListener('click', () => exportCsv(bulkResults, `domain-lookup-results-${Date.now()}.csv`));

bulkDeepCheckBtn.addEventListener('click', () => {
  const selected = [...bulkSelected];
  if (selected.length === 0) return;

  const truncated = selected.slice(0, MAX_BULK_DOMAINS);
  if (selected.length > MAX_BULK_DOMAINS) {
    bulkStatus.innerHTML = `<span class="error-text">Selected ${selected.length} domains; only the first ${MAX_BULK_DOMAINS} will be deep-checked.</span>`;
  }

  runBulkLookup(truncated, { fast: false, append: true });
});

/** @type {HTMLButtonElement} */ (document.getElementById('shortlist-export-btn')).addEventListener('click', () => {
  exportCsv(loadShortlist(), `domain-shortlist-${Date.now()}.csv`);
});
