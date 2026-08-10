<script lang="ts">
  import EvidenceTopology from '$lib/components/EvidenceTopology.svelte';
  import {
    SYNTHETIC_DEMO_CANDIDATES,
    syntheticDemoTimeline,
  } from '$lib/analysis/demo-model.ts';
  import { projectEvidenceTopology } from '$lib/analysis/evidence-topology.ts';

  const initialCandidate = SYNTHETIC_DEMO_CANDIDATES[0];
  if (!initialCandidate) throw new Error('The synthetic homepage preview requires one candidate.');
  let selectedCandidateId = $state(initialCandidate.id);
  const selected = $derived(SYNTHETIC_DEMO_CANDIDATES.find((candidate) => candidate.id === selectedCandidateId) ?? initialCandidate);
  const timeline = $derived(syntheticDemoTimeline(selected.id, true).toReversed());
  type PreviewView = 'overview' | 'sources' | 'timeline';
  let previewView = $state<PreviewView>('sources');
  const previewTabs: ReadonlyArray<{ id: PreviewView; label: string }> = [
    { id: 'overview', label: 'At a glance' },
    { id: 'sources', label: 'Evidence' },
    { id: 'timeline', label: 'Timeline' },
  ];
  const topologyNodes = $derived([
    { id: 'registry', label: 'Registry', detail: selected.evidence.registry.status, status: sourceState(selected.evidence.registry.status), side: 'left' as const, glyph: 'R', family: 'registry' as const },
    { id: 'dns', label: 'DNS', detail: selected.evidence.dns.status, status: sourceState(selected.evidence.dns.status), side: 'left' as const, glyph: 'D', family: 'network' as const },
    { id: 'website', label: 'Website', detail: selected.evidence.website.status, status: sourceState(selected.evidence.website.status), side: 'right' as const, glyph: 'H', family: 'web' as const },
    { id: 'certificate', label: 'Certificate', detail: selected.evidence.certificate.status, status: sourceState(selected.evidence.certificate.status), side: 'right' as const, glyph: 'T', family: 'web' as const },
    { id: 'analysis', label: 'Risk signals', detail: `${selected.signals.length} explainable cue${selected.signals.length === 1 ? '' : 's'}`, status: selected.risk >= 50 ? 'warning' : 'success', side: 'right' as const, provenance: 'derived' as const, glyph: 'A', family: 'derived' as const },
  ]);
  const topologyGraph = $derived(projectEvidenceTopology(
    { label: selected.domain, detail: 'Domain lookup', status: selected.availability },
    topologyNodes,
  ));
  const materialChange = $derived(timeline.find((entry) => entry.changes.length > 0) ?? null);
  const monitorAction = $derived(selected.risk >= 70
    ? 'Review this candidate now'
    : selected.availability === 'Unknown'
      ? 'Repeat incomplete collection'
      : 'Watch for material change');

  function sourceState(value: string): 'success' | 'partial' | 'inconclusive' | 'unavailable' {
    const state = value.toLowerCase();
    if (state.includes('inconclusive')) return 'inconclusive';
    if (state.includes('not evaluated') || state.includes('not observed')) return 'unavailable';
    if (state.includes('partial') || state.includes('limited')) return 'partial';
    return 'success';
  }

  function observationDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Observation time unavailable'
      : new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function previewTabKeydown(event: KeyboardEvent) {
    const current = previewTabs.findIndex((tab) => tab.id === previewView);
    let index = -1;
    if (event.key === 'ArrowRight') index = (current + 1) % previewTabs.length;
    else if (event.key === 'ArrowLeft') index = (current + previewTabs.length - 1) % previewTabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = previewTabs.length - 1;
    const next = previewTabs[index];
    if (!next) return;
    event.preventDefault();
    previewView = next.id;
    const tablist = (event.currentTarget as HTMLButtonElement).closest('[role="tablist"]');
    requestAnimationFrame(() => tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus());
  }
</script>

<section class="product-preview" aria-label="Synthetic WHOISleuth console preview">
  <article class="preview-panel discover-panel">
    <header><span>Discover</span><small>Synthetic candidates</small></header>
    <div class="candidate-list">
      {#each SYNTHETIC_DEMO_CANDIDATES as candidate}
        <button
          type="button"
          class:selected={candidate.id === selected.id}
          class="candidate-row"
          aria-pressed={candidate.id === selected.id}
          aria-label={`Show ${candidate.domain} in the preview`}
          onclick={() => selectedCandidateId = candidate.id}
        >
          <span><strong>{candidate.domain}</strong><small>{candidate.mutation}</small></span>
          <b aria-label={`Risk score ${candidate.risk}`}>{candidate.risk}</b>
        </button>
      {/each}
    </div>
  </article>

  <article class="preview-panel lookup-panel">
    <header><span>Lookup</span><small>{selected.domain}</small></header>
    <label class="mobile-domain-picker">
      <span>Example domain</span>
      <select bind:value={selectedCandidateId}>
        {#each SYNTHETIC_DEMO_CANDIDATES as candidate}
          <option value={candidate.id}>{candidate.domain}</option>
        {/each}
      </select>
    </label>
    <div class="preview-tabs" role="tablist" aria-label="Lookup result layout preview">
      {#each previewTabs as tab}
        <button
          id={`homepage-preview-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={previewView === tab.id}
          aria-controls="homepage-preview-panel"
          tabindex={previewView === tab.id ? 0 : -1}
          class:active={previewView === tab.id}
          onclick={() => previewView = tab.id}
          onkeydown={previewTabKeydown}
        >{tab.label}</button>
      {/each}
    </div>
    <div
      id="homepage-preview-panel"
      class="preview-tab-panel"
      role="tabpanel"
      aria-labelledby={`homepage-preview-tab-${previewView}`}
    >
      {#if previewView === 'overview'}
        <div class="assessment">
          <div><small>Registration</small><strong>{selected.availability}</strong></div>
          <div><small>Priority</small><strong>{selected.risk}<span>/100</span></strong></div>
          <div><small>Mapped evidence</small><strong>{topologyGraph.provenanceCounts.direct} <span>sources + {topologyGraph.provenanceCounts.derived} derived</span></strong></div>
        </div>
        <div class="preview-findings" aria-label="Synthetic lookup summary">
          {#each selected.signals.slice(0, 2) as signal, index}
            <p><span class:observed={index === 0} class:review={index > 0} class="finding-state">{index === 0 ? 'Observed' : 'Review'}</span><strong>{signal}</strong></p>
          {/each}
        </div>
      {:else if previewView === 'sources'}
        <EvidenceTopology
          id="homepage-evidence-topology"
          title="Where this result comes from"
          target={{ label: selected.domain, detail: 'Domain lookup', status: selected.availability }}
          nodes={topologyNodes}
          embedded
          compact
          headingLevel={2}
        />
        <ul class="mobile-source-summary" aria-label="Synthetic evidence item status">
          {#each topologyNodes as node}
            <li class={`state-${node.status}`}><span>{node.label}</span><strong>{node.status}</strong></li>
          {/each}
        </ul>
      {:else}
        <ol class="lookup-timeline" aria-label="Synthetic lookup timeline">
          {#each timeline as entry,index}
            <li class:changed={entry.changes.length > 0}>
              <span aria-hidden="true"></span>
              <div>
                <strong>{entry.label}</strong>
                <small>{observationDate(entry.capturedAt)} · {index === 0 ? 'Latest observation' : entry.repeated ? 'Repeated observation' : 'Earlier observation'}</small>
                {#if entry.changes.length > 0}<small class="change-summary">{entry.changes.length} changed field{entry.changes.length === 1 ? '' : 's'} · {entry.changes[0]?.field}</small>{/if}
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </article>

  <article class="preview-panel monitor-panel">
    <header><span>Monitor</span><small>{selected.domain}</small></header>
    <div class="monitor-summary">
      <div><small>Retained checks</small><strong>{timeline.length}</strong></div>
      <div><small>Changed fields</small><strong>{materialChange?.changes.length ?? 0}</strong></div>
      <p><span aria-hidden="true"></span><strong>{monitorAction}</strong></p>
    </div>
  </article>
</section>

<p class="preview-note">Fixed fictional data from the public demo. No live target is contacted.</p>

<style>
  .product-preview{display:grid;grid-template-columns:.85fr 1.25fr;grid-template-rows:auto auto;gap:10px;align-items:stretch}
  .discover-panel{grid-column:1;grid-row:1}.monitor-panel{grid-column:1;grid-row:2}.lookup-panel{grid-column:2;grid-row:1 / 3}
  .preview-panel{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel);box-shadow:0 18px 48px rgb(var(--shadow-rgb) / .12)}
  .preview-panel header{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);background:rgb(var(--overlay-rgb) / .025);font-family:var(--mono)}
  .preview-panel header span{color:var(--accent);font-size:var(--text-xs);font-weight:750}
  .preview-panel header small{min-width:0;overflow:hidden;color:var(--muted);font-size:var(--text-2xs);text-overflow:ellipsis;white-space:nowrap}
  .candidate-list{display:grid;gap:6px;padding:10px}
  .candidate-row{display:flex;width:100%;min-width:0;align-items:center;justify-content:space-between;gap:10px;padding:9px;border:0;border-left:2px solid transparent;border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);text-align:left;cursor:pointer}
  .candidate-row:hover{background:color-mix(in srgb,var(--accent) 5%,var(--panel-raised))}.candidate-row:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
  .candidate-row.selected{border-left-color:var(--accent2);background:rgb(var(--accent2-rgb) / .065)}
  .candidate-row>span{min-width:0}.candidate-row strong,.candidate-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .candidate-row strong{font:650 var(--text-xs) var(--mono)}.candidate-row small{margin-top:3px;color:var(--muted);font-size:.62rem}.candidate-row b{color:var(--amber);font:750 .9rem var(--mono)}
  .preview-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;padding:6px;border-bottom:1px solid var(--border);background:var(--panel-raised)}
  .preview-tabs button{min-width:0;min-height:34px;padding:6px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:650 .6rem var(--mono);text-align:center;cursor:pointer}
  .preview-tabs button:hover,.preview-tabs button.active{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));background:var(--panel);color:var(--accent)}
  .preview-tabs button:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
  .mobile-domain-picker{display:none}
  .preview-tab-panel{min-width:0}
  .assessment{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--border)}
  .assessment div{display:grid;gap:4px;padding:13px;background:var(--panel)}.assessment small{color:var(--muted);font:var(--text-2xs) var(--mono)}.assessment strong{color:var(--accent2);font:750 1.05rem var(--mono)}.assessment strong span{color:var(--muted);font-size:.62rem}
  .preview-findings{display:grid;gap:1px;padding:1px;background:var(--border)}
  .preview-findings p{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:center;margin:0;padding:13px;background:var(--panel)}
  .preview-findings strong{font:650 var(--text-xs) var(--mono)}
  .finding-state{padding:3px 6px;border:1px solid currentColor;border-radius:999px;font:700 .52rem var(--mono);text-transform:uppercase}
  .finding-state.observed{color:var(--accent2)}.finding-state.review{color:var(--amber)}
  .mobile-source-summary{display:none}
  .lookup-timeline{display:grid;gap:0;margin:0;padding:16px 18px;list-style:none}.lookup-timeline li{display:grid;position:relative;grid-template-columns:12px minmax(0,1fr);gap:8px;min-height:68px}.lookup-timeline li::before{content:"";position:absolute;top:13px;bottom:-7px;left:4px;width:1px;background:var(--border)}.lookup-timeline li:last-child::before{display:none}.lookup-timeline li>span{z-index:1;width:9px;height:9px;margin-top:8px;border:2px solid var(--muted);border-radius:50%;background:var(--panel)}.lookup-timeline li.changed>span{border-color:var(--accent2);box-shadow:0 0 7px rgb(var(--accent2-rgb) / .4)}.lookup-timeline li strong,.lookup-timeline li small{display:block}.lookup-timeline li strong{font:650 var(--text-xs) var(--mono)}.lookup-timeline li small{margin-top:4px;color:var(--muted);font-size:.62rem;line-height:1.35}.lookup-timeline .change-summary{color:var(--accent)}
  .monitor-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;padding:1px;background:var(--border)}.monitor-summary>div{display:grid;gap:5px;padding:11px;background:var(--panel)}.monitor-summary small{color:var(--muted);font:var(--text-2xs) var(--mono)}.monitor-summary>div strong{color:var(--accent2);font:750 1rem var(--mono)}.monitor-summary p{display:flex;grid-column:1 / -1;gap:8px;align-items:center;margin:0;padding:10px;background:var(--panel)}.monitor-summary p span{width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:var(--amber);box-shadow:0 0 7px rgb(var(--amber-rgb) / .35)}.monitor-summary p strong{font:650 var(--text-2xs) var(--mono)}
  .preview-note{margin:12px 0 0;color:var(--muted);font:var(--text-2xs) var(--mono);text-align:center}
  @media(max-width:820px){.product-preview{grid-template-columns:1fr 1fr;grid-template-rows:auto auto}.lookup-panel{grid-column:1 / -1;grid-row:1}.discover-panel{grid-column:1;grid-row:2}.monitor-panel{grid-column:2;grid-row:2}}
  @media(max-width:560px){
    .product-preview{grid-template-columns:1fr}
    .lookup-panel{grid-column:auto;grid-row:auto}
    .discover-panel,.monitor-panel{display:none}
    .mobile-domain-picker{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:center;padding:8px 9px;border-bottom:1px solid var(--border);color:var(--muted);font:650 var(--text-2xs) var(--mono)}
    .mobile-domain-picker select{width:100%;min-width:0;min-height:34px;padding:5px 28px 5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);font:650 .62rem var(--mono)}
    .lookup-panel :global(.evidence-topology){display:none}
    .assessment{grid-template-columns:repeat(2,minmax(0,1fr))}.assessment div:last-child{grid-column:1 / -1}
    .mobile-source-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;padding:1px;background:var(--border);list-style:none}
    .mobile-source-summary li{display:flex;min-height:42px;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;background:var(--panel)}
    .mobile-source-summary li:last-child{grid-column:1 / -1}
    .mobile-source-summary span{min-width:0;overflow:hidden;font:650 .62rem var(--mono);text-overflow:ellipsis;white-space:nowrap}
    .mobile-source-summary strong{color:var(--muted);font:700 .5rem var(--mono);text-transform:uppercase}
    .mobile-source-summary .state-success strong{color:var(--accent2)}
    .mobile-source-summary .state-warning strong,.mobile-source-summary .state-partial strong,.mobile-source-summary .state-inconclusive strong{color:var(--amber)}
    .mobile-source-summary .state-error strong{color:var(--danger)}
    .mobile-source-summary .state-unavailable strong{color:var(--muted)}
  }
</style>
