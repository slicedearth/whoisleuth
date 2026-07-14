<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import EvidenceTimeline from '$lib/components/EvidenceTimeline.svelte';
  import CaseReportExport from '$lib/components/CaseReportExport.svelte';
  import CaseRelationships from '$lib/components/CaseRelationships.svelte';
  import CampaignManager from '$lib/components/CampaignManager.svelte';
  import CaseRelationshipTable from '$lib/components/CaseRelationshipTable.svelte';
  import CaseRelationshipGraph from '$lib/components/CaseRelationshipGraph.svelte';
  import { buildCaseRelationships } from '$lib/analysis/case-relationships.js';
  import { deleteWatchlist, exportWatchlists, fieldLabels, formatValue, importWatchlists, loadWatchlists, MAX_WATCHLIST_IMPORT_BYTES, writeWatchlists, type Watchlists } from '$lib/watchlists';
  import {
    addCaseNote, CASE_DISPOSITIONS, CASE_STATUSES, deleteCase, dispositionLabel, editCase, exportCases,
    importCases, loadCases, MAX_CASE_IMPORT_BYTES, openCase, sourceLabel, statusLabel, type CaseRecord
  } from '$lib/cases';
  import { loadCampaigns } from '$lib/campaigns';

  type View = 'watchlists' | 'cases' | 'campaigns' | 'relationships';
  let view=$state<View>('watchlists');

  // --- Watchlists ---
  let watchlists=$state<Watchlists>({});let selected=$state('');let changedOnly=$state(false);let message=$state('');
  const names=$derived(Object.keys(watchlists).sort());const entry=$derived(selected?watchlists[selected]||null:null);const history=$derived(entry?(changedOnly?entry.history.filter(e=>e.changeCount>0):entry.history):[]);
  function refresh(){watchlists=loadWatchlists();if(selected&&!watchlists[selected])selected='';}
  function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
  function remove(name:string){if(!confirm(`Delete watchlist "${name}" and its history?`))return;deleteWatchlist(name);refresh();}
  function clearAll(){if(!names.length||!confirm('Delete every saved watchlist and its history?'))return;writeWatchlists({});refresh();}
  async function rescan(name:string){const current=watchlists[name];if(!current)return;const candidates=current.results.map(record=>({domain:String(record.domain),source:name,mutationTypes:Array.isArray(record.mutationTypes)?record.mutationTypes:[]}));saveCandidateHandoff('watchlist',candidates);await goto('/bulk?source=watchlist');}
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_WATCHLIST_IMPORT_BYTES)throw new Error('Watchlist imports are limited to 2 MB.');const result=importWatchlists(JSON.parse(await file.text()));message=`Imported ${result.added} new and ${result.updated} updated watchlists.`;refresh();}catch(cause){message=cause instanceof Error?cause.message:'Import failed';}finally{input.value='';}}

  // --- Cases ---
  let cases=$state<CaseRecord[]>([]);
  let campaignCount=$state(0);
  let relationshipCount=$state(0);
  let statusFilter=$state('');let dispositionFilter=$state('');let caseSearch=$state('');let caseSort=$state<'updated'|'domain'|'status'>('updated');
  let expandedId=$state('');let noteDraft=$state('');let tagDraft=$state('');let caseMessage=$state('');let newDomain=$state('');
  const statusOrder=new Map(CASE_STATUSES.map((item,index)=>[item.value,index]));
  const filteredCases=$derived.by(()=>{
    const term=caseSearch.trim().toLowerCase();
    return cases.filter(record=>{
      if(statusFilter&&record.status!==statusFilter)return false;
      if(dispositionFilter&&record.disposition!==dispositionFilter)return false;
      if(term&&!record.domain.includes(term)&&!record.tags.some(tag=>tag.toLowerCase().includes(term)))return false;
      return true;
    }).sort((a,b)=>{
      if(caseSort==='domain')return a.domain.localeCompare(b.domain);
      if(caseSort==='status')return (statusOrder.get(a.status)??99)-(statusOrder.get(b.status)??99)||a.domain.localeCompare(b.domain);
      return Date.parse(b.updatedAt)-Date.parse(a.updatedAt);
    });
  });
  function refreshCases(){cases=loadCases();relationshipCount=buildCaseRelationships(cases).groups.length;if(expandedId&&!cases.some(record=>record.id===expandedId))expandedId='';}
  function expand(record:CaseRecord){if(expandedId===record.id){expandedId='';return;}expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';}
  function openRelatedCase(record:CaseRecord){view='cases';if(expandedId!==record.id)expand(record);}
  function prunedNote(pruned:number){return pruned?` (pruned ${pruned} old evidence snapshot${pruned===1?'':'s'} to stay within storage)`:'';}
  function trackDomain(){const domain=newDomain.trim();if(!domain){caseMessage='Enter a domain to track.';return;}try{const{record,created,pruned}=openCase({domain,source:'monitor'});refreshCases();newDomain='';expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';caseMessage=`${created?`Opened a new case for ${record.domain}.`:`${record.domain} already has a case.`}${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not open the case.';}}
  function setStatus(record:CaseRecord,value:string){try{const{pruned}=editCase(record.id,{status:value});refreshCases();caseMessage=`Set ${record.domain} to ${statusLabel(value)}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the case.';}}
  function setDisposition(record:CaseRecord,value:string){try{const{pruned}=editCase(record.id,{disposition:value});refreshCases();caseMessage=`Marked ${record.domain} as ${dispositionLabel(value)}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the case.';}}
  function saveTags(record:CaseRecord){try{const{pruned}=editCase(record.id,{tags:tagDraft.split(/[,\n]+/).map(value=>value.trim()).filter(Boolean)});refreshCases();caseMessage=`Updated tags for ${record.domain}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update tags.';}}
  function addNote(record:CaseRecord){const body=noteDraft.trim();if(!body){caseMessage='A note cannot be empty.';return;}try{const{pruned}=addCaseNote(record.id,body);refreshCases();noteDraft='';caseMessage=`Added a note to ${record.domain}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not add the note.';}}
  function downloadCases(){try{exportCases();}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not export cases.';}}
  function removeCase(record:CaseRecord){if(!confirm(`Delete the case for ${record.domain}? Its notes are removed unless you exported them.`))return;try{deleteCase(record.id);if(expandedId===record.id)expandedId='';refreshCases();caseMessage=`Deleted the case for ${record.domain}.`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not delete the case.';}}
  function clearCaseFilters(){statusFilter='';dispositionFilter='';caseSearch='';}
  async function importCaseFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_CASE_IMPORT_BYTES)throw new Error('Case imports are limited to 2 MB.');const result=importCases(JSON.parse(await file.text()));refreshCases();caseMessage=`Imported ${result.added} new and ${result.updated} merged cases${result.skipped?`; skipped ${result.skipped} invalid or over-limit record${result.skipped===1?'':'s'}`:''}${prunedNote(result.pruned)}.`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Case import failed';}finally{input.value='';}}

  onMount(()=>{
    refresh();refreshCases();campaignCount=loadCampaigns().length;
    const focus=page.url.searchParams.get('case');
    if(focus){view='cases';if(cases.some(record=>record.id===focus)){const target=cases.find(record=>record.id===focus)!;expandedId=focus;tagDraft=target.tags.join(', ');}}
    else if(page.url.searchParams.get('view')==='cases')view='cases';
    else if(page.url.searchParams.get('view')==='campaigns')view='campaigns';
    else if(page.url.searchParams.get('view')==='relationships')view='relationships';
  });
</script>

<svelte:head><title>Monitor · WHOISleuth</title></svelte:head>
<section class="heading"><div><p class="eyebrow">Monitor</p><h1>Investigation workspace</h1><p>Organize cases into campaigns, review cross-case relationships, and compare watchlist changes over time.</p></div></section>

<div class="views" role="tablist" aria-label="Monitor views">
  <button role="tab" id="tab-cases" aria-selected={view==='cases'} aria-controls="panel-cases" class:active={view==='cases'} onclick={()=>view='cases'}>Cases <span>{cases.length}</span></button>
  <button role="tab" id="tab-campaigns" aria-selected={view==='campaigns'} aria-controls="panel-campaigns" class:active={view==='campaigns'} onclick={()=>view='campaigns'}>Campaigns <span>{campaignCount}</span></button>
  <button role="tab" id="tab-relationships" aria-selected={view==='relationships'} aria-controls="panel-relationships" class:active={view==='relationships'} onclick={()=>view='relationships'}>Relationships <span>{relationshipCount}</span></button>
  <button role="tab" id="tab-watchlists" aria-selected={view==='watchlists'} aria-controls="panel-watchlists" class:active={view==='watchlists'} onclick={()=>view='watchlists'}>Watchlists <span>{names.length}</span></button>
</div>

{#if view==='campaigns'}
<div id="panel-campaigns" role="tabpanel" aria-labelledby="tab-campaigns">
  <CampaignManager records={cases} onselect={openRelatedCase} oncount={(count)=>campaignCount=count} />
</div>
{/if}

{#if view==='relationships'}
<div id="panel-relationships" role="tabpanel" aria-labelledby="tab-relationships">
  <CaseRelationshipGraph records={cases} onselect={openRelatedCase} />
  <CaseRelationshipTable records={cases} onselect={openRelatedCase} />
</div>
{/if}

{#if view==='cases'}
<div id="panel-cases" role="tabpanel" aria-labelledby="tab-cases">
  <section class="case-toolbar card">
    <form class="track" onsubmit={(event)=>{event.preventDefault();trackDomain();}}>
      <label for="new-case">Track a domain</label>
      <div><input id="new-case" bind:value={newDomain} placeholder="suspicious.example" autocomplete="off" spellcheck="false"><button class="primary" type="submit" disabled={!newDomain.trim()}>Open or create case</button></div>
    </form>
    <div class="top-actions"><button onclick={downloadCases} disabled={!cases.length}>Export JSON</button><label>Import JSON<input type="file" accept="application/json,.json" onchange={importCaseFile}></label></div>
  </section>
  {#if caseMessage}<p class="message" role="status" aria-live="polite">{caseMessage}</p>{/if}

  {#if cases.length}
    <section class="case-filters card">
      <label>Status<select bind:value={statusFilter}><option value="">All statuses</option>{#each CASE_STATUSES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      <label>Disposition<select bind:value={dispositionFilter}><option value="">All dispositions</option>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      <label class="search">Search<input bind:value={caseSearch} placeholder="Domain or tag" autocomplete="off"></label>
      <label>Sort<select bind:value={caseSort}><option value="updated">Recently updated</option><option value="domain">Domain</option><option value="status">Status</option></select></label>
      <button onclick={clearCaseFilters} disabled={!statusFilter&&!dispositionFilter&&!caseSearch}>Clear</button>
    </section>
    <p class="count">{filteredCases.length} of {cases.length} case{cases.length===1?'':'s'} shown</p>

    <section class="case-list">
      {#each filteredCases as record (record.id)}
        <article class="case card" class:open={expandedId===record.id}>
          <button class="case-head" aria-expanded={expandedId===record.id} aria-controls={`case-body-${record.id}`} onclick={()=>expand(record)}>
            <span class="case-domain"><strong>{record.domain}</strong>{#if record.notes.length}<small>{record.notes.length} note{record.notes.length===1?'':'s'}</small>{/if}</span>
            <span class="badges"><span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span><span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span></span>
            <span class="updated">{date(record.updatedAt)}</span>
          </button>
          {#if record.tags.length}<div class="tag-row">{#each record.tags as tag}<span class="tag">{tag}</span>{/each}</div>{/if}
          {#if expandedId===record.id}
            <div class="case-body" id={`case-body-${record.id}`}>
              <div class="field-grid">
                <label>Status<select value={record.status} onchange={(event)=>setStatus(record,(event.currentTarget as HTMLSelectElement).value)}>{#each CASE_STATUSES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
                <label>Disposition<select value={record.disposition} onchange={(event)=>setDisposition(record,(event.currentTarget as HTMLSelectElement).value)}>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
              </div>
              <form class="tags-edit" onsubmit={(event)=>{event.preventDefault();saveTags(record);}}>
                <label for={`tags-${record.id}`}>Tags <small>comma separated</small></label>
                <div><input id={`tags-${record.id}`} bind:value={tagDraft} placeholder="phishing, active-campaign" autocomplete="off"><button type="submit">Save tags</button></div>
              </form>
              <form class="note-edit" onsubmit={(event)=>{event.preventDefault();addNote(record);}}>
                <label for={`note-${record.id}`}>Add note</label>
                <textarea id={`note-${record.id}`} bind:value={noteDraft} rows="2" placeholder="Observed behaviour, evidence, decisions…"></textarea>
                <button type="submit" disabled={!noteDraft.trim()}>Add note</button>
              </form>
              {#if record.notes.length}<ol class="notes">{#each [...record.notes].reverse() as note}<li><time datetime={note.createdAt}>{date(note.createdAt)}</time><p>{note.body}</p></li>{/each}</ol>{/if}
              <CaseRelationships {record} records={cases} onselect={expand} />
              {#key record.id}<EvidenceTimeline {record} />{/key}
              {#key record.id}<CaseReportExport {record} onmessage={(value)=>caseMessage=value} />{/key}
              <div class="case-meta"><span>Source: {sourceLabel(record.source)}</span><span>Opened {date(record.createdAt)}</span></div>
              <div class="case-actions"><a href={`/lookup?q=${encodeURIComponent(record.domain)}`}>Look up domain</a><button class="danger" onclick={()=>removeCase(record)}>Delete case</button></div>
            </div>
          {/if}
        </article>
      {/each}
      {#if !filteredCases.length}<p class="count">No cases match the current filters.</p>{/if}
    </section>
  {:else}
    <section class="empty card"><h2>No cases yet</h2><p>Open a case from a Lookup result, a Bulk row, or the form above to start a documented investigation record.</p><a href="/lookup">Open Lookup →</a></section>
  {/if}
</div>
{/if}

{#if view==='watchlists'}
<div id="panel-watchlists" role="tabpanel" aria-labelledby="tab-watchlists">
  <section class="wl-toolbar card"><div class="top-actions"><button onclick={exportWatchlists} disabled={!names.length}>Export JSON</button><label>Import JSON<input type="file" accept="application/json,.json" onchange={importFile}></label><button class="danger" onclick={clearAll} disabled={!names.length}>Clear all</button></div></section>
  {#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

  {#if names.length}
    <section class="watchlists card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Domains</th><th>Checks</th><th>Latest changes</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{#each names as name}{@const item=watchlists[name]}{@const latest=item.history.at(-1)}<tr><td><strong>{name}</strong></td><td>{item.results.length}</td><td>{item.history.length}</td><td><span class:changed={(latest?.changeCount||0)>0}>{latest?.changeCount||0}</span></td><td>{date(item.updatedAt)}</td><td><div class="actions"><button onclick={()=>rescan(name)}>Rescan in Bulk</button><button onclick={()=>{selected=name;changedOnly=false}}>History</button><button class="danger" onclick={()=>remove(name)}>Delete</button></div></td></tr>{/each}</tbody></table></div></section>
  {:else}
    <section class="empty card"><h2>No watchlists saved</h2><p>Run a Bulk scan, then save its results to begin a browser-local monitoring timeline.</p><a href="/bulk">Open Bulk analysis →</a></section>
  {/if}

  {#if entry}
    <section class="history card"><header><div><p class="eyebrow">History</p><h2>{selected}</h2><p>{entry.history.length} retained check{entry.history.length===1?'':'s'} · {entry.results.length} domain{entry.results.length===1?'':'s'}</p></div><div><button class:active={changedOnly} aria-pressed={changedOnly} onclick={()=>changedOnly=!changedOnly}>Material changes only</button><button onclick={()=>selected=''}>Close</button></div></header>
      <div class="events">{#each [...history].reverse() as event}<article><div class="event-head"><time datetime={event.checkedAt}>{date(event.checkedAt)}</time><span>{event.mode} scan</span><strong class:changed={event.changeCount>0}>{event.changeCount} change{event.changeCount===1?'':'s'}</strong><small>{event.conclusiveCount}/{event.resultCount} conclusive</small></div>{#if event.changes.length}<ul>{#each event.changes as change}<li class={change.tone}><strong>{change.domain}</strong><span>{fieldLabels[change.field]||change.field}</span><small>{formatValue(change.before,change.field)} → {formatValue(change.after,change.field)}</small></li>{/each}</ul>{:else}<p class="no-change">No material changes detected.</p>{/if}{#if event.omittedChanges}<p class="no-change">{event.omittedChanges} additional changes omitted to keep storage bounded.</p>{/if}</article>{/each}</div>
    </section>
  {/if}
</div>
{/if}

<style>.views{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px}.views button{display:flex;gap:7px;align-items:center;min-height:40px;padding:0 15px;border:1px solid var(--border);border-radius:9px;background:var(--panel-raised);font-size:.74rem}.views button.active{color:var(--accent);border-color:var(--accent)}.views button span{padding:1px 7px;border-radius:99px;background:var(--border);color:var(--text);font-size:.62rem}
.top-actions,.actions,.history header>div:last-child{display:flex;flex-wrap:wrap;gap:7px}.top-actions button,.top-actions label,.actions button,.history button{min-height:38px;padding:0 11px;border:1px solid var(--border);border-radius:9px;background:var(--panel-raised);font-size:.7rem}.top-actions label{display:grid;place-items:center;cursor:pointer}.top-actions input{display:none}.danger{color:var(--danger)}.message{color:var(--accent)}.watchlists,.history{padding:22px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.74rem}th,td{padding:12px 9px;border-top:1px solid var(--border);text-align:left}th{color:var(--muted);font-size:.64rem;text-transform:uppercase}.changed{color:var(--danger)}.empty{display:grid;min-height:300px;place-content:center;padding:30px;text-align:center}.empty p,.history header p,.no-change{color:var(--muted)}.empty a{color:var(--accent);font-weight:700}.history{margin-top:16px}.history header{display:flex;justify-content:space-between;gap:16px}.history h2{margin:0}.history header p{margin:5px 0}.history button.active{color:var(--accent);border-color:#7ee0a8}.events{display:grid;gap:10px;margin-top:18px}.events article{padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}.event-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.event-head span,.event-head strong{padding:5px 7px;border:1px solid var(--border);border-radius:99px;font-size:.65rem;text-transform:capitalize}.event-head small{margin-left:auto;color:var(--muted)}ul{display:grid;gap:6px;margin:14px 0 0;padding:0;list-style:none}li{display:grid;grid-template-columns:minmax(150px,1fr) 120px minmax(180px,1fr);gap:10px;padding:8px;border-left:3px solid var(--border);font-size:.7rem}li.danger{border-color:var(--danger)}li.warn{border-color:#f2b84b}li.good{border-color:var(--accent)}li span,li small{color:var(--muted)}
.wl-toolbar,.case-toolbar,.case-filters{padding:16px}.case-toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px;align-items:end}.track label,.case-filters label{display:block;color:var(--muted);font-size:.66rem}.track>div{display:flex;gap:8px;margin-top:5px}.track input{min-width:200px}.track input,.case-filters input,.case-filters select,.tags-edit input,.note-edit textarea,.field-grid select{min-height:38px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}.track button,.case-filters button,.tags-edit button,.note-edit button{min-height:38px;padding:0 13px;border:1px solid var(--border);border-radius:8px;background:var(--panel-raised);font-size:.7rem}.case-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-top:14px}.case-filters .search{flex:1;min-width:150px}.case-filters .search input{width:100%}.count{margin:12px 2px;color:var(--muted);font-size:.7rem}
.case-list{display:grid;gap:10px}.case{padding:0;overflow:hidden}.case.open{border-color:var(--accent)}.case-head{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;width:100%;padding:15px 18px;border:0;background:none;text-align:left}.case-domain{display:flex;flex-direction:column;gap:3px;min-width:0}.case-domain strong{overflow-wrap:anywhere}.case-domain small,.updated{color:var(--muted);font-size:.64rem}.badges{display:flex;flex-wrap:wrap;gap:6px}.badge{padding:4px 9px;border:1px solid var(--border);border-radius:99px;font-size:.62rem;white-space:nowrap}.badge.status-escalated{color:var(--danger);border-color:rgba(255,107,107,.4)}.badge.status-resolved{color:var(--accent2)}.badge.disposition-confirmed_abuse{color:var(--danger);border-color:rgba(255,107,107,.4)}.badge.disposition-suspicious{color:#f2b84b}.badge.disposition-false_positive,.badge.disposition-expected{color:var(--accent2)}.tag-row{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 14px}.tag{padding:3px 8px;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-size:.62rem}.case-body{display:grid;gap:14px;padding:16px 18px;border-top:1px solid var(--border);background:var(--panel)}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field-grid label,.tags-edit label,.note-edit label{display:block;color:var(--muted);font-size:.66rem;margin-bottom:5px}.field-grid select{width:100%}.tags-edit>div{display:flex;gap:8px}.tags-edit input{flex:1}.note-edit textarea{width:100%;resize:vertical}.note-edit button{margin-top:8px}.notes{display:grid;gap:8px;margin:0;padding:0;list-style:none}.notes li{display:grid;gap:4px;padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--panel-raised)}.notes time{color:var(--muted);font-size:.62rem}.notes p{margin:0;font-size:.72rem;overflow-wrap:anywhere;white-space:pre-wrap}.case-meta{display:flex;flex-wrap:wrap;gap:14px;color:var(--muted);font-size:.64rem}.case-actions{display:flex;flex-wrap:wrap;gap:8px}.case-actions a,.case-actions button{min-height:36px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--panel-raised);font-size:.68rem}.case-actions a{color:var(--accent)}
@media(max-width:800px){.heading{align-items:start;flex-direction:column}.history header{display:block}.history header>div:last-child{margin-top:12px}.table-wrap{margin-inline:-22px;padding-inline:22px}li{grid-template-columns:1fr} .event-head small{width:100%;margin:0}.case-toolbar{flex-direction:column;align-items:stretch}.track>div{flex-direction:column}.track input{min-width:0}.case-head{grid-template-columns:1fr;gap:7px}.updated{order:3}.field-grid{grid-template-columns:1fr}}</style>
