<script lang="ts">
  import type {
    LookupClaimReadiness,
    LookupClaimReadinessState,
  } from '$lib/analysis/lookup-claim-readiness.ts';

  let { readiness }: { readiness: LookupClaimReadiness } = $props();

  const labels: Readonly<Record<LookupClaimReadinessState, string>> = {
    ready: 'Evidence ready',
    limited: 'Limited',
    not_ready: 'Not ready',
    not_applicable: 'Not applicable',
  };
</script>

{#if readiness.entries.length}
  <section class="claim-readiness card" aria-labelledby="claim-readiness-title">
    <header>
      <div>
        <p class="eyebrow">Claim readiness</p>
        <h4 id="claim-readiness-title">What the current evidence can support</h4>
        <p>Each row checks the evidence needed for one narrow statement. It does not add a score or convert an incomplete source into a negative conclusion.</p>
      </div>
      <div class="counts" role="group" aria-label="Claim-readiness summary">
        <span><strong>{readiness.counts.ready}</strong> ready</span>
        <span><strong>{readiness.counts.limited + readiness.counts.not_ready}</strong> limited</span>
      </div>
    </header>

    <ul class="claims">
      {#each readiness.entries as entry (entry.id)}
        <li>
          <div class="claim-head">
            <strong>{entry.label}</strong>
            <span class="state state-{entry.state}">{labels[entry.state]}</span>
          </div>
          <p>{entry.conclusion}</p>
          {#if entry.missingEvidence.length}
            <p class="missing"><b>Still needed:</b> {entry.missingEvidence.join(' · ')}</p>
          {:else}
            <p class="requirements"><b>Supported by:</b> {entry.requiredEvidence.join(' · ')}</p>
          {/if}
          <a href={entry.href}>Review evidence</a>
        </li>
      {/each}
    </ul>

    {#if readiness.disagreements.length}
      <details>
        <summary>Why {readiness.disagreements.length} registration difference{readiness.disagreements.length === 1 ? '' : 's'} may exist</summary>
        <ul class="diagnostics">
          {#each readiness.disagreements as item (item.id)}
            <li>
              <strong>{item.field}: {item.hypothesis}</strong>
              <p>{item.detail}</p>
              <span>Basis: {item.basis.join(' · ')}</span>
            </li>
          {/each}
        </ul>
        <p class="note">These are possible explanations derived from source type, field class, and collection time. They are not findings about why a source differs.</p>
      </details>
    {/if}
    <p class="limit">{readiness.limitation}</p>
  </section>
{/if}

<style>
  .claim-readiness{min-width:0;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  header h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .counts{display:flex;flex:0 0 auto;gap:7px}
  .counts span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .counts strong{color:var(--text);font-size:var(--text-sm)}
  .claims,.diagnostics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0 0;padding:0;list-style:none}
  .claims>li,.diagnostics>li{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .claim-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .claim-head strong,.diagnostics strong{font-size:var(--text-xs);line-height:1.4}
  .state{flex:0 0 auto;padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .state-ready{border-color:color-mix(in srgb,var(--success) 45%,var(--border));color:var(--success)}
  .state-limited,.state-not_ready{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  .claims p,.diagnostics p{margin:6px 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .claims a{font:650 var(--text-2xs) var(--mono)}
  .claims .missing{color:var(--text)}
  .claims b{font-weight:700}
  details{margin-top:12px;border-top:1px solid var(--border)}
  summary{padding:12px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .diagnostics{margin-top:0}
  .diagnostics span{color:var(--muted);font:var(--text-2xs) var(--mono)}
  .note,.limit{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .limit{padding-top:10px;border-top:1px solid var(--border)}
  @media(max-width:760px){
    header{display:grid}
    .counts{width:100%}.counts span{flex:1}
    .claims,.diagnostics{grid-template-columns:minmax(0,1fr)}
  }
</style>
