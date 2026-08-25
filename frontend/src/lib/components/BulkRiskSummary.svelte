<script lang="ts">
  import type { BulkRiskPresentation } from '$lib/analysis/bulk-route-model.ts';

  let {
    risk,
    domain,
  }: {
    risk: BulkRiskPresentation;
    domain: string;
  } = $props();
</script>

<div class="bulk-risk" data-risk-state={risk.state} data-risk-band={risk.band}>
  <span class="risk-band">
    <span aria-hidden="true" class="risk-symbol"></span>
    <strong>{risk.label}</strong>
    <span class="sr-only">Risk triage. {risk.summary}</span>
  </span>
  <small>{risk.state === 'comparable' ? `${risk.modelLabel} · comparable cohort` : 'Excluded from Risk comparison'}</small>
  <details class="risk-detail">
    <summary aria-label={`Inspect Risk model and factors for ${domain}`}>Inspect</summary>
    <div class="risk-detail-body">
      <p>{risk.summary}</p>
      <dl>
        <div><dt>Exact retained result</dt><dd>{risk.exactScore === null ? 'Unavailable' : `${risk.exactScore}/100`}</dd></div>
        <div><dt>Model</dt><dd>{risk.modelLabel}</dd></div>
        <div><dt>Scan depth</dt><dd>{risk.scanDepth}</dd></div>
        <div><dt>Provenance</dt><dd>{risk.provenanceLabel}</dd></div>
        <div class="source-states"><dt>Source states</dt><dd>{risk.coverageLabel}</dd></div>
      </dl>
      {#if risk.factors.length}
        <section aria-label={`Complete retained Risk factors for ${domain}`}>
          <strong class="factor-title">Complete retained factor list</strong>
          <ul>{#each risk.factors as factor}<li><span>{factor.label}</span><strong>{factor.points >= 0 ? '+' : ''}{factor.points}</strong></li>{/each}</ul>
        </section>
      {:else}
        <p>No retained Risk factor explanation is available.</p>
      {/if}
      <ul class="limitations">{#each risk.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </div>
  </details>
</div>

<style>
  .bulk-risk{display:grid;min-width:132px;max-width:260px;gap:3px}
  .risk-band{display:inline-flex;width:max-content;max-width:100%;align-items:center;gap:5px;padding:3px 6px;border:1px solid var(--border-strong);border-radius:999px;color:var(--text);font:700 var(--text-2xs) var(--mono)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}
  .risk-symbol{display:grid;width:13px;height:13px;place-items:center;border:1px solid currentColor;border-radius:50%}
  .risk-symbol::before{content:'•';font-size:8px}
  [data-risk-band='elevated'] .risk-band{border-color:var(--danger);color:var(--danger)}
  [data-risk-band='elevated'] .risk-symbol::before{content:'!'}
  [data-risk-band='review'] .risk-band{border-color:var(--amber);color:var(--amber)}
  [data-risk-band='review'] .risk-symbol::before{content:'!'}
  [data-risk-band='lower'] .risk-band{border-color:var(--muted);color:var(--text)}
  [data-risk-band='inconclusive'] .risk-band{border-style:dashed;color:var(--muted)}
  [data-risk-band='inconclusive'] .risk-symbol::before{content:'?'}
  .bulk-risk>small{color:var(--muted);font-size:var(--text-2xs);line-height:1.35;overflow-wrap:anywhere}
  .risk-detail{min-width:0}
  .risk-detail:not([open]) .risk-detail-body{display:none}
  .risk-detail>summary{width:max-content;max-width:100%;color:var(--accent);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  .risk-detail>summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .risk-detail-body{display:grid;min-width:min(420px,70vw);max-width:560px;gap:9px;margin-top:7px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);box-shadow:0 8px 24px rgb(var(--shadow-rgb) / .12)}
  .risk-detail-body p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:0}
  dl div{min-width:0;padding:6px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  dl .source-states{grid-column:1/-1}
  dt{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  dd{margin:3px 0 0;color:var(--text);font-size:var(--text-2xs);line-height:1.4;overflow-wrap:anywhere;text-transform:capitalize}
  .factor-title{display:block;font:700 var(--text-2xs) var(--mono)}
  section ul,.limitations{display:grid;gap:5px;margin:5px 0 0;padding:0;list-style:none}
  section li{display:flex;justify-content:space-between;gap:8px;padding:6px;border-left:2px solid var(--border);font-size:var(--text-2xs)}
  section li span{min-width:0;overflow-wrap:anywhere}
  section li strong{flex:0 0 auto}
  .limitations{padding-left:16px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4;list-style:disc}
  @media(max-width:700px){
    .bulk-risk{min-width:0;max-width:none}
    .risk-detail-body{min-width:0;max-width:none;box-shadow:none}
    dl{grid-template-columns:minmax(0,1fr)}
    dl .source-states{grid-column:auto}
  }
</style>
