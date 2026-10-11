<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { createCasePracticeRecord, previewCasePracticePackets } from '#lib/analysis/case-practice.ts';
  import { compareCaseHandoffCopies } from '../../../../packages/cases/case-handoff-comparison.mts';
  import CaseHandoffComparisonView from './CaseHandoffComparisonView.svelte';

  let copies = $state.raw<Awaited<ReturnType<typeof previewCasePracticePackets>> | null>(null);
  let busy = $state(false), error = $state('');
  let heading = $state<HTMLHeadingElement>();
  let generation = 0, live = true;
  let controller = new AbortController();
  const comparison = $derived(compareCaseHandoffCopies(copies?.[0] ?? null, copies?.[1] ?? null));
  function clear() {
    generation++; controller.abort(); copies = null; busy = false; error = '';
  }
  onDestroy(() => { live = false; clear(); });
  async function prepare() {
    if (!live || busy) return;
    clear(); controller = new AbortController();
    const current = generation;
    busy = true;
    try {
      const next = await previewCasePracticePackets(createCasePracticeRecord('credential-form'), controller.signal);
      if (!live || generation !== current) return;
      copies = next;
      await tick();
      if (live && generation === current) heading?.focus();
    } catch {
      if (live && generation === current) error = 'The fictional drafts could not be compared. Your practice Case and drafts are unchanged.';
    } finally { if (live && generation === current) busy = false; }
  }
</script>

<section class="practice-packets" aria-label="Fictional response draft comparison">
  <p>Compare two draft selections from a fresh copy of the supplied fictional Case. They change the internal recipient, page or advertisement scope, and selected evidence. Your practice edits and simulated delivery history stay separate.</p>
  <div class="actions"><button class="btn" type="button" disabled={busy} onclick={() => void prepare()}>Compare supplied fictional drafts</button>
    <button class="btn" type="button" onclick={clear}>Clear fictional comparison</button></div>
  {#if busy}<p role="status">Preparing and validating fictional drafts…</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if copies}<h4 bind:this={heading} tabindex="-1">Fictional draft differences</h4>
    <p>Both packets remain unauthorised drafts. No packet was downloaded, delivered or imported. A pin missing from one selection is still retained in the source Case.</p>
    <CaseHandoffComparisonView {comparison} labels={['Baseline draft', 'Comparison draft']} />
    <details><summary>Fictional packet identities</summary>
      {#each copies as copy, index}<p>{index === 0 ? 'Baseline' : 'Comparison'} · response packet schema {copy.version}<br><code>{copy.digest}</code></p>{/each}
      <p>These hashes identify the generated examples, not a real recipient, submission or authorisation. The pair is discarded when cleared, closed, restarted or left.</p>
    </details>
  {/if}
</section>

<style>
  .practice-packets { display: grid; gap: 12px; min-width: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  p, h4 { margin: 0; overflow-wrap: anywhere; }
  p { max-width: 85ch; line-height: 1.6; }
  code { overflow-wrap: anywhere; }
  button { white-space: normal; }
</style>
