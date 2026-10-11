<script lang="ts">
  import { compareObservationContexts, MAX_CAPTURE_COMPARISON_CONTEXTS } from '../../../../packages/comparison/capture-context.mts';
  import type { CaptureManifestContext } from '../../../../packages/interchange/web-capture-import.mts';
  import Pagination from './Pagination.svelte';

  let { first, second, firstPage, secondPage, choosePage }: {
    first: readonly CaptureManifestContext[];
    second: readonly CaptureManifestContext[];
    firstPage: string;
    secondPage: string;
    choosePage: (side: 'first' | 'second', index: number) => void;
  } = $props();

  const pageSize = 10;
  let page = $state(1), selection = $state.raw<readonly string[]>([]);
  const candidates = $derived([
    ...first.map((context, index) => ({ context, index, side: 'first' as const, key: `first:${index}`, label: `First manifest · capture ${index + 1}` })),
    ...second.map((context, index) => ({ context, index, side: 'second' as const, key: `second:${index}`, label: `Second manifest · capture ${index + 1}` })),
  ]);
  const selected = $derived(candidates.filter(item => selection.includes(item.key)));
  const comparison = $derived(selected.length >= 2 ? compareObservationContexts(selected.map(item => item.context)) : null);
  const stateLabel = { same: 'Same declarations', different: 'Different declarations', unknown: 'Not fully declared' };
  $effect(() => { first; second; selection = []; page = 1; });

  function toggle(key: string, checked: boolean) {
    if (!checked) selection = selection.filter(value => value !== key);
    else if (!selection.includes(key) && selection.length < MAX_CAPTURE_COMPARISON_CONTEXTS) selection = [...selection, key];
  }
</script>

<details class="capture-condition-matrix">
  <summary>Compare capture conditions</summary>
  <div class="body">
    <p>Select 2–{MAX_CAPTURE_COMPARISON_CONTEXTS} observations from either manifest. Page and image comparisons keep their own selections.</p>
    <div class="selection-status">
      <p role="status">{selected.length} of {candidates.length} observations selected · maximum {MAX_CAPTURE_COMPARISON_CONTEXTS}</p>
      <button class="btn btn-secondary" type="button" disabled={!selection.length} onclick={() => selection = []}>Clear condition selection</button>
    </div>
    <ul aria-label="Capture observations">
      {#each candidates.slice((page - 1) * pageSize, page * pageSize) as item (item.key)}
        {@const activePage = String(item.index) === (item.side === 'first' ? firstPage : secondPage)}
        <li>
          <label>
            <input type="checkbox" checked={selection.includes(item.key)} disabled={selection.length >= MAX_CAPTURE_COMPARISON_CONTEXTS && !selection.includes(item.key)}
              onchange={event => toggle(item.key, event.currentTarget.checked)}>
            <span><strong>{item.label}</strong><span>{item.context.domain}</span><span>{item.context.observedAt ?? 'Observation time not retained'}</span></span>
          </label>
          {#if item.context.pageBehaviour}
            <button class="btn btn-secondary" type="button" aria-pressed={activePage} onclick={() => choosePage(item.side, item.index)}>Use as {item.side} page</button>
          {:else}<p>Page observations not retained</p>{/if}
        </li>
      {/each}
    </ul>
    <Pagination currentPage={page} pageCount={Math.ceil(candidates.length / pageSize)} setPage={next => page = next} ariaLabel="Capture observations" />
    {#if comparison}
      <p>Observation times: {comparison.time.state === 'unknown' ? 'not fully retained' : comparison.time.state === 'same_instant' ? 'the same instant' : 'different instants'}.</p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named overflow region provides native keyboard access to every selected observation -->
      <div class="matrix-scroll" role="region" aria-label="Selected capture condition comparison" tabindex="0">
        <table>
          <caption>Declared conditions for {selected.length} selected observations</caption>
          <thead><tr><th scope="col">Condition</th>{#each selected as item (item.key)}<th scope="col">{item.label}<span>{item.context.domain}</span><span>{item.context.observedAt ?? 'Observation time not retained'}</span></th>{/each}</tr></thead>
          <tbody>{#each comparison.rows as row (row.id)}<tr>
            <th scope="row">{row.label}<span>{stateLabel[row.state]}</span></th>
            {#each row.values as value}<td>{value ?? 'Not declared'}</td>{/each}
          </tr>{/each}</tbody>
        </table>
      </div>
      <details class="interpretation"><summary>How to interpret this comparison</summary>
        <p>Exact capture URLs and login or session state are not retained in this comparison. Viewports are declarations, not image dimensions.</p>
        {#each comparison.limitations as limitation}<p>{limitation}</p>{/each}
      </details>
    {:else}<p>Select at least two observations to show their conditions side by side.</p>{/if}
  </div>
</details>

<style>
  .capture-condition-matrix, .body { min-width: 0; }
  summary { cursor: pointer; padding-block: 12px; font-weight: 650; }
  .body { display: grid; gap: 12px; padding-bottom: 12px; }
  p, label, table { font-size: var(--text-xs); line-height: 1.6; overflow-wrap: anywhere; }
  p { margin: 0; color: var(--muted); }
  .selection-status { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0; margin: 0; list-style: none; }
  li { display: grid; align-content: start; gap: 8px; min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  label { display: flex; align-items: flex-start; gap: 8px; min-height: 44px; cursor: pointer; }
  input { flex: 0 0 auto; margin-top: 5px; }
  label > span { min-width: 0; }
  label span span, th span { display: block; font-weight: 400; color: var(--muted); }
  button { justify-self: start; max-width: 100%; white-space: normal; }
  .matrix-scroll { min-width: 0; max-width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  table { border-collapse: collapse; width: max-content; min-width: 100%; table-layout: fixed; }
  caption { text-align: left; padding: 10px; }
  th, td { min-width: 180px; max-width: 220px; padding: 10px; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); text-align: left; vertical-align: top; }
  tr:last-child > * { border-bottom: 0; }
  tr > :last-child { border-right: 0; }
  .interpretation p + p { margin-top: 8px; }
  @media (max-width: 700px) { ul { grid-template-columns: minmax(0, 1fr); } }
</style>
