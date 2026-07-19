<script lang="ts">
  import {
    MAX_WORKSPACE_ARCHIVE_BYTES,
    createWorkspaceArchiveDownload,
    mergeLocalWorkspaceArchive,
    previewLocalWorkspaceArchive,
  } from '$lib/workspace-archive';

  let { onimport }:{onimport?:()=>void}=$props();
  let archiveValue=$state<unknown>(null);
  let preview=$state<any>(null);
  let selectedIds=$state<string[]>([]);
  let message=$state('');
  let busy=$state(false);

  function selected(id:string){return selectedIds.includes(id);}
  function toggle(id:string,checked:boolean){selectedIds=checked?[...new Set([...selectedIds,id])]:selectedIds.filter((item)=>item!==id);}

  async function download(){
    busy=true;message='';
    try{
      const output=await createWorkspaceArchiveDownload();
      const url=URL.createObjectURL(new Blob([output.content],{type:output.mimeType}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=output.filename;anchor.click();URL.revokeObjectURL(url);
      message=`Downloaded ${output.archive.manifest.sectionCount} verified workspace sections.`;
    }catch(cause){message=cause instanceof Error?cause.message:'Could not create the workspace archive.';}
    finally{busy=false;}
  }

  async function chooseFile(event:Event){
    const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];
    archiveValue=null;preview=null;selectedIds=[];message='';
    if(!file)return;
    busy=true;
    try{
      if(file.size>MAX_WORKSPACE_ARCHIVE_BYTES)throw new Error('Workspace archive imports are limited to 10 MiB.');
      const value=JSON.parse(await file.text());
      const result=await previewLocalWorkspaceArchive(value);
      archiveValue=value;preview=result;
      selectedIds=result.sections.filter((section:any)=>section.status==='ready').map((section:any)=>section.id);
      message=`Previewed ${result.sections.length} archive sections. Review existing matches and skipped records before merging.`;
    }catch(cause){message=cause instanceof Error?cause.message:'Could not preview the workspace archive.';}
    finally{busy=false;input.value='';}
  }

  async function apply(){
    if(!archiveValue)return;
    busy=true;message='';
    try{
      const result=await mergeLocalWorkspaceArchive(archiveValue,selectedIds);
      const totals=result.results.reduce((sum:any,item:any)=>({added:sum.added+item.added,updated:sum.updated+item.updated,skipped:sum.skipped+item.skipped,pruned:sum.pruned+item.pruned}),{added:0,updated:0,skipped:0,pruned:0});
      message=`Merged ${result.results.length} sections: ${totals.added} new, ${totals.updated} existing matches, ${totals.skipped} skipped${totals.pruned?`, ${totals.pruned} older evidence snapshot${totals.pruned===1?'':'s'} pruned to fit`:''}.`;
      archiveValue=null;preview=null;selectedIds=[];onimport?.();
    }catch(cause){message=cause instanceof Error?cause.message:'Workspace archive import failed.';}
    finally{busy=false;}
  }
</script>

<section class="workspace-archive card" aria-labelledby="workspace-archive-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Portability</p>
      <h2 id="workspace-archive-title">Workspace archive</h2>
      <p>Move or back up supported browser-local investigation records with a versioned manifest and per-section checksums.</p>
    </div>
    <div class="top-actions toolbar">
      <button class="btn" type="button" onclick={download} disabled={busy}>Export workspace</button>
      <label class="btn file-btn" class:disabled={busy}>Preview archive<input type="file" accept="application/json,.json" onchange={chooseFile} disabled={busy}></label>
    </div>
  </header>

  <p class="privacy-note">Archives can include case notes and other analyst-owned records. They exclude sessions, passwords, API credentials, hosted-monitor keys, raw upstream payloads, tab state, and unrelated browser storage.</p>

  {#if preview}
    <div class="preview" aria-labelledby="workspace-archive-preview-title">
      <header>
        <div><p class="eyebrow">Import preview</p><h3 id="workspace-archive-preview-title">Choose sections to merge</h3></div>
        <span>{preview.bytes.toLocaleString()} bytes · {preview.generatedAt?new Date(preview.generatedAt).toLocaleString():'Unknown creation time'}</span>
      </header>
      <p>Existing matches use each store's established merge rules. Records absent from the archive are retained, and nothing is written until you choose Merge selected sections.</p>
      <ul>
        {#each preview.sections as section}
          <li class:unsupported={section.status!=='ready'}>
            <label>
              <input type="checkbox" checked={selected(section.id)} disabled={section.status!=='ready'||busy} onchange={(event)=>toggle(section.id,(event.currentTarget as HTMLInputElement).checked)}>
              <span><strong>{section.label}</strong><small>{section.recordCount} in archive · {section.added} new · {section.updated} existing match{section.updated===1?'':'es'} · {section.skipped} skipped{section.pruned?` · ${section.pruned} older evidence snapshot${section.pruned===1?'':'s'} will be pruned`:''}</small></span>
            </label>
            <span class="state">{section.status==='ready'?'Ready':section.status==='unsupported'?'Unsupported':'Blocked'}</span>
            {#if section.reason}<p>{section.reason}</p>{/if}
          </li>
        {/each}
      </ul>
      <div class="preview-actions">
        <button class="primary" type="button" onclick={apply} disabled={busy||!selectedIds.length}>Merge selected sections</button>
        <button class="btn" type="button" onclick={()=>{archiveValue=null;preview=null;selectedIds=[];message='Preview cancelled.';}} disabled={busy}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if message}<p class="status" role="status" aria-live="polite">{message}</p>{/if}
</section>

<style>
  .workspace-archive{margin-top:34px;padding:21px}.section-head{align-items:flex-start}.section-head h2,.preview h3{margin:3px 0 0;font:700 1.15rem var(--mono)}.section-head>div>p:not(.eyebrow),.privacy-note,.preview>p,.preview li p{color:var(--muted);font-size:var(--text-xs);line-height:1.55}.section-head>div>p:not(.eyebrow){max-width:720px;margin:7px 0 0}.privacy-note{margin:14px 0 0;padding:11px 12px;border-left:2px solid var(--amber);background:color-mix(in srgb,var(--amber) 7%,transparent)}.file-btn.disabled{opacity:.55;pointer-events:none}.preview{margin-top:18px;padding-top:18px;border-top:1px solid var(--border)}.preview>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.preview>header>span{color:var(--muted);font-size:var(--text-2xs);text-align:right}.preview>p{margin:9px 0 12px}.preview ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}.preview li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;align-items:center;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.preview li.unsupported{opacity:.72}.preview li label{display:flex;min-width:0;gap:10px;align-items:flex-start}.preview li label>span{display:grid;min-width:0;gap:3px}.preview li strong{overflow-wrap:anywhere;font:700 var(--text-xs) var(--mono)}.preview li small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}.preview li .state{color:var(--accent2);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.preview li.unsupported .state{color:var(--amber)}.preview li p{grid-column:1/-1;margin:0 0 0 26px}.preview-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}.status{margin:13px 0 0;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:700px){.workspace-archive{padding:16px}.section-head,.preview>header{align-items:stretch;flex-direction:column}.top-actions,.top-actions .btn,.preview-actions,.preview-actions button{width:100%}.top-actions{display:grid}.preview>header>span{text-align:left}.preview li{grid-template-columns:minmax(0,1fr)}.preview li .state{margin-left:26px}.preview-actions{display:grid}}
</style>
