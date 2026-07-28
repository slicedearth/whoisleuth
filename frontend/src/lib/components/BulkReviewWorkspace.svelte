<script lang="ts">
  import {
    BULK_REVIEW_STATES,
    type BulkReviewFilter,
    type BulkReviewPreset,
    type BulkReviewPresetView,
    type BulkReviewStore,
  } from '$lib/bulk-review';

  let {
    store,
    currentView,
    reviewFilter,
    setReviewFilter,
    saveView,
    loadView,
    deleteView,
    status,
  }: {
    store: BulkReviewStore;
    currentView: BulkReviewPresetView;
    reviewFilter: BulkReviewFilter;
    setReviewFilter: (value: BulkReviewFilter) => void;
    saveView: (name: string, view: BulkReviewPresetView) => void | Promise<void>;
    loadView: (preset: BulkReviewPreset) => void;
    deleteView: (preset: BulkReviewPreset) => void | Promise<void>;
    status: string;
  } = $props();

  let name = $state('');
  let selectedId = $state('');

  function selectedPreset(): BulkReviewPreset | null {
    return store.presets.find((item) => item.id === selectedId) ?? null;
  }
</script>

<section id="bulk-review-views" class="review-views card" aria-labelledby="bulk-review-views-title">
  <div>
    <p class="eyebrow">Review workflow</p>
    <h2 id="bulk-review-views-title">Saved views and review queue</h2>
    <p>Save the current filters, grouping, and sort order. Per-domain review state stays separate from case disposition and does not start or resume a scan.</p>
  </div>
  <div class="controls">
    <label for="bulk-review-state-filter">Review state
      <select id="bulk-review-state-filter" aria-label="Filter by review state" value={reviewFilter} onchange={(event) => setReviewFilter(event.currentTarget.value as BulkReviewFilter)}>
        <option value="">Any state</option>
        {#each BULK_REVIEW_STATES as value}<option {value}>{value}</option>{/each}
      </select>
    </label>
    <label for="bulk-review-saved-view">Saved view
      <select id="bulk-review-saved-view" aria-label="Saved Bulk review view" bind:value={selectedId}>
        <option value="">Choose a saved view</option>
        {#each store.presets as preset}<option value={preset.id}>{preset.name}</option>{/each}
      </select>
    </label>
    <div class="view-actions">
      <button class="btn" type="button" disabled={!selectedPreset()} onclick={() => { const preset = selectedPreset(); if (preset) loadView(preset); }}>Load view</button>
      <button class="btn danger-text" type="button" disabled={!selectedPreset()} onclick={() => { const preset = selectedPreset(); if (preset) void deleteView(preset); }}>Delete</button>
    </div>
    <form onsubmit={(event) => { event.preventDefault(); void saveView(name, currentView); name = ''; }}>
      <label for="bulk-review-view-name">New view name<input id="bulk-review-view-name" bind:value={name} maxlength="80" placeholder="High-risk mail review"></label>
      <button class="btn" type="submit">Save current view</button>
    </form>
  </div>
  <p class="review-status" role="status">{status}</p>
</section>

<style>
  .review-views{display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,.8fr);gap:22px;margin-top:16px;padding:var(--card-pad)}
  h2,p{margin:0}h2{margin-top:4px;font:700 var(--text-lg) var(--mono)}
  .review-views>div>p:last-child{margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
  label{display:grid;gap:5px;font:650 var(--text-xs) var(--mono)}
  .view-actions{display:flex;align-items:end;gap:7px}
  .controls form{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-column:1/-1;gap:7px;align-items:end}
  .danger-text{color:var(--danger)}
  .review-status{grid-column:1/-1;color:var(--accent);font-size:var(--text-xs)}
  .review-status:empty{display:none}
  @media(max-width:760px){.review-views,.controls{grid-template-columns:1fr}.controls form{grid-template-columns:1fr}.view-actions .btn{flex:1}}
</style>
