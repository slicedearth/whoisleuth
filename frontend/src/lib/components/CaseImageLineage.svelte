<script lang="ts">
  import type { reviewCaseImageDerivation } from '../../../../packages/cases/case-attachment-model.mts';
  import { MAX_SELECTED_FILES } from '../../../../packages/contracts/selected-file-limits.mts';

  let { review }: { review: NonNullable<ReturnType<typeof reviewCaseImageDerivation>> } = $props();
  let expanded = $state(false);
</script>

<div class="image-lineage">
  <p>{review.steps.length} declared parent link{review.steps.length === 1 ? '' : 's'} reviewed in this Case. File bytes have not been checked by this review.</p>
  {#if review.termination === 'no_further_declaration'}<p>The last matching parent has no recorded edit declaration; this does not prove it is an unedited original.</p>
  {:else if review.termination === 'missing_parent'}<p>Stopped at a parent reference not retained in this Case. Earlier history is unresolved.</p>
  {:else if review.termination === 'conflicting_parent'}<p>Stopped at a conflicting parent reference. No alternative reference was substituted.</p>
  {:else if review.termination === 'cycle'}<p>Stopped at a repeated parent reference (a cycle). The declarations do not establish a creation order.</p>
  {:else}<p>Stopped at the Case limit of {MAX_SELECTED_FILES} declared parent links. Earlier history is unresolved.</p>{/if}
  <details bind:open={expanded}>
    <summary>Inspect declared links ({review.steps.length})</summary>
    {#if expanded}<ol aria-label="Declared image links">
      {#each review.steps as step}
        <li>
          <p>Declared edits: {step.declaration.operations.map(kind => kind === 'redact' ? 'redaction' : 'outline').join(', ')} · {step.declaration.method}</p>
          <p>Declared parent: <code>{step.declaration.source.digestSha256}</code> · {step.declaration.source.byteLength.toLocaleString('en-AU')} bytes</p>
          {#if step.parentReference === 'missing'}<p>The declared parent reference is not retained in this Case.</p>
          {:else if step.parentReference === 'conflicting'}<p>The retained parent reference conflicts with this declaration.</p>
          {:else}<p>The parent reference matches the recorded fingerprint and size. {step.parentHasDeclaredEdits ? 'It also declares edits.' : 'It has no recorded edit declaration.'}</p>{/if}
        </li>
      {/each}
    </ol>{/if}
  </details>
</div>

<style>
  .image-lineage{display:grid;gap:8px;min-width:0}
  p{margin:0;color:var(--muted);font:400 var(--text-xs)/1.55 var(--font-sans);overflow-wrap:anywhere}
  summary{min-height:44px;padding:10px 0;cursor:pointer;font:650 var(--text-xs)/1.5 var(--font-sans)}
  ol{margin:8px 0;padding-inline-start:1.5rem}li{margin-block:12px;padding-inline-start:4px;min-width:0}li p+p{margin-top:4px}
  code{font-size:var(--text-2xs);overflow-wrap:anywhere}
</style>
