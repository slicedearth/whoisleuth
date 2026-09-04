<script lang="ts">
  import { normalizeProfile, type BrandProfile } from '$lib/brand-profiles';
  import { MAX_PROFILE_VALUES } from '$lib/analysis/brand-profile-model.ts';

  let {
    profile,
    onsave,
    onmessage,
  }: {
    profile: BrandProfile;
    onsave: (allowlistedDomains: string[], allowlistedRegistrars: string[]) => boolean | Promise<boolean>;
    onmessage: (message: string) => void;
  } = $props();

  let domains = $state<string[]>([]);
  let registrars = $state<string[]>([]);
  let domainInput = $state('');
  let registrarInput = $state('');
  let dirty = $state(false);
  let busy = $state(false);
  let syncedFingerprint = $state('');

  const profileFingerprint = $derived(JSON.stringify([
    profile.id,
    profile.updatedAt,
    profile.allowlistedDomains,
    profile.allowlistedRegistrars,
  ]));
  const overlapDomains = $derived(domains.filter((domain) => (
    profile.officialDomains.includes(domain) || profile.approvedPartnerDomains.includes(domain)
  )));

  $effect(() => {
    const next = profileFingerprint;
    if (busy || (dirty && syncedFingerprint.startsWith(`${profile.id}:`))) return;
    domains = [...profile.allowlistedDomains];
    registrars = [...profile.allowlistedRegistrars];
    domainInput = '';
    registrarInput = '';
    dirty = false;
    syncedFingerprint = `${profile.id}:${next}`;
  });

  function normalisedDomains(raw: string): string[] {
    return normalizeProfile({
      ...profile,
      allowlistedDomains: raw.split(/[\n,]+/u),
    }, profile).allowlistedDomains;
  }

  function normalisedRegistrars(raw: string): string[] {
    return normalizeProfile({
      ...profile,
      allowlistedRegistrars: raw.split(/[\n,]+/u),
    }, profile).allowlistedRegistrars;
  }

  function addDomains() {
    const candidates = normalisedDomains(domainInput);
    const existing = new Set(domains);
    const additions = candidates.filter((domain) => (
      !existing.has(domain)
      && !profile.officialDomains.includes(domain)
      && !profile.approvedPartnerDomains.includes(domain)
    ));
    if (!additions.length) {
      onmessage('Enter a valid domain that is not already official, trusted or allowlisted.');
      return;
    }
    domains = [...domains, ...additions].slice(0, MAX_PROFILE_VALUES);
    domainInput = '';
    dirty = true;
  }

  function addRegistrars() {
    const existing = new Set(registrars.map((value) => value.toLowerCase()));
    const additions = normalisedRegistrars(registrarInput)
      .filter((value) => !existing.has(value.toLowerCase()));
    if (!additions.length) {
      onmessage('Enter a registrar name that is not already allowlisted.');
      return;
    }
    registrars = [...registrars, ...additions].slice(0, MAX_PROFILE_VALUES);
    registrarInput = '';
    dirty = true;
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
    domains = [...profile.allowlistedDomains];
    registrars = [...profile.allowlistedRegistrars];
    domainInput = '';
    registrarInput = '';
    dirty = false;
    onmessage(`Discarded unsaved allowlist changes for ${profile.name}.`);
  }

  async function save() {
    if (!dirty || busy) return;
    busy = true;
    try {
      if (await onsave(domains, registrars)) dirty = false;
    } finally {
      busy = false;
    }
  }
</script>

<section class="allowlist card" aria-labelledby={`brand-allowlist-title-${profile.id}`} aria-busy={busy}>
  <header>
    <div>
      <p class="eyebrow">Active Brand Profile</p>
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
        <label class="field">Add domains <small>one per line or comma separated</small><textarea bind:value={domainInput} rows="2" maxlength="51000" placeholder="reviewed.example"></textarea></label>
        <button class="btn" type="submit" disabled={busy || !domainInput.trim() || domains.length >= MAX_PROFILE_VALUES}>Add</button>
      </form>
      {#if domains.length}
        <ul>{#each domains as domain}<li><code>{domain}</code><button class="btn small" type="button" disabled={busy} aria-label={`Remove ${domain} from the domain allowlist`} onclick={() => removeDomain(domain)}>Remove</button></li>{/each}</ul>
      {:else}<p class="empty">No domains are allowlisted.</p>{/if}
    </section>

    <section aria-labelledby={`allowlisted-registrars-title-${profile.id}`}>
      <div class="section-heading"><h3 id={`allowlisted-registrars-title-${profile.id}`}>Registrars</h3><span>{registrars.length}/{MAX_PROFILE_VALUES}</span></div>
      <form onsubmit={(event) => { event.preventDefault(); addRegistrars(); }}>
        <label class="field">Add registrar names <small>one per line or comma separated</small><textarea bind:value={registrarInput} rows="2" maxlength="51000" placeholder="Reviewed Registrar"></textarea></label>
        <button class="btn" type="submit" disabled={busy || !registrarInput.trim() || registrars.length >= MAX_PROFILE_VALUES}>Add</button>
      </form>
      {#if registrars.length}
        <ul>{#each registrars as registrar}<li><span>{registrar}</span><button class="btn small" type="button" disabled={busy} aria-label={`Remove ${registrar} from the registrar allowlist`} onclick={() => removeRegistrar(registrar)}>Remove</button></li>{/each}</ul>
      {:else}<p class="empty">No registrars are allowlisted.</p>{/if}
    </section>
  </div>

  <footer>
    <span>{dirty ? 'Unsaved allowlist changes' : 'Saved in this browser'}</span>
    <div><button class="btn" type="button" disabled={busy || !dirty} onclick={discard}>Discard</button><button class="primary" type="button" disabled={busy || !dirty} onclick={() => void save()}>{busy ? 'Saving…' : 'Save allowlist'}</button></div>
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
