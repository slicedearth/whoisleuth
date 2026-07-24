<script lang="ts">
  import EvidenceTopology from '$lib/components/EvidenceTopology.svelte';
  import {
    SYNTHETIC_DEMO_CANDIDATES,
    syntheticDemoTimeline,
  } from '$lib/analysis/demo-model.js';

  const selected = SYNTHETIC_DEMO_CANDIDATES[0];
  const timeline = syntheticDemoTimeline(selected.id, true);
  const topologyNodes = [
    { id: 'registry', label: 'Registry', detail: selected.evidence.registry.status, status: 'success', side: 'left' as const, glyph: 'R', family: 'registry' as const },
    { id: 'dns', label: 'DNS', detail: selected.evidence.dns.status, status: 'success', side: 'left' as const, glyph: 'D', family: 'network' as const },
    { id: 'website', label: 'Website', detail: 'Active page observed', status: 'success', side: 'right' as const, glyph: 'H', family: 'web' as const },
    { id: 'certificate', label: 'Certificate', detail: selected.evidence.certificate.status, status: 'success', side: 'right' as const, glyph: 'T', family: 'web' as const },
    { id: 'analysis', label: 'Risk signals', detail: 'Explainable review cues', status: 'warning', side: 'right' as const, provenance: 'derived' as const, glyph: 'A' },
  ];
</script>

<div class="product-preview" aria-label="Synthetic previews of Discover, Lookup and Monitor">
  <article class="preview-panel discover-panel">
    <header><span>Discover</span><small>Synthetic candidates</small></header>
    <div class="candidate-list">
      {#each SYNTHETIC_DEMO_CANDIDATES as candidate}
        <div class:selected={candidate.id === selected.id} class="candidate-row">
          <span><strong>{candidate.domain}</strong><small>{candidate.mutation}</small></span>
          <b>{candidate.risk}</b>
        </div>
      {/each}
    </div>
  </article>

  <article class="preview-panel lookup-panel">
    <header><span>Lookup</span><small>{selected.domain}</small></header>
    <div class="assessment">
      <div><small>Registration</small><strong>{selected.availability}</strong></div>
      <div><small>Priority</small><strong>{selected.risk}<span>/100</span></strong></div>
    </div>
    <EvidenceTopology
      id="homepage-evidence-topology"
      title="Synthetic lookup evidence topology"
      target={{ label: selected.domain, detail: 'Domain lookup', status: selected.availability }}
      nodes={topologyNodes}
      embedded
      compact
    />
  </article>

  <article class="preview-panel monitor-panel">
    <header><span>Monitor</span><small>Evidence timeline</small></header>
    <ol>
      {#each timeline as entry,index}
        <li class:changed={entry.changes.length > 0}>
          <span aria-hidden="true"></span>
          <div><strong>{entry.label}</strong><small>{index === 0 ? 'Latest observation' : entry.repeated ? 'Repeated observation' : 'Earlier observation'}</small></div>
        </li>
      {/each}
    </ol>
  </article>
</div>

<p class="preview-note">Fixed fictional data from the public demo. No live target is contacted.</p>

<style>
  .product-preview{display:grid;grid-template-columns:.85fr 1.25fr;grid-template-rows:auto auto;gap:10px;align-items:stretch}
  .discover-panel{grid-column:1;grid-row:1}.monitor-panel{grid-column:1;grid-row:2}.lookup-panel{grid-column:2;grid-row:1 / 3}
  .preview-panel{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel);box-shadow:0 18px 48px rgb(var(--shadow-rgb) / .12)}
  .preview-panel header{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);background:rgb(var(--overlay-rgb) / .025);font-family:var(--mono)}
  .preview-panel header span{color:var(--accent);font-size:var(--text-xs);font-weight:750}
  .preview-panel header small{min-width:0;overflow:hidden;color:var(--muted);font-size:var(--text-2xs);text-overflow:ellipsis;white-space:nowrap}
  .candidate-list{display:grid;gap:6px;padding:10px}
  .candidate-row{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:10px;padding:9px;border-left:2px solid transparent;border-radius:var(--radius-sm);background:var(--panel-raised)}
  .candidate-row.selected{border-left-color:var(--accent2);background:rgb(var(--accent2-rgb) / .065)}
  .candidate-row>span{min-width:0}.candidate-row strong,.candidate-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .candidate-row strong{font:650 var(--text-xs) var(--mono)}.candidate-row small{margin-top:3px;color:var(--muted);font-size:.62rem}.candidate-row b{color:var(--amber);font:750 .9rem var(--mono)}
  .assessment{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border)}
  .assessment div{display:grid;gap:4px;padding:13px;background:var(--panel)}.assessment small{color:var(--muted);font:var(--text-2xs) var(--mono)}.assessment strong{color:var(--accent2);font:750 1.05rem var(--mono)}.assessment strong span{color:var(--muted);font-size:.62rem}
  ol{display:grid;gap:0;margin:0;padding:12px 12px 12px 18px;list-style:none}li{display:grid;position:relative;grid-template-columns:12px minmax(0,1fr);gap:8px;min-height:49px}li::before{content:"";position:absolute;top:13px;bottom:-7px;left:4px;width:1px;background:var(--border)}li:last-child::before{display:none}li>span{z-index:1;width:9px;height:9px;margin-top:8px;border:2px solid var(--muted);border-radius:50%;background:var(--panel)}li.changed>span{border-color:var(--accent2);box-shadow:0 0 7px rgb(var(--accent2-rgb) / .4)}li strong,li small{display:block}li strong{font:650 var(--text-xs) var(--mono)}li small{margin-top:4px;color:var(--muted);font-size:.62rem;line-height:1.35}
  .preview-note{margin:12px 0 0;color:var(--muted);font:var(--text-2xs) var(--mono);text-align:center}
  @media(max-width:820px){.product-preview{grid-template-columns:1fr 1fr;grid-template-rows:auto auto}.lookup-panel{grid-column:1 / -1;grid-row:1}.discover-panel{grid-column:1;grid-row:2}.monitor-panel{grid-column:2;grid-row:2}}
  @media(max-width:560px){.product-preview{grid-template-columns:1fr}.lookup-panel,.discover-panel,.monitor-panel{grid-column:auto;grid-row:auto}}
</style>
