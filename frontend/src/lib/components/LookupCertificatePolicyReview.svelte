<script lang="ts">
  import type { CertificatePolicyReview } from '$lib/analysis/certificate-policy-review.ts';
  let { review }: { review: CertificatePolicyReview } = $props();
  const visible = $derived(review.findings.filter((finding) => finding.state !== 'not_configured'));
</script>

{#if visible.length}
  <details class="policy evidence-card card" id="evidence-certificate-policy">
    <summary>
      <span class="chevron" aria-hidden="true">›</span>
      <span><strong>Certificate policy context</strong><small>Current CAA, observed issuer, and reviewed expectations</small></span>
      <span class="state">{visible.some((finding) => ['changed', 'apparently_outside_current_policy'].includes(finding.state)) ? 'review' : visible.some((finding) => finding.state === 'indeterminate') ? 'partial' : 'context'}</span>
    </summary>
    <div class="body">
      <p>Compare already-collected point-in-time DNS and TLS evidence. A mismatch is a review lead, not evidence of improper issuance or compromise.</p>
      <div class="findings">
        {#each visible as finding (finding.id)}
          <article>
            <header><strong>{finding.label}</strong><span>{finding.state.replaceAll('_', ' ')}</span></header>
            <p>{finding.detail}</p>
            <dl>
              <div><dt>Observed</dt><dd>{finding.observed.join(', ') || 'Unavailable'}</dd></div>
              <div><dt>Expected or authorized</dt><dd>{finding.expected.join(', ') || 'Not established'}</dd></div>
              <div><dt>Sources</dt><dd>{finding.sources.join(', ')}</dd></div>
            </dl>
            {#if finding.limitations.length}<small>{finding.limitations.join(' ')}</small>{/if}
          </article>
        {/each}
      </div>
      <ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </div>
  </details>
{/if}

<style>
  .policy{padding:0;overflow:clip}
  summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:12px var(--card-pad);cursor:pointer;list-style:none}
  summary::-webkit-details-marker{display:none}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
  summary>span:nth-child(2){display:grid;gap:3px}
  summary strong{font:700 var(--text-sm) var(--mono)}
  summary small{color:var(--muted);font-size:var(--text-2xs)}
  .chevron{color:var(--accent);font:700 1.2rem var(--mono);transition:transform .16s ease}
  details[open] .chevron{transform:rotate(90deg)}
  .state{color:var(--cyan);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .body{padding:0 var(--card-pad) var(--card-pad);border-top:1px solid var(--border)}
  .body>p,.body>ul{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .findings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:11px}
  article{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  article header span{color:var(--cyan);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  article p,article small{display:block;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  dl{display:grid;gap:5px;margin:9px 0}
  dl div{display:grid;grid-template-columns:112px minmax(0,1fr);gap:7px}
  dt{color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  dd{min-width:0;margin:0;font-size:var(--text-xs);overflow-wrap:anywhere}
  @media(max-width:700px){.findings{grid-template-columns:1fr}dl div{grid-template-columns:1fr}}
</style>
