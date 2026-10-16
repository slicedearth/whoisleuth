<script lang="ts">
  import { tick } from 'svelte';
  import type { compareCaseHandoffCopies, CaseHandoffChange } from '../../../../packages/cases/case-handoff-comparison.mts';
  import ArtifactPreview from './ArtifactPreview.svelte';

  let { comparison, labels = ['Baseline export', 'Comparison export'] }: {
    comparison: ReturnType<typeof compareCaseHandoffCopies>;
    labels?: readonly [string, string];
  } = $props();
  let page = $state(1), showUnchanged = $state(false), selected = $state('');
  let heading = $state<HTMLHeadingElement>();
  const states = $derived<Record<CaseHandoffChange, string>>({
    unchanged: 'Unchanged', changed: 'Changed content',
    baseline_only: `Only in ${labels[0].toLowerCase()}`, comparison_only: `Only in ${labels[1].toLowerCase()}`,
  });
  const rows = $derived(comparison.rows.filter(row => showUnchanged || row.state !== 'unchanged'));
  const pages = $derived(Math.max(1, Math.ceil(rows.length / 10)));
  const visible = $derived(rows.slice((page - 1) * 10, page * 10));
  const active = $derived(visible.find(row => row.key === selected));
  const values = $derived(active ? [active.baseline, active.comparison].map(value => value === undefined
    ? null : new Blob([JSON.stringify(value)], { type: 'application/json' })) : []);
  const fieldLabel = (field: string) => field.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/^./u, letter => letter.toUpperCase());
  $effect(() => { comparison; page = 1; selected = ''; });

  async function inspect(key: string) {
    const current = comparison;
    selected = key; await tick();
    if (current === comparison && selected === key) heading?.focus();
  }
</script>

<div class="comparison-view">
  <p role="status" aria-label="Case export comparison status">{comparison.state === 'unavailable'
    ? 'Comparison unavailable — select both a baseline and a comparison export.'
    : `${comparison.counts.changed} changed · ${comparison.counts.comparison_only} only in comparison · ${comparison.counts.baseline_only} only in baseline · ${comparison.counts.unchanged} unchanged`}</p>
  {#if comparison.state === 'ready'}
    <label class="filter"><input type="checkbox" bind:checked={showUnchanged} onchange={() => { page = 1; selected = ''; }}> Show unchanged content</label>
    {#if !rows.length}<p>No differences in compared Case content.</p>{/if}
    <ul class="records">
      {#each visible as row (row.key)}<li>
        <strong>{fieldLabel(row.field)}{row.order ? ' · order of shared records' : ''}</strong>
        {#if row.recordId}<code>{row.recordId}</code>{/if}
        <span>{states[row.state]}</span>
        <button class="btn" type="button" onclick={() => void inspect(row.key)}>Inspect values<span class="sr-only"> for {fieldLabel(row.field)}{row.recordId ? ` ${row.recordId}` : row.order ? ' record order' : ''}</span></button>
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
        {:else}<p>Not present in this selected copy.</p>{/if}
      </section>{/each}</div>
    </section>{/if}
  {/if}
</div>

<style>
  .comparison-view, .selected-values { display: grid; gap: 12px; min-width: 0; }
  p, h4, h5 { margin: 0; overflow-wrap: anywhere; }
  p { max-width: 85ch; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
  .values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .values > section { min-width: 0; }
  .filter, nav { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .filter { min-height: var(--control-h); cursor: pointer; }
  .records { list-style: none; padding: 0; margin: 0; }
  .records > li { display: grid; gap: 6px; padding: 12px 0; border-bottom: 1px solid var(--border); }
  code { overflow-wrap: anywhere; }
  button { justify-self: start; }
  h4 { scroll-margin-top: 9rem; }
  @media (max-width: 700px) { .values { grid-template-columns: minmax(0, 1fr); } }
</style>
