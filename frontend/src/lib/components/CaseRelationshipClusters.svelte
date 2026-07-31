<script lang="ts">
  import {
    applyCaseRelationshipClusterAdjustments,
    buildCaseRelationshipClusterExport,
    type RelationshipClusterAdjustments,
    type RelationshipClusterSummary,
  } from '$lib/analysis/case-relationship-clusters.ts';
  import { registerAnalystUndo } from '$lib/analyst-undo';

  let { summary }: { summary: RelationshipClusterSummary } = $props();
  let labels = $state<Record<string, string>>({});
  let dismissed = $state<string[]>([]);
  let merged = $state<string[][]>([]);
  let splitCases = $state<Record<string, string[]>>({});
  let selected = $state<string[]>([]);
  let labelStartValues = $state<Record<string, string>>({});
  const adjustments = $derived<RelationshipClusterAdjustments>({ labels, dismissed, merged, splitCases });
  const reviewed = $derived(applyCaseRelationshipClusterAdjustments(summary, adjustments));
  const visible = $derived(reviewed.clusters.filter((cluster) => !cluster.dismissed));

  function toggleSelected(id: string, checked: boolean) {
    selected = checked
      ? [...new Set([...selected, id])]
      : selected.filter((item) => item !== id);
  }

  function setLabel(id: string, value: string) {
    labels = { ...labels, [id]: value.slice(0, 80) };
  }

  function beginLabelEdit(id: string): void {
    labelStartValues = { ...labelStartValues, [id]: labels[id] ?? '' };
  }

  function commitLabelEdit(id: string, clusterName: string): void {
    const previous = labelStartValues[id] ?? '';
    const current = labels[id] ?? '';
    if (previous === current) return;
    registerAnalystUndo({
      kind: 'local_label',
      action: current ? 'Evidence-cluster label updated' : 'Evidence-cluster label cleared',
      affectedRecord: clusterName,
      undo: async () => {
        setLabel(id, previous);
        return `Restored the previous label for ${clusterName}.`;
      },
    });
    const { [id]: _discarded, ...remaining } = labelStartValues;
    labelStartValues = remaining;
  }

  function toggleDismissed(id: string) {
    dismissed = dismissed.includes(id)
      ? dismissed.filter((item) => item !== id)
      : [...dismissed, id];
  }

  function splitCase(clusterId: string, caseId: string) {
    const current = splitCases[clusterId] ?? [];
    splitCases = {
      ...splitCases,
      [clusterId]: current.includes(caseId)
        ? current.filter((item) => item !== caseId)
        : [...current, caseId],
    };
  }

  function sourceClusterIdForCase(sourceClusterIds: readonly string[], caseId: string): string {
    return sourceClusterIds.find((id) =>
      summary.clusters.find((cluster) => cluster.id === id)?.cases.some((member) => member.id === caseId))
      ?? sourceClusterIds[0]
      ?? '';
  }

  function mergeSelected() {
    const sourceIds = [...new Set(selected.flatMap((id) => {
      const cluster = reviewed.clusters.find((item) => item.id === id);
      return cluster?.sourceClusterIds ?? [];
    }))];
    if (sourceIds.length < 2) return;
    merged = [...merged, sourceIds];
    selected = [];
  }

  function reset() {
    labels = {};
    dismissed = [];
    merged = [];
    splitCases = {};
    selected = [];
  }

  function exportReview() {
    const content = `${JSON.stringify(buildCaseRelationshipClusterExport(summary, adjustments), null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `whoisleuth-reviewed-clusters-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function confidenceLabel(value: string): string {
    return value === 'shared_infrastructure'
      ? 'Shared infrastructure'
      : value === 'bounded_similarity'
        ? 'Bounded similarity'
        : 'Exact observation';
  }
</script>

<section class="cluster-workspace" aria-labelledby="relationship-cluster-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Review layer</p>
      <h2 id="relationship-cluster-title">Evidence clusters</h2>
      <p>Group connected cases without changing the retained relationship evidence. Labels, splits, merges, and dismissals apply only to this view until exported.</p>
    </div>
    <div class="controls">
      <button class="btn" type="button" onclick={mergeSelected} disabled={selected.length < 2}>Merge selected</button>
      <button class="btn" type="button" onclick={exportReview} disabled={!reviewed.clusters.length}>Export review</button>
      <button class="btn" type="button" onclick={reset} disabled={!Object.keys(labels).length && !dismissed.length && !merged.length && !Object.keys(splitCases).length}>Reset</button>
    </div>
  </header>

  {#if summary.truncated || reviewed.adjustmentsTruncated}
    <p class="partial">Partial cluster view. One or more source or review bounds were reached.</p>
  {/if}

  {#if visible.length}
    <div class="cluster-grid">
      {#each visible as cluster (cluster.id)}
        <article class:common={cluster.confidence === 'shared_infrastructure'}>
          <header>
            <label class="select">
              <input type="checkbox" checked={selected.includes(cluster.id)} onchange={(event) => toggleSelected(cluster.id, event.currentTarget.checked)}>
              <span>Select cluster</span>
            </label>
            <span class="confidence">{confidenceLabel(cluster.confidence)}</span>
          </header>
          <label class="label-field">
            <span>Analyst label</span>
            <input value={cluster.label ?? ''} onfocus={() => beginLabelEdit(cluster.sourceClusterIds[0] ?? cluster.id)} oninput={(event) => setLabel(cluster.sourceClusterIds[0] ?? cluster.id, event.currentTarget.value)} onchange={() => commitLabelEdit(cluster.sourceClusterIds[0] ?? cluster.id, cluster.label || `Cluster with ${cluster.cases.length} cases`)} maxlength="80" placeholder="Optional review label">
          </label>
          <dl>
            <div><dt>Cases</dt><dd>{cluster.cases.length}</dd></div>
            <div><dt>Relationships</dt><dd>{cluster.groups.length}</dd></div>
            <div><dt>Sources</dt><dd>{cluster.sources.length || 'Unavailable'}</dd></div>
            <div><dt>Coverage</dt><dd>{cluster.truncated ? 'Partial' : cluster.complete === true ? 'Complete' : cluster.complete === false ? 'Partial' : 'Unknown'}</dd></div>
          </dl>
          {#if cluster.infrastructureMatches.length}
            <p class="catalogue-match"><strong>Known shared range</strong><span>{cluster.infrastructureMatches.map((match)=>match.sourceLabel).join(' · ')}</span></p>
          {/if}
          <div class="cases">
            {#each cluster.cases as member}
              <span>{member.domain}<button type="button" onclick={() => splitCase(sourceClusterIdForCase(cluster.sourceClusterIds, member.id), member.id)} aria-label={`Split ${member.domain} from this review cluster`}>Split</button></span>
            {/each}
          </div>
          <details>
            <summary>Inspect {cluster.groups.length} contributing relationship{cluster.groups.length === 1 ? '' : 's'}</summary>
            <ul>
              {#each cluster.groups as group}
                <li><strong>{group.label}</strong><code>{group.value}</code><small>{group.method}</small></li>
              {/each}
            </ul>
          </details>
          {#if cluster.limitations.length}
            <p class="limitation">{cluster.limitations[0]}</p>
          {/if}
          <button class="dismiss" type="button" onclick={() => cluster.sourceClusterIds.forEach(toggleDismissed)}>Dismiss from review</button>
        </article>
      {/each}
    </div>
  {:else if reviewed.clusters.length}
    <section class="empty card"><h3>All clusters are dismissed</h3><p>Reset the review to restore them. Source cases and relationships remain unchanged.</p></section>
  {:else}
    <section class="empty card"><h3>No connected evidence clusters yet</h3><p>At least two cases need a retained relationship before a cluster can be reviewed.</p></section>
  {/if}

  <details class="limits">
    <summary>Interpretation and review limits</summary>
    {#each reviewed.limitations as limitation}<p>{limitation}</p>{/each}
  </details>
</section>

<style>
  .cluster-workspace{display:grid;gap:12px;margin:18px 0 24px}
  .section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .section-head h2{margin:0}.section-head p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .controls{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}
  .partial{margin:0;color:var(--amber);font:650 var(--text-xs) var(--mono)}
  .cluster-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  article{display:grid;gap:10px;min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  article.common{border-color:color-mix(in srgb,var(--amber) 35%,var(--border))}
  article>header{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .select{display:flex;align-items:center;gap:7px;font-size:var(--text-xs);cursor:pointer}
  .confidence{color:var(--accent);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  article.common .confidence{color:var(--amber)}
  .label-field{display:grid;gap:4px}.label-field span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}.label-field input{width:100%}
  dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:0}
  dl div{min-width:0;padding:7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}dd{margin:3px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .cases{display:flex;flex-wrap:wrap;gap:6px}.cases span{display:inline-flex;align-items:center;max-width:100%;gap:5px;padding:4px 6px;border:1px solid var(--border);border-radius:999px;font:var(--text-2xs) var(--mono);overflow-wrap:anywhere}.cases button,.dismiss{border:0;background:none;color:var(--muted);font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}.cases button:hover,.dismiss:hover{color:var(--accent)}
  .catalogue-match{display:flex;flex-wrap:wrap;gap:5px 9px;margin:0;padding:8px 9px;border:1px solid color-mix(in srgb,var(--amber) 30%,var(--border));border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.catalogue-match strong{color:var(--text);font-family:var(--mono)}
  details summary{color:var(--muted);font-size:var(--text-xs);cursor:pointer}details ul{display:grid;gap:7px;margin:8px 0 0;padding-left:18px}details li{font-size:var(--text-xs)}details strong,details code,details small{display:block}details code{margin-top:2px;color:var(--accent);overflow-wrap:anywhere}details small{color:var(--muted)}
  .limitation,.limits p,.empty p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.dismiss{justify-self:start;padding:0}
  .limits{margin-top:2px}.limits p{margin-top:6px}.empty h3{margin:0}.empty{padding:14px}
  @media(max-width:900px){.cluster-grid{grid-template-columns:1fr}}
  @media(max-width:700px){.section-head{flex-direction:column}.controls{display:grid;width:100%;grid-template-columns:1fr}.controls .btn{width:100%}dl{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
