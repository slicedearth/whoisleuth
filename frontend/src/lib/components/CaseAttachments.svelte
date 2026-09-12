<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import type { CaseAttachment } from '../../../../packages/cases/case-attachment-model.mts';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import { isoFromUtcInput, utcDateTimeInputAttributes } from '$lib/analysis/case-response-form-values.ts';
  import { prepareCaseAttachmentFiles, readRetainedCaseFile, removeRetainedCaseAttachment, retainCaseAttachments, type SelectedCaseAttachment } from '$lib/case-attachments.ts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import { supportsArtifactPreview } from '$lib/artifact-preview.ts';
  import { trackTransientCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import ArtifactPreview from './ArtifactPreview.svelte';
  import CaseImageReview from './CaseImageReview.svelte';

  let { record, mutationBusy, persistOperation, onmessage }: {
    record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation; onmessage: (message: string) => void;
  } = $props();
  let input = $state<HTMLInputElement>();
  let summary = $state<HTMLElement>();
  let source = $state('');
  let observedAt = $state('');
  let pending = $state.raw<readonly SelectedCaseAttachment[]>([]);
  let preparing = $state(false);
  let loading = $state('');
  let preview = $state.raw<{ attachment: CaseAttachment; file: Blob } | null>(null);
  let removing = $state<CaseAttachment | null>(null);
  let error = $state('');
  let imageReview = $state<CaseImageReview>();
  let imageBusy = $state(false);
  let generation = 0;
  let activeCaseId: string | undefined;
  let previewTrigger: HTMLButtonElement | null = null;
  trackTransientCaseDraft(() => pending.length > 0 || preparing);
  $effect(() => {
    if (record.id === activeCaseId) return;
    activeCaseId = record.id;
    generation++; pending = []; source = ''; observedAt = ''; preview = null; removing = null; error = ''; preparing = false; loading = '';
  });
  onDestroy(() => { generation++; });

  async function select(event: Event) {
    const selected = event.currentTarget as HTMLInputElement;
    const files = Array.from(selected.files ?? []); selected.value = '';
    if (!files.length || mutationBusy || preparing || loading || imageBusy || (imageReview && !imageReview.confirmDiscard())) return;
    if (pending.length && !window.confirm('Replace the unsaved file selection? Retained files will not change.')) return;
    const current = ++generation;
    preparing = true; error = ''; preview = null;
    try {
      const ready = await prepareCaseAttachmentFiles(files, null, null);
      if (current === generation) pending = ready;
    } catch (cause) { if (current === generation) error = cause instanceof Error ? cause.message : 'The selected files could not be prepared.'; }
    finally { if (current === generation) preparing = false; }
  }

  async function retain() {
    if (!pending.length || mutationBusy || preparing) return;
    error = '';
    const selected = pending, current = generation, caseId = record.id;
    try {
      const observed = isoFromUtcInput(observedAt);
      if (observedAt.trim() && observed === null) throw new Error('Enter a valid observation date and time in UTC, or leave it empty when unknown.');
      const files = selected.map(item => ({ file: item.file, attachment: { ...item.attachment, source: source.trim() || null, observedAt: observed } }));
      if (await persistOperation(() => retainCaseAttachments(caseId, files), `Retained ${files.length} original file reference${files.length === 1 ? '' : 's'}.`, () => input ?? null)
        && current === generation && pending === selected) { pending = []; source = ''; observedAt = ''; }
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The files could not be retained.'; }
  }

  async function open(attachment: CaseAttachment, download: boolean, trigger: HTMLButtonElement) {
    if (mutationBusy || preparing || loading || imageBusy) return;
    if (!download && imageReview && !imageReview.confirmDiscard()) return;
    const current = ++generation;
    if (!download) { preview = null; previewTrigger = trigger; }
    loading = attachment.id; error = '';
    try {
      const file = await readRetainedCaseFile(attachment);
      if (current !== generation || !record.attachments?.some(item => item.id === attachment.id)) return;
      if (download) { downloadLocalFile(file, attachment.fileName); onmessage(`Prepared the verified ${attachment.derivation ? 'derived' : 'original'} file download.`); }
      else preview = { attachment, file };
    } catch (cause) { if (current === generation) error = cause instanceof Error ? cause.message : 'The original file could not be read.'; }
    finally { if (current === generation) loading = ''; }
  }

  async function closePreview() {
    if (imageReview && !imageReview.confirmDiscard()) return;
    preview = null; await tick(); previewTrigger?.focus();
  }
  async function remove() {
    const expected = removing;
    if (!expected || mutationBusy) return;
    if (preview?.attachment.id === expected.id && imageReview && !imageReview.confirmDiscard()) return;
    if (await persistOperation(() => removeRetainedCaseAttachment(record.id, expected), 'Removed the file reference. Shared original bytes remain while another Case references them.', () => summary ?? null)) {
      if (preview?.attachment.id === expected.id) preview = null;
      removing = null;
    }
  }
</script>

<details class="case-files">
  <summary bind:this={summary}>Retained files <span>{record.attachments?.length ?? 0}</span></summary>
  <div class="files-body">
    <p>Keep selected originals in this workspace. File digests identify bytes, not their source or accuracy. Ordinary JSON backups contain references only; keep a separate copy of the originals.</p>
    <label class="file-select btn">{preparing ? 'Checking selected files…' : 'Choose original files'}<input bind:this={input} type="file" multiple disabled={preparing || mutationBusy || Boolean(loading) || imageBusy} onchange={select}></label>
    {#if pending.length}
      <section aria-label="Files selected for retention" class="pending-files">
        <h4>{pending.length} selected · not saved</h4>
        <ul>{#each pending as item}<li><span>{item.attachment.fileName} · {item.attachment.byteLength.toLocaleString('en-AU')} bytes</span><button class="btn" type="button" disabled={mutationBusy || preparing} onclick={() => pending = pending.filter(candidate => candidate !== item)}>Remove {item.attachment.fileName} from selection</button></li>{/each}</ul>
        <div class="source-fields"><label>Source <input bind:value={source} maxlength="240" disabled={mutationBusy} placeholder="Optional source description"></label><label>Observed at (UTC) <input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={observedAt} disabled={mutationBusy}></label></div>
        <p>An empty observation time remains unknown. Retaining the file does not create a new source observation.</p>
        <button class="primary" type="button" disabled={mutationBusy || preparing} onclick={() => void retain()}>Retain selected files</button>
      </section>
    {/if}
    {#if error}<p class="file-error" role="alert">{error}</p>{/if}
    {#if record.attachments?.length}
      <ul class="retained-files">{#each record.attachments as attachment (attachment.id)}
        <li>
          <div class="file-heading"><h4>{attachment.fileName}</h4><span>{attachment.byteLength.toLocaleString('en-AU')} bytes · {attachment.mediaType}</span></div>
          <p>{attachment.source ?? 'Source not declared'} · {#if attachment.observedAt}Observed <time datetime={attachment.observedAt}>{attachment.observedAt.replace('T', ' ').replace('Z', ' UTC')}</time>{:else}Observation time unknown{/if}</p>
          <p>Retained <time datetime={attachment.retainedAt}>{attachment.retainedAt.replace('T', ' ').replace('Z', ' UTC')}</time></p>
          <p class="file-digest"><code>{attachment.digestSha256}</code></p>
          {#if attachment.derivation}<details class="derivation"><summary>Derived image details</summary><p>Edited from attachment <code>{attachment.derivation.sourceAttachmentId}</code> using {attachment.derivation.method}. The observation time belongs to the source, not the edit.</p><p>Source digest: <code>{attachment.derivation.source.digestSha256}</code></p><ol>{#each attachment.derivation.plan.regions as region}<li>{region.kind === 'redact' ? 'Redact' : 'Outline'}: left {region.x}, top {region.y}, {region.width} × {region.height} source pixels</li>{/each}</ol></details>{/if}
          <div class="file-actions">
            {#if supportsArtifactPreview(attachment.mediaType)}<button class="btn" type="button" aria-label={`Preview ${attachment.fileName}`} disabled={mutationBusy || Boolean(loading) || preparing || imageBusy} onclick={event => void open(attachment, false, event.currentTarget)}>Preview</button>{/if}
            <button class="btn" type="button" aria-label={`Download ${attachment.derivation ? 'derivative' : 'original'} ${attachment.fileName}`} disabled={mutationBusy || Boolean(loading) || preparing || imageBusy} onclick={event => void open(attachment, true, event.currentTarget)}>Download {attachment.derivation ? 'derivative' : 'original'}</button>
            <button class="btn" type="button" aria-label={`Remove ${attachment.fileName}`} disabled={mutationBusy || Boolean(loading) || preparing || imageBusy} onclick={() => removing = attachment}>Remove</button>
          </div>
          {#if loading === attachment.id}<p role="status">Verifying retained bytes…</p>{/if}
          {#if removing?.id === attachment.id}<div class="remove-file"><p>Remove this reference and its original bytes if no other Case references them?</p>{#if record.attachments.some(item => item.derivation?.sourceAttachmentId === attachment.id)}<p>Retained derivatives will keep their source fingerprint, but will no longer retain this source file.</p>{/if}<button class="btn" type="button" disabled={mutationBusy || imageBusy} onclick={() => void remove()}>Confirm removal</button><button class="btn" type="button" disabled={mutationBusy} onclick={() => removing = null}>Keep file</button></div>{/if}
        </li>
      {/each}</ul>
    {:else}<p>No file references are retained in this Case.</p>{/if}
    {#if preview}
      <section aria-label={`File preview: ${preview.attachment.fileName}`} class="file-preview">
        <button class="btn" type="button" disabled={mutationBusy || imageBusy} onclick={() => void closePreview()}>Close file preview</button>
        {#key preview.attachment.id}
          {#if preview.attachment.mediaType === 'image/png'}
            <CaseImageReview bind:this={imageReview} {record} attachment={preview.attachment} file={preview.file} {mutationBusy} {persistOperation} onbusy={value => imageBusy = value} />
          {:else}<ArtifactPreview file={preview.file} mediaType={preview.attachment.mediaType} label={preview.attachment.fileName} />{/if}
        {/key}
      </section>
    {/if}
  </div>
</details>

<style>
  .case-files{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}summary span{margin-left:8px;color:var(--muted)}
  details[open]>summary{border-bottom:1px solid var(--border)}.files-body{display:grid;gap:12px;padding:14px;min-width:0}
  p{margin:0;color:var(--muted);font:400 var(--text-xs)/1.55 var(--font-sans);overflow-wrap:anywhere}h4{margin:0;font:650 var(--text-sm)/1.4 var(--font-sans);overflow-wrap:anywhere}
  .file-select{justify-self:start}.file-select input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.file-select:focus-within{outline:2px solid var(--focus);outline-offset:3px}
  .pending-files{display:grid;gap:12px}.pending-files ul,.retained-files{list-style:none;padding:0;margin:0}.pending-files li{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:6px 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .source-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.source-fields label{display:grid;gap:5px;min-width:0;font-size:var(--text-xs)}.source-fields input{width:100%;min-width:0}.primary{justify-self:start}
  .retained-files>li{display:grid;gap:8px;min-width:0;padding:15px 0;border-top:1px solid var(--border)}.file-heading{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:baseline;min-width:0}.file-heading span{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .file-digest code{font:400 var(--text-2xs)/1.5 var(--mono);overflow-wrap:anywhere}.file-actions,.remove-file{display:flex;flex-wrap:wrap;gap:8px}.remove-file{align-items:center}.file-actions button{white-space:normal;overflow-wrap:anywhere;max-width:100%}.file-error{color:var(--danger)}
  .file-preview{display:grid;gap:14px;min-width:0;border-top:1px solid var(--border);padding-top:14px}.file-preview>button{justify-self:start}.derivation{min-width:0}.derivation summary{padding:8px 0}.derivation p,.derivation li{font-size:var(--text-xs);overflow-wrap:anywhere}.derivation ol{padding-left:1.5em}
  @media(max-width:600px){.source-fields{grid-template-columns:minmax(0,1fr)}.files-body{padding:12px}.file-actions{align-items:stretch}.file-actions button{flex:1 1 100%}}
</style>
