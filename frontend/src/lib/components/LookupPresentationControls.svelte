<script lang="ts">
  let {
    allSectionsExpanded,
    anySectionsExpanded,
    expandAll,
    collapseAll,
  }: {
    allSectionsExpanded: boolean;
    anySectionsExpanded: boolean;
    expandAll: () => void;
    collapseAll: () => void;
  } = $props();

</script>

<section class="presentation" aria-labelledby="lookup-presentation-title">
  <h3 id="lookup-presentation-title">Evidence families</h3>
  <div class="section-visibility">
    <div role="group" aria-label="Evidence family visibility">
      <button type="button" aria-disabled={allSectionsExpanded} onclick={() => { if (!allSectionsExpanded) expandAll(); }}>Expand all</button>
      <button type="button" aria-disabled={!anySectionsExpanded} onclick={() => { if (anySectionsExpanded) collapseAll(); }}>Collapse all</button>
    </div>
  </div>
</section>

<style>
  .presentation{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin:18px 0 0;padding-block:10px;border-block:1px solid var(--border)}
  .presentation h3{margin:0;font:650 var(--text-sm) var(--font-sans)}
  .section-visibility{display:grid;gap:5px;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .section-visibility>div{display:flex;gap:6px}
  .section-visibility button{min-height:var(--control-h);padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .section-visibility button:hover:not([aria-disabled='true']),.section-visibility button:focus-visible{border-color:var(--accent);color:var(--accent)}
  .section-visibility button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .section-visibility button[aria-disabled='true']{cursor:not-allowed;opacity:.45}
</style>
