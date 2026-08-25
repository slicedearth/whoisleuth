<script lang="ts">
  type PreviewCandidate = Readonly<{
    id: string;
    domain: string;
    mutation: string;
    availability: string;
    risk: number;
    nextAction: string;
    compactAction: string;
    signals: readonly string[];
    evidence: Readonly<{
      registry: Readonly<{ status: string }>;
      dns: Readonly<{ status: string }>;
      website: Readonly<{ status: string }>;
      certificate: Readonly<{ status: string }>;
    }>;
    timeline: readonly Readonly<{
      label: string;
      capturedAt: string;
      repeated: boolean;
      changes: readonly Readonly<{ field: string }>[];
    }>[];
  }>;

  const previewCandidates: readonly PreviewCandidate[] = Object.freeze([
    Object.freeze({
      id: 'credential-lure', domain: 'northstar-login.example', mutation: 'Brand + login term', availability: 'Registered', risk: 78,
      nextAction: 'Review the limited website evidence', compactAction: 'Review website',
      signals: Object.freeze(['Recently observed registration', 'Password form present']),
      evidence: Object.freeze({
        registry: Object.freeze({ status: 'Complete' }), dns: Object.freeze({ status: 'Complete' }),
        website: Object.freeze({ status: 'Limited' }), certificate: Object.freeze({ status: 'Complete' }),
      }),
      timeline: Object.freeze([
        Object.freeze({ label: 'Initial observation', capturedAt: '2026-06-26T11:15:00.000Z', repeated: false, changes: Object.freeze([]) }),
        Object.freeze({ label: 'Repeated observation', capturedAt: '2026-06-27T11:15:00.000Z', repeated: true, changes: Object.freeze([]) }),
        Object.freeze({ label: 'Material change', capturedAt: '2026-07-01T11:15:00.000Z', repeated: false, changes: Object.freeze([
          Object.freeze({ field: 'Risk assessment' }),
          Object.freeze({ field: 'Mail authentication' }),
          Object.freeze({ field: 'Page identity' }),
        ]) }),
      ]),
    }),
    Object.freeze({
      id: 'character-edit', domain: 'northstarr.example', mutation: 'Character duplication', availability: 'Registered', risk: 34,
      nextAction: 'Repeat certificate collection', compactAction: 'Repeat certificate',
      signals: Object.freeze(['Character edit', 'Parked page pattern']),
      evidence: Object.freeze({
        registry: Object.freeze({ status: 'Complete' }), dns: Object.freeze({ status: 'Complete' }),
        website: Object.freeze({ status: 'Limited' }), certificate: Object.freeze({ status: 'Unavailable' }),
      }),
      timeline: Object.freeze([
        Object.freeze({ label: 'Initial observation', capturedAt: '2026-06-26T11:15:00.000Z', repeated: false, changes: Object.freeze([]) }),
        Object.freeze({ label: 'Repeated observation', capturedAt: '2026-06-27T11:15:00.000Z', repeated: true, changes: Object.freeze([]) }),
        Object.freeze({ label: 'Material change', capturedAt: '2026-07-01T11:15:00.000Z', repeated: false, changes: Object.freeze([
          Object.freeze({ field: 'Website activity' }),
          Object.freeze({ field: 'Website response detail' }),
          Object.freeze({ field: 'Page title' }),
        ]) }),
      ]),
    }),
    Object.freeze({
      id: 'alternate-tld', domain: 'northstar.invalid', mutation: 'Alternate TLD', availability: 'Unknown', risk: 52,
      nextAction: 'Repeat registration collection', compactAction: 'Repeat registration',
      signals: Object.freeze(['Official label on alternate TLD', 'Collection intentionally incomplete']),
      evidence: Object.freeze({
        registry: Object.freeze({ status: 'Inconclusive' }), dns: Object.freeze({ status: 'Unavailable' }),
        website: Object.freeze({ status: 'Limited' }), certificate: Object.freeze({ status: 'Unavailable' }),
      }),
      timeline: Object.freeze([
        Object.freeze({ label: 'Initial observation', capturedAt: '2026-06-26T11:15:00.000Z', repeated: false, changes: Object.freeze([]) }),
        Object.freeze({ label: 'Repeated observation', capturedAt: '2026-06-27T11:15:00.000Z', repeated: true, changes: Object.freeze([]) }),
      ]),
    }),
  ]);

  const initialCandidate = previewCandidates[0];
  if (!initialCandidate) throw new Error('The synthetic homepage preview requires one candidate.');
  let selectedCandidateId = $state(initialCandidate.id);
  const selected = $derived(previewCandidates.find((candidate) => candidate.id === selectedCandidateId) ?? initialCandidate);
  const timeline = $derived(selected.timeline.toReversed());
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
    { id: 'analysis', label: 'Review cues', detail: `${selected.signals.length} explainable cue${selected.signals.length === 1 ? '' : 's'}`, status: selected.signals.length ? 'warning' : 'success', side: 'right' as const, provenance: 'derived' as const, glyph: 'A', family: 'derived' as const },
  ]);
  const directSourceCount = 4;
  const completeSourceCount = $derived(Object.values(selected.evidence).filter((source) => source.status === 'Complete').length);
  const materialChange = $derived(timeline.find((entry) => entry.changes.length > 0) ?? null);
  const monitorAction = $derived(selected.nextAction);
  const compactMonitorAction = $derived(selected.compactAction);

  function candidateCompleteSourceCount(candidate: PreviewCandidate): number {
    return Object.values(candidate.evidence).filter((source) => source.status === 'Complete').length;
  }

  function sourceState(value: string): 'success' | 'partial' | 'inconclusive' | 'unavailable' {
    const state = value.toLowerCase();
    if (state.includes('inconclusive')) return 'inconclusive';
    if (state.includes('unavailable') || state.includes('not evaluated') || state.includes('not observed')) return 'unavailable';
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
    <header><span>Candidates</span><small>Synthetic examples</small></header>
    <div class="candidate-list">
      {#each previewCandidates as candidate}
        <button
          type="button"
          class:selected={candidate.id === selected.id}
          class="candidate-row"
          aria-pressed={candidate.id === selected.id}
          aria-label={`Show ${candidate.domain} in the preview`}
          onclick={() => selectedCandidateId = candidate.id}
        >
          <span><strong>{candidate.domain}</strong><small>{candidate.mutation}</small></span>
          <b aria-label={`${candidateCompleteSourceCount(candidate)} of ${directSourceCount} direct evidence sources complete`}>{candidateCompleteSourceCount(candidate)}/{directSourceCount}</b>
        </button>
      {/each}
    </div>
  </article>

  <article class="preview-panel lookup-panel">
    <header><span>Lookup</span><small>{selected.domain}</small></header>
    <label class="mobile-domain-picker">
      <span>Example domain</span>
      <select bind:value={selectedCandidateId}>
        {#each previewCandidates as candidate}
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
      class:source-view={previewView === 'sources'}
      role="tabpanel"
      aria-labelledby={`homepage-preview-tab-${previewView}`}
    >
      {#if previewView === 'overview'}
        <div class="assessment">
          <div><small>Registration</small><strong>{selected.availability}</strong></div>
          <div><small>Direct evidence</small><strong>{completeSourceCount}/{directSourceCount} <span>sources complete</span></strong></div>
          <div><small>Next review</small><strong>{compactMonitorAction}</strong><span class="triage-score">Risk triage {selected.risk}/100</span></div>
        </div>
        <div class="preview-findings" aria-label="Synthetic lookup summary">
          {#each selected.signals.slice(0, 2) as signal, index}
            <p><span class:observed={index === 0} class:review={index > 0} class="finding-state">{index === 0 ? 'Observed' : 'Review'}</span><strong>{signal}</strong></p>
          {/each}
        </div>
      {:else if previewView === 'sources'}
        <div class="preview-evidence-map" role="region" aria-labelledby="homepage-evidence-map-title" aria-describedby="homepage-evidence-map-description">
          <h2 id="homepage-evidence-map-title" class="sr-only">Where this result comes from</h2>
          <p id="homepage-evidence-map-description" class="sr-only">Four separately attributed evidence sources retain complete, limited, and unavailable states before an explainable assessment suggests a next review action.</p>
          <svg viewBox="0 0 620 230" role="img" aria-labelledby="homepage-evidence-svg-title homepage-evidence-svg-description">
            <title id="homepage-evidence-svg-title">Separately attributed evidence flow</title>
            <desc id="homepage-evidence-svg-description">Registry, DNS, website, and certificate observations remain separate. They feed an assessment layer, which suggests review or another bounded collection step.</desc>
            <path class="evidence-edge" d="M142 44 C210 44 216 95 278 104 M142 102 C210 102 218 110 278 112 M142 160 C210 160 216 127 278 120 M478 70 C430 70 420 101 342 108 M478 150 C430 150 420 126 342 118 M342 114 C420 114 430 114 492 114" />
            <g class={`map-node state-${topologyNodes[0]?.status}`} transform="translate(18 22)"><rect width="124" height="44" rx="9"/><text x="12" y="18">Registry</text><text class="node-state" x="12" y="34">{topologyNodes[0]?.status}</text></g>
            <g class={`map-node state-${topologyNodes[1]?.status}`} transform="translate(18 80)"><rect width="124" height="44" rx="9"/><text x="12" y="18">DNS</text><text class="node-state" x="12" y="34">{topologyNodes[1]?.status}</text></g>
            <g class={`map-node state-${topologyNodes[2]?.status}`} transform="translate(18 138)"><rect width="124" height="44" rx="9"/><text x="12" y="18">Website</text><text class="node-state" x="12" y="34">{topologyNodes[2]?.status}</text></g>
            <g class="map-node assessment-node" transform="translate(278 91)"><rect width="96" height="50" rx="12"/><text x="48" y="20" text-anchor="middle">Assessment</text><text class="node-state" x="48" y="37" text-anchor="middle">Explainable</text></g>
            <g class={`map-node state-${topologyNodes[3]?.status}`} transform="translate(478 48)"><rect width="124" height="44" rx="9"/><text x="12" y="18">Certificate</text><text class="node-state" x="12" y="34">{topologyNodes[3]?.status}</text></g>
            <g class="map-node action-node" transform="translate(478 128)"><rect width="124" height="48" rx="9"/><text x="62" y="19" text-anchor="middle">Next review action</text><text class="node-state" x="62" y="36" text-anchor="middle">{compactMonitorAction}</text></g>
          </svg>
        </div>
        <ul class="mobile-source-summary" aria-label="Synthetic evidence item status">
          {#each topologyNodes as node}
            <li class={`state-${node.status}`}><span>{node.label}</span><strong>{node.status}</strong></li>
          {/each}
        </ul>
        <p class="mobile-next-action"><strong>Next review action</strong><span>{monitorAction}</span></p>
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
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}
  .product-preview{display:grid;grid-template-columns:.85fr 1.25fr;grid-template-rows:auto auto;gap:10px;align-items:stretch}
  .discover-panel{grid-column:1;grid-row:1}.monitor-panel{grid-column:1;grid-row:2}.lookup-panel{grid-column:2;grid-row:1 / 3}
  .preview-panel{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel);box-shadow:0 18px 48px rgb(var(--shadow-rgb) / .12)}
  .preview-panel header{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);background:rgb(var(--overlay-rgb) / .025);font-family:var(--mono)}
  .preview-panel header span{color:var(--accent);font-size:var(--text-xs);font-weight:750}
  .preview-panel header small{min-width:0;overflow:hidden;color:var(--muted);font-size:var(--text-2xs);text-overflow:ellipsis;white-space:nowrap}
  .candidate-list{display:grid;gap:6px;padding:10px}
  .candidate-row{display:flex;width:100%;min-width:0;align-items:center;justify-content:space-between;gap:10px;padding:9px;border:0;border-left:2px solid transparent;border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);text-align:left;cursor:pointer}
  .candidate-row:hover{background:color-mix(in srgb,var(--accent) 5%,var(--panel-raised))}.candidate-row:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
  .candidate-row.selected{border-left-color:var(--interface-accent);background:rgb(var(--interface-accent-rgb) / .065)}
  .candidate-row>span{min-width:0}.candidate-row strong,.candidate-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .candidate-row strong{font:650 var(--text-xs) var(--mono)}.candidate-row small{margin-top:3px;color:var(--muted);font-size:.62rem}.candidate-row b{flex:0 0 auto;color:var(--muted);font:700 .65rem var(--mono)}
  .preview-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;padding:6px;border-bottom:1px solid var(--border);background:var(--panel-raised)}
  .preview-tabs button{min-width:0;min-height:34px;padding:6px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:650 .6rem var(--mono);text-align:center;cursor:pointer}
  .preview-tabs button:hover,.preview-tabs button.active{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));background:var(--panel);color:var(--accent)}
  .preview-tabs button:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
  .mobile-domain-picker{display:none}
  .preview-tab-panel{min-width:0}
  .assessment{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--border)}
  .assessment div{display:grid;gap:4px;padding:13px;background:var(--panel)}.assessment small{color:var(--muted);font:var(--text-2xs) var(--mono)}.assessment strong{color:var(--text);font:750 1.05rem var(--mono)}.assessment strong span{color:var(--muted);font-size:.62rem}.assessment .triage-score{color:var(--muted);font:600 .56rem var(--mono)}
  .preview-findings{display:grid;gap:1px;padding:1px;background:var(--border)}
  .preview-findings p{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:center;margin:0;padding:13px;background:var(--panel)}
  .preview-findings strong{font:650 var(--text-xs) var(--mono)}
  .finding-state{padding:3px 6px;border:1px solid currentColor;border-radius:999px;font:700 .52rem var(--mono);text-transform:uppercase}
  .finding-state.observed{color:var(--accent2)}.finding-state.review{color:var(--amber)}
  .mobile-source-summary{display:none}
  .preview-evidence-map{min-width:0;padding:10px 12px 7px;background:linear-gradient(145deg,var(--panel),color-mix(in srgb,var(--panel-raised) 84%,var(--accent) 3%))}
  .preview-evidence-map svg{display:block;width:100%;height:auto;max-height:238px;overflow:visible}
  .evidence-edge{fill:none;stroke:var(--border-strong);stroke-width:1.6;stroke-linecap:round}
  .map-node rect{fill:var(--panel-raised);stroke:var(--border-strong);stroke-width:1.5}
  .map-node text{fill:var(--text);font:700 11px var(--mono)}.map-node .node-state{fill:var(--muted);font-size:9px;text-transform:uppercase}
  .map-node.state-success rect{stroke:var(--accent2)}.map-node.state-partial rect,.map-node.state-inconclusive rect{stroke:var(--amber)}.map-node.state-unavailable rect{stroke:var(--muted);stroke-dasharray:4 3}
  .assessment-node rect{fill:rgb(var(--accent-rgb) / .08);stroke:var(--accent)}.assessment-node text{fill:var(--accent)}
  .action-node rect{fill:rgb(var(--amber-rgb) / .06);stroke:var(--amber)}.action-node text{fill:var(--text)}.action-node .node-state{fill:var(--amber);font-size:8px}
  .mobile-next-action{display:none}
  .lookup-timeline{display:grid;gap:0;margin:0;padding:16px 18px;list-style:none}.lookup-timeline li{display:grid;position:relative;grid-template-columns:12px minmax(0,1fr);gap:8px;min-height:68px}.lookup-timeline li::before{content:"";position:absolute;top:13px;bottom:-7px;left:4px;width:1px;background:var(--border)}.lookup-timeline li:last-child::before{display:none}.lookup-timeline li>span{z-index:1;width:9px;height:9px;margin-top:8px;border:2px solid var(--muted);border-radius:50%;background:var(--panel)}.lookup-timeline li.changed>span{border-color:var(--amber);box-shadow:0 0 7px rgb(var(--amber-rgb) / .32)}.lookup-timeline li strong,.lookup-timeline li small{display:block}.lookup-timeline li strong{font:650 var(--text-xs) var(--mono)}.lookup-timeline li small{margin-top:4px;color:var(--muted);font-size:.62rem;line-height:1.35}.lookup-timeline .change-summary{color:var(--accent)}
  .monitor-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;padding:1px;background:var(--border)}.monitor-summary>div{display:grid;gap:5px;padding:11px;background:var(--panel)}.monitor-summary small{color:var(--muted);font:var(--text-2xs) var(--mono)}.monitor-summary>div strong{color:var(--text);font:750 1rem var(--mono)}.monitor-summary p{display:flex;grid-column:1 / -1;gap:8px;align-items:center;margin:0;padding:10px;background:var(--panel)}.monitor-summary p span{width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:var(--amber);box-shadow:0 0 7px rgb(var(--amber-rgb) / .35)}.monitor-summary p strong{font:650 var(--text-2xs) var(--mono)}
  .preview-note{margin:12px 0 0;color:var(--muted);font:var(--text-2xs) var(--mono);text-align:center}
  @media(min-width:821px){
    .lookup-panel{display:flex;flex-direction:column}
    .preview-tab-panel{flex:1 1 auto}
    .preview-tab-panel.source-view{display:flex}
    .preview-tab-panel.source-view .preview-evidence-map{display:flex;width:100%;flex:1 1 auto;align-items:center}
  }
  @media(max-width:820px){.product-preview{grid-template-columns:1fr 1fr;grid-template-rows:auto auto}.lookup-panel{grid-column:1 / -1;grid-row:1}.discover-panel{grid-column:1;grid-row:2}.monitor-panel{grid-column:2;grid-row:2}}
  @media(max-width:560px){
    .product-preview{grid-template-columns:1fr}
    .lookup-panel{grid-column:auto;grid-row:auto}
    .discover-panel,.monitor-panel{display:none}
    .mobile-domain-picker{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:center;padding:8px 9px;border-bottom:1px solid var(--border);color:var(--muted);font:650 var(--text-2xs) var(--mono)}
    .mobile-domain-picker select{width:100%;min-width:0;min-height:34px;padding:5px 28px 5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);font:650 .62rem var(--mono)}
    .preview-evidence-map{display:none}
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
    .mobile-next-action{display:flex;min-width:0;align-items:flex-start;justify-content:space-between;gap:10px;margin:0;padding:10px;border-top:1px solid var(--border);background:rgb(var(--amber-rgb) / .04);font:650 .58rem var(--mono)}
    .mobile-next-action strong{color:var(--amber);text-transform:uppercase}.mobile-next-action span{min-width:0;color:var(--text);text-align:right;overflow-wrap:anywhere}
  }
</style>
