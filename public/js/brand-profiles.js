// Local brand profiles - a browser-local record of a brand's official
// domains, products, approved partners, and allowlist, so the typosquat
// generator can prefill from a known identity instead of a bare keyword,
// and bulk/watchlist results can distinguish "this is our own domain" from
// "this is an unrecognized lookalike." Same localStorage + JSON import/
// export pattern as shortlist.js/watchlist.js - no backend, no database.

import { escapeHtml, downloadBlob, readFileAsText, runPool } from './utils.js';
import { showGate } from './auth.js';

const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `bp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Splits on commas and newlines, trims, drops empties/duplicates - shared
// parsing for every multi-value profile field (domain lists, product
// names, TLDs, registrars).
function parseListInput(raw) {
  return [...new Set(
    (raw || '')
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  )];
}

function normalizeProfile(raw) {
  return {
    id: raw.id || makeId(),
    name: (raw.name || '').trim(),
    officialDomains: Array.isArray(raw.officialDomains) ? raw.officialDomains : [],
    productNames: Array.isArray(raw.productNames) ? raw.productNames : [],
    tlds: Array.isArray(raw.tlds) ? raw.tlds : [],
    approvedPartnerDomains: Array.isArray(raw.approvedPartnerDomains) ? raw.approvedPartnerDomains : [],
    allowlistedDomains: Array.isArray(raw.allowlistedDomains) ? raw.allowlistedDomains : [],
    allowlistedRegistrars: Array.isArray(raw.allowlistedRegistrars) ? raw.allowlistedRegistrars : [],
    dkimSelectors: Array.isArray(raw.dkimSelectors) ? raw.dkimSelectors : [],
    trademarkOwner: raw.trademarkOwner || '',
    trademarkRegistration: raw.trademarkRegistration || '',
    officialFaviconHash: raw.officialFaviconHash || '',
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function loadBrandProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveBrandProfiles(list) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
  } catch {
    /* storage full/unavailable - profiles just won't persist this time */
  }
}

export function getActiveBrandProfileId() {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || '';
  } catch {
    return '';
  }
}

export function setActiveBrandProfileId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    else localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

export function getActiveBrandProfile() {
  const id = getActiveBrandProfileId();
  if (!id) return null;
  return loadBrandProfiles().find((p) => p.id === id) || null;
}

// Exact, case-insensitive hostname match against the active profile's
// official/partner/allowlisted domains - deliberately not a substring or
// suffix match, so e.g. "notacme.com" doesn't get allowlisted just because
// it contains "acme.com".
export function isDomainAllowlisted(domain) {
  const profile = getActiveBrandProfile();
  if (!profile || !domain) return false;
  const target = domain.trim().toLowerCase();
  const all = [...profile.officialDomains, ...profile.approvedPartnerDomains, ...profile.allowlistedDomains];
  return all.some((d) => d.toLowerCase() === target);
}

// A registered lookalike domain serving the exact same favicon bytes as the
// active profile's official site is a much stronger phishing signal than
// merely being active (see lib/favicon.js) - deliberately not applied to a
// domain already covered by isDomainAllowlisted() (your own official site
// obviously "matches" its own favicon; that's not a finding).
export function isFaviconHashMatchingProfile(hash) {
  const profile = getActiveBrandProfile();
  if (!profile || !hash || !profile.officialFaviconHash) return false;
  return profile.officialFaviconHash === hash;
}

// A registered lookalike whose page pulls a live resource (logo, CSS, JS -
// see lib/html-signals.js) straight from the active profile's own official
// domain is a common lazy-clone tell: it never bothered copying the asset,
// just hotlinked it. Same allowlist exclusion reasoning as
// isFaviconHashMatchingProfile() above.
export function isReusingOfficialAssets(externalAssetHosts) {
  const profile = getActiveBrandProfile();
  if (!profile || !Array.isArray(externalAssetHosts) || externalAssetHosts.length === 0) return false;
  const officialHosts = new Set(profile.officialDomains.map((d) => d.toLowerCase()));
  return externalAssetHosts.some((h) => officialHosts.has(h.toLowerCase()));
}

export function upsertBrandProfile(profile) {
  const list = loadBrandProfiles();
  const idx = list.findIndex((p) => p.id === profile.id);
  if (idx !== -1) list[idx] = profile;
  else list.push(profile);
  saveBrandProfiles(list);
  return profile;
}

export function deleteBrandProfile(id) {
  saveBrandProfiles(loadBrandProfiles().filter((p) => p.id !== id));
  if (getActiveBrandProfileId() === id) setActiveBrandProfileId('');
}

export function exportBrandProfilesJson() {
  downloadBlob(JSON.stringify(loadBrandProfiles(), null, 2), `brand-profiles-${Date.now()}.json`, 'application/json;charset=utf-8;');
}

// Merges by name (case-insensitive) rather than id, since ids are only
// meaningful within the browser that generated them - re-importing a
// backup on a different machine should update an existing same-named
// profile instead of creating a duplicate.
export function importBrandProfilesJson(parsed) {
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of brand profiles.');
  const list = loadBrandProfiles();
  const byName = new Map(list.map((p) => [p.name.toLowerCase(), p]));
  let added = 0;
  let updated = 0;
  for (const entry of parsed) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) continue;
    const key = entry.name.trim().toLowerCase();
    const existing = byName.get(key);
    const profile = normalizeProfile({ ...entry, id: existing ? existing.id : undefined, createdAt: existing?.createdAt });
    byName.set(key, profile);
    if (existing) updated += 1;
    else added += 1;
  }
  saveBrandProfiles([...byName.values()]);
  return { added, updated };
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

const profileCountEl = /** @type {HTMLElement} */ (document.getElementById('brand-profile-count'));
const profileSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('brand-profile-select'));
const profileEditBtn = /** @type {HTMLButtonElement} */ (document.getElementById('brand-profile-edit-btn'));
const profileDeleteBtn = /** @type {HTMLButtonElement} */ (document.getElementById('brand-profile-delete-btn'));
const profileAuditBtn = /** @type {HTMLButtonElement} */ (document.getElementById('brand-profile-audit-btn'));
const profileNewBtn = /** @type {HTMLButtonElement} */ (document.getElementById('brand-profile-new-btn'));
const profileExportJsonBtn = /** @type {HTMLButtonElement} */ (document.getElementById('brand-profile-export-json-btn'));
const profileImportInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-import-file'));
const profileStatusEl = /** @type {HTMLElement} */ (document.getElementById('brand-profile-status'));
const postureResultsEl = /** @type {HTMLElement} */ (document.getElementById('brand-posture-results'));

const profileFormEl = /** @type {HTMLElement} */ (document.getElementById('brand-profile-form'));
const profileSaveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('brand-profile-save-btn'));
const profileCancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById('brand-profile-cancel-btn'));
const nameInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-name'));
const tldsInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-tlds'));
const officialDomainsInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('brand-profile-official-domains'));
const productNamesInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-product-names'));
const partnerDomainsInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('brand-profile-partner-domains'));
const allowlistDomainsInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('brand-profile-allowlist-domains'));
const allowlistRegistrarsInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-allowlist-registrars'));
const dkimSelectorsInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-dkim-selectors'));
const trademarkOwnerInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-trademark-owner'));
const trademarkRegInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-trademark-number'));
const faviconHashInput = /** @type {HTMLInputElement} */ (document.getElementById('brand-profile-favicon-hash'));
const faviconHashDisplay = /** @type {HTMLElement} */ (document.getElementById('brand-profile-favicon-hash-display'));
const faviconFetchBtn = /** @type {HTMLButtonElement} */ (document.getElementById('brand-profile-favicon-fetch-btn'));

let editingId = null; // null = "New profile" mode, an id string = editing that profile
const MAX_POSTURE_DOMAINS = 20;
const POSTURE_CONCURRENCY = 3;

function selectedProfile() {
  return loadBrandProfiles().find((profile) => profile.id === profileSelectEl.value) || null;
}

function updateProfileActionState() {
  const profile = selectedProfile();
  const hasSelection = Boolean(profile);
  profileEditBtn.disabled = !hasSelection;
  profileDeleteBtn.disabled = !hasSelection;
  profileAuditBtn.disabled = !profile || profile.officialDomains.length === 0;
}

function clearPostureResults() {
  postureResultsEl.hidden = true;
  postureResultsEl.innerHTML = '';
}

function renderBrandProfilesPanel() {
  const list = loadBrandProfiles();
  profileCountEl.textContent = `${list.length} saved`;

  const activeId = getActiveBrandProfileId();
  const activeStillExists = list.some((p) => p.id === activeId);
  if (activeId && !activeStillExists) setActiveBrandProfileId('');

  profileSelectEl.innerHTML = '<option value="">None</option>'
    + list.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  profileSelectEl.value = activeStillExists ? activeId : '';

  updateProfileActionState();
}

function showForm(profile) {
  editingId = profile ? profile.id : null;
  nameInput.value = profile?.name || '';
  tldsInput.value = (profile?.tlds || []).join(', ');
  officialDomainsInput.value = (profile?.officialDomains || []).join('\n');
  productNamesInput.value = (profile?.productNames || []).join(', ');
  partnerDomainsInput.value = (profile?.approvedPartnerDomains || []).join('\n');
  allowlistDomainsInput.value = (profile?.allowlistedDomains || []).join('\n');
  allowlistRegistrarsInput.value = (profile?.allowlistedRegistrars || []).join(', ');
  dkimSelectorsInput.value = (profile?.dkimSelectors || []).join(', ');
  trademarkOwnerInput.value = profile?.trademarkOwner || '';
  trademarkRegInput.value = profile?.trademarkRegistration || '';
  faviconHashInput.value = profile?.officialFaviconHash || '';
  faviconHashDisplay.textContent = profile?.officialFaviconHash
    ? `${profile.officialFaviconHash.slice(0, 16)}…`
    : 'Not fetched';
  profileFormEl.style.display = 'block';
  nameInput.focus();
}

function hideForm() {
  profileFormEl.style.display = 'none';
  editingId = null;
}

faviconFetchBtn.addEventListener('click', async () => {
  const officialDomain = parseListInput(officialDomainsInput.value)[0];
  if (!officialDomain) {
    profileStatusEl.innerHTML = '<span class="error-text">Enter at least one official domain first.</span>';
    return;
  }
  faviconFetchBtn.disabled = true;
  faviconHashDisplay.textContent = 'Fetching…';
  try {
    const res = await fetch(`/api/availability?q=${encodeURIComponent(officialDomain)}`);
    if (res.status === 401) {
      showGate();
      return;
    }
    const body = await res.json();
    if (body.faviconHash) {
      faviconHashInput.value = body.faviconHash;
      faviconHashDisplay.textContent = `${body.faviconHash.slice(0, 16)}… (from ${officialDomain}/favicon.ico)`;
    } else {
      faviconHashInput.value = '';
      faviconHashDisplay.textContent = `No favicon found at ${officialDomain}/favicon.ico`;
    }
  } catch {
    faviconHashDisplay.textContent = 'Fetch failed - try again.';
  } finally {
    faviconFetchBtn.disabled = false;
  }
});

profileNewBtn.addEventListener('click', () => showForm(null));

profileEditBtn.addEventListener('click', () => {
  const profile = loadBrandProfiles().find((p) => p.id === profileSelectEl.value);
  if (profile) showForm(profile);
});

profileCancelBtn.addEventListener('click', hideForm);

profileDeleteBtn.addEventListener('click', () => {
  const id = profileSelectEl.value;
  const profile = loadBrandProfiles().find((p) => p.id === id);
  if (!profile) return;
  if (!window.confirm(`Delete the brand profile "${profile.name}"? This cannot be undone.`)) return;
  deleteBrandProfile(id);
  renderBrandProfilesPanel();
  clearPostureResults();
  profileStatusEl.textContent = `Deleted "${profile.name}".`;
});

profileSaveBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    profileStatusEl.innerHTML = '<span class="error-text">Enter a brand name.</span>';
    return;
  }
  const existing = editingId ? loadBrandProfiles().find((p) => p.id === editingId) : null;
  const profile = normalizeProfile({
    id: editingId || undefined,
    name,
    officialDomains: parseListInput(officialDomainsInput.value).map((d) => d.toLowerCase()),
    productNames: parseListInput(productNamesInput.value),
    tlds: parseListInput(tldsInput.value).map((t) => t.toLowerCase().replace(/^\./, '')),
    approvedPartnerDomains: parseListInput(partnerDomainsInput.value).map((d) => d.toLowerCase()),
    allowlistedDomains: parseListInput(allowlistDomainsInput.value).map((d) => d.toLowerCase()),
    allowlistedRegistrars: parseListInput(allowlistRegistrarsInput.value),
    dkimSelectors: parseListInput(dkimSelectorsInput.value).map((selector) => selector.toLowerCase()),
    trademarkOwner: trademarkOwnerInput.value.trim(),
    trademarkRegistration: trademarkRegInput.value.trim(),
    officialFaviconHash: faviconHashInput.value.trim(),
    createdAt: existing?.createdAt,
  });
  upsertBrandProfile(profile);
  setActiveBrandProfileId(profile.id);
  renderBrandProfilesPanel();
  profileSelectEl.value = profile.id;
  hideForm();
  clearPostureResults();
  profileStatusEl.textContent = `Saved "${profile.name}" and set it as the active profile.`;
});

profileSelectEl.addEventListener('change', () => {
  setActiveBrandProfileId(profileSelectEl.value);
  updateProfileActionState();
  clearPostureResults();
});

function postureStatusLabel(status) {
  return { pass: 'Pass', warning: 'Review', danger: 'Action', info: 'Info' }[status] || status;
}

function renderPostureReport(report) {
  const countParts = [
    report.summary.danger ? `${report.summary.danger} action` : '',
    report.summary.warning ? `${report.summary.warning} review` : '',
    report.summary.pass ? `${report.summary.pass} pass` : '',
    report.summary.info ? `${report.summary.info} info` : '',
  ].filter(Boolean);
  const checks = report.checks.map((item) => {
    const records = item.records.length
      ? `<details class="posture-records"><summary>Source records (${item.records.length})</summary><pre>${escapeHtml(item.records.join('\n'))}</pre></details>`
      : '';
    const detail = item.detail ? `<p class="posture-detail">${escapeHtml(item.detail)}</p>` : '';
    const remediation = item.remediation
      ? `<p class="posture-remediation"><strong>Next:</strong> ${escapeHtml(item.remediation)}</p>`
      : '';
    return `
      <article class="posture-check ${escapeHtml(item.status)}">
        <div class="posture-check-heading">
          <h4>${escapeHtml(item.label)}</h4>
          <span class="signal-chip ${item.status === 'pass' ? 'good' : item.status === 'danger' ? 'danger' : item.status === 'warning' ? 'warn' : 'neutral'}">${escapeHtml(postureStatusLabel(item.status))}</span>
        </div>
        <p class="posture-summary">${escapeHtml(item.summary)}</p>
        ${detail}${records}${remediation}
      </article>`;
  }).join('');

  return `
    <section class="posture-domain-result">
      <div class="posture-domain-heading">
        <div><span class="section-title">Official domain posture</span><h3>${escapeHtml(report.domain)}</h3></div>
        <span class="posture-counts">${escapeHtml(countParts.join(' · '))}</span>
      </div>
      <div class="posture-check-grid">${checks}</div>
    </section>`;
}

async function fetchPostureReport(domain, selectors) {
  const params = new URLSearchParams({ q: domain });
  if (selectors.length) params.set('selectors', selectors.join(','));
  const res = await fetch(`/api/domain-posture?${params.toString()}`);
  if (res.status === 401) {
    showGate();
    throw new Error('Authentication required');
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Audit failed (${res.status})`);
  return body;
}

async function auditProfileDomains(domains, selectors) {
  const results = new Array(domains.length);
  await runPool(domains, POSTURE_CONCURRENCY, async (domain, index) => {
    try {
      results[index] = { report: await fetchPostureReport(domain, selectors), error: null };
    } catch (err) {
      results[index] = { report: null, error: err.message || String(err), domain };
    }
  });
  return results;
}

profileAuditBtn.addEventListener('click', async () => {
  const profile = selectedProfile();
  if (!profile || profile.officialDomains.length === 0) return;
  const domains = profile.officialDomains.slice(0, MAX_POSTURE_DOMAINS);
  profileAuditBtn.disabled = true;
  const originalText = profileAuditBtn.textContent;
  profileAuditBtn.textContent = `Auditing ${domains.length}…`;
  profileStatusEl.textContent = `Auditing ${domains.length} official domain${domains.length === 1 ? '' : 's'}…`;
  postureResultsEl.hidden = false;
  postureResultsEl.innerHTML = '<div class="posture-loading">Checking DNS, registry, and mail transport policies…</div>';
  try {
    const results = await auditProfileDomains(domains, profile.dkimSelectors || []);
    // The profile selector remains usable while network checks run. If the
    // user moved to another profile, do not paint the completed results under
    // that different profile's controls.
    if (profileSelectEl.value !== profile.id) return;
    const completed = results.filter((result) => result.report).length;
    const failures = results.length - completed;
    postureResultsEl.innerHTML = results.map((result) => result.report
      ? renderPostureReport(result.report)
      : `<section class="posture-domain-result"><h3>${escapeHtml(result.domain)}</h3><p class="error-text">${escapeHtml(result.error)}</p></section>`).join('');
    const truncated = profile.officialDomains.length - domains.length;
    profileStatusEl.textContent = `Audited ${completed}/${domains.length} official domains${failures ? `; ${failures} failed` : ''}${truncated ? `; ${truncated} skipped (limit ${MAX_POSTURE_DOMAINS})` : ''}.`;
  } finally {
    profileAuditBtn.textContent = originalText;
    updateProfileActionState();
  }
});

profileExportJsonBtn.addEventListener('click', () => {
  if (loadBrandProfiles().length === 0) return;
  exportBrandProfilesJson();
});

profileImportInput.addEventListener('change', async () => {
  const file = profileImportInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await readFileAsText(file));
    const { added, updated } = importBrandProfilesJson(parsed);
    renderBrandProfilesPanel();
    clearPostureResults();
    profileStatusEl.textContent = `Imported ${file.name}: ${added} added, ${updated} updated.`;
  } catch (err) {
    profileStatusEl.innerHTML = `<span class="error-text">Could not import brand profiles: ${escapeHtml(err.message)}</span>`;
  } finally {
    profileImportInput.value = '';
  }
});

renderBrandProfilesPanel();
