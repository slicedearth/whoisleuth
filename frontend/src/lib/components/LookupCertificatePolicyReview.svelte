<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  import type { CertificatePolicyReview, CertificatePolicyState } from '$lib/analysis/certificate-policy-review.ts';
  let { review }: { review: CertificatePolicyReview } = $props();
  const visible = $derived(review.findings.filter((finding) => finding.state !== 'not_configured'));
  const status = $derived(visible.some((finding) => ['changed', 'apparently_outside_current_policy'].includes(finding.state))
    ? 'review'
    : visible.some((finding) => finding.state === 'indeterminate')
      ? 'partial'
      : 'context');

  function findingTone(state: CertificatePolicyState): 'complete' | 'partial' | 'neutral' {
    if (state === 'aligned') return 'complete';
    if (state === 'changed' || state === 'apparently_outside_current_policy' || state === 'indeterminate') return 'partial';
    return 'neutral';
  }

  function findingStateLabel(state: CertificatePolicyState): string {
    if (state === 'aligned') return 'Aligned';
    if (state === 'apparently_outside_current_policy') return 'Review';
    if (state === 'changed') return 'Changed';
    if (state === 'indeterminate') return 'Partial';
    if (state === 'no_target_policy_observed') return 'No policy observed';
    return 'Not configured';
  }
</script>

{#if visible.length}
  <details class="policy evidence-card card" id="evidence-certificate-policy" aria-labelledby="certificate-policy-title">
    <summary class="evidence-summary">
      <span class="evidence-summary-row">
        <span class="evidence-summary-copy">
          <span class="eyebrow">Derived deep-scan analysis</span>
          <span class="evidence-summary-title" id="certificate-policy-title" role="heading" aria-level="4">Certificate policy context</span>
          <span class="evidence-summary-detail">Current CAA, observed issuer, and reviewed expectations</span>
        </span>
        <span class="evidence-status {status === 'context' ? 'neutral' : evidenceStatusTone(status)}">{status}</span>
      </span>
    </summary>
    <div class="body evidence-body">
      <p>Compare already-collected point-in-time DNS and TLS evidence. A mismatch is a review lead, not evidence of improper issuance or compromise.</p>
      <div class="findings">
        {#each visible as finding (finding.id)}
          <article>
            <header><strong>{finding.label}</strong><span class="finding-state {findingTone(finding.state)}">{findingStateLabel(finding.state)}</span></header>
            <p>{finding.detail}</p>
            <dl>
              <div><dt>Observed</dt><dd>{finding.observed.join(', ') || 'Unavailable'}</dd></div>
              <div><dt>Expected or authorised</dt><dd>{finding.expected.join(', ') || 'Not established'}</dd></div>
              <div><dt>Sources</dt><dd>{finding.sources.join(', ')}</dd></div>
            </dl>
            {#if finding.limitations.length}<small>{finding.limitations.join(' ')}</small>{/if}
          </article>
        {/each}
      </div>
      {#if review.caaAuthorizations.some((authorization) => authorization.accountUris.length || authorization.validationMethods.length || authorization.unrecognizedParameters.length)}
        <details class="authorization-parameters">
          <summary>Review CAA authorisation parameters</summary>
          <div>
            {#each review.caaAuthorizations as authorization}
              {#if authorization.accountUris.length || authorization.validationMethods.length || authorization.unrecognizedParameters.length}
                <article>
                  <strong>{authorization.tag} {authorization.issuer}</strong>
                  <dl>
                    {#if authorization.accountUris.length}<div><dt>Account URI</dt><dd>{authorization.accountUris.join(', ')}</dd></div>{/if}
                    {#if authorization.validationMethods.length}<div><dt>Validation methods</dt><dd>{authorization.validationMethods.join(', ')}</dd></div>{/if}
                    {#if authorization.unrecognizedParameters.length}<div><dt>Other parameters</dt><dd>{authorization.unrecognizedParameters.join(', ')}</dd></div>{/if}
                  </dl>
                </article>
              {/if}
            {/each}
          </div>
          <p>These parameters are current DNS policy context. They do not prove which account or validation method was used for the observed certificate.</p>
        </details>
      {/if}
      <ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </div>
  </details>
{/if}

<style>
  .policy{padding:0;overflow:hidden}
  .body>p,.body>ul{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .findings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:11px}
  article{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .finding-state{flex:0 0 auto;padding:3px 7px;border:1px solid var(--border-strong);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .finding-state.complete{border-color:color-mix(in srgb,var(--success) 40%,var(--border));color:var(--success)}
  .finding-state.partial{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  .authorization-parameters{margin-top:10px;border-top:1px solid var(--border)}
  .authorization-parameters summary{padding:10px 0;color:var(--text);font:650 var(--text-xs) var(--mono);cursor:pointer}
  .authorization-parameters>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .authorization-parameters>p{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  article p,article small{display:block;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  dl{display:grid;gap:5px;margin:9px 0}
  dl div{display:grid;grid-template-columns:112px minmax(0,1fr);gap:7px}
  dt{color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  dd{min-width:0;margin:0;font-size:var(--text-xs);overflow-wrap:anywhere}
  @media(max-width:700px){.findings,.authorization-parameters>div{grid-template-columns:1fr}article header{display:grid;gap:7px}.finding-state{justify-self:start}dl div{grid-template-columns:1fr}}
</style>
