<script lang="ts">
  import { onDestroy } from 'svelte';
  import { CLI_CASE_PACK_INPUT_CASE_VERSIONS, SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS } from '../../../../packages/contracts/case-portability.mts';
  import { MAX_CASE_HANDOFF_INPUT_BYTES, compareCaseHandoffCopies, readCaseHandoffCopy, type CaseHandoffCopy } from '../../../../packages/cases/case-handoff-comparison.mts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import CaseHandoffComparisonView from './CaseHandoffComparisonView.svelte';

  let { caseId, domain }: { caseId: string; domain: string } = $props();
  const id = $props.id();
  const labels = ['Baseline export', 'Comparison export'] as const;
  let copies = $state.raw<(CaseHandoffCopy | null)[]>([null, null]);
  let busy = $state([false, false]), errors = $state(['', '']);
  let inputs: (HTMLInputElement | undefined)[] = [];
  const generation = [0, 0];
  const result = $derived(compareCaseHandoffCopies(copies[0] ?? null, copies[1] ?? null));

  function clear() {
    generation[0]!++; generation[1]!++;
    copies = [null, null]; busy = [false, false]; errors = ['', ''];
    for (const input of inputs) if (input) input.value = '';
  }
  onDestroy(clear);
  async function selectFile(event: Event, side: number) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
    const revision = ++generation[side]!;
    copies = copies.map((copy, index) => index === side ? null : copy);
    errors[side] = ''; busy[side] = Boolean(file);
    if (!file) return;
    let bytes: Uint8Array | undefined;
    try {
      if (!file.size || file.size > MAX_CASE_HANDOFF_INPUT_BYTES) throw new Error(`Select a Case export or response packet between 1 and ${MAX_CASE_HANDOFF_INPUT_BYTES} bytes.`);
      bytes = new Uint8Array(await file.arrayBuffer());
      if (generation[side] !== revision) return;
      const copy = await readCaseHandoffCopy(bytes);
      if (generation[side] !== revision) return;
      if (copy.caseId !== caseId || copy.domain !== domain) throw new Error('Select an export for this exact Case ID and domain.');
      const next = copies.map((previous, index) => index === side ? copy : previous);
      compareCaseHandoffCopies(next[0] ?? null, next[1] ?? null);
      copies = next;
    } catch (cause) {
      if (generation[side] === revision) errors[side] = cause instanceof Error ? cause.message : 'The selected Case export could not be read.';
    } finally {
      bytes?.fill(0);
      if (generation[side] === revision) { busy[side] = false; input.value = ''; }
    }
  }
</script>

<section class="handoff-comparison" aria-label="Read-only Case export comparison">
  <p>Compare two Case exports or two response packets for this Case. Nothing is imported or saved. Missing entries are absent from that selected copy, not proven deleted from the Case.</p>
  <div class="selectors">
    {#each labels as label, side}<div>
      <label for={`${id}-${side}`}>{label} (JSON)</label>
      <input bind:this={inputs[side]} id={`${id}-${side}`} type="file" accept="application/json,.json" onchange={event => void selectFile(event, side)}>
      {#if busy[side]}<p role="status">Reading {label.toLowerCase()}…</p>{/if}
      {#if errors[side]}<p role="alert">{errors[side]}</p>{/if}
      {#if copies[side]}<p>{copies[side]!.kind === 'response_packet' ? 'Response packet' : 'Case'} schema {copies[side]!.version} · exported {formatEvidenceDate(copies[side]!.exportedAt, 'time not recorded')}</p>
        <details><summary>{label} file identity</summary><code>{copies[side]!.digest}</code></details>{/if}
    </div>{/each}
  </div>
  <button type="button" class="btn" onclick={() => clear()}>Clear comparison</button>
  <CaseHandoffComparisonView comparison={result} />
  <details><summary>Formats and comparison scope</summary>
    <p>Ordinary single-Case exports with schemas {CLI_CASE_PACK_INPUT_CASE_VERSIONS.join(', ')} and response packets with schemas {SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS.join(', ')} are supported. Both selections must be the same kind of file. Packet structure, reviewed-input binding and integrity are checked before comparison; older packets without a reviewed-input binding keep their original contract. CLI packs and encrypted containers are not accepted here. Use the separate package review to unlock a handoff and deliberately select its exported JSON.</p>
    <p>Records align only by exact IDs. Shared-record order changes are shown separately; other arrays compare as complete values. All selected fields participate, including recipient routes, limitations and scope. Packet generation times, authorisations and integrity blocks describe that packet, not new evidence, submission, acceptance or permission to act. File digests do not authenticate a reviewer. This view adds no import permission and has no download action.</p>
    <p>Copies remain in page memory until replaced, cleared, this comparison is closed or the Case is left. These full private exports can contain notes, filenames and response details.</p>
  </details>
</section>

<style>
  .handoff-comparison { display: grid; gap: 12px; min-width: 0; }
  p { margin: 0; overflow-wrap: anywhere; }
  p { max-width: 85ch; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
  .selectors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .selectors > div { min-width: 0; }
  label { display: block; margin-bottom: 6px; }
  input[type='file'] { max-width: 100%; min-height: var(--control-h); font: inherit; color: var(--text); }
  input[type='file']::file-selector-button { min-height: var(--control-h); padding: 8px; margin-right: 8px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  code { overflow-wrap: anywhere; }
  button { justify-self: start; }
  @media (max-width: 700px) { .selectors { grid-template-columns: minmax(0, 1fr); } }
</style>
