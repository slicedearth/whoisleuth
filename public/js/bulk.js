// Bulk CSV lookup: fast RDAP-only scans over large candidate lists, with an
// explicit deep-check follow-up (registrar/registrant, parking/for-sale
// detection) reserved for a shortlist. Also owns the results table's
// checkbox selection, opportunity-score sorting, CSV export, and the CSV
// upload flow (which loads into the query box rather than tracking the
// file separately until submit).

import { escapeHtml, toCsvValue, readFileAsText, parseDomainsFromText, downloadBlob, runPool } from './utils.js';
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
import { isDomainAllowlisted, isFaviconHashMatchingProfile, isReusingOfficialAssets } from './brand-profiles.js';
import { showGate } from './auth.js';
import { getCandidateProvenance, listCandidateProvenance } from './candidate-provenance.js';
import { buildCoverageReport } from './coverage.js';
import { MUTATION_LABELS } from './typosquat-generator.js';
import { getBulkTriageBuckets, matchesBulkTriage, mutationTriageOptions } from './bulk-filters.js';
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
  bulkTriage,
  bulkTriageSummary,
  bulkTriageStateButtons,
  bulkTriageSignalButtons,
  bulkTriageMutation,
  bulkTriageClear,
  bulkResultsWrap,
  bulkResultsBody,
  bulkSelectAll,
  clusterPanel,
  clusterList,
  coveragePanel,
  coverageSummary,
  coverageMutationBody,
  coverageTldBody,
  coverageExportBtn,
  submitBtn,
  fillQueryInputWithCandidates,
} from './dom.js';

const MAX_BULK_DOMAINS = 200;
export const MAX_FAST_BULK_DOMAINS = 2000;
const BULK_CONCURRENCY = 6;
// Fast scans (RDAP-only, no WHOIS/homepage fetch) are cheap enough on both
// this backend and upstream registries to run much larger, more concurrent
// batches - meant for sourcing/screening large candidate lists, with the
// deep (default) mode reserved for a shortlist.
const FAST_BULK_CONCURRENCY = 20;

// The documented max fast scan (2000 domains) legitimately exceeds the
// shared API rate limit (1000 requests/minute - lib/rate-limit.js) if it
// completes within one window, which it usually does at
// FAST_BULK_CONCURRENCY. Without this, the back half of a full-size scan
// used to just turn into permanent "Too many requests" error rows with no
// way to recover short of re-running the whole scan. Retrying instead of
// giving up keeps the documented maximum actually usable.
const MAX_429_RETRIES = 5;

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
}

async function fetchWithRateLimitRetry(url, signal) {
  let res = await fetch(url, { signal });
  for (let attempt = 0; res.status === 429 && attempt < MAX_429_RETRIES; attempt += 1) {
    const retryAfterSeconds = Number(res.headers.get('Retry-After'));
    const waitMs = (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 2) * 1000
      + Math.random() * 500; // spreads out concurrent workers that all hit the limit in the same window
    await delay(waitMs, signal);
    res = await fetch(url, { signal });
  }
  return res;
}

let bulkResults = [];
// domain -> index into bulkResults, so upsertBulkRow (called once per
// scanned domain, up to MAX_FAST_BULK_DOMAINS) doesn't need an
// Array#findIndex scan for every row - that made a full scan O(n^2). Indices
// stay valid since bulkResults is only ever appended to or updated in place,
// never reordered/spliced. Kept in sync everywhere bulkResults is reset.
let bulkResultsByDomain = new Map();
let bulkAbortController = null;
const bulkSelected = new Set();
let lastCoverageReport = null;
const coverageGroupDomains = new Map();
let bulkTriageFilters = { state: 'all', mutation: '', signals: new Set() };
let bulkTriageCounts = emptyBulkTriageCounts();
const bulkMutationCounts = new Map();
let visibleBulkRows = 0;

const TRIAGE_STATE_LABELS = {
  all: 'All',
  available: 'Available',
  registered: 'Registered',
  high_risk: 'High risk',
  errors: 'Errors',
};

function emptyBulkTriageCounts() {
  return { all: 0, available: 0, registered: 0, high_risk: 0, errors: 0 };
}

function withCandidateProvenance(domain, record) {
  const provenance = getCandidateProvenance(domain);
  return {
    ...record,
    sourceDomain: provenance?.source || null,
    candidateTld: provenance?.tld || domain.split('.').pop() || null,
    mutationTypes: provenance?.mutationTypes || [],
  };
}

function resetBulkTriage() {
  bulkTriageFilters = { state: 'all', mutation: '', signals: new Set() };
  bulkTriageCounts = emptyBulkTriageCounts();
  bulkMutationCounts.clear();
  visibleBulkRows = 0;
  bulkTriageMutation.innerHTML = '<option value="">All mutations</option>';
  bulkTriageMutation.value = '';
  bulkTriage.hidden = true;
  bulkTriageSummary.textContent = '0 of 0 shown';
  bulkTriageStateButtons.forEach((button) => {
    const state = button.dataset.bulkState || 'all';
    button.textContent = `${TRIAGE_STATE_LABELS[state] || state}: 0`;
    button.setAttribute('aria-pressed', String(state === 'all'));
  });
  bulkTriageSignalButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  bulkTriageClear.disabled = true;
}

function adjustBulkTriageCounts(record, direction) {
  for (const bucket of getBulkTriageBuckets(record)) {
    bulkTriageCounts[bucket] += direction;
  }
  const mutationTypes = new Set(Array.isArray(record.mutationTypes) ? record.mutationTypes : []);
  let mutationOptionsChanged = false;
  for (const mutationType of mutationTypes) {
    const nextCount = (bulkMutationCounts.get(mutationType) || 0) + direction;
    if (nextCount <= 0) {
      bulkMutationCounts.delete(mutationType);
      mutationOptionsChanged = true;
    } else {
      if (!bulkMutationCounts.has(mutationType)) mutationOptionsChanged = true;
      bulkMutationCounts.set(mutationType, nextCount);
    }
  }
  return mutationOptionsChanged;
}

function renderMutationTriageOptions() {
  const selected = bulkTriageFilters.mutation;
  const options = mutationTriageOptions(bulkMutationCounts, MUTATION_LABELS);
  bulkTriageMutation.innerHTML = [
    '<option value="">All mutations</option>',
    ...options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)} (${option.count})</option>`),
  ].join('');
  bulkTriageMutation.value = options.some((option) => option.value === selected) ? selected : '';
  bulkTriageFilters.mutation = bulkTriageMutation.value;
}

function renderBulkTriageControls({ mutationOptionsChanged = false } = {}) {
  if (mutationOptionsChanged) renderMutationTriageOptions();
  bulkTriageStateButtons.forEach((button) => {
    const state = button.dataset.bulkState || 'all';
    button.textContent = `${TRIAGE_STATE_LABELS[state] || state}: ${bulkTriageCounts[state] || 0}`;
    button.setAttribute('aria-pressed', String(bulkTriageFilters.state === state));
  });
  bulkTriageSignalButtons.forEach((button) => {
    const signal = button.dataset.bulkSignal || '';
    button.setAttribute('aria-pressed', String(bulkTriageFilters.signals.has(signal)));
  });
  bulkTriageClear.disabled = bulkTriageFilters.state === 'all'
    && !bulkTriageFilters.mutation
    && bulkTriageFilters.signals.size === 0;
  bulkTriageSummary.textContent = `${visibleBulkRows} of ${bulkTriageCounts.all} shown`;
}

function applyBulkTriageToAllRows() {
  visibleBulkRows = 0;
  /** @type {NodeListOf<HTMLTableRowElement>} */ (bulkResultsBody.querySelectorAll('tr[data-domain]')).forEach((tr) => {
    const record = getBulkResultByDomain(tr.dataset.domain || '');
    const visible = Boolean(record && matchesBulkTriage(record, bulkTriageFilters));
    tr.hidden = !visible;
    if (visible) visibleBulkRows += 1;
  });
  updateBulkSelectAllState();
}

function applyBulkTriageToRow(tr, record, isNew) {
  const wasVisible = !isNew && !tr.hidden;
  const visible = matchesBulkTriage(record, bulkTriageFilters);
  tr.hidden = !visible;
  if (isNew && visible) visibleBulkRows += 1;
  else if (!isNew && visible !== wasVisible) visibleBulkRows += visible ? 1 : -1;
}

function updateBulkSelectAllState() {
  const visibleCheckboxes = /** @type {HTMLInputElement[]} */ ([
    .../** @type {NodeListOf<HTMLInputElement>} */ (bulkResultsBody.querySelectorAll('tr[data-domain]:not([hidden]) input[type="checkbox"]')),
  ]);
  const selectedCount = visibleCheckboxes.filter((checkbox) => checkbox.checked).length;
  bulkSelectAll.checked = visibleCheckboxes.length > 0 && selectedCount === visibleCheckboxes.length;
  bulkSelectAll.indeterminate = selectedCount > 0 && selectedCount < visibleCheckboxes.length;
}

// Maps a raw /api/availability response into the flat row shape the bulk
// results table (and CSV export) expect.
function toBulkRecord(domain, body) {
  if (!body.applicable) {
    return withCandidateProvenance(domain, {
      domain,
      availability: 'error',
      availabilityDetail: 'Not a domain name (bulk lookup only supports domains, not IPs/ASNs)',
    });
  }
  const resolvedDomain = body.domain || domain;
  // Computed once here (not live at render time, unlike the Allowlisted
  // badge) so the risk score - read from this same record by scoring.js,
  // both for the table and CSV export - always matches what's displayed.
  // Never true for a domain the allowlist already covers - your own
  // official site trivially "matches" its own favicon, which isn't a
  // finding.
  const faviconHash = body.faviconHash ?? null;
  const notAllowlisted = !isDomainAllowlisted(resolvedDomain);
  const faviconMatch = notAllowlisted && isFaviconHashMatchingProfile(faviconHash);
  const reusesOfficialAssets = notAllowlisted && isReusingOfficialAssets(body.externalAssetHosts);

  return withCandidateProvenance(resolvedDomain, {
    domain: resolvedDomain,
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
    hasNullMx: body.hasNullMx ?? null,
    hasSpf: body.hasSpf ?? null,
    hasDmarc: body.hasDmarc ?? null,
    abuseEmail: body.abuse ? body.abuse.email : null,
    faviconMatch,
    faviconHash,
    pageTitle: body.pageTitle ?? null,
    hasPasswordField: body.hasPasswordField ?? null,
    phishingLanguageMatch: body.phishingLanguageMatch ?? null,
    reusesOfficialAssets,
  });
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

// Groups scanned domains that likely belong to the same registration/
// hosting campaign, using signals a scan already collects - no extra
// network calls. Nameserver matching requires the exact full nameserver
// set (not just one shared nameserver, which large registrars hand out to
// millions of unrelated domains and would be pure noise); a shared favicon
// hash between two *different* domains is a much stronger, rarer signal on
// its own, and catches a phishing ring even without a brand profile's
// official hash to compare against. A domain the active brand profile
// already allowlists is excluded - two of a brand's own legitimate domains
// sharing infrastructure isn't a finding.
function computeInfrastructureClusters(results) {
  const candidates = results.filter((r) => !isDomainAllowlisted(r.domain));
  const clusters = [];

  const byNameservers = new Map();
  for (const r of candidates) {
    if (!r.nameservers) continue;
    const key = r.nameservers.toLowerCase();
    if (!byNameservers.has(key)) byNameservers.set(key, []);
    byNameservers.get(key).push(r.domain);
  }
  for (const domains of byNameservers.values()) {
    if (domains.length >= 2) clusters.push({ type: 'Shared nameservers', domains });
  }

  const byFavicon = new Map();
  for (const r of candidates) {
    if (!r.faviconHash) continue;
    if (!byFavicon.has(r.faviconHash)) byFavicon.set(r.faviconHash, []);
    byFavicon.get(r.faviconHash).push(r.domain);
  }
  for (const domains of byFavicon.values()) {
    if (domains.length >= 2) clusters.push({ type: 'Shared favicon', domains });
  }

  return clusters;
}

// Rebuilt from scratch on every call (not appended) so a deep check that
// changes clustering - e.g. reveals a shared favicon fast mode couldn't see -
// doesn't leave stale badges from an earlier pass behind.
function injectClusterBadges(clusters) {
  bulkResultsBody.querySelectorAll('.cluster-flag').forEach((el) => el.remove());
  for (const cluster of clusters) {
    const siblingCount = cluster.domains.length - 1;
    const title = `${cluster.type} with ${siblingCount} other domain${siblingCount === 1 ? '' : 's'} in this scan`;
    for (const domain of cluster.domains) {
      const cell = bulkResultsBody.querySelector(`tr[data-domain="${CSS.escape(domain)}"] td.domain-cell`);
      if (!cell) continue;
      cell.insertAdjacentHTML(
        'beforeend',
        `<span class="watch-flag warn cluster-flag" title="${escapeHtml(title)}">${escapeHtml(cluster.type)}</span>`
      );
    }
  }
}

function renderInfrastructureClusters() {
  const clusters = computeInfrastructureClusters(bulkResults);
  injectClusterBadges(clusters);

  if (clusters.length === 0) {
    clusterPanel.style.display = 'none';
    clusterList.innerHTML = '';
    return;
  }

  clusterPanel.style.display = '';
  clusterList.innerHTML = clusters
    .map((cluster) => `
      <div style="margin-top: 10px;">
        <span class="signal-chip warn">${escapeHtml(cluster.type)}</span>
        <span class="bulk-label" style="display:inline; margin-left: 6px;">${cluster.domains.length} domains: ${escapeHtml(cluster.domains.join(', '))}</span>
        <button type="button" class="secondary cluster-load-btn" data-domains="${escapeHtml(cluster.domains.join(','))}" style="margin-left:8px; padding:2px 8px; font-size:0.72rem;">Load into query box</button>
      </div>
    `)
    .join('');
}

function coverageGroupRows(groups, dimension) {
  return groups.map((group) => {
    const groupId = `${dimension}:${group.key}`;
    coverageGroupDomains.set(groupId, group.actionableDomains);
    const disabled = group.actionableDomains.length === 0 ? ' disabled' : '';
    return `
      <tr>
        <td>${escapeHtml(group.label)}</td>
        <td>${group.total}</td>
        <td>${group.protected}</td>
        <td>${group.registered}</td>
        <td>${group.available}</td>
        <td>${group.unknown}</td>
        <td>${group.coveragePercent}%</td>
        <td><button type="button" class="secondary coverage-load-btn" data-coverage-group="${escapeHtml(groupId)}"${disabled}>Load gaps</button></td>
      </tr>`;
  }).join('');
}

function renderCoveragePlanner() {
  const generated = listCandidateProvenance();
  const allowlistedDomains = new Set(generated.filter((candidate) => isDomainAllowlisted(candidate.domain)).map((candidate) => candidate.domain));
  const report = buildCoverageReport(bulkResults, generated, allowlistedDomains, MUTATION_LABELS);
  lastCoverageReport = report;
  coverageGroupDomains.clear();

  if (report.summary.total === 0) {
    coveragePanel.style.display = 'none';
    coverageSummary.innerHTML = '';
    coverageMutationBody.innerHTML = '';
    coverageTldBody.innerHTML = '';
    return;
  }

  const summary = report.summary;
  coveragePanel.style.display = '';
  coverageSummary.innerHTML = [
    `<span class="signal-chip neutral">Generated: ${summary.total}</span>`,
    `<span class="signal-chip good">Protected: ${summary.protected}</span>`,
    `<span class="signal-chip danger">Registered: ${summary.registered}</span>`,
    `<span class="signal-chip warn">Available: ${summary.available}</span>`,
    `<span class="signal-chip neutral">Unknown: ${summary.unknown}</span>`,
    `<span class="signal-chip ${summary.coveragePercent >= 75 ? 'good' : summary.coveragePercent >= 40 ? 'warn' : 'danger'}">Coverage: ${summary.coveragePercent}%</span>`,
  ].join('');
  coverageMutationBody.innerHTML = coverageGroupRows(report.mutationGroups, 'mutation');
  coverageTldBody.innerHTML = coverageGroupRows(report.tldGroups, 'tld');
}

function exportCoverageCsv() {
  if (!lastCoverageReport || lastCoverageReport.summary.total === 0) return;
  const headers = ['Dimension', 'Group', 'Total', 'Protected', 'Registered', 'Available', 'Unknown', 'Coverage %'];
  const groupRows = (dimension, groups) => groups.map((group) => [
    dimension,
    group.label,
    group.total,
    group.protected,
    group.registered,
    group.available,
    group.unknown,
    group.coveragePercent,
  ]);
  const rows = [
    ...groupRows('Mutation family', lastCoverageReport.mutationGroups),
    ...groupRows('TLD', lastCoverageReport.tldGroups),
  ];
  const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(',')).join('\r\n');
  downloadBlob(csv, `defensive-registration-coverage-${Date.now()}.csv`, 'text/csv;charset=utf-8;');
}

function updateDeepCheckButton() {
  bulkDeepCheckBtn.disabled = bulkSelected.size === 0;
}

function exportCsv(records, filename) {
  if (records.length === 0) return;
  const headers = [
    'Domain',
    'Source Domain',
    'Mutation Types',
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
    'Null MX',
    'SPF Record',
    'DMARC Record',
    'Favicon Match',
    'Page Title',
    'Password Field',
    'Phishing Language Match',
    'Reuses Official Assets',
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
    r.sourceDomain,
    Array.isArray(r.mutationTypes) ? r.mutationTypes.map((type) => MUTATION_LABELS[type] || type).join('; ') : '',
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
    r.hasNullMx ? 'Yes' : '',
    r.hasSpf === true ? 'Yes' : r.hasSpf === false ? 'No' : '',
    r.hasDmarc === true ? 'Yes' : r.hasDmarc === false ? 'No' : '',
    r.faviconMatch ? 'Yes' : '',
    r.pageTitle,
    r.hasPasswordField ? 'Yes' : '',
    r.phishingLanguageMatch,
    r.reusesOfficialAssets ? 'Yes' : '',
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
  const mutationLabels = Array.isArray(r.mutationTypes)
    ? r.mutationTypes.map((type) => MUTATION_LABELS[type] || type)
    : [];
  const mutationCell = mutationLabels.length
    ? `<span class="signal-chip neutral" title="${escapeHtml(mutationLabels.join(', '))}">${escapeHtml(mutationLabels.length > 2 ? `${mutationLabels.slice(0, 2).join(', ')} +${mutationLabels.length - 2}` : mutationLabels.join(', '))}</span>`
    : '—';

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

  const allowlistFlag = isDomainAllowlisted(r.domain)
    ? `<span class="watch-flag good" title="Matches the active brand profile's official/partner/allowlisted domains">Allowlisted</span>`
    : '';
  const faviconFlag = r.faviconMatch
    ? `<span class="watch-flag danger" title="Serves the exact same favicon as your official domain - a strong sign of a cloned phishing page">Favicon match</span>`
    : '';
  const passwordFlag = r.hasPasswordField
    ? `<span class="watch-flag warn" title="Homepage HTML contains a password input field">Password field</span>`
    : '';
  const phishingLangFlag = r.phishingLanguageMatch
    ? `<span class="watch-flag danger" title="Homepage text matched: &quot;${escapeHtml(r.phishingLanguageMatch)}&quot;">Phishing language</span>`
    : '';
  const assetReuseFlag = r.reusesOfficialAssets
    ? `<span class="watch-flag danger" title="Loads an image, script, or stylesheet directly from your official domain">Reuses official assets</span>`
    : '';

  return `
    <td class="domain-cell">${star}${escapeHtml(r.domain)}${allowlistFlag}${faviconFlag}${passwordFlag}${phishingLangFlag}${assetReuseFlag}</td>
    <td>${mutationCell}</td>
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
    updateBulkSelectAllState();
  });
}

function getBulkResultByDomain(domain) {
  const idx = bulkResultsByDomain.get(domain);
  return idx === undefined ? undefined : bulkResults[idx];
}

// Used both for a fresh scan (every domain is new) and a deep-check
// follow-up (updates the existing row for a domain in place instead of
// adding a duplicate).
function upsertBulkRow(r) {
  const existingIdx = bulkResultsByDomain.get(r.domain);
  const previousRecord = existingIdx === undefined ? null : bulkResults[existingIdx];
  let mutationOptionsChanged = false;
  if (previousRecord) mutationOptionsChanged = adjustBulkTriageCounts(previousRecord, -1);
  if (existingIdx !== undefined) {
    bulkResults[existingIdx] = r;
  } else {
    bulkResultsByDomain.set(r.domain, bulkResults.length);
    bulkResults.push(r);
  }
  mutationOptionsChanged = adjustBulkTriageCounts(r, 1) || mutationOptionsChanged;

  const existingTr = bulkResultsBody.querySelector(`tr[data-domain="${CSS.escape(r.domain)}"]`);
  if (existingTr) {
    const checked = /** @type {HTMLInputElement | null} */ (existingTr.querySelector('input[type="checkbox"]'))?.checked;
    existingTr.innerHTML = `<td><input type="checkbox" ${checked ? 'checked' : ''}/></td>${bulkRowCellsHtml(r)}`;
    wireBulkRowCheckbox(existingTr, r.domain);
    applyBulkTriageToRow(existingTr, r, false);
    renderBulkTriageControls({ mutationOptionsChanged });
    return;
  }

  const tr = document.createElement('tr');
  tr.dataset.domain = r.domain;
  tr.innerHTML = `<td><input type="checkbox" /></td>${bulkRowCellsHtml(r)}`;
  wireBulkRowCheckbox(tr, r.domain);
  bulkResultsBody.appendChild(tr);
  applyBulkTriageToRow(tr, r, existingIdx === undefined);
  renderBulkTriageControls({ mutationOptionsChanged });
}

export function clearBulkResults() {
  bulkResultsBody.innerHTML = '';
  bulkResults = [];
  bulkResultsByDomain.clear();
  bulkSelected.clear();
  bulkSelectAll.checked = false;
  bulkSelectAll.indeterminate = false;
  resetBulkTriage();
  updateDeepCheckButton();
  bulkResultsWrap.classList.remove('visible');
  bulkProgressWrap.classList.remove('visible');
  bulkExportBtn.disabled = true;
  bulkDeepCheckBtn.style.display = 'none';
  bulkExportBtn.style.display = 'none';
  bulkDensityBtn.style.display = 'none';
  clusterPanel.style.display = 'none';
  clusterList.innerHTML = '';
  coveragePanel.style.display = 'none';
  coverageSummary.innerHTML = '';
  coverageMutationBody.innerHTML = '';
  coverageTldBody.innerHTML = '';
  lastCoverageReport = null;
  coverageGroupDomains.clear();
  // Registrant/abuse-contact data (WHOIS/RDAP personal data) pulled for
  // this table's rows - never cleared before, so it accumulated in memory
  // across every scan for the rest of the browser session. Safe to drop
  // here: the only caller of clearBulkResults() (main.js, right before a
  // single lookup) immediately repopulates its own single entry once that
  // lookup's own registrant/abuse data arrives.
  outreachRegistrantByDomain.clear();
  abuseRecordByDomain.clear();
}

bulkDensityBtn.addEventListener('click', () => {
  const nowCompact = bulkResultsWrap.classList.toggle('compact');
  bulkDensityBtn.textContent = nowCompact ? 'Comfortable rows' : 'Compact rows';
  bulkDensityBtn.setAttribute('aria-pressed', String(nowCompact));
});

bulkSelectAll.addEventListener('change', () => {
  bulkResultsBody.querySelectorAll('tr[data-domain]:not([hidden]) input[type="checkbox"]').forEach((cbEl) => {
    const cb = /** @type {HTMLInputElement} */ (cbEl);
    cb.checked = bulkSelectAll.checked;
    const domain = /** @type {HTMLElement | null} */ (cb.closest('tr'))?.dataset.domain;
    if (!domain) return;
    if (cb.checked) bulkSelected.add(domain);
    else bulkSelected.delete(domain);
  });
  updateDeepCheckButton();
  updateBulkSelectAllState();
});

bulkTriageStateButtons.forEach((button) => {
  button.addEventListener('click', () => {
    bulkTriageFilters.state = button.dataset.bulkState || 'all';
    applyBulkTriageToAllRows();
    renderBulkTriageControls();
  });
});

bulkTriageSignalButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const signal = button.dataset.bulkSignal || '';
    if (bulkTriageFilters.signals.has(signal)) bulkTriageFilters.signals.delete(signal);
    else bulkTriageFilters.signals.add(signal);
    applyBulkTriageToAllRows();
    renderBulkTriageControls();
  });
});

bulkTriageMutation.addEventListener('change', () => {
  bulkTriageFilters.mutation = bulkTriageMutation.value;
  applyBulkTriageToAllRows();
  renderBulkTriageControls();
});

bulkTriageClear.addEventListener('click', () => {
  bulkTriageFilters = { state: 'all', mutation: '', signals: new Set() };
  bulkTriageMutation.value = '';
  applyBulkTriageToAllRows();
  renderBulkTriageControls();
});

// Star/unstar a bulk row (shortlist toggle), and remove-from-shortlist
// clicks from the shortlist panel table (which needs to revert that row's
// star here if it's currently visible in the bulk results too).
document.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const starBtn = target.closest('.star-btn');
  if (starBtn instanceof HTMLElement) {
    const record = getBulkResultByDomain(starBtn.dataset.domain);
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
    const record = getBulkResultByDomain(removeDomain);
    if (tr && record) {
      const checked = /** @type {HTMLInputElement | null} */ (tr.querySelector('input[type="checkbox"]'))?.checked;
      tr.innerHTML = `<td><input type="checkbox" ${checked ? 'checked' : ''}/></td>${bulkRowCellsHtml(record)}`;
      wireBulkRowCheckbox(tr, record.domain);
    }
    return;
  }
  const clusterLoadBtn = target.closest('.cluster-load-btn');
  if (clusterLoadBtn instanceof HTMLElement) {
    const domains = (clusterLoadBtn.dataset.domains || '').split(',').filter(Boolean);
    if (domains.length) {
      const provenance = domains.map((domain) => getBulkResultByDomain(domain)).filter((record) => record?.mutationTypes?.length);
      fillQueryInputWithCandidates(domains, provenance);
    }
    return;
  }
  const coverageLoadBtn = target.closest('.coverage-load-btn');
  if (coverageLoadBtn instanceof HTMLElement) {
    const domains = coverageGroupDomains.get(coverageLoadBtn.dataset.coverageGroup || '') || [];
    if (domains.length) {
      const provenance = domains.map((domain) => getBulkResultByDomain(domain) || getCandidateProvenance(domain)).filter(Boolean);
      fillQueryInputWithCandidates(domains, provenance);
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
    bulkResultsByDomain.clear();
    bulkSelected.clear();
    bulkSelectAll.checked = false;
    bulkSelectAll.indeterminate = false;
    resetBulkTriage();
    updateDeepCheckButton();
    coveragePanel.style.display = 'none';
    lastCoverageReport = null;
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
  bulkTriage.hidden = false;
  renderBulkTriageControls();
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
      const res = await fetchWithRateLimitRetry(`/api/availability?q=${encodeURIComponent(domain)}${fast ? '&fast=1' : ''}`, signal);
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
      record = withCandidateProvenance(domain, { domain, availability: 'error', availabilityDetail: err.message });
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
    bulkStatus.textContent = `Done - ${total} domain${total === 1 ? '' : 's'} ${verb}.`;
    renderCoveragePlanner();
    renderInfrastructureClusters();
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
coverageExportBtn.addEventListener('click', exportCoverageCsv);

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
