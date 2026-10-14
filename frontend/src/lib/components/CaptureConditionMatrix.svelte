<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { compareObservationContexts, MAX_CAPTURE_COMPARISON_CONTEXTS } from '../../../../packages/comparison/capture-context.mts';
  import type { CaptureManifestContext } from '../../../../packages/interchange/web-capture-import.mts';
  import Pagination from './Pagination.svelte';

  let { first, second, firstPage, secondPage, choosePage, active = true }: {
    first: readonly CaptureManifestContext[];
    second: readonly CaptureManifestContext[];
    firstPage: string;
    secondPage: string;
    choosePage: (side: 'first' | 'second', index: number) => void;
    active?: boolean;
  } = $props();

  const pageSize = 10;
  const instance = $props.id();
  let page = $state(1), selection = $state.raw<readonly string[]>([]);
  let open = $state(false), annotationsOpen = $state(false);
  const sessionChoices = { signed_out: 'Signed out', signed_in: 'Signed in', unknown: 'Cannot determine' } as const;
  type SessionDeclaration = { value: keyof typeof sessionChoices; annotatedAt: string };
  // Input object identity and capture ordinal belong to this loaded review only.
  // Neither display labels nor equal capture times can retarget a declaration.
  let annotations = $state.raw<{ first: typeof first; second: typeof second; entries: Readonly<Record<string, SessionDeclaration>> } | null>(null);
  const currentAnnotations = $derived(active && open && annotationsOpen && annotations?.first === first && annotations.second === second ? annotations.entries : {});
  const candidates = $derived([
    ...first.map((context, index) => ({ context, index, side: 'first' as const, key: `first:${index}`, label: `First manifest · capture ${index + 1}` })),
    ...second.map((context, index) => ({ context, index, side: 'second' as const, key: `second:${index}`, label: `Second manifest · capture ${index + 1}` })),
  ]);
  const selected = $derived(candidates.filter(item => selection.includes(item.key)));
  const comparison = $derived(selected.length >= 2 ? compareObservationContexts(selected.map(item => item.context)) : null);
  const stateLabel = { same: 'Same declarations', different: 'Different declarations', unknown: 'Not fully declared' };
  const missingDeclarations = $derived(selected.filter(item => !currentAnnotations[item.key]).length);
  const unknownDeclarations = $derived(selected.filter(item => currentAnnotations[item.key]?.value === 'unknown').length);
  const sessionComparison = $derived(missingDeclarations || unknownDeclarations ? 'Session context is not fully declared.'
    : new Set(selected.map(item => currentAnnotations[item.key]?.value)).size > 1 ? 'Different analyst declarations.' : 'Matching analyst declarations.');
  function clearAnnotations() { annotations = null; }
  $effect(() => { first; second; selection = []; page = 1; untrack(() => { clearAnnotations(); annotationsOpen = false; }); });
  $effect(() => { if (!active || !open || !annotationsOpen) clearAnnotations(); });
  beforeNavigate(clearAnnotations);
  onMount(() => {
    window.addEventListener('pagehide', clearAnnotations);
    return () => { window.removeEventListener('pagehide', clearAnnotations); clearAnnotations(); };
  });

  function declareSession(item: (typeof candidates)[number], value: string) {
    if (!active || !open || !annotationsOpen || !selection.includes(item.key)
      || (item.side === 'first' ? first : second)[item.index] !== item.context) return;
    if (value !== '' && value !== 'signed_in' && value !== 'signed_out' && value !== 'unknown') return;
    const entries = { ...currentAnnotations };
    if (value === '') delete entries[item.key];
    else entries[item.key] = { value, annotatedAt: new Date().toISOString() };
    annotations = { first, second, entries };
  }

  function toggle(key: string, checked: boolean) {
    if (!checked) {
      selection = selection.filter(value => value !== key);
      const entries = { ...currentAnnotations }; delete entries[key];
      annotations = { first, second, entries };
    }
    else if (!selection.includes(key) && selection.length < MAX_CAPTURE_COMPARISON_CONTEXTS) selection = [...selection, key];
  }
</script>

<details class="capture-condition-matrix" bind:open>
  <summary>Compare capture conditions</summary>
  <div class="body">
    <p>Select 2–{MAX_CAPTURE_COMPARISON_CONTEXTS} observations from either manifest. Page and image comparisons keep their own selections.</p>
    <div class="selection-status">
      <p role="status">{selected.length} of {candidates.length} observations selected · maximum {MAX_CAPTURE_COMPARISON_CONTEXTS}</p>
      <button class="btn btn-secondary" type="button" disabled={!selection.length} onclick={() => { selection = []; clearAnnotations(); }}>Clear condition selection</button>
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
    {#if selected.length}
      <details class="session-annotations" bind:open={annotationsOpen}>
        <summary>Temporary analyst session declarations</summary>
        <p id={`${instance}-session-help`}>Add your current statement about each selected capture's session context. These are not manifest observations or proof of authentication, equal privileges or equivalent environments.</p>
        <p>Page memory only: closing or leaving this review, changing either input, Case or workspace, locking or reloading clears these declarations. They are not saved, printed, copied by export actions or included in downloads and reports.</p>
        {#if annotationsOpen}
          <ul aria-label="Analyst session declarations">
            {#each selected as item (item.key)}
              {@const declaration = currentAnnotations[item.key]}
              <li>
                <label class="session-choice">Session declaration — {item.label}
                  <select value={declaration?.value ?? ''} aria-describedby={`${instance}-session-help`} onchange={event => declareSession(item, event.currentTarget.value)}>
                    <option value="">No declaration</option>
                    {#each Object.entries(sessionChoices) as [value, label]}<option {value}>{label}</option>{/each}
                  </select>
                </label>
                <p>Capture observation time: {item.context.observedAt ?? 'not retained'}.</p>
                {#if declaration}<p>Analyst annotation time: <time datetime={declaration.annotatedAt}>{declaration.annotatedAt}</time>. Author identity is not verified.</p>{/if}
              </li>
            {/each}
          </ul>
          <p role="status">{selected.length >= 2 ? sessionComparison : 'Select another observation to compare declarations.'} {missingDeclarations} without a declaration; {unknownDeclarations} explicitly unknown. Capture comparisons are unchanged.</p>
        {/if}
      </details>
    {/if}
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
        <p>Exact capture URLs and observed login or session state are not retained in these manifests. Temporary analyst declarations are separate from these source conditions. Viewports are declarations, not image dimensions.</p>
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
  .session-annotations { min-width: 0; }
  .session-annotations p { margin-bottom: 10px; }
  .session-choice { display: grid; gap: 6px; cursor: auto; }
  select { width: 100%; min-width: 0; max-width: 100%; min-height: 44px; }
  @media (max-width: 700px) { ul { grid-template-columns: minmax(0, 1fr); } }
  @media print { .session-annotations { display: none !important; } }
</style>
