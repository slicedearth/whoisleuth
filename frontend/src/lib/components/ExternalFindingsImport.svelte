<script lang="ts">
  import {
    importExternalFindings,
    MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
    parseExternalFindingsDocument,
    type ExternalFindingsDocument,
  } from '$lib/cases';

  let {
    oncomplete,
    onmessage,
  }: {
    oncomplete: () => void | Promise<void>;
    onmessage: (message: string) => void;
  } = $props();

  let preview = $state<ExternalFindingsDocument | null>(null);
  let applying = $state(false);
  const domains = $derived(preview ? [...new Set(preview.findings.map((finding) => finding.domain))] : []);

  function countLabel(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
  }

  async function selectFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    preview = null;
    if (!file) return;
    try {
      if (file.size > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) {
        throw new Error('External finding imports are limited to 384 KiB.');
      }
      preview = parseExternalFindingsDocument(JSON.parse(await file.text()));
      onmessage(`Validated ${preview.findings.length} local finding${preview.findings.length === 1 ? '' : 's'} for ${domains.length} domain${domains.length === 1 ? '' : 's'}. Review the preview before importing.`);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'External findings import could not be validated.');
    } finally {
      input.value = '';
    }
  }

  async function applyImport() {
    if (!preview || applying) return;
    applying = true;
    try {
      const result = await importExternalFindings(preview);
      await oncomplete();
      onmessage(`Imported ${result.findingsAdded} finding${result.findingsAdded === 1 ? '' : 's'} into ${result.casesCreated} new and ${result.casesUpdated} existing case${result.casesCreated + result.casesUpdated === 1 ? '' : 's'}${result.duplicatesSkipped ? `; skipped ${result.duplicatesSkipped} duplicate${result.duplicatesSkipped === 1 ? '' : 's'}` : ''}${result.pruned ? `; pruned ${result.pruned} old evidence snapshot${result.pruned === 1 ? '' : 's'} to stay within storage` : ''}.`);
      preview = null;
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'External findings could not be imported.');
    } finally {
      applying = false;
    }
  }
</script>

<details class="external-import card">
  <summary>Import bounded external findings</summary>
  <div class="import-body">
    <p>Use the strict <code>whoisleuth.external-findings</code> JSON schema to preview inert, local evidence pins before changing any cases. Imports never fetch references, run code, alter analyst dispositions, or submit data elsewhere.</p>
    <label class="btn file-btn">Choose JSON<input type="file" accept="application/json,.json" onchange={selectFile}></label>
    {#if preview}
      <section class="preview" aria-labelledby="external-findings-preview-title">
        <header>
          <div><p class="eyebrow">Validated preview</p><h3 id="external-findings-preview-title">{preview.source.name}</h3></div>
          <span>{countLabel(preview.findings.length, 'finding')} · {countLabel(domains.length, 'domain')}</span>
        </header>
        <ul>
          {#each preview.findings.slice(0, 8) as finding}
            <li><strong>{finding.domain}</strong><span>{finding.category} · {finding.completeness}</span><p>{finding.summary}</p></li>
          {/each}
        </ul>
        {#if preview.findings.length > 8}<p class="preview-note">Showing 8 of {preview.findings.length} validated findings.</p>{/if}
        <div class="actions"><button class="primary" type="button" onclick={() => void applyImport()} disabled={applying}>{applying ? 'Importing…' : 'Import into cases'}</button><button class="btn" type="button" onclick={() => preview = null} disabled={applying}>Cancel</button></div>
      </section>
    {/if}
  </div>
</details>

<style>
  .external-import{margin-top:10px;padding:0}
  summary{padding:12px 14px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  details[open]>summary{border-bottom:1px solid var(--border)}
  .import-body{display:grid;gap:10px;padding:13px}
  .import-body>p{max-width:880px;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  code{color:var(--accent);font-size:var(--text-2xs)}
  .file-btn{justify-self:start}
  .preview{display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .preview header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px}
  .preview h3{margin:0;font-size:var(--text-base)}
  .preview header>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .preview ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .preview li{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .preview li strong,.preview li span{display:block;overflow-wrap:anywhere}
  .preview li span{margin-top:2px;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .preview li p{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .preview-note{margin:0;color:var(--muted);font-size:var(--text-2xs)}
  .actions{display:flex;flex-wrap:wrap;gap:8px}
  @media(max-width:680px){.preview ul{grid-template-columns:minmax(0,1fr)}.actions button{flex:1}}
</style>
