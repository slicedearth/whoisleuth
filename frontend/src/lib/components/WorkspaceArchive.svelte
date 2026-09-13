<script lang="ts">
  import { onMount, tick } from 'svelte';
  import BrowserWorkspaceIndicator from '$lib/components/BrowserWorkspaceIndicator.svelte';
  import BrowserStorageHealth from './BrowserStorageHealth.svelte';
  import WorkspaceRecovery from './WorkspaceRecovery.svelte';
  import WorkspaceFileBackup from './WorkspaceFileBackup.svelte';
  import { hasUnlockedBrowserWorkspace } from '$lib/browser-workspace-unlock.ts';
  import { currentBrowserWorkspaceId, DEFAULT_BROWSER_WORKSPACE } from '$lib/browser-workspace-context.ts';
  import { isLocalApplication } from '$lib/local-application-context.ts';
  import { boundedJsonLimitsForBytes, parseBoundedJson } from '$lib/bounded-json';
  import {
    MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
    MAX_WORKSPACE_ARCHIVE_BYTES,
    MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES,
    MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS,
    createEncryptedWorkspaceArchiveDownload,
    createWorkspaceArchiveDownload,
    decryptLocalWorkspaceArchive,
    inspectEncryptedWorkspaceArchive,
    isEncryptedWorkspaceArchive,
    prepareLocalWorkspaceArchive,
  } from '$lib/workspace-archive';
  import type { WorkspaceImportSummary } from '$lib/workspace-archive';
  import { restoreLegacyBrowserData } from '$lib/browser-local-data-service';

  type ArchiveReview = Awaited<ReturnType<typeof prepareLocalWorkspaceArchive>>;
  type WorkspacePreview = Awaited<ReturnType<ArchiveReview['preview']>>;

  let { onimport, importOnly = false }:{onimport?:(message:string)=>void|Promise<void>;importOnly?:boolean}=$props();
  let archiveReview=$state.raw<ArchiveReview|null>(null);
  let encryptedSource=$state(false);
  let preparedBackup=$state.raw<Awaited<ReturnType<typeof createWorkspaceArchiveDownload>>['archive'] | null>(null);
  let preview=$state<WorkspacePreview|null>(null);
  let selectedIds=$state<string[]>([]);
  let message=$state('');
  let busy=$state(false);
  let showEncryptionForm=$state(false);
  let exportPassphrase=$state('');
  let confirmPassphrase=$state('');
  let encryptedImportValue=$state<unknown>(null);
  let importPassphrase=$state('');
  let importHeading=$state<HTMLHeadingElement>();
  let importStatus=$state<HTMLParagraphElement>();
  let defaultWorkspace=$state(true);
  let localApplication=$state(false);
  let preparedAt=$state<string|null>(null);
  onMount(() => { localApplication=isLocalApplication(); defaultWorkspace=!localApplication && currentBrowserWorkspaceId()===DEFAULT_BROWSER_WORKSPACE; });

  function selected(id:string){return selectedIds.includes(id);}
  async function toggle(id:string,checked:boolean){
    const nextIds=checked?[...new Set([...selectedIds,id])]:selectedIds.filter((item)=>item!==id);
    selectedIds=nextIds;
    if(!archiveReview)return;
    busy=true;
    try{
      preview=await archiveReview.preview(nextIds);
      selectedIds=preview.sections.filter((section)=>section.status==='ready'&&section.selected).map((section)=>section.id);
    }catch(cause){message=cause instanceof Error?cause.message:'Could not update the workspace selection preview.';}
    finally{busy=false;}
  }

  function downloadFile(output:{content:string;mimeType:string;filename:string}){
    const url=URL.createObjectURL(new Blob([output.content],{type:output.mimeType}));
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=output.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadUnencrypted(){
    busy=true;message='';
    try{
      const output=await createWorkspaceArchiveDownload();
      downloadFile(output);
      preparedBackup=output.archive;
      preparedAt=new Date().toISOString();
      message=`Prepared an unencrypted workspace backup with ${output.archive.manifest.sectionCount} verified data sections. Check the downloaded file.`;
    }catch(cause){message=cause instanceof Error?cause.message:'Could not create the workspace archive.';}
    finally{busy=false;}
  }

  async function downloadEncrypted(){
    busy=true;message='';
    try{
      if(exportPassphrase!==confirmPassphrase)throw new Error('The backup passphrases do not match.');
      const output=await createEncryptedWorkspaceArchiveDownload(exportPassphrase);
      downloadFile(output);
      preparedBackup=output.archive;
      showEncryptionForm=false;
      preparedAt=new Date().toISOString();
      message=`Prepared an encrypted workspace backup with ${output.archive.manifest.sectionCount} verified data sections. Check the downloaded file and keep its passphrase separately.`;
    }catch(cause){message=cause instanceof Error?cause.message:'Could not encrypt the workspace archive.';}
    finally{
      exportPassphrase='';
      confirmPassphrase='';
      busy=false;
    }
  }

  async function previewArchive(value:unknown){
    const review=await prepareLocalWorkspaceArchive(value);
    const result=await review.preview();
    archiveReview=review;preview=result;
    selectedIds=result.sections.filter((section)=>section.status==='ready').map((section)=>section.id);
    message=`Reviewed ${result.sections.length} backup sections. Check existing matches and skipped records before merging.`;
  }

  export async function reviewFile(file:Blob):Promise<void>{
    if(busy)throw new Error('Finish the current workspace operation before opening another file.');
    archiveReview=null;preview=null;selectedIds=[];encryptedImportValue=null;importPassphrase='';message='';encryptedSource=false;
    busy=true;
    try{
      if(file.size>MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES)throw new Error(`Encrypted workspace archive imports are limited to ${MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES} bytes.`);
      const value=parseBoundedJson(await file.text(),{label:'Workspace archive',maximumBytes:MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,limits:boundedJsonLimitsForBytes(MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES)});
      if(isEncryptedWorkspaceArchive(value)){
        encryptedSource=true;
        const inspected=inspectEncryptedWorkspaceArchive(value);
        encryptedImportValue=value;
        message=`Encrypted backup selected (${inspected.ciphertextBytes.toLocaleString()} encrypted bytes). Enter its passphrase to review the contents locally.`;
      }else{
        if(file.size>MAX_WORKSPACE_ARCHIVE_BYTES)throw new Error(`Unencrypted workspace archive imports are limited to ${MAX_WORKSPACE_ARCHIVE_BYTES / 1024 / 1024} MiB.`);
        await previewArchive(value);
      }
      await tick();importHeading?.focus();
    }catch(cause){message=cause instanceof Error?cause.message:'Could not preview the workspace archive.';throw cause;}
    finally{busy=false;}
  }

  async function chooseFile(event:Event){
    const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];input.value='';
    if(file)await reviewFile(file).catch(()=>{});
  }

  async function unlockImport(){
    if(!encryptedImportValue)return;
    busy=true;message='';
    try{
      const value=await decryptLocalWorkspaceArchive(encryptedImportValue,importPassphrase);
      await previewArchive(value);
      encryptedImportValue=null;
    }catch(cause){message=cause instanceof Error?cause.message:'Could not decrypt the workspace archive.';}
    finally{importPassphrase='';busy=false;}
  }

  async function apply(){
    if(!archiveReview)return;
    busy=true;message='';
    try{
      const result=await archiveReview.merge(selectedIds);
      const totals=result.results.reduce(
        (sum:Omit<WorkspaceImportSummary,'id'>,item)=>({
          added:sum.added+item.added,
          updated:sum.updated+item.updated,
          skipped:sum.skipped+item.skipped,
          pruned:sum.pruned+item.pruned,
          brandProfileReferencesOmitted:sum.brandProfileReferencesOmitted+item.brandProfileReferencesOmitted,
          authoredHistoryOmitted:sum.authoredHistoryOmitted+item.authoredHistoryOmitted,
        }),
        {added:0,updated:0,skipped:0,pruned:0,brandProfileReferencesOmitted:0,authoredHistoryOmitted:0},
      );
      const resultMessage=`Added backup data from ${result.results.length} sections: ${totals.added} new, ${totals.updated} existing matches, ${totals.skipped} skipped${totals.brandProfileReferencesOmitted?`, ${totals.brandProfileReferencesOmitted} Brand Profile reference${totals.brandProfileReferencesOmitted===1?'':'s'} omitted beyond the retained bounds`:''}${totals.authoredHistoryOmitted?`, ${totals.authoredHistoryOmitted} malformed, duplicate or over-limit authored-history record${totals.authoredHistoryOmitted===1?'':'s'} omitted`:''}${totals.pruned?`, ${totals.pruned} older evidence snapshot${totals.pruned===1?'':'s'} pruned to fit`:''}.`;
      archiveReview=null;preview=null;selectedIds=[];
      message=resultMessage;
      try {
        await onimport?.(resultMessage);
      } catch {
        message=`${resultMessage} The Dashboard summary could not be refreshed; reload it to reread the saved workspace.`;
      }
    }catch(cause){message=cause instanceof Error?cause.message:'Workspace archive import failed.';}
    finally{busy=false;await tick();importStatus?.focus();}
  }

  async function prepareRollbackCopy(){
    busy=true;message='';
    try{
      const result=await restoreLegacyBrowserData();
      message=`Updated the legacy rollback copy for ${result.collectionCount} browser-local collections (${result.serializedBytes.toLocaleString()} bytes).`;
    }catch(cause){message=cause instanceof Error?cause.message:'Could not update the legacy rollback copy.';}
    finally{busy=false;}
  }
</script>

<section class="workspace-archive card" aria-labelledby="workspace-archive-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">{importOnly ? 'Bring existing work' : 'Manage saved data'}</p>
      <h2 id="workspace-archive-title" bind:this={importHeading} tabindex="-1">{importOnly ? 'Import a workspace' : 'Back up or move saved work'}</h2>
      <p>{importOnly ? 'Review a supported workspace backup before adding its selected records to this workspace.' : 'Download supported work from this workspace, or review a previous backup before adding it here.'}</p>
    </div>
    <div class="top-actions toolbar">
      {#if !importOnly}<button class="primary" type="button" onclick={()=>showEncryptionForm=!showEncryptionForm} aria-expanded={showEncryptionForm} aria-controls={showEncryptionForm?'workspace-encryption-form':undefined} disabled={busy}>Download encrypted backup</button>{/if}
      <label class="btn file-btn" class:disabled={busy}>Review backup file<input type="file" accept="application/json,.json" onchange={chooseFile} disabled={busy}></label>
    </div>
  </header>
  <BrowserWorkspaceIndicator destination />
  {#if !importOnly && !localApplication}<BrowserStorageHealth {preparedAt} />{/if}
  {#if localApplication && preparedAt}<p>Backup prepared during this visit: {new Date(preparedAt).toLocaleString()}. Check the downloaded file; a prepared download is not a verified restore.</p>{/if}
  {#if preparedBackup}{#key preparedBackup}<WorkspaceFileBackup archive={preparedBackup} />{/key}{/if}

  {#if showEncryptionForm}
    <form id="workspace-encryption-form" class="encryption-form" onsubmit={(event)=>{event.preventDefault();void downloadEncrypted();}}>
      <div>
        <p class="eyebrow">Protect the downloaded file</p>
        <h3>Set a backup passphrase</h3>
        <p>Encryption happens in this browser. The passphrase is not stored or sent anywhere, and WHOISleuth cannot recover it.</p>
      </div>
      <label class="field">Passphrase
        <input type="password" autocomplete="new-password" minlength={MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} maxlength={MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES} bind:value={exportPassphrase} disabled={busy} required>
        <small>Use at least {MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} characters and keep it separately from the file.</small>
      </label>
      <label class="field">Confirm passphrase
        <input type="password" autocomplete="new-password" minlength={MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} maxlength={MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES} bind:value={confirmPassphrase} disabled={busy} required>
      </label>
      <div class="encryption-actions">
        <button class="primary" type="submit" disabled={busy||!exportPassphrase||!confirmPassphrase}>Encrypt and download</button>
        <button class="btn" type="button" onclick={()=>{showEncryptionForm=false;exportPassphrase='';confirmPassphrase='';}} disabled={busy}>Cancel</button>
      </div>
    </form>
  {/if}

  {#if encryptedImportValue}
    <form class="encryption-form import-unlock" onsubmit={(event)=>{event.preventDefault();void unlockImport();}}>
      <div>
        <p class="eyebrow">Encrypted backup</p>
        <h3>Unlock locally to review</h3>
        <p>The decrypted content stays in memory only while this page reviews and merges it.</p>
      </div>
      <label class="field">Backup passphrase
        <input type="password" autocomplete="off" minlength={MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} maxlength={MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES} bind:value={importPassphrase} disabled={busy} required>
      </label>
      <div class="encryption-actions">
        <button class="primary" type="submit" disabled={busy||!importPassphrase}>Unlock and review</button>
        <button class="btn" type="button" onclick={()=>{encryptedImportValue=null;importPassphrase='';message='Encrypted backup review cancelled.';}} disabled={busy}>Cancel</button>
      </div>
    </form>
  {/if}

  <p class="privacy-note">Backups can include case notes and other analyst-owned records. Encrypted downloads protect the file while it is locked, but not this browser while the Console is open. Unfinished Case forms, sessions, passwords, API credentials, hosted-monitor keys, raw upstream payloads, tab state, and unrelated browser storage are excluded.</p>
  {#if !importOnly}<details class="archive-details">
    <summary>How workspace backups work</summary>
    <p>Each backup uses a versioned manifest and a SHA-256 checksum for every data section. WHOISleuth checks its format, size, supported versions, and integrity before showing a merge preview. Existing work follows each data type's normal merge rules, and records missing from the backup are retained.</p>
    <p>Encrypted backups use browser-native PBKDF2-HMAC-SHA-256 and AES-256-GCM authenticated encryption. Encryption cannot protect an unlocked Console from software already able to read the page. A forgotten passphrase makes the backup unrecoverable.</p>
    <button class="btn unencrypted-download" type="button" onclick={downloadUnencrypted} disabled={busy}>Download unencrypted backup</button>
    {#if defaultWorkspace}
      <p>WHOISleuth keeps the original local-storage documents after its one-time IndexedDB migration. If you intend to return to an older build after making changes here, update those legacy copies first. This does not replace a downloaded backup and can fail when the workspace no longer fits within local-storage limits.</p>
      <button class="btn rollback-copy" type="button" onclick={prepareRollbackCopy} disabled={busy}>Update legacy rollback copy</button>
    {:else if localApplication}<p>This filesystem workspace has no browser-storage rollback copy. Download a portable backup for recovery.</p>
    {:else}<p>Named workspaces have no historical local-storage copy. Download a portable backup for recovery; the default workspace is unchanged.</p>{/if}
  </details>{/if}

  {#if preview}
    <div class="preview" role="group" aria-labelledby="workspace-archive-preview-title">
      <header>
        <div><p class="eyebrow">Backup review</p><h3 id="workspace-archive-preview-title">Choose saved data to add</h3></div>
        <span>{preview.bytes.toLocaleString()} bytes · {preview.generatedAt?new Date(preview.generatedAt).toLocaleString():'Unknown creation time'}</span>
      </header>
      <p>Existing matches use each data type's established merge rules. Records absent from the backup are retained, and nothing is written until you choose Add selected data.</p>
      <ul>
        {#each preview.sections as section}
          <li class:unsupported={section.status==='unsupported'} class:blocked={section.status==='blocked'}>
            <label>
              <input type="checkbox" checked={selected(section.id)} disabled={section.status!=='ready'||busy} onchange={(event)=>void toggle(section.id,(event.currentTarget as HTMLInputElement).checked)}>
              <span><strong>{section.label}</strong><small>{section.recordCount} in archive · {section.added} new · {section.updated} existing match{section.updated===1?'':'es'} · {section.skipped} skipped{section.brandProfileReferencesOmitted?` · ${section.brandProfileReferencesOmitted} Brand Profile reference${section.brandProfileReferencesOmitted===1?'':'s'} will be omitted`:''}{section.authoredHistoryOmitted?` · ${section.authoredHistoryOmitted} malformed, duplicate or over-limit authored-history record${section.authoredHistoryOmitted===1?'':'s'} will be omitted`:''}{section.pruned?` · ${section.pruned} older evidence snapshot${section.pruned===1?'':'s'} will be pruned`:''}</small></span>
            </label>
            <span class="state">{section.status==='ready'?'Ready':section.status==='unsupported'?'Unsupported':'Blocked'}</span>
            {#if section.reason}<p>{section.reason}</p>{/if}
          </li>
        {/each}
      </ul>
      <div class="preview-actions">
        <button class="primary" type="button" onclick={apply} disabled={busy||!selectedIds.length}>Add selected data</button>
        <button class="btn" type="button" onclick={()=>{archiveReview=null;preview=null;selectedIds=[];message='Preview cancelled.';}} disabled={busy}>Cancel</button>
      </div>
      {#if localApplication}
        <details class="archive-details"><summary>Rehearse filesystem recovery</summary><p>Start a separate local application with a new empty folder and <code>--init --offline</code>. Review and import this backup there, then restore its original files or evidence package. Compare the restored records and file verification results before relying on the backup. Keep the original folder unchanged.</p><a href="/cli#local-application">Local recovery instructions</a></details>
      {:else if archiveReview}{#key archiveReview}<WorkspaceRecovery readArchive={archiveReview.read} requireEncryption={encryptedSource || hasUnlockedBrowserWorkspace()} onbusy={value => { busy = value; }} />{/key}{/if}
    </div>
  {/if}

  {#if message}<p bind:this={importStatus} class="status" role="status" aria-live="polite" tabindex="-1">{message}</p>{/if}
</section>

<style>
  .workspace-archive{margin-top:34px;padding:21px}.section-head{align-items:flex-start}.section-head h2,.preview h3,.encryption-form h3{margin:3px 0 0;font:700 1.15rem var(--mono)}.section-head>div>p:not(.eyebrow),.privacy-note,.archive-details,.preview>p,.preview li p,.encryption-form>div>p:not(.eyebrow){color:var(--muted);font-size:var(--text-xs);line-height:1.55}.section-head>div>p:not(.eyebrow){max-width:720px;margin:7px 0 0}.privacy-note{margin:14px 0 0;padding:11px 12px;border-left:2px solid var(--amber);background:color-mix(in srgb,var(--amber) 7%,transparent)}.encryption-form{display:grid;grid-template-columns:minmax(220px,1.3fr) repeat(2,minmax(180px,1fr));gap:12px;align-items:end;margin-top:16px;padding:16px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));border-radius:var(--radius-sm);background:color-mix(in srgb,var(--accent) 4%,var(--panel-raised))}.encryption-form>div>p:not(.eyebrow){max-width:500px;margin:6px 0 0}.encryption-actions{display:flex;grid-column:2/-1;justify-content:flex-end;gap:8px;align-items:center}.import-unlock{grid-template-columns:minmax(260px,1fr) minmax(220px,1fr) auto}.import-unlock .encryption-actions{grid-column:auto}.archive-details{margin-top:12px}.archive-details summary{cursor:pointer;color:var(--text);font:700 var(--text-xs) var(--mono)}.archive-details p{max-width:880px;margin:8px 0 0}.unencrypted-download,.rollback-copy{margin-top:4px}.file-btn.disabled{opacity:.55;pointer-events:none}.preview{margin-top:18px;padding-top:18px;border-top:1px solid var(--border)}.preview>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.preview>header>span{color:var(--muted);font-size:var(--text-2xs);text-align:right}.preview>p{margin:9px 0 12px}.preview ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}.preview li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;align-items:center;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.preview li.unsupported{border-style:dotted}.preview li.blocked{border-color:color-mix(in srgb,var(--danger) 42%,var(--border))}.preview li label{display:flex;min-width:0;gap:10px;align-items:flex-start}.preview li label>span{display:grid;min-width:0;gap:3px}.preview li strong{overflow-wrap:anywhere;font:700 var(--text-xs) var(--mono)}.preview li small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}.preview li .state{color:var(--accent2);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.preview li.unsupported .state{color:var(--muted)}.preview li.blocked .state{color:var(--danger)}.preview li p{grid-column:1/-1;margin:0 0 0 26px}.preview-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}.status{margin:13px 0 0;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:980px){.encryption-form,.import-unlock{grid-template-columns:1fr 1fr}.encryption-form>div,.encryption-actions{grid-column:1/-1}}
  @media(max-width:700px){.workspace-archive{padding:16px}.section-head,.preview>header{align-items:stretch;flex-direction:column}.top-actions,.top-actions .btn,.top-actions .primary,.preview-actions,.preview-actions button{width:100%}.top-actions,.encryption-form,.import-unlock,.preview-actions{display:grid;grid-template-columns:minmax(0,1fr)}.encryption-form>div,.encryption-actions{grid-column:auto}.encryption-actions{display:grid}.encryption-actions button{width:100%}.preview>header>span{text-align:left}.preview li{grid-template-columns:minmax(0,1fr)}.preview li .state{margin-left:26px}}
</style>
