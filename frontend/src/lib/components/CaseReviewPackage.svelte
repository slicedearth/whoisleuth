<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import { canonicalArtifactJsonV2 } from '../../../../packages/evidence/artifact-integrity.mts';
  import { prepareCaseReviewHandoff, assertCaseReviewHandoffCurrent } from '$lib/case-review-package.ts';
  import EvidenceFileExport from './EvidenceFileExport.svelte';

  let { record, disabled = false, onbusy = () => {} }: { record: CaseRecord; disabled?: boolean; onbusy?: (busy: boolean) => void } = $props();
  let excludedIds = $state<string[]>([]), activeCase = '', busy = $state(false), checking = $state(false), message = $state(''), error = $state('');
  let ready = $state.raw<Awaited<ReturnType<typeof prepareCaseReviewHandoff>> | null>(null);
  let heading = $state<HTMLHeadingElement>();
  let controller: AbortController | null = null;
  const selection = $derived((record.attachments ?? []).filter(item => !excludedIds.includes(item.id)));
  const ids = $derived(selection.map(item => item.id));
  const stale = $derived(Boolean(ready && (ready.expectedCase !== canonicalArtifactJsonV2(record)
    || JSON.stringify(ready.selection.selected.map(item => item.id).sort()) !== JSON.stringify([...ids].sort()))));
  $effect(() => {
    if (record.id === activeCase) return;
    activeCase = record.id; controller?.abort(); ready = null; error = ''; message = '';
    excludedIds = [];
  });
  onDestroy(() => { controller?.abort(); ready = null; onbusy(false); });
  async function check() {
    if (disabled || busy || checking) return;
    const current = new AbortController(); controller = current;
    checking = true; onbusy(true); ready = null; error = ''; message = '';
    try {
      const checked = await prepareCaseReviewHandoff(record, [...ids], current.signal);
      await assertCaseReviewHandoffCurrent(checked.expectedCase, checked.record.id);
      current.signal.throwIfAborted(); ready = checked;
      await tick(); if (!current.signal.aborted) heading?.focus();
    } catch (cause) { if (!current.signal.aborted) error = cause instanceof Error ? cause.message : 'The handoff contents could not be checked.'; }
    finally { if (controller === current) { controller = null; checking = false; onbusy(false); } }
  }
  async function validate() {
    if (!ready || stale) throw new Error('Check the current Case and file selection again before downloading.');
    await assertCaseReviewHandoffCurrent(ready.expectedCase, ready.record.id);
  }
</script>

<section class="review-package" aria-labelledby={`review-package-${record.id}`}>
  <h4 id={`review-package-${record.id}`}>Prepare an encrypted handoff</h4>
  <p>Include the full Case and the originals the reviewer needs. Notes, incident links, filenames and saved response records are private, unredacted content. Unfinished forms, authentication state and other Cases are not included.</p>
  {#if record.attachments?.length}<fieldset disabled={disabled || busy || checking}><legend>Original files to include</legend>
    {#each record.attachments as attachment (attachment.id)}<label><input type="checkbox" checked={ids.includes(attachment.id)} onchange={event => { excludedIds = event.currentTarget.checked ? excludedIds.filter(id => id !== attachment.id) : [...excludedIds, attachment.id]; }}> <span>{attachment.fileName} · {attachment.byteLength.toLocaleString('en-AU')} bytes</span></label>{/each}
  </fieldset>{/if}
  <p>{selection.length} of {record.attachments?.length ?? 0} file references selected. Identical bytes are packaged once; each source declaration stays in the Case.</p>
  <button class="btn" type="button" disabled={disabled || busy || checking} onclick={() => void check()}>{checking ? 'Checking Case and originals…' : 'Check handoff contents'}</button>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if ready}
    <div class="checked">
      <h5 bind:this={heading} tabindex="-1">Handoff contents checked</h5>
      <p>{ready.selection.omitted.length ? 'Partial file selection' : 'All referenced originals included'} · One complete Case · {ready.selection.files.length} distinct file bodies · {ready.files.reduce((sum, item) => sum + item.file.size, 0).toLocaleString('en-AU')} bytes</p>
      {#if ready.selection.omitted.length}<p>{ready.selection.omitted.length} reference{ready.selection.omitted.length === 1 ? ' has' : 's have'} no selected bytes. The Case keeps those references; the recipient’s completeness check will identify them.</p><ul>{#each ready.selection.omitted as item}<li>{item.fileName}</li>{/each}</ul>{/if}
      {#if stale}<p role="alert">The Case or selection changed. Check the contents again before downloading.</p>{/if}
      <EvidenceFileExport workflow="Case second-opinion handoff" requireEncryption disabled={disabled || checking || stale}
        getFiles={async signal => { signal.throwIfAborted(); await validate(); return ready!.files; }} validateSelection={validate}
        onbusy={value => { busy = value; onbusy(value); }} onmessage={value => message = value} />
      <p>Ask the reviewer to unlock and verify the package in Dashboard’s saved-work tools, download its Case JSON and needed originals, and import the Case into a separate workspace. Return a current Case export or another encrypted handoff. Send the passphrase separately.</p>
    </div>
  {/if}
  <p role="status" aria-label="Case handoff status">{message}</p>
</section>

<style>
  .review-package,.checked{display:grid;gap:12px;min-width:0}.review-package{border-block:1px solid var(--border);padding-block:16px}h4,h5,p{margin:0;overflow-wrap:anywhere}h4,h5{font:650 var(--text-sm)/1.4 var(--font-sans)}p,li,legend{font:400 var(--text-xs)/1.6 var(--font-sans)}p{max-width:80ch;color:var(--muted)}fieldset{margin:0;padding:8px 0;border:0;min-width:0}label{display:flex;align-items:center;gap:8px;min-height:44px;font-size:var(--text-xs);overflow-wrap:anywhere}label input{flex:none}label span{min-width:0}button{justify-self:start;max-width:100%;white-space:normal}ul{margin:0;padding-left:22px}[role=alert]{color:var(--danger)}[role=status]:empty{display:none}
</style>
