<script lang="ts">
  import { tick } from 'svelte';
  import type { BrandProfile, BrandProfileSaveResult } from '$lib/brand-profiles';
  import { addBrandAllowlistValues, MAX_ALLOWLIST_DRAFT_CHARACTERS, MAX_PROFILE_VALUES } from '$lib/analysis/brand-profile-model.ts';
  import { restoreSubmittedFocus } from '$lib/controllers/submitted-draft';

  let {
    profile,
    onsave,
    onmessage,
    writeDisabled = false,
  }: {
    profile: BrandProfile;
    onsave: (expected: BrandProfile, allowlistedDomains: string[], allowlistedRegistrars: string[]) => Promise<BrandProfileSaveResult>;
    onmessage: (message: string) => void;
    writeDisabled?: boolean;
  } = $props();

  let domains = $state<string[]>([]);
  let registrars = $state<string[]>([]);
  let domainInput = $state('');
  let registrarInput = $state('');
  let dirty = $state(false);
  let busy = $state(false);
  let syncedFingerprint = $state('');
  let base = $state.raw<BrandProfile | null>(null);
  let componentRoot = $state<HTMLElement>();

  const profileFingerprint = $derived(JSON.stringify([
    profile.id,
    profile.allowlistedDomains,
    profile.allowlistedRegistrars,
  ]));
  const overlapDomains = $derived(domains.filter((domain) => (
    profile.officialDomains.includes(domain) || profile.approvedPartnerDomains.includes(domain)
  )));

  $effect(() => {
    const next = profileFingerprint;
    if (busy || writeDisabled || dirty || domainInput || registrarInput || next === syncedFingerprint) return;
    base = $state.snapshot(profile);
    domains = [...profile.allowlistedDomains];
    registrars = [...profile.allowlistedRegistrars];
    domainInput = '';
    registrarInput = '';
    dirty = false;
    syncedFingerprint = next;
  });

  function addDomains() {
    if (busy) return;
    try {
      domains = addBrandAllowlistValues(profile, 'domains', domains, domainInput);
      domainInput = '';
      dirty = true;
    } catch (cause) { onmessage(cause instanceof Error ? cause.message : 'The domain entries could not be added.'); }
  }

  function addRegistrars() {
    if (busy) return;
    try {
      registrars = addBrandAllowlistValues(profile, 'registrars', registrars, registrarInput);
      registrarInput = '';
      dirty = true;
    } catch (cause) { onmessage(cause instanceof Error ? cause.message : 'The registrar entries could not be added.'); }
  }

  function removeDomain(domain: string) {
    domains = domains.filter((value) => value !== domain);
    dirty = true;
  }

  function removeRegistrar(registrar: string) {
    registrars = registrars.filter((value) => value !== registrar);
    dirty = true;
  }

  function discard() {
    base = $state.snapshot(profile);
    domains = [...profile.allowlistedDomains];
    registrars = [...profile.allowlistedRegistrars];
    domainInput = '';
    registrarInput = '';
    dirty = false;
    syncedFingerprint = profileFingerprint;
    onmessage(`Discarded unsaved allowlist changes for ${profile.name}.`);
  }

  async function save() {
    if (!dirty || busy || writeDisabled || !base) return;
    const origin = document.activeElement;
    const submittedDomains = [...domains];
    const submittedRegistrars = [...registrars];
    busy = true;
    try {
      const result = await onsave(base, submittedDomains, submittedRegistrars);
      if (result.committed) {
        base = result.profile;
        syncedFingerprint = JSON.stringify([base.id, base.allowlistedDomains, base.allowlistedRegistrars]);
        dirty = JSON.stringify(domains) !== JSON.stringify(base.allowlistedDomains)
          || JSON.stringify(registrars) !== JSON.stringify(base.allowlistedRegistrars);
      }
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'The allowlist could not be saved.');
    } finally {
      busy = false;
      await tick();
      restoreSubmittedFocus(origin, componentRoot?.querySelector<HTMLTextAreaElement>('textarea'), componentRoot);
    }
  }
</script>

<section class="allowlist card" bind:this={componentRoot} aria-labelledby={`brand-allowlist-title-${profile.id}`} aria-busy={busy}>
  <header>
    <div>
      <p class="eyebrow">Brand Profile</p>
      <h2 id={`brand-allowlist-title-${profile.id}`}>Allowlist</h2>
      <p>Exclude reviewed domains and registrars from Brand candidate escalation. Official and trusted domains remain separate profile facts.</p>
    </div>
    <span>{domains.length} domain{domains.length === 1 ? '' : 's'} · {registrars.length} registrar{registrars.length === 1 ? '' : 's'}</span>
  </header>

  {#if overlapDomains.length}
    <p class="overlap" role="status">{overlapDomains.length} existing allowlisted domain{overlapDomains.length === 1 ? '' : 's'} also appear as official or trusted. Remove the duplicate allowlist entries when convenient.</p>
  {/if}

  <div class="columns">
    <section aria-labelledby={`allowlisted-domains-title-${profile.id}`}>
      <div class="section-heading"><h3 id={`allowlisted-domains-title-${profile.id}`}>Domains</h3><span>{domains.length}/{MAX_PROFILE_VALUES}</span></div>
      <form onsubmit={(event) => { event.preventDefault(); addDomains(); }}>
        <label class="field">Add domains <small>one per line or comma separated</small><textarea bind:value={domainInput} rows="2" maxlength={MAX_ALLOWLIST_DRAFT_CHARACTERS} placeholder="reviewed.example"></textarea></label>
        <button class="btn" type="submit" disabled={busy || !domainInput.trim()}>Add</button>
      </form>
      {#if domains.length}
        <ul>{#each domains as domain}<li><code>{domain}</code><button class="btn small" type="button" disabled={busy} aria-label={`Remove ${domain} from the domain allowlist`} onclick={() => removeDomain(domain)}>Remove</button></li>{/each}</ul>
      {:else}<p class="empty">No domains are allowlisted.</p>{/if}
    </section>

    <section aria-labelledby={`allowlisted-registrars-title-${profile.id}`}>
      <div class="section-heading"><h3 id={`allowlisted-registrars-title-${profile.id}`}>Registrars</h3><span>{registrars.length}/{MAX_PROFILE_VALUES}</span></div>
      <form onsubmit={(event) => { event.preventDefault(); addRegistrars(); }}>
        <label class="field">Add registrar names <small>one per line or comma separated</small><textarea bind:value={registrarInput} rows="2" maxlength={MAX_ALLOWLIST_DRAFT_CHARACTERS} placeholder="Reviewed Registrar"></textarea></label>
        <button class="btn" type="submit" disabled={busy || !registrarInput.trim()}>Add</button>
      </form>
      {#if registrars.length}
        <ul>{#each registrars as registrar}<li><span>{registrar}</span><button class="btn small" type="button" disabled={busy} aria-label={`Remove ${registrar} from the registrar allowlist`} onclick={() => removeRegistrar(registrar)}>Remove</button></li>{/each}</ul>
      {:else}<p class="empty">No registrars are allowlisted.</p>{/if}
    </section>
  </div>

  <footer>
    <span>{dirty ? 'Unsaved allowlist changes' : domainInput || registrarInput ? 'Entered text has not been added to the list' : writeDisabled ? 'Saved profile is not ready' : 'Saved in this workspace'}</span>
    <div><button class="btn" type="button" disabled={busy || writeDisabled || (!dirty && !domainInput && !registrarInput)} onclick={discard}>Discard</button><button class="primary" type="button" disabled={busy || writeDisabled || !dirty} onclick={() => void save()}>{busy ? 'Saving…' : 'Save allowlist'}</button></div>
  </footer>
</section>

<style>
  .allowlist{display:grid;gap:15px;margin-top:20px;padding:var(--card-pad)}
  .allowlist>header,.section-heading,.allowlist>footer{display:flex;min-width:0;align-items:flex-start;justify-content:space-between;gap:12px}
  .allowlist h2{margin:3px 0 0;font:700 var(--text-lg) var(--mono)}
  .allowlist>header p:not(.eyebrow){max-width:72ch;margin:7px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .allowlist>header>span,.section-heading>span,.allowlist>footer>span{flex:none;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .columns>section{display:grid;min-width:0;align-content:start;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .section-heading{align-items:baseline}.section-heading h3{margin:0;font:700 var(--text-sm) var(--mono)}
  form{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px}textarea{width:100%;margin-top:5px;resize:vertical}.field small{color:var(--muted)}
  ul{display:grid;gap:5px;margin:0;padding:0;list-style:none}li{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}li code,li span{min-width:0;font-size:var(--text-2xs);overflow-wrap:anywhere}
  .empty{margin:0;color:var(--muted);font-size:var(--text-xs)}.overlap{margin:0;padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-xs)}
  .allowlist>footer{align-items:center;padding-top:3px}.allowlist>footer>div{display:flex;gap:7px}
  @media(max-width:850px){.columns{grid-template-columns:1fr}}
  @media(max-width:560px){.allowlist>header,.allowlist>footer{align-items:stretch;flex-direction:column}form{grid-template-columns:1fr}form button,.allowlist>footer>div,.allowlist>footer button{width:100%}.allowlist>footer>div{display:grid;grid-template-columns:1fr 1fr}}
</style>
