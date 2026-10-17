<script lang="ts">
  import { onMount } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { caseWorkspaceHref } from '#lib/analysis/case-response-stage.ts';
  import { buildComparisonLedgerDetails, buildComparisonLedgerIndex, comparisonLedgerCasePairIndexId } from '#lib/analysis/comparison-ledger.ts';
  import ComparisonFrame from './ComparisonFrame.svelte';
  import ComparisonLedgerRows from './ComparisonLedgerRows.svelte';

  let { cases, initialSelection = null }: {
    cases: readonly CaseRecord[];
    initialSelection?: Readonly<{ caseId: string; checkpointIds: readonly string[] }> | null;
  } = $props();
  const componentId = $props.id();
  let caseId = $state('');
  let checkpointIds = $state<string[]>([]);
  let pairId = $state('');
  const eligibleCases = $derived(cases.filter(record => record.evidenceHistory.length >= 2));
  const record = $derived(cases.find(record => record.id === caseId) ?? null);
  const history = $derived([...(record?.evidenceHistory ?? [])].sort((left, right) => (
    Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || left.id.localeCompare(right.id)
  )));
  const checkpoints = $derived(history.filter(snapshot => checkpointIds.includes(snapshot.id)));
  const pairs = $derived.by(() => checkpoints.flatMap((earlier, index) => checkpoints.slice(index + 1)
    .filter(later => Date.parse(earlier.capturedAt) < Date.parse(later.capturedAt))
    .map(later => ({ caseId, earlierSnapshotId: earlier.id, laterSnapshotId: later.id }))));
  const input = $derived({ cases: record ? [record] : [], casePairs: pairs });
  const index = $derived(buildComparisonLedgerIndex(input));
  const selectedPair = $derived(pairs.find(pair => comparisonLedgerCasePairIndexId(caseId, pair.earlierSnapshotId, pair.laterSnapshotId) === pairId) ?? null);
  const selectedItem = $derived(index.items.find(item => item.id === pairId) ?? null);
  const earlier = $derived(history.find(snapshot => snapshot.id === selectedPair?.earlierSnapshotId) ?? null);
  const later = $derived(history.find(snapshot => snapshot.id === selectedPair?.laterSnapshotId) ?? null);
  const details = $derived(selectedItem ? buildComparisonLedgerDetails(input, { itemIds: [selectedItem.id] }) : null);

  function clear(): void { caseId = ''; checkpointIds = []; pairId = ''; }
  function chooseCase(value: string): void { clear(); caseId = value; }
  function chooseCheckpoint(id: string, checked: boolean): void {
    if (checked && checkpointIds.length < 3 && !checkpointIds.includes(id)) checkpointIds = [...checkpointIds, id];
    else if (!checked) checkpointIds = checkpointIds.filter(value => value !== id);
    pairId = '';
  }
  let appliedSelection: typeof initialSelection = null;
  $effect(() => {
    if (!initialSelection) return;
    if (initialSelection === appliedSelection) return;
    appliedSelection = initialSelection;
    chooseCase(initialSelection.caseId);
    for (const id of initialSelection.checkpointIds) chooseCheckpoint(id, true);
  });
  $effect(() => {
    if (caseId && !record) { checkpointIds = []; pairId = ''; }
  });
  onMount(() => {
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); clear(); };
  });
</script>

<section class="checkpoint-stage" aria-labelledby={`checkpoint-stage-${componentId}`}>
  <header><h3 id={`checkpoint-stage-${componentId}`}>Compare Case checkpoints</h3><button class="btn small" type="button" onclick={clear} disabled={!caseId}>Clear comparison</button></header>
  <p>Choose two or three retained checkpoints from one Case, then inspect an interval. Selections stay on this page; no evidence is saved or collected.</p>
  <label>Case for checkpoint review
    <select value={caseId} onchange={event => chooseCase(event.currentTarget.value)}>
      <option value="">Choose a Case</option>
      {#each eligibleCases as item (item.id)}<option value={item.id}>{item.title || item.domain} · {item.domain} · {item.id}</option>{/each}
    </select>
  </label>
  {#if caseId && !record}
    <p role="alert">The selected Case is no longer available. Choose an available Case; no replacement was selected.</p>
  {:else if record}
    <fieldset>
      <legend>Select two or three exact checkpoints</legend>
      <ol class="checkpoint-list">
        {#each history as snapshot (snapshot.id)}
          <li><label class="checkpoint-choice">
            <input type="checkbox" checked={checkpointIds.includes(snapshot.id)} disabled={checkpointIds.length >= 3 && !checkpointIds.includes(snapshot.id)}
              onchange={event => chooseCheckpoint(snapshot.id, event.currentTarget.checked)} />
            <span><time datetime={snapshot.capturedAt}>{formatEvidenceDate(snapshot.capturedAt)}</time><code>{snapshot.id}</code><small>Retained {snapshot.source} checkpoint · {snapshot.scanDepth} collection</small></span>
          </label></li>
        {/each}
      </ol>
    </fieldset>
    <p role="status" aria-live="polite">{checkpointIds.length} selected. {checkpointIds.length < 2 ? 'Choose at least two checkpoints.' : 'Each selected interval uses only its two endpoints.'}</p>
    {#if pairs.length}
      <label>Interval to inspect
        <select value={pairId} onchange={event => pairId = event.currentTarget.value}>
          <option value="">Choose an interval</option>
          {#each pairs as pair}
            {@const before = history.find(snapshot => snapshot.id === pair.earlierSnapshotId)}
            {@const after = history.find(snapshot => snapshot.id === pair.laterSnapshotId)}
            <option value={comparisonLedgerCasePairIndexId(caseId, pair.earlierSnapshotId, pair.laterSnapshotId)}>{formatEvidenceDate(before?.capturedAt)} → {formatEvidenceDate(after?.capturedAt)} · {pair.earlierSnapshotId} → {pair.laterSnapshotId}</option>
          {/each}
        </select>
      </label>
    {:else if checkpointIds.length >= 2}
      <p>No chronological interval is available. Equal, unknown or unavailable checkpoint times do not establish an earlier-to-later direction.</p>
    {/if}
    {#if checkpointIds.some(id => !history.some(snapshot => snapshot.id === id))}
      <p role="alert">A selected checkpoint is no longer retained. Clear the stage or explicitly choose the remaining checkpoints.</p>
    {/if}
    {#if pairId && !selectedItem}
      <p role="alert">This exact interval cannot be resolved. Its references may be unavailable or ambiguous; no other checkpoints were substituted.</p>
    {/if}
    {#if selectedItem && details && earlier && later}
      <ComparisonFrame>
        {#snippet header()}<h4>Selected checkpoint interval</h4><a href={caseWorkspaceHref(record.id, 'evidence')}>Open Case evidence</a>{/snippet}
        {#snippet left()}<section aria-label="Earlier selected checkpoint"><h5>Earlier checkpoint</h5><dl><dt>Snapshot ID</dt><dd><code>{earlier.id}</code></dd><dt>Checkpoint time</dt><dd>{formatEvidenceDate(earlier.capturedAt)}</dd><dt>Source</dt><dd>{earlier.source}</dd><dt>Collection depth</dt><dd>{earlier.scanDepth}</dd></dl></section>{/snippet}
        {#snippet right()}<section aria-label="Later selected checkpoint"><h5>Later checkpoint</h5><dl><dt>Snapshot ID</dt><dd><code>{later.id}</code></dd><dt>Checkpoint time</dt><dd>{formatEvidenceDate(later.capturedAt)}</dd><dt>Source</dt><dd>{later.source}</dd><dt>Collection depth</dt><dd>{later.scanDepth}</dd></dl></section>{/snippet}
        {#snippet context()}<p>No state or transition between these checkpoints is inferred. Each field retains its own scope, collection-quality and model-version qualifications.</p>{/snippet}
        <ComparisonLedgerRows rows={details.rows} totalRows={details.totalRows} omittedRows={details.omissions.detailRows}
          duplicateRows={details.omissions.duplicateDetailRows} sourceOmittedRows={details.omissions.sourceRows} />
      </ComparisonFrame>
    {/if}
  {/if}
</section>

<style>
  .checkpoint-stage{min-width:0;margin-top:14px}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
  h3,h4,h5{margin:0}
  h5{font-size:var(--text-sm)}
  p{font-size:var(--text-sm);color:var(--muted)}
  label{display:grid;min-width:0;gap:6px;font-size:var(--text-sm);font-weight:700}
  select{width:100%;min-width:0}
  fieldset{min-width:0;margin:14px 0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  legend{padding:0 6px;font-weight:700}
  .checkpoint-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}
  .checkpoint-choice{grid-template-columns:auto minmax(0,1fr);align-items:start;padding:7px}
  input{margin-top:4px}
  .checkpoint-choice span{min-width:0;overflow-wrap:anywhere}
  .checkpoint-choice code,.checkpoint-choice small{display:block;margin-top:3px}
  small{color:var(--muted);font-weight:400}
  code{white-space:normal;overflow-wrap:anywhere}
  dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 10px;margin:10px 0;font-size:var(--text-xs)}
  dt{color:var(--muted)}
  dd{min-width:0;margin:0;overflow-wrap:anywhere}
  @media(max-width:520px){dl{grid-template-columns:1fr;gap:3px}dt:not(:first-child){margin-top:6px}}
</style>
