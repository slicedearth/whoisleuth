<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { MAX_CASE_TAG_BATCH_TEXT_LENGTH, parseCaseBatchTags, type CaseTagBatchIntent, type CaseTagBatchPreview } from '../../../../packages/cases/case-tag-batch.mts';
  import { MAX_CASE_BATCH_MUTATIONS } from '../../../../packages/cases/case-batch-limits.mts';
  import { MAX_TAG_LENGTH, MAX_TAGS_PER_CASE } from '../../../../packages/contracts/case-portability.mts';
  import { caseNumber } from '../../../../packages/cases/case-workflow-metadata.mts';
  import { caseWorkspaceHref } from '#lib/analysis/case-response-stage.ts';
  import { trackTransientCaseDraft } from '#lib/controllers/case-draft.svelte.ts';
  import { createDraftRevision, restoreSubmittedFocus } from '#lib/controllers/submitted-draft.ts';
  import { failedLocalMutationOutcome } from '#lib/local-mutation-outcome.ts';
  import CopyButton from './CopyButton.svelte';
  import Pagination from './Pagination.svelte';

  let { selectedIds, disabled = false, onclear, captureSelection, onpreview, onapply }: {
    selectedIds: readonly string[]; disabled?: boolean; onclear: () => void;
    captureSelection: () => () => boolean;
    onpreview: (intent: CaseTagBatchIntent) => Promise<CaseTagBatchPreview>;
    onapply: (preview: CaseTagBatchPreview) => Promise<{ changed: number; unchanged: number }>;
  } = $props();
  let text = $state(''), operation = $state<'add' | 'remove'>('add');
  let preview = $state.raw<CaseTagBatchPreview | null>(null), previewKey = $state('');
  let phase = $state<'preparing' | 'saving' | null>(null), uncertain = $state(false), message = $state(''), previewPage = $state(1);
  const busy = $derived(phase !== null);
  let heading = $state<HTMLHeadingElement>(), status = $state<HTMLParagraphElement>(), root = $state<HTMLElement>();
  let disposed = false, generation = 0;
  const key = $derived(JSON.stringify([selectedIds, operation, text]));
  const revision = createDraftRevision(() => key);
  const currentPreview = $derived(previewKey === key ? preview : null);
  const changedCount = $derived(currentPreview?.rows.filter(row => row.state === 'changed').length ?? 0);
  const pageCount = $derived(Math.max(1, Math.ceil((currentPreview?.rows.length ?? 0) / 25)));
  const currentPage = $derived(Math.min(previewPage, pageCount));
  const pageRows = $derived(currentPreview?.rows.slice((currentPage - 1) * 25, currentPage * 25) ?? []);
  $effect(() => { if (preview && previewKey !== key) preview = null; });
  trackTransientCaseDraft(() => Boolean(text.trim()) || uncertain);
  onDestroy(() => { disposed = true; generation++; preview = null; });
  function captureDraft() { const selection = captureSelection(), draft = revision.capture(); return () => selection() && draft(); }
  function edit() { revision.changed(); preview = null; message = ''; }
  function discard() { edit(); text = ''; onclear(); }
  async function prepare() {
    if (busy || disabled || uncertain) return;
    const origin = document.activeElement, unchanged = captureDraft(), request = ++generation;
    phase = 'preparing'; preview = null; message = '';
    try {
      const intent = { ids: [...selectedIds], operation, tags: parseCaseBatchTags(text) };
      const result = await onpreview(intent);
      if (disposed || request !== generation) return;
      if (!unchanged()) { message = 'The selection or tag draft changed while cases were read. Preview the current draft.'; return; }
      preview = result; previewKey = key; previewPage = 1;
      await tick();
      if (!disposed && request === generation) restoreSubmittedFocus(origin, heading, root);
    } catch (cause) {
      if (!disposed && request === generation) message = cause instanceof Error ? cause.message : 'The tag preview could not be prepared. Saved cases were not changed.';
    } finally {
      if (!disposed && request === generation) {
        phase = null; await tick();
        if (!disposed && request === generation && unchanged()) restoreSubmittedFocus(origin, currentPreview ? heading : status, root);
      }
    }
  }
  async function apply() {
    const reviewed = currentPreview;
    if (busy || disabled || uncertain || !reviewed?.canApply || !changedCount) return;
    const origin = document.activeElement, unchanged = captureDraft(), request = ++generation;
    phase = 'saving'; message = '';
    try {
      const result = await onapply(reviewed);
      if (disposed || request !== generation) return;
      message = `Tags saved for ${result.changed} cases; ${result.unchanged} already matched the requested tags.`;
      if (unchanged()) { text = ''; onclear(); preview = null; }
      else message += ' The current tag draft was not part of this write.';
    } catch (cause) {
      if (disposed || request !== generation) return;
      uncertain = failedLocalMutationOutcome(cause) === 'unknown';
      preview = null;
      message = uncertain
        ? 'The write outcome is unknown. Reload and inspect the saved tags before another batch; do not repeat this write.'
        : cause instanceof Error ? cause.message : 'Tags could not be saved. Prepare a new preview before deliberately retrying.';
    } finally {
      if (!disposed && request === generation) {
        phase = null; await tick();
        if (!disposed && request === generation) restoreSubmittedFocus(origin, status ?? origin as HTMLElement, root);
      }
    }
  }
</script>

<section aria-label="Case batch tagging" bind:this={root}>
  <p>Select cases in the queue, then add or remove literal tags. {selectedIds.length} selected across pages and filters.</p>
  <div class="tag-controls">
    <label>Tag operation<select bind:value={operation} onchange={edit}><option value="add">Add tags</option><option value="remove">Remove tags</option></select></label>
    <label>Batch tags<textarea bind:value={text} oninput={edit} maxlength={MAX_CASE_TAG_BATCH_TEXT_LENGTH} rows="2" placeholder="Separate tags with commas or new lines"></textarea></label>
  </div>
  <div class="actions"><button class="btn" type="button" disabled={busy || disabled || uncertain || !selectedIds.length || !text.trim()} onclick={prepare}>Preview exact tag changes</button>
    <button class="btn" type="button" disabled={busy || uncertain} onclick={discard}>Discard tag draft and selection</button></div>
  {#if phase}<p role="status" aria-live="polite">{phase === 'preparing' ? 'Reading cases and preparing exact tag changes…' : 'Saving the reviewed tag changes…'}</p>{/if}
  {#if message}<p bind:this={status} tabindex="-1" role="status" aria-label="Case tag batch status" aria-live="polite">{message}</p>{/if}
  {#if uncertain}<button class="btn" type="button" onclick={() => window.location.reload()}>Reload saved Cases</button>{/if}
  {#if currentPreview}
    <section class="preview" aria-label="Exact Case tag changes">
      <h2 bind:this={heading} tabindex="-1">Exact Case tag changes</h2>
      <p>{currentPreview.rows.length} exact records · {changedCount} changes · {currentPreview.rows.filter(row => row.state === 'unchanged').length} unchanged · {currentPreview.rows.filter(row => row.state === 'blocked').length} blocked.</p>
      {#each currentPreview.blockers as blocker}<p>{blocker}</p>{/each}
      {#each pageRows as row (row.id)}
        <article>
          <h3>{row.title || row.domain || 'Case unavailable'}</h3>
          <p><code>{caseNumber(row.id)}</code> <CopyButton value={caseNumber(row.id)} label="Copy Case number" description={`Copy Case number ${caseNumber(row.id)}`} /></p>
          {#if row.domain}<p><code>{row.domain}</code> · {row.state}</p><a href={caseWorkspaceHref(row.id)}>Open this Case</a>{/if}
          <dl><div><dt>Before</dt><dd>{#if row.expectedTags.length}<ul>{#each row.expectedTags as tag}<li>{tag}</li>{/each}</ul>{:else}No tags{/if}</dd></div>
            <div><dt>After</dt><dd>{#if row.nextTags.length}<ul>{#each row.nextTags as tag}<li>{tag}</li>{/each}</ul>{:else}No tags{/if}</dd></div></dl>
          {#if row.limitation}<p>{row.limitation}</p>{/if}
        </article>
      {/each}
      <Pagination {currentPage} {pageCount} setPage={value => previewPage = value} ariaLabel="Case tag preview pages" pageInputLabel="Case tag preview page" />
      <button class="btn primary" type="button" disabled={busy || disabled || uncertain || !currentPreview.canApply || !changedCount} onclick={apply}>Apply reviewed tag changes</button>
      {#if !changedCount && currentPreview.canApply}<p>No tag changes are needed; saved records and timestamps remain unchanged.</p>{/if}
    </section>
  {/if}
  <details><summary>Tag selection limits</summary><p>At most {MAX_CASE_BATCH_MUTATIONS} exact cases and {MAX_TAGS_PER_CASE} requested tags of {MAX_TAG_LENGTH} characters each. Matching ignores case but preserves retained spelling and order. Duplicates and over-limit additions are rejected, not shortened. Every target is rechecked before one atomic write; tags do not change evidence or disposition.</p></details>
</section>

<style>
  section,article{min-width:0;overflow-wrap:anywhere}p{line-height:1.6}h2,h3{margin-block:.75rem}.tag-controls{display:grid;grid-template-columns:minmax(10rem,1fr) minmax(0,3fr);gap:1rem}label{display:grid;gap:.5rem;font-size:var(--text-sm)}textarea,select{width:100%;min-width:0}textarea{resize:vertical}.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-block:1rem}.preview{margin-block:1rem}.preview article{padding-block:1rem;border-top:1px solid var(--border)}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}dt{font-weight:650}dd{margin:.5rem 0 0}ul{margin:0;padding-inline-start:1.25rem}code{white-space:normal;overflow-wrap:anywhere}summary{cursor:pointer;min-height:44px;align-content:center}@media(max-width:700px){.tag-controls,dl{grid-template-columns:minmax(0,1fr)}}
</style>
