<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import { readRetainedCaseFiles } from '$lib/case-attachments.ts';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import {
    TEXT_COMPARISON_BYTES,
    type TextPassageComparison,
  } from '../../../../packages/comparison/text-passages.mts';

  let { record }: { record: CaseRecord } = $props();
  // Retained text uses the existing generic-binary contract. The filename is
  // only a selection hint; the worker validates the complete UTF-8 contents.
  const files = $derived(
    (record.attachments ?? []).filter(
      (file) =>
        file.mediaType === 'application/octet-stream' && /\.(?:txt|text)$/iu.test(file.fileName),
    ),
  );
  const id = $props.id();
  let referenceId = $state(''),
    candidateId = $state(''),
    error = $state(''),
    busy = $state(false),
    page = $state(0);
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
    page = 0;
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
    page = 0;
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
  // Make directional formatting visible instead of allowing source text to reorder labels.
  const visible = (text: string) =>
    text.replace(
      /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
      (value) => `[U+${value.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`,
    );
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
    {#if result && reference && candidate}
      <h4 bind:this={heading} tabindex="-1"
        >{result.totalPassages} shared {result.totalPassages === 1 ? 'passage' : 'passages'}</h4
      >
      <p role="status"
        >{result.matchedCandidateWords} of {result.candidate.words} candidate words and {result.matchedReferenceWords}
        of {result.reference.words} reference words participate in these matches. {result.exactBytes
          ? 'The complete file bytes are identical.'
          : 'The complete file bytes differ.'}</p
      >
      <details
        ><summary>Sources and comparison method</summary>
        <dl
          >{#each [{ label: 'Reference', attachment: reference, measured: result.reference }, { label: 'Candidate', attachment: candidate, measured: result.candidate }] as source}<div
              ><dt>{source.label}: {source.attachment.fileName}</dt><dd
                >{source.attachment.source ?? 'Source not declared'} · {source.attachment
                  .observedAt ?? 'Observation time unknown'}<br /><code
                  >{source.measured.digestSha256}</code
                ></dd
              ></div
            >{/each}</dl
        >
        <ul
          >{#each result.limitations as limitation}<li>{limitation}</li>{/each}<li
            >Directional controls are shown as Unicode code points in the excerpts.</li
          ></ul
        >
      </details>
      <ol start={page * 8 + 1}
        >{#each result.passages.slice(page * 8, (page + 1) * 8) as passage}<li
            ><p>{passage.words} matching words</p><div class="passage"
              >{#each [{ label: 'Reference', excerpt: passage.reference }, { label: 'Candidate', excerpt: passage.candidate }] as part}<div
                  ><h5>{part.label} · characters {part.excerpt.start}–{part.excerpt.end}</h5
                  ><blockquote>{visible(part.excerpt.text)}</blockquote>{#if part.excerpt.clipped}<p
                      >Showing the first {part.excerpt.text.length.toLocaleString()} characters of this
                      passage. The full range above refers to the unchanged retained file.</p
                    >{/if}</div
                >{/each}</div
            ></li
          >{/each}</ol
      >
      {#if result.passages.length > 8}<nav aria-label="Text passages"
          ><button class="btn" disabled={page === 0} onclick={() => page--}
            >Previous passages</button
          ><span>{page + 1} of {Math.ceil(result.passages.length / 8)}</span><button
            class="btn"
            disabled={(page + 1) * 8 >= result.passages.length}
            onclick={() => page++}>Next passages</button
          ></nav
        >{/if}
      {#if result.omittedPassages}<p
          >{result.omittedPassages} further passages are counted but not listed. The list includes the
          first {result.passages.length} in candidate order.</p
        >{/if}
    {/if}
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
  p,
  li,
  dd {
    font-size: var(--text-xs);
    line-height: 1.6;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--muted);
  }
  h4,
  h5 {
    margin: 0;
    font-size: var(--text-sm);
  }
  h4:focus {
    outline: 2px solid var(--focus);
    outline-offset: 4px;
  }
  .selectors,
  .passage {
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
  .actions,
  nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  button {
    max-width: 100%;
    white-space: normal;
  }
  dl {
    display: grid;
    gap: 12px;
  }
  dt {
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  code {
    overflow-wrap: anywhere;
  }
  ol,
  ul {
    padding-left: 20px;
    display: grid;
    gap: 16px;
  }
  blockquote {
    margin: 8px 0;
    padding: 10px;
    background: var(--panel-raised);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    unicode-bidi: plaintext;
  }
  [role='alert'] {
    color: var(--danger);
  }
  @media (max-width: 640px) {
    .selectors,
    .passage {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
