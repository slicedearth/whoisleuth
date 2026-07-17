<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import type { BrandProfile } from '$lib/brand-profiles';

  let { profiles, activeId, activate, edit, remove, formatDate, readOnly = false }: {
    profiles: BrandProfile[];
    activeId: string;
    activate?: (id: string) => void;
    edit?: (profile: BrandProfile) => void;
    remove?: (profile: BrandProfile) => void;
    formatDate: (value: string) => string;
    readOnly?: boolean;
  } = $props();

  const PAGE_SIZE=12;
  let page=$state(1);
  let activeLocation=$state('');
  const pageCount=$derived(Math.max(1,Math.ceil(profiles.length/PAGE_SIZE)));
  const currentPage=$derived(Math.min(page,pageCount));
  const pagedProfiles=$derived(profiles.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE));
  const activeIndex=$derived(profiles.findIndex((profile)=>profile.id===activeId));
  function setPage(value:number){page=Math.min(pageCount,Math.max(1,Math.trunc(value)));}
  $effect(()=>{if(page>pageCount)page=pageCount;});
  $effect(()=>{const location=`${activeId}:${activeIndex}`;if(location===activeLocation)return;activeLocation=location;if(activeIndex>=0)page=Math.floor(activeIndex/PAGE_SIZE)+1;});
</script>

{#if profiles.length}<section><div class="profiles">{#each pagedProfiles as profile}<article class="profile card" class:active={profile.id === activeId}><header class="section-head"><div><p class="eyebrow">{readOnly ? 'Synthetic profile' : profile.id === activeId ? 'Active profile' : 'Saved profile'}</p><h2>{profile.name}</h2></div>{#if !readOnly && activate}<input type="radio" name="active-profile" aria-label={`Set ${profile.name} active`} checked={profile.id === activeId} onchange={() => activate?.(profile.id)}>{/if}</header><p>{profile.officialDomains.length} official domain{profile.officialDomains.length === 1 ? '' : 's'} · {profile.approvedPartnerDomains.length} trusted partner{profile.approvedPartnerDomains.length === 1 ? '' : 's'} · {profile.allowlistedDomains.length} allowlisted domain{profile.allowlistedDomains.length === 1 ? '' : 's'}</p><div class="chips">{#each profile.officialDomains.slice(0, 6) as domain}<span class="chip wrap">{domain}</span>{/each}{#if profile.officialDomains.length>6}<span class="chip wrap">+{profile.officialDomains.length-6} more</span>{/if}</div>{#if profile.pageBaseline}<p class="baseline-status"><strong>Page baseline</strong><span>{profile.pageBaseline.domain} · {profile.pageBaseline.complete ? 'Complete' : 'Partial'} · {formatDate(profile.pageBaseline.observedAt)}</span></p>{:else}<p class="baseline-status"><strong>Page baseline</strong><span>Not captured</span></p>{/if}{#if !readOnly && edit && remove}<footer class="toolbar"><button class="btn" onclick={() => edit?.(profile)}>Edit</button><button class="btn danger" onclick={() => remove?.(profile)}>Delete</button></footer>{/if}</article>{/each}</div><Pagination {currentPage} {pageCount} {setPage} ariaLabel="Brand profile pages" /></section>{:else}<section class="empty-state card"><h2>No brand profiles saved</h2><p>Create a profile to establish official domains and trusted infrastructure.</p></section>{/if}

<style>
  .profiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
  .profile{min-width:0;display:flex;flex-direction:column;padding:20px}
  .profile.active{border-color:rgba(126,224,168,.55)}
  .profile h2{margin:0}
  .profile>p{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .chips{display:flex;flex-wrap:wrap;gap:5px;margin:12px 0}
  .baseline-status{display:grid;gap:3px;margin:0 0 14px;font-size:var(--text-xs)}
  .baseline-status strong{color:var(--text)}
  .baseline-status span{overflow-wrap:anywhere;color:var(--muted)}
  .profile footer{margin-top:auto}
  @media(max-width:750px){.profiles{grid-template-columns:1fr}}
</style>
