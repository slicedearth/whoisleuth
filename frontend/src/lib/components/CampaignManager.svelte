<script lang="ts">
  import { onMount } from 'svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import type { CaseRecord } from '$lib/cases';
  import {
    addCampaignDomain,
    createCampaign,
    deleteCampaign,
    editCampaign,
    exportCampaigns,
    importCampaigns,
    loadCampaigns,
    MAX_CAMPAIGN_IMPORT_BYTES,
    removeCampaignDomain,
    type CampaignRecord,
  } from '$lib/campaigns';

  let { records, onselect, oncount, focusId = '' }:{records:CaseRecord[];onselect?:(record:CaseRecord)=>void;oncount?:(count:number)=>void;focusId?:string}=$props();
  let campaigns=$state<CampaignRecord[]>([]);
  let expandedId=$state('');
  let newName=$state('');
  let nameDraft=$state('');
  let descriptionDraft=$state('');
  let selectedDomain=$state('');
  let message=$state('');
  let page=$state(1);
  let memberPage=$state(1);

  const PAGE_SIZE=10;
  const MEMBER_PAGE_SIZE=25;

  const expanded=$derived(campaigns.find((campaign)=>campaign.id===expandedId)??null);
  const caseByDomain=$derived(new Map(records.map((record)=>[record.domain,record])));
  const availableCases=$derived(records.filter((record)=>!expanded?.domains.includes(record.domain)).sort((a,b)=>a.domain.localeCompare(b.domain)));
  const pageCount=$derived(Math.max(1,Math.ceil(campaigns.length/PAGE_SIZE)));
  const currentPage=$derived(Math.min(page,pageCount));
  const pagedCampaigns=$derived(campaigns.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE));
  const memberPageCount=$derived(Math.max(1,Math.ceil((expanded?.domains.length??0)/MEMBER_PAGE_SIZE)));
  const currentMemberPage=$derived(Math.min(memberPage,memberPageCount));
  const pagedMembers=$derived((expanded?.domains??[]).slice((currentMemberPage-1)*MEMBER_PAGE_SIZE,currentMemberPage*MEMBER_PAGE_SIZE));

  function setPage(value:number){page=Math.min(pageCount,Math.max(1,Math.trunc(value)));}
  function setMemberPage(value:number){memberPage=Math.min(memberPageCount,Math.max(1,Math.trunc(value)));}
  function showCampaign(id:string){const index=campaigns.findIndex((campaign)=>campaign.id===id);if(index>=0)page=Math.floor(index/PAGE_SIZE)+1;}
  $effect(()=>{if(page>pageCount)page=pageCount;});
  $effect(()=>{if(memberPage>memberPageCount)memberPage=memberPageCount;});

  function refresh(next=loadCampaigns()){
    campaigns=next;
    if(expandedId&&!campaigns.some((campaign)=>campaign.id===expandedId))expandedId='';
    oncount?.(campaigns.length);
  }
  function open(campaign:CampaignRecord){
    if(expandedId===campaign.id){expandedId='';return;}
    showCampaign(campaign.id);expandedId=campaign.id;nameDraft=campaign.name;descriptionDraft=campaign.description;selectedDomain='';memberPage=1;
  }
  function create(){
    try{const result=createCampaign({name:newName});refresh(result.campaigns);const created=result.record;newName='';open(created);message=`Created campaign “${created.name}”.`;}
    catch(cause){message=cause instanceof Error?cause.message:'Could not create the campaign.';}
  }
  function save(campaign:CampaignRecord){
    try{refresh(editCampaign(campaign.id,{name:nameDraft,description:descriptionDraft}));showCampaign(campaign.id);const current=campaigns.find((item)=>item.id===campaign.id);if(current){nameDraft=current.name;descriptionDraft=current.description;}message=`Updated campaign “${current?.name??campaign.name}”.`;}
    catch(cause){message=cause instanceof Error?cause.message:'Could not update the campaign.';}
  }
  function add(campaign:CampaignRecord){
    if(!selectedDomain){message='Choose a case to add.';return;}
    try{refresh(addCampaignDomain(campaign.id,selectedDomain));showCampaign(campaign.id);message=`Added ${selectedDomain} to “${campaign.name}”.`;selectedDomain='';}
    catch(cause){message=cause instanceof Error?cause.message:'Could not add the case.';}
  }
  function removeDomain(campaign:CampaignRecord,domain:string){
    try{refresh(removeCampaignDomain(campaign.id,domain));showCampaign(campaign.id);message=`Removed ${domain} from “${campaign.name}”.`;}
    catch(cause){message=cause instanceof Error?cause.message:'Could not remove the case.';}
  }
  function remove(campaign:CampaignRecord){
    if(!confirm(`Delete campaign “${campaign.name}”? Cases and their evidence are not deleted.`))return;
    try{refresh(deleteCampaign(campaign.id));message=`Deleted campaign “${campaign.name}”.`;}
    catch(cause){message=cause instanceof Error?cause.message:'Could not delete the campaign.';}
  }
  function download(){try{exportCampaigns();message='Exported the campaign collection.';}catch(cause){message=cause instanceof Error?cause.message:'Could not export campaigns.';}}
  async function importFile(event:Event){
    const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;
    try{if(file.size>MAX_CAMPAIGN_IMPORT_BYTES)throw new Error('Campaign imports are limited to 2 MB.');const result=importCampaigns(JSON.parse(await file.text()));refresh(result.campaigns);page=1;memberPage=1;message=`Imported ${result.added} new and ${result.updated} merged campaign${result.added+result.updated===1?'':'s'}${result.skipped?`; skipped ${result.skipped} invalid or over-limit record${result.skipped===1?'':'s'}`:''}.`;}
    catch(cause){message=cause instanceof Error?cause.message:'Campaign import failed.';}finally{input.value='';}
  }
  function openCase(domain:string){const record=caseByDomain.get(domain);if(record)onselect?.(record);}

  onMount(()=>{
    refresh();
    const focused=focusId?campaigns.find((campaign)=>campaign.id===focusId):null;
    if(focused)open(focused);
  });
</script>

<section class="campaign-toolbar card">
  <form onsubmit={(event)=>{event.preventDefault();create();}}>
    <label for="new-campaign">New campaign</label>
    <div><input id="new-campaign" bind:value={newName} maxlength="100" placeholder="Investigation name" autocomplete="off"><button class="primary" type="submit" disabled={!newName.trim()}>Create campaign</button></div>
  </form>
  <div class="top-actions toolbar"><button class="btn" type="button" onclick={download} disabled={!campaigns.length}>Export JSON</button><label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile}></label></div>
</section>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

{#if campaigns.length}
  <p class="summary">{campaigns.length} browser-local campaign{campaigns.length===1?'':'s'} · domain membership only</p>
  <p class="privacy-note">Campaign exports include their labels and descriptions. Review the file before sharing it.</p>
  <section class="campaign-list">
    {#each pagedCampaigns as campaign (campaign.id)}
      <article class="campaign card" class:open={expandedId===campaign.id}>
        <button class="campaign-head" type="button" aria-expanded={expandedId===campaign.id} aria-controls={`campaign-${campaign.id}`} onclick={()=>open(campaign)}>
          <span><strong>{campaign.name}</strong>{#if campaign.description}<small>{campaign.description}</small>{/if}</span>
          <span>{campaign.domains.length} case{campaign.domains.length===1?'':'s'}</span>
        </button>
        {#if expandedId===campaign.id}
          <div class="campaign-body" id={`campaign-${campaign.id}`}>
            <form class="campaign-edit" onsubmit={(event)=>{event.preventDefault();save(campaign);}}>
              <label for={`campaign-name-${campaign.id}`}>Name</label>
              <input id={`campaign-name-${campaign.id}`} bind:value={nameDraft} maxlength="100" required>
              <label for={`campaign-description-${campaign.id}`}>Description <small>optional</small></label>
              <textarea id={`campaign-description-${campaign.id}`} bind:value={descriptionDraft} maxlength="1000" rows="3" placeholder="Scope, working hypothesis, or handoff context"></textarea>
              <button class="btn" type="submit" disabled={!nameDraft.trim()}>Save details</button>
            </form>

            <section class="members" aria-label={`Cases in ${campaign.name}`}>
              <header><div><p class="eyebrow">Members</p><h3>{campaign.domains.length} case domain{campaign.domains.length===1?'':'s'}</h3></div></header>
              {#if campaign.domains.length}
                <ul>{#each pagedMembers as domain}{@const linked=caseByDomain.get(domain)}<li><div><strong>{domain}</strong>{#if !linked}<small>Case unavailable in this browser</small>{/if}</div><div>{#if linked}<button class="btn small" type="button" onclick={()=>openCase(domain)}>Open case</button>{/if}<button class="btn small danger" type="button" onclick={()=>removeDomain(campaign,domain)}>Remove</button></div></li>{/each}</ul>
                <Pagination currentPage={currentMemberPage} pageCount={memberPageCount} setPage={setMemberPage} ariaLabel={`Case pages for ${campaign.name}`} />
              {:else}<p>No cases have been added to this campaign.</p>{/if}
            </section>

            <form class="add-case" onsubmit={(event)=>{event.preventDefault();add(campaign);}}>
              <label for={`campaign-case-${campaign.id}`}>Add an existing case</label>
              <div><select id={`campaign-case-${campaign.id}`} bind:value={selectedDomain} disabled={!availableCases.length}><option value="">{availableCases.length?'Choose a case':'All available cases are included'}</option>{#each availableCases as record}<option value={record.domain}>{record.domain}</option>{/each}</select><button class="btn" type="submit" disabled={!selectedDomain}>Add case</button></div>
            </form>
            <details><summary>Campaign data and interpretation limits</summary><p>Campaigns store only a label, description, and normalized domain membership in this browser. Membership is an analyst organization aid and does not prove common ownership, coordination, intent, or maliciousness.</p></details>
            <button class="btn danger delete" type="button" onclick={()=>remove(campaign)}>Delete campaign</button>
          </div>
        {/if}
      </article>
    {/each}
  </section>
  <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Campaign pages" />
{:else}
  <section class="empty-state card"><h2>No campaigns yet</h2><p>Group existing analyst cases into a browser-local investigation without copying their evidence or notes.</p></section>
{/if}

<style>
  .campaign-toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px;align-items:end;padding:16px}.campaign-toolbar form label,.campaign-edit>label,.add-case>label{display:block;margin-bottom:5px;color:var(--text);font:600 var(--text-xs) var(--mono)}.campaign-toolbar form>div,.add-case>div{display:flex;flex-wrap:wrap;gap:8px}.campaign-toolbar input,.campaign-edit input{min-height:42px}.add-case select{min-height:var(--control-h)}.message{color:var(--accent);font-size:var(--text-sm)}.summary{margin:12px 2px 2px;color:var(--muted);font-size:var(--text-xs)}.privacy-note{margin:0 2px 12px;color:var(--muted);font-size:var(--text-xs)}.campaign-list{display:grid;gap:10px}.campaign{padding:0;overflow:hidden}.campaign.open{border-color:var(--accent)}.campaign-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;padding:15px 18px;border:0;background:none;text-align:left;cursor:pointer}.campaign-head:hover strong{color:var(--accent)}.campaign-head>span:first-child{display:grid;gap:3px;min-width:0}.campaign-head strong,.campaign-head small{overflow-wrap:anywhere}.campaign-head strong{font:700 var(--text-md) var(--mono)}.campaign-head small,.campaign-head>span:last-child{color:var(--muted);font-size:var(--text-2xs)}.campaign-body{display:grid;gap:16px;padding:16px 18px;border-top:1px solid var(--border);background:var(--panel)}.campaign-edit{display:grid;gap:7px}.campaign-edit textarea{resize:vertical}.campaign-edit button{justify-self:start}.members{padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm)}.members h3{margin:0;font-size:var(--text-md)}.members ul{display:grid;gap:7px;margin:11px 0 0;padding:0;list-style:none}.members li{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.members li>div:first-child{display:grid;gap:2px;min-width:0}.members li strong{overflow-wrap:anywhere;font-size:var(--text-sm)}.members li small,.members>p,details p{color:var(--muted);font-size:var(--text-xs)}.members li>div:last-child{display:flex;flex-wrap:wrap;gap:6px}.add-case select{min-width:0;max-width:100%}details summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}details p{max-width:80ch}.delete{justify-self:start}
  @media(max-width:700px){.campaign-toolbar{align-items:stretch;flex-direction:column}.campaign-toolbar form>div,.add-case>div{display:grid}.campaign-toolbar input,.campaign-toolbar button,.top-actions>:global(*),.add-case select{width:100%}.campaign-head{grid-template-columns:1fr}.members li{align-items:stretch;flex-direction:column}.members li>div:last-child button{flex:1}.campaign-edit button,.delete{width:100%}}
</style>
