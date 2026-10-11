<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { MAX_EDITABLE_CASE_INPUT_BYTES, CLI_CASE_PACK_INPUT_CASE_VERSIONS } from '../../../../packages/contracts/case-portability.mts';
  import { compareCaseHandoffCopies, readCaseHandoffCopy, type CaseHandoffCopy, type CaseHandoffChange } from '../../../../packages/cases/case-handoff-comparison.mts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import ArtifactPreview from './ArtifactPreview.svelte';

  let { caseId, domain }: { caseId: string; domain: string } = $props();
  const id = $props.id();
  const labels = ['Baseline export', 'Comparison export'] as const;
  const states: Record<CaseHandoffChange, string> = {
    unchanged: 'Unchanged', changed: 'Changed content',
    baseline_only: 'Only in baseline export', comparison_only: 'Only in comparison export',
  };
  let copies = $state.raw<(CaseHandoffCopy | null)[]>([null, null]);
  let busy = $state([false, false]), errors = $state(['', '']);
  let page = $state(1), showUnchanged = $state(false), selected = $state('');
  let heading = $state<HTMLHeadingElement>();
  let inputs: (HTMLInputElement | undefined)[] = [];
  const generation = [0, 0];
  const result = $derived(compareCaseHandoffCopies(copies[0] ?? null, copies[1] ?? null));
  const rows = $derived(result.rows.filter(row => showUnchanged || row.state !== 'unchanged'));
  const pages = $derived(Math.max(1, Math.ceil(rows.length / 10)));
  const visible = $derived(rows.slice((page - 1) * 10, page * 10));
  const active = $derived(visible.find(row => row.key === selected));
  const values = $derived(active ? [active.baseline, active.comparison].map(value => value === undefined
    ? null : new Blob([JSON.stringify(value)], { type: 'application/json' })) : []);
  const fieldLabel = (field: string) => field.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/^./u, letter => letter.toUpperCase());

  function clear() {
    generation[0]!++; generation[1]!++;
    copies = [null, null]; busy = [false, false]; errors = ['', '']; page = 1; selected = '';
    for (const input of inputs) if (input) input.value = '';
  }
  onDestroy(clear);
  async function selectFile(event: Event, side: number) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
    const revision = ++generation[side]!;
    copies = copies.map((copy, index) => index === side ? null : copy);
    errors[side] = ''; busy[side] = Boolean(file); page = 1; selected = '';
    if (!file) return;
    let bytes: Uint8Array | undefined;
    try {
      if (!file.size || file.size > MAX_EDITABLE_CASE_INPUT_BYTES) throw new Error(`Select a Case export between 1 and ${MAX_EDITABLE_CASE_INPUT_BYTES} bytes.`);
      bytes = new Uint8Array(await file.arrayBuffer());
      if (generation[side] !== revision) return;
      const copy = await readCaseHandoffCopy(bytes);
      if (generation[side] !== revision) return;
      if (copy.caseId !== caseId || copy.domain !== domain) throw new Error('Select an export for this exact Case ID and domain.');
      copies = copies.map((previous, index) => index === side ? copy : previous);
    } catch (cause) {
      if (generation[side] === revision) errors[side] = cause instanceof Error ? cause.message : 'The selected Case export could not be read.';
    } finally {
      bytes?.fill(0);
      if (generation[side] === revision) { busy[side] = false; input.value = ''; }
    }
  }
  async function inspect(key: string) {
    selected = key; await tick(); heading?.focus();
  }
</script>

<section class="handoff-comparison" aria-label="Read-only Case export comparison">
  <p>Compare two selected copies of this Case. Nothing is imported or saved. Missing entries are absent from that export, not proven deleted from the Case.</p>
  <div class="selectors">
    {#each labels as label, side}<div>
      <label for={`${id}-${side}`}>{label} (JSON)</label>
      <input bind:this={inputs[side]} id={`${id}-${side}`} type="file" accept="application/json,.json" onchange={event => void selectFile(event, side)}>
      {#if busy[side]}<p role="status">Reading {label.toLowerCase()}…</p>{/if}
      {#if errors[side]}<p role="alert">{errors[side]}</p>{/if}
      {#if copies[side]}<p>Case schema {copies[side]!.version} · exported {formatEvidenceDate(copies[side]!.exportedAt, 'time not recorded')}</p>
        <details><summary>{label} file identity</summary><code>{copies[side]!.digest}</code></details>{/if}
    </div>{/each}
  </div>
  <button type="button" class="btn" onclick={() => clear()}>Clear comparison</button>
  <p role="status" aria-label="Case export comparison status">{result.state === 'unavailable'
    ? 'Comparison unavailable — select both a baseline and a comparison export.'
    : `${result.counts.changed} changed · ${result.counts.comparison_only} only in comparison · ${result.counts.baseline_only} only in baseline · ${result.counts.unchanged} unchanged`}</p>
  {#if result.state === 'ready'}
    <label class="filter"><input type="checkbox" bind:checked={showUnchanged} onchange={() => { page = 1; selected = ''; }}> Show unchanged content</label>
    {#if !rows.length}<p>No differences in compared Case content.</p>{/if}
    <ul class="records">
      {#each visible as row (row.key)}<li>
        <strong>{fieldLabel(row.field)}{row.order ? ' · order of shared records' : ''}</strong>
        {#if row.recordId}<code>{row.recordId}</code>{/if}
        <span>{states[row.state]}</span>
        <button class="btn" type="button" onclick={() => void inspect(row.key)}
          aria-label={`Inspect ${fieldLabel(row.field)}${row.recordId ? ` ${row.recordId}` : row.order ? ' record order' : ''}`}>Inspect values</button>
      </li>{/each}
    </ul>
    {#if pages > 1}<nav aria-label="Handoff comparison pages">
      <button class="btn" disabled={page <= 1} onclick={() => { page--; selected = ''; }}>Previous differences</button>
      <span>Page {page} of {pages}</span>
      <button class="btn" disabled={page >= pages} onclick={() => { page++; selected = ''; }}>Next differences</button>
    </nav>{/if}
    {#if active}<section class="selected-values" aria-label="Selected comparison values">
      <h4 bind:this={heading} tabindex="-1">{fieldLabel(active.field)}{active.order ? ' · order of shared records' : ''}{active.recordId ? ` · ${active.recordId}` : ''}</h4>
      <div class="values">{#each labels as label, side}<section aria-label={`${label} value`}>
        <h5>{label}</h5>
        {#if values[side]}<ArtifactPreview file={values[side]!} mediaType="application/json" {label} focusOnReady={false} />
        {:else}<p>Not present in this selected export.</p>{/if}
      </section>{/each}</div>
    </section>{/if}
  {/if}
  <details><summary>Formats and comparison scope</summary>
    <p>Ordinary single-Case exports with schemas {CLI_CASE_PACK_INPUT_CASE_VERSIONS.join(', ')} are supported. Response packets, CLI packs and encrypted containers are not accepted here. Use the separate package review to unlock a handoff and deliberately select its exported Case JSON.</p>
    <p>Records align only by exact IDs. Shared-record order changes are shown separately; other arrays compare as complete values. All selected Case fields participate, including recipient routes, limitations and scope. Export times and file digests describe the copies, not independent observations or reviewer identity. This view adds no import permission and has no download action.</p>
    <p>Copies remain in page memory until replaced, cleared, this comparison is closed or the Case is left. These full private exports can contain notes, filenames and response details.</p>
  </details>
</section>

<style>
  .handoff-comparison { display: grid; gap: 12px; min-width: 0; }
  p, h4, h5 { margin: 0; overflow-wrap: anywhere; }
  p { max-width: 85ch; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
  .selectors, .values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .selectors > div, .values > section { min-width: 0; }
  label { display: block; margin-bottom: 6px; }
  input[type='file'] { max-width: 100%; min-height: var(--control-h); font: inherit; color: var(--text); }
  input[type='file']::file-selector-button { min-height: var(--control-h); padding: 8px; margin-right: 8px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .filter, nav { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .filter { min-height: var(--control-h); cursor: pointer; }
  .records { list-style: none; padding: 0; margin: 0; }
  .records > li { display: grid; gap: 6px; padding: 12px 0; border-bottom: 1px solid var(--border); }
  code { overflow-wrap: anywhere; }
  button { justify-self: start; }
  .selected-values { display: grid; gap: 12px; min-width: 0; }
  h4 { scroll-margin-top: 9rem; }
  @media (max-width: 700px) { .selectors, .values { grid-template-columns: minmax(0, 1fr); } }
</style>
