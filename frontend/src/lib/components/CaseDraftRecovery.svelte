<script lang="ts">
  import type { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import { tick } from 'svelte';
  import { restoreSubmittedFocus } from '$lib/controllers/submitted-draft.ts';
  let { draft }: { draft: ReturnType<typeof createCaseDraft> } = $props();
  let previewId = $state<string | null>(null);
  async function recover(event: MouseEvent, action: () => Promise<void>) {
    const origin = event.currentTarget as HTMLButtonElement;
    const stage = origin.closest('.case-response-stage');
    await action(); await tick();
    const form = stage?.querySelector(`form[data-recovery-form="${CSS.escape(draft.form)}"]`);
    const target = form?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)');
    restoreSubmittedFocus(origin, target, stage);
  }
</script>

{#if draft.state.message || draft.state.readError || draft.state.candidates.length}
  <div class="draft-recovery" data-recovery-form={draft.form} data-recovery-status={draft.state.status}>
    {#if draft.state.readError || draft.state.message}<p role="status">{draft.state.readError || draft.state.message}</p>{/if}
    <div class="draft-actions">
      {#if draft.state.readError}<button type="button" class="btn small" disabled={draft.state.busy} onclick={() => void draft.refresh()}>Reload saved drafts</button>{/if}
      {#if draft.state.status === 'error' && draft.state.edited}<button type="button" class="btn small" disabled={draft.state.busy} onclick={() => void draft.flush().catch(() => {})}>Retry recovery save</button>{/if}
      {#if draft.state.edited}<button type="button" class="btn small" disabled={draft.state.busy} onclick={(event) => void recover(event, () => draft.discard())}>Discard this draft</button>{/if}
    </div>
    {#if draft.state.candidates.length}
      <details><summary>{draft.state.candidates.length} saved draft{draft.state.candidates.length === 1 ? '' : 's'} for this form</summary>
        <p>{draft.retention === 'document' ? 'Practice copies stay on this page only.' : 'Recovery copies stay in this workspace and are not included in exports.'} Discard the current form before restoring another copy.</p>
        <ul>{#each draft.state.candidates as candidate (candidate.id)}
          <li><span>{new Date(candidate.updatedAt).toLocaleString()}</span>
            <button type="button" class="btn small" disabled={draft.state.busy || draft.state.edited || candidate.formVersion !== 1} onclick={(event) => void recover(event, () => draft.restore(candidate))}>Restore draft</button>
            <button type="button" class="btn small" disabled={draft.state.busy} onclick={() => void draft.discard(candidate)}>Discard saved draft</button>
            <button type="button" class="btn small" aria-expanded={previewId === candidate.id} onclick={() => previewId = previewId === candidate.id ? null : candidate.id}>View saved values</button>
            {#if previewId === candidate.id}<pre>{JSON.stringify(candidate.fields, null, 2)}</pre>{/if}
          </li>
        {/each}</ul>
      </details>
    {/if}
  </div>
{/if}

<style>
  .draft-recovery{display:grid;gap:6px;color:var(--muted);font-size:var(--text-xs)}p{margin:0;overflow-wrap:anywhere}.draft-actions,li{display:flex;flex-wrap:wrap;align-items:center;gap:8px}ul{display:grid;gap:8px;list-style:none;padding:0}summary{cursor:pointer}details>p{margin-block:8px}pre{flex-basis:100%;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text)}
</style>
