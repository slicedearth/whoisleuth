// Bulk CSV lookup: fast RDAP-only scans over large candidate lists, with an
// explicit deep-check follow-up (registrar/registrant, parking/for-sale
// detection) reserved for a shortlist. Also owns the results table's
// checkbox selection, opportunity-score sorting, CSV export, and the CSV
// upload flow (which loads into the query box rather than tracking the
// file separately until submit).

import { escapeHtml, toCsvValue, readFileAsText, parseDomainsFromText } from './utils.js';
import { fmtAge, fmtExpiresIn, formatPrivacyCell, formatActivityCell, computeOpportunityScore, scoreTone } from './scoring.js';
import { PILL_LABELS } from './render.js';
import { buildOutreachMailto, outreachRegistrantByDomain } from './outreach.js';
import { isShortlisted, toggleShortlist, loadShortlist } from './shortlist.js';
import {
  bulkFileInput,
  bulkCancelBtn,
  bulkDeepCheckBtn,
  bulkExportBtn,
  bulkStatus,
  bulkProgressWrap,
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

let bulkResults = [];
let bulkAbortController = null;
const bulkSelected = new Set();

function updateDeepCheckButton() {
  bulkDeepCheckBtn.disabled = bulkSelected.size === 0;
}

function exportCsv(records, filename) {
  if (records.length === 0) return;
  const headers = [
    'Domain',
    'Opportunity Score',
    'Availability',
    'Availability Detail',
    'Domain Age (days)',
    'Expires In (days)',
    'Privacy Protected',
    'Activity Status',
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
    r.availability,
    r.availabilityDetail,
    r.domainAgeDays,
    r.expiresInDays,
    formatPrivacyCell(r.privacyProtected),
    formatActivityCell(r.activityStatus),
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
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function bulkRowCellsHtml(r) {
  const pillLabel = PILL_LABELS[r.availability] || r.availability;
  const registrar = [r.registrarName].filter(Boolean).join(' ') || '—';
  const registrant = [r.registrantName, r.registrantOrg].filter(Boolean).join(', ') || '—';
  const score = computeOpportunityScore(r);

  const registrantObj = r.registrantEmail
    ? { name: r.registrantName, org: r.registrantOrg, email: r.registrantEmail }
    : null;
  if (registrantObj) outreachRegistrantByDomain.set(r.domain, registrantObj);
  const mailto = buildOutreachMailto(r.domain, registrantObj);
  const outreachCell = mailto
    ? `<a href="${escapeHtml(mailto)}" title="Draft email to ${escapeHtml(r.registrantEmail)}">&#9993;</a> <button type="button" class="secondary outreach-copy-btn" data-domain="${escapeHtml(r.domain)}" style="padding:2px 8px;font-size:0.72rem;">Copy</button>`
    : '—';

  const starred = isShortlisted(r.domain);
  const star = `<button type="button" class="star-btn" data-domain="${escapeHtml(r.domain)}" title="${starred ? 'Remove from' : 'Add to'} shortlist" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 6px 0 0;font-size:0.95rem;">${starred ? '★' : '☆'}</button>`;

  return `
    <td class="domain-cell">${star}${escapeHtml(r.domain)}</td>
    <td>${score === null ? '—' : `<span class="signal-chip ${scoreTone(score)}">${score}</span>`}</td>
    <td><span class="mini-pill ${escapeHtml(r.availability)}">${escapeHtml(pillLabel)}</span></td>
    <td>${escapeHtml(fmtAge(r.domainAgeDays) || '—')}</td>
    <td>${escapeHtml(fmtExpiresIn(r.expiresInDays) || '—')}</td>
    <td>${escapeHtml(formatPrivacyCell(r.privacyProtected))}</td>
    <td>${escapeHtml(formatActivityCell(r.activityStatus))}</td>
    <td>${escapeHtml(registrar)}</td>
    <td>${escapeHtml(registrant)}</td>
    <td>${escapeHtml(r.nameservers || '—')}</td>
    <td>${outreachCell}</td>
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
    const checked = existingTr.querySelector('input[type="checkbox"]')?.checked;
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
}

bulkSelectAll.addEventListener('change', () => {
  bulkResultsBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = bulkSelectAll.checked;
    const domain = cb.closest('tr')?.dataset.domain;
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
  const starBtn = e.target.closest('.star-btn');
  if (starBtn) {
    const record = bulkResults.find((r) => r.domain === starBtn.dataset.domain);
    if (record) {
      toggleShortlist(record);
      const nowStarred = isShortlisted(record.domain);
      starBtn.textContent = nowStarred ? '★' : '☆';
      starBtn.title = `${nowStarred ? 'Remove from' : 'Add to'} shortlist`;
    }
    return;
  }
  const removeBtn = e.target.closest('.shortlist-remove-btn');
  if (removeBtn) {
    toggleShortlist({ domain: removeBtn.dataset.domain });
    // re-render any visible bulk row for this domain so its star reverts
    const tr = bulkResultsBody.querySelector(`tr[data-domain="${CSS.escape(removeBtn.dataset.domain)}"]`);
    const record = bulkResults.find((r) => r.domain === removeBtn.dataset.domain);
    if (tr && record) {
      const checked = tr.querySelector('input[type="checkbox"]')?.checked;
      tr.innerHTML = `<td><input type="checkbox" ${checked ? 'checked' : ''}/></td>${bulkRowCellsHtml(record)}`;
      wireBulkRowCheckbox(tr, record.domain);
    }
  }
});

let bulkSortDescending = true;
document.getElementById('bulk-sort-score').addEventListener('click', () => {
  const byDomain = new Map(bulkResults.map((r) => [r.domain, r]));
  const rows = [...bulkResultsBody.querySelectorAll('tr[data-domain]')];
  rows.sort((a, b) => {
    const scoreA = computeOpportunityScore(byDomain.get(a.dataset.domain) || {}) ?? -1;
    const scoreB = computeOpportunityScore(byDomain.get(b.dataset.domain) || {}) ?? -1;
    return bulkSortDescending ? scoreB - scoreA : scoreA - scoreB;
  });
  rows.forEach((tr) => bulkResultsBody.appendChild(tr));
  bulkSortDescending = !bulkSortDescending;
});

// fast: RDAP-only scan (default for a fresh run over a candidate list).
// append: true means this is a deep-check follow-up on an existing table -
// update matching rows in place instead of clearing/rebuilding it.
export async function runBulkLookup(domains, { fast = true, append = false } = {}) {
  if (!append) {
    bulkResultsBody.innerHTML = '';
    bulkResults = [];
  }
  bulkResultsWrap.classList.add('visible');
  bulkExportBtn.disabled = true;
  bulkProgressWrap.classList.add('visible');
  bulkProgressFill.style.width = '0%';
  bulkProgressLabel.textContent = `Processed 0 / ${domains.length}`;
  submitBtn.disabled = true;
  bulkDeepCheckBtn.disabled = true;
  bulkCancelBtn.style.display = 'inline-block';
  bulkStatus.innerHTML = '';

  bulkAbortController = new AbortController();

  try {
    const res = await fetch('/api/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains, fast }),
      signal: bulkAbortController.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Bulk lookup failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let total = domains.length;
    let processed = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'start') {
          total = msg.total;
          bulkProgressLabel.textContent = `Processed 0 / ${total}`;
        } else if (msg.type === 'result') {
          processed += 1;
          upsertBulkRow(msg);
          bulkProgressLabel.textContent = `Processed ${processed} / ${total}`;
          bulkProgressFill.style.width = `${Math.round((processed / total) * 100)}%`;
        }
      }
    }

    bulkExportBtn.disabled = bulkResults.length === 0;
    const verb = fast ? 'scanned' : 'deep-checked';
    bulkStatus.textContent = `Done — ${domains.length} domain${domains.length === 1 ? '' : 's'} ${verb}.`;
  } catch (err) {
    if (err.name !== 'AbortError') {
      bulkStatus.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
    } else {
      bulkStatus.textContent = 'Cancelled.';
    }
  } finally {
    submitBtn.disabled = false;
    updateDeepCheckButton();
    bulkCancelBtn.style.display = 'none';
    bulkAbortController = null;
  }
}

// Uploading a CSV loads its domains straight into the query box (same
// "generate/load, review, then click Lookup" pattern as the generators and
// the shortlist) rather than being tracked separately until submit - so
// there's exactly one place that decides what gets scanned.
bulkFileInput.addEventListener('change', async () => {
  const file = bulkFileInput.files[0];
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

document.getElementById('shortlist-export-btn').addEventListener('click', () => {
  exportCsv(loadShortlist(), `domain-shortlist-${Date.now()}.csv`);
});
