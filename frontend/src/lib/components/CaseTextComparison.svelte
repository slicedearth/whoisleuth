<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import { readRetainedCaseFiles } from '#lib/case-attachments.ts';
  import { runInvestigationPackageWorker } from '#lib/investigation-package-worker.ts';
  import TextPassageResults from './TextPassageResults.svelte';
  import { galleryFileKind } from '#lib/analysis/retained-evidence-gallery.ts';
  import {
    TEXT_COMPARISON_BYTES,
    type TextPassageComparison,
  } from '../../../../packages/comparison/text-passages.mts';

  let { record }: { record: CaseRecord } = $props();
  // Retained text uses the existing generic-binary contract. The filename is
  // only a selection hint; the worker validates the complete UTF-8 contents.
  const files = $derived(
    (record.attachments ?? []).filter(file => galleryFileKind(file) === 'text'),
  );
  const id = $props.id();
  let referenceId = $state(''),
    candidateId = $state(''),
    error = $state(''),
    busy = $state(false);
  let result = $state.raw<TextPassageComparison | null>(null);
  let heading = $state<HTMLHeadingElement>(),
    trigger = $state<HTMLButtonElement>();
  let controller: AbortController | null = null;
  const reference = $derived(files.find((file) => file.id === referenceId));
  const candidate = $derived(files.find((file) => file.id === candidateId));
  function invalidate() {
    controller?.abort();
    controller = null;
    result = null;
    error = '';
    busy = false;
  }
  $effect(() => {
    record.id;
    referenceId;
    candidateId;
    JSON.stringify(files);
    untrack(invalidate);
  });
  onDestroy(() => controller?.abort());
  async function compare() {
    if (busy || !reference || !candidate || reference.id === candidate.id) return;
    const current = new AbortController();
    controller = current;
    busy = true;
    error = '';
    result = null;
    try {
      if (
        reference.byteLength > TEXT_COMPARISON_BYTES ||
        candidate.byteLength > TEXT_COMPARISON_BYTES
      )
        throw new Error(
          'Choose text files no larger than 1 MiB each. The retained originals are unchanged.',
        );
      const selected = await readRetainedCaseFiles([reference, candidate]);
      if (current.signal.aborted) return;
      const compared = await runInvestigationPackageWorker(
        'textCompare',
        { left: selected[0]!.file, right: selected[1]!.file },
        { signal: current.signal },
      );
      if (current.signal.aborted || controller !== current) return;
      result = compared;
      await tick();
      if (!current.signal.aborted) heading?.focus();
    } catch (cause) {
      if (!current.signal.aborted)
        error =
          cause instanceof Error ? cause.message : 'The retained text files could not be compared.';
    } finally {
      if (controller === current) {
        busy = false;
        controller = null;
      }
    }
  }
  async function cancel() {
    invalidate();
    await tick();
    trigger?.focus();
  }
</script>

<details class="text-comparison">
  <summary>Compare retained text</summary>
  <div class="body">
    <p
      >Find shared passages in two UTF-8 text files, up to 1 MiB and 65,536 words each. The files
      stay unchanged.</p
    >
    {#if files.length < 2}<p>Retain two plain-text files named .txt or .text to compare them.</p
      >{:else}
      <div class="selectors">
        <label for={`${id}-reference`}
          >Reference text<select id={`${id}-reference`} bind:value={referenceId}
            ><option value="">Choose reference</option>{#each files as file (file.id)}<option
                value={file.id}>{file.fileName}</option
              >{/each}</select
          ></label
        >
        <label for={`${id}-candidate`}
          >Candidate text<select id={`${id}-candidate`} bind:value={candidateId}
            ><option value="">Choose candidate</option>{#each files as file (file.id)}<option
                value={file.id}>{file.fileName}</option
              >{/each}</select
          ></label
        >
      </div>
      <div class="actions"
        ><button
          class="btn"
          bind:this={trigger}
          disabled={busy || !reference || !candidate || referenceId === candidateId}
          onclick={() => void compare()}>Compare text passages</button
        >{#if busy}<button class="btn" onclick={() => void cancel()}>Cancel comparison</button><span
            role="status">Comparing verified local files…</span
          >{/if}</div
      >
    {/if}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if result && reference && candidate}<TextPassageResults {result} {reference} {candidate} bind:heading />{/if}
  </div>
</details>

<style>
  .text-comparison {
    min-width: 0;
    border-top: 1px solid var(--border);
  }
  summary {
    cursor: pointer;
    padding-block: 10px;
    font-weight: 650;
  }
  .body {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  p {
    font-size: var(--text-xs);
    line-height: 1.6;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--muted);
  }
  .selectors {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    min-width: 0;
  }
  label {
    display: grid;
    gap: 5px;
    min-width: 0;
    font-size: var(--text-xs);
  }
  select {
    min-width: 0;
    width: 100%;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  button {
    max-width: 100%;
    white-space: normal;
  }
  [role='alert'] {
    color: var(--danger);
  }
  @media (max-width: 640px) {
    .selectors {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
