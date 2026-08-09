<script lang="ts">
  import { tick } from 'svelte';
  import type { BrandProfile } from '$lib/brand-profiles';
  import { MAX_CASE_BRAND_PROFILE_IDS, type CaseRecord } from '$lib/cases';

  let {
    record,
    profiles,
    profilesUnavailable = false,
    addAssociation,
    removeAssociation,
  }: {
    record: CaseRecord;
    profiles: BrandProfile[];
    profilesUnavailable?: boolean;
    addAssociation: (record: CaseRecord, id: string) => boolean | Promise<boolean>;
    removeAssociation: (record: CaseRecord, id: string) => boolean | Promise<boolean>;
  } = $props();
  let selected = $state('');
  let saving = $state(false);
  const profileById = $derived(new Map(profiles.slice(0, 100).map((profile) => [profile.id, profile])));
  const available = $derived(profiles.slice(0, 100).filter((profile) => !record.brandProfileIds.includes(profile.id)));
  const atLimit = $derived(record.brandProfileIds.length >= MAX_CASE_BRAND_PROFILE_IDS);

  async function add() {
    if (!selected || atLimit || profilesUnavailable) return;
    saving = true;
    let saved = false;
    try {
      saved = await addAssociation(record, selected);
    } finally {
      saving = false;
    }
    if (!saved) return;
    selected = '';
    await tick();
    focusAssociationFallback();
  }

  function focusAssociationFallback() {
    const selector = document.getElementById(`case-brand-profile-${record.id}`) as HTMLSelectElement | null;
    if (selector && !selector.disabled) selector.focus();
    else document.getElementById(`case-brand-associations-region-${record.id}`)?.focus();
  }

  async function remove(id: string) {
    if (profilesUnavailable) return;
    const previousIndex = record.brandProfileIds.indexOf(id);
    saving = true;
    let saved = false;
    try {
      saved = await removeAssociation(record, id);
    } finally {
      saving = false;
    }
    if (!saved) return;
    await tick();
    const nextId = record.brandProfileIds[Math.min(Math.max(0, previousIndex), record.brandProfileIds.length - 1)];
    const target = nextId
      ? document.getElementById(`case-brand-remove-${record.id}-${nextId}`)
      : document.getElementById(`case-brand-profile-${record.id}`);
    if (target instanceof HTMLButtonElement && !target.disabled) target.focus();
    else if (target instanceof HTMLSelectElement && !target.disabled) target.focus();
    else focusAssociationFallback();
  }
</script>

<section id={`case-brand-associations-region-${record.id}`} class="associations" aria-labelledby={`case-brand-associations-${record.id}`} tabindex="-1">
  <div class="association-heading">
    <div><h3 id={`case-brand-associations-${record.id}`}>Brand Profile associations</h3><p>Analyst-selected references only. WHOISleuth does not infer an association from names, domains, tags, certificates, or evidence.</p></div>
    <span>{record.brandProfileIds.length}/{MAX_CASE_BRAND_PROFILE_IDS}</span>
  </div>

  {#if record.brandProfileIds.length}
    <ul>
      {#each record.brandProfileIds as profileId (profileId)}
        {@const profile = profileById.get(profileId)}
        <li class:unresolved={!profile && !profilesUnavailable}>
          <span class="association-label">{profile ? profile.name : profilesUnavailable ? 'Profile details unavailable' : 'Unavailable profile'}<code>{profileId}</code></span>
          <button
            id={`case-brand-remove-${record.id}-${profileId}`}
            class="btn"
            type="button"
            aria-label={profile ? `Remove association with ${profile.name} (${profileId})` : `Remove association with unavailable profile ${profileId}`}
            disabled={profilesUnavailable || saving}
            onclick={() => remove(profileId)}
          >Remove association</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">No Brand Profile is explicitly associated with this case.</p>
  {/if}

  <form onsubmit={(event) => { event.preventDefault(); void add(); }}>
    <label for={`case-brand-profile-${record.id}`}>Add Brand Profile</label>
    <div>
      <select id={`case-brand-profile-${record.id}`} bind:value={selected} disabled={profilesUnavailable || atLimit || !available.length || saving}>
        <option value="">Select a local profile</option>
        {#each available as profile}<option value={profile.id}>{profile.name}</option>{/each}
      </select>
      <button class="btn" type="submit" disabled={!selected || profilesUnavailable || atLimit || saving}>Add association</button>
    </div>
  </form>
  {#if profilesUnavailable}<p class="notice">Brand Profile details could not be loaded, so association changes are unavailable. Retained references are preserved; reload to try again.</p>
  {:else if atLimit}<p class="notice">This case has reached the eight-association limit.</p>
  {:else if !profiles.length}<p class="notice">Create a Brand Profile before adding an association.</p>{/if}
</section>

<style>
  .associations{display:grid;min-width:0;gap:10px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .association-heading{display:flex;justify-content:space-between;gap:16px}
  .association-heading>div{min-width:0}
  .association-heading h3,.association-heading p{margin:0}
  .association-heading h3{font:700 var(--text-sm) var(--mono)}
  .association-heading p,.empty,.notice{margin-top:5px;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .association-heading>span{color:var(--accent2);font:700 var(--text-xs) var(--mono);white-space:nowrap}
  ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}
  li{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  li.unresolved{border-color:rgb(var(--amber-rgb) / .45)}
  .association-label{display:grid;gap:3px;min-width:0;font-size:var(--text-xs);font-weight:650;overflow-wrap:anywhere}
  code{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  form>label{display:block;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  form,form>div{min-width:0}
  form>div{display:flex;gap:8px;margin-top:6px}
  select{flex:1;min-width:0;min-height:var(--control-h)}
  .empty,.notice{margin:0}
  .notice{color:var(--amber)}
  @media(max-width:640px){li,form>div{display:grid}.btn{width:100%}}
</style>
