<script lang="ts">
  type Finding = {
    id: string;
    category: string;
    state: string;
    tone: string;
    label: string;
    detail: string;
    evidence: string[];
  };
  type Summary = { observed: number; potentialExposure: number; observedAbsence: number; unavailable: number };

  let {
    status,
    complete,
    summary,
    findings,
    limitations,
  }: {
    status: string;
    complete: boolean;
    summary: Summary;
    findings: Finding[];
    limitations: string[];
  } = $props();

  function stateLabel(value: string) {
    if (value === 'potential_exposure') return 'Review';
    if (value === 'observed_absence') return 'Not observed';
    if (value === 'unavailable') return 'Unavailable';
    return 'Observed';
  }
</script>

<section class="security-posture-card evidence-card card" aria-labelledby="security-posture-title">
  <header class="section-head">
    <div><p class="eyebrow">Derived deep-scan analysis</p><h4 id="security-posture-title">Passive security posture</h4></div>
    <span class:partial={!complete}>{status}</span>
  </header>

  <div class="posture-summary stat-grid" aria-label="Passive security posture summary">
    <article><small>Observed</small><strong>{summary.observed}</strong></article>
    <article class:review={summary.potentialExposure > 0}><small>Review</small><strong>{summary.potentialExposure}</strong></article>
    <article><small>Not observed</small><strong>{summary.observedAbsence}</strong></article>
    <article><small>Unavailable</small><strong>{summary.unavailable}</strong></article>
  </div>

  <div class="posture-grid">
    {#each findings as finding}
      <article class:review={finding.tone === 'review'} class:configured={finding.tone === 'configured'}>
        <div class="finding-head">
          <div><p>{finding.category}</p><h5>{finding.label}</h5></div>
          <span class="state state-{finding.tone}">{stateLabel(finding.state)}</span>
        </div>
        <p class="detail">{finding.detail}</p>
        {#if finding.evidence.length}<p class="evidence">Evidence: {finding.evidence.join(', ')}</p>{/if}
      </article>
    {/each}
  </div>

  {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
  <p class="card-note">These findings interpret existing point-in-time HTTP, static page, TLS, DNSSEC, and CAA evidence. They make no additional request and are review signals, not confirmed vulnerabilities or a claim that the site is safe.</p>
</section>

<style>
  .evidence-card{padding:var(--card-pad)}
  .posture-summary{margin-top:14px}
  .posture-summary .review strong{color:var(--danger)}
  .posture-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:10px;margin-top:14px}
  .posture-grid>article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-soft)}
  .posture-grid>article.review{border-color:color-mix(in srgb,var(--danger) 42%,var(--border))}
  .posture-grid>article.configured{border-color:color-mix(in srgb,var(--success) 34%,var(--border))}
  .finding-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .finding-head>div{min-width:0}
  .finding-head p{margin:0 0 3px;color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.04em}
  .finding-head h5{margin:0;color:var(--text);font-size:var(--text-sm);overflow-wrap:anywhere}
  .state{flex:0 0 auto;padding:3px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.04em}
  .state-review{border-color:color-mix(in srgb,var(--danger) 42%,var(--border));color:var(--danger)}
  .state-configured{border-color:color-mix(in srgb,var(--success) 40%,var(--border));color:var(--success)}
  .detail{margin:9px 0 0;font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  .evidence{margin:7px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  .callout{margin-top:12px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  @media(max-width:650px){
    .finding-head{display:grid;gap:7px}
    .state{justify-self:start}
  }
</style>
