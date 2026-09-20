<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';
  import BrandIdentityReferencesEditor from './BrandIdentityReferencesEditor.svelte';

  type Field = 'name'|'official'|'products'|'tlds'|'partners'|'selectors'|'retiredSelectors'|'mailProtectionProfile'|'trademarkOwner'|'trademarkRegistration'|'faviconHash';
  type Values = Record<Field, string>;

  let { editing, values, setValue, officialChannels, rightsReferences, setOfficialChannels, setRightsReferences, pageBaseline, capturingIdentity, busy, saveDisabled=false, orphaned=false, disabledReason, captureSiteIdentity, save, close, formatDate }: {
    editing: boolean;
    values: Values;
    setValue: (field: Field, value: string) => void;
    officialChannels: BrandProfile['officialChannels'];
    rightsReferences: BrandProfile['rightsReferences'];
    setOfficialChannels: (value: BrandProfile['officialChannels']) => void;
    setRightsReferences: (value: BrandProfile['rightsReferences']) => void;
    pageBaseline: BrandProfile['pageBaseline'];
    capturingIdentity: boolean;
    busy: boolean;
    saveDisabled?: boolean;
    orphaned?: boolean;
    disabledReason: string;
    captureSiteIdentity: () => void | Promise<void>;
    save: () => void | Promise<void>;
    close: () => void;
    formatDate: (value: string) => string;
  } = $props();
</script>

<form class="form card" aria-label="Brand Profile" aria-busy={busy} novalidate onsubmit={(event) => { event.preventDefault(); if (!busy && !saveDisabled) void save(); }}>
  <header class="section-head">
    <h2>{editing ? 'Edit profile' : 'New profile'}</h2>
    <button class="btn" type="button" disabled={busy} onclick={close}>Close</button>
  </header>
  <div class="profile-identity">
    <label class="field">Brand name
      <input id="brand-profile-name" value={values.name} oninput={(event) => setValue('name', event.currentTarget.value)}>
    </label>
    <label class="field">Official domains
      <textarea id="official-domains" value={values.official} oninput={(event) => setValue('official', event.currentTarget.value)}></textarea>
    </label>
  </div>

  <details class="profile-options">
    <summary>Matching and mail settings</summary>
    <div class="form-grid">
      <label class="field">Preferred TLDs<input value={values.tlds} oninput={(event) => setValue('tlds', event.currentTarget.value)}></label>
      <label class="field">Product names<input value={values.products} oninput={(event) => setValue('products', event.currentTarget.value)}></label>
      <label class="field wide">Approved partner domains<textarea value={values.partners} oninput={(event) => setValue('partners', event.currentTarget.value)}></textarea></label>
      <label class="field">Mail posture profile
        <select value={values.mailProtectionProfile} onchange={(event) => setValue('mailProtectionProfile', event.currentTarget.value)}>
          <option value="standard">Active mail</option><option value="defensive_no_mail">Defensive, no mail</option><option value="parked">Parked domain</option>
        </select>
      </label>
      <label class="field">Active DKIM selectors<input value={values.selectors} oninput={(event) => setValue('selectors', event.currentTarget.value)}></label>
      <label class="field">Retired DKIM selectors
        <input value={values.retiredSelectors} oninput={(event) => setValue('retiredSelectors', event.currentTarget.value)}>
        <small>Checked for continued publication, not treated as active keys.</small>
      </label>
    </div>
  </details>
  <details class="profile-options">
    <summary>Rights and official channels</summary>
    <div class="form-grid">
      <label class="field">Trademark owner<input value={values.trademarkOwner} oninput={(event) => setValue('trademarkOwner', event.currentTarget.value)}></label>
      <label class="field">Trademark registration<input value={values.trademarkRegistration} oninput={(event) => setValue('trademarkRegistration', event.currentTarget.value)}></label>
      <BrandIdentityReferencesEditor {officialChannels} {rightsReferences} disabled={busy} onOfficialChannelsChange={setOfficialChannels} onRightsReferencesChange={setRightsReferences}/>
    </div>
  </details>
  <details class="profile-options">
    <summary>Official-site identity</summary>
    <div class="identity-capture">
      <p>Capture a comparison baseline from the first official domain. The profile stores fingerprints and metadata, not page HTML.</p>
      {#if disabledReason}<p class="feature-disabled" role="note">{disabledReason}</p>{/if}
      <div class="identity-actions">
        <button class="btn" type="button" onclick={captureSiteIdentity} disabled={busy || saveDisabled || capturingIdentity || Boolean(disabledReason)}>{capturingIdentity ? 'Capturing…' : pageBaseline ? 'Update official-site baseline' : 'Capture official-site baseline'}</button>
        {#if pageBaseline}<span>{pageBaseline.domain} · {pageBaseline.complete ? 'Complete' : 'Partial'} · {formatDate(pageBaseline.observedAt)}</span>{:else}<span>Not captured</span>{/if}
      </div>
      <label class="field">Official favicon hash<input value={values.faviconHash} readonly placeholder="Not captured"></label>
      {#if pageBaseline}
        <dl class="baseline-summary stat-grid">
          <div><dt>Page title</dt><dd>{pageBaseline.pageTitle || 'Not observed'}</dd></div>
          <div><dt>Canonical host</dt><dd>{pageBaseline.canonicalHost || 'Not observed'}</dd></div>
          <div><dt>Page fingerprints</dt><dd>{2 + (pageBaseline.visibleText ? 1 : 0) + (pageBaseline.formStructure ? 1 : 0)} components</dd></div>
          <div><dt>External hosts / tracking IDs</dt><dd>{pageBaseline.resourceHosts.values.length} / {pageBaseline.trackingIdentifiers.values.length}</dd></div>
        </dl>
      {/if}
    </div>
  </details>
  {#if orphaned}<p class="draft-status">The saved profile was deleted. This draft can be saved under a new identity; references to the deleted profile are not reassigned.</p>{/if}
  <footer class="toolbar">
    <button class="primary" type="submit" disabled={busy || saveDisabled}>{busy ? 'Saving…' : orphaned ? 'Save as new profile' : 'Save profile'}</button>
    <button class="btn" type="button" disabled={busy} onclick={close}>Cancel</button>
  </footer>
</form>

<style>
  #official-domains{scroll-margin-top:88px}
  .form{margin-top:16px;padding:var(--card-pad)}
  .form h2{margin:0}
  .profile-identity{display:grid;gap:12px;max-width:70ch;margin:18px 0}
  .profile-identity textarea{min-height:82px}
  .profile-options{margin:0;border-top:1px solid var(--border)}
  .profile-options>summary{padding:12px 0;cursor:pointer;font:650 var(--text-sm) var(--mono)}
  .form footer{margin-top:18px}
  .draft-status{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}
  .form-grid textarea{min-height:82px;background:rgb(var(--bg-rgb) / .78)}
  .form-grid small{display:block;margin-top:5px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .wide{grid-column:span 2}
  .identity-capture{min-width:0;max-width:80ch;margin:4px 0 14px}
  .identity-capture>p{margin:0 0 12px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .identity-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .identity-actions span{min-width:0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .baseline-summary{margin:12px 0 0}
  .baseline-summary dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .baseline-summary dd{margin:5px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  @media(max-width:750px){.form-grid{grid-template-columns:1fr}.wide{grid-column:auto}.identity-actions{align-items:stretch;flex-direction:column}.identity-actions button{width:100%}}
</style>
