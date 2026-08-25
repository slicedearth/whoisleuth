<script lang="ts">
  import type {
    LookupClaimReadiness,
    LookupClaimId,
    LookupClaimReadinessState,
  } from '$lib/analysis/lookup-claim-readiness.ts';
  import type { LookupReviewActionModel } from '$lib/analysis/lookup-review-action-model.ts';

  let {
    readiness,
    reviewActions,
    onpassport,
  }: {
    readiness: LookupClaimReadiness;
    reviewActions: LookupReviewActionModel;
    onpassport?: (claimId: LookupClaimId) => Promise<string>;
  } = $props();

  const impact = $derived(reviewActions.evidenceImprovements);

  let exportingClaim = $state<LookupClaimId | null>(null);
  let passportStatus = $state('');
  let readinessEpoch = 0;

  $effect(() => {
    void readiness;
    readinessEpoch += 1;
    exportingClaim = null;
    passportStatus = '';
  });

  async function exportPassport(claimId: LookupClaimId): Promise<void> {
    if (!onpassport || exportingClaim) return;
    const epoch = readinessEpoch;
    exportingClaim = claimId;
    passportStatus = '';
    try {
      const message = await onpassport(claimId);
      if (epoch === readinessEpoch) passportStatus = message;
    } catch (error) {
      if (epoch === readinessEpoch) {
        passportStatus = error instanceof Error
          ? error.message
          : 'The claim passport could not be prepared.';
      }
    } finally {
      if (epoch === readinessEpoch) exportingClaim = null;
    }
  }

  const labels: Readonly<Record<LookupClaimReadinessState, string>> = {
    ready: 'Evidence ready',
    limited: 'Limited',
    not_ready: 'Not ready',
  };
</script>

{#if readiness.entries.length}
  <section class="claim-readiness card" aria-labelledby="claim-readiness-title">
    <header>
      <div>
        <p class="eyebrow">Evidence Readiness</p>
        <h4 id="claim-readiness-title">What the current evidence can support</h4>
        <p>Each row checks the evidence needed for one narrow statement. It does not add a score or convert an incomplete source into a negative conclusion.</p>
      </div>
      <div class="counts" role="group" aria-label="Evidence Readiness summary">
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
          <div class="claim-actions">
            <a href={entry.href}>Review evidence</a>
            {#if onpassport}
              <button
                type="button"
                class="btn small"
                disabled={exportingClaim !== null}
                aria-label={`Download portable passport for ${entry.label}`}
                onclick={() => void exportPassport(entry.id)}
              >{exportingClaim === entry.id ? 'Preparing…' : 'Download passport'}</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    {#if passportStatus}<p class="passport-status" role="status">{passportStatus}</p>{/if}

    {#if impact.displayedItems.length}
      <details
        class="impact-plan"
        data-total={impact.total}
        data-displayed-count={impact.displayedCount}
        data-omitted-count={impact.omittedCount}
      >
        <summary>Plan {impact.total} evidence improvement{impact.total === 1 ? '' : 's'}</summary>
        <p class="impact-intro">Prioritised by the statement each step could improve, rather than by the number of sources available.</p>
        <p class="impact-counts">Showing <strong>{impact.displayedCount}</strong> of <strong>{impact.total}</strong> bounded actions. {impact.omittedCount > 0 ? `${impact.omittedCount} omitted.` : 'None omitted.'}</p>
        <ul class="impacts">
          {#each impact.displayedItems as item (item.id)}
            <li
              data-impact-id={item.id}
              data-basis={item.basis}
              data-fact-id={item.factId ?? ''}
              data-mode={item.mode}
              data-evidence-state={item.evidenceState ?? ''}
              data-freshness={item.freshness ?? ''}
            >
              <div class="impact-head">
                <strong>{item.evidenceLabel}</strong>
                <span class="mode">{item.mode === 'network_collection' ? 'Network request' : 'Local review'}</span>
              </div>
              <p class="basis"><b>Basis:</b> {item.basisLabel}</p>
              {#if item.factId && item.evidencePresentation && item.freshnessPresentation}
                <p class="fact-id"><b>Decision Fact:</b> {item.factId}</p>
                <div class="canonical-state" aria-label={`Canonical evidence presentation for ${item.evidenceLabel}`}>
                  <span data-tone={item.evidencePresentation.tone} data-evidence-state={item.evidenceState}>{item.evidencePresentation.label}</span>
                  <span data-tone={item.freshnessPresentation.tone} data-freshness={item.freshness}>{item.freshnessPresentation.label}</span>
                </div>
                {#if item.contributors.length}
                  <ul class="impact-contributors" aria-label={`Contributors for ${item.evidenceLabel}`}>
                    {#each item.contributors as contributor (contributor.id)}
                      <li data-contributor-id={contributor.id} data-provenance={contributor.provenance}>
                        <strong>{contributor.label}</strong>
                        <span>{contributor.provenancePresentation.label} · {contributor.evidencePresentation.label}</span>
                        {#each contributor.limitations as limitation}
                          <p class="limitation"><b>Limitation from {contributor.label}:</b> {limitation}</p>
                        {/each}
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#each item.unattributedLimitations as limitation}
                  <p class="limitation"><b>Adjacent fact limitation:</b> {limitation}</p>
                {/each}
              {:else}
                <p class="context-note">No Decision Fact or collected-evidence provenance is attributed to this contextual requirement.</p>
                {#each item.limitations as limitation}
                  <p class="limitation"><b>Context limitation:</b> {limitation}</p>
                {/each}
              {/if}
              <p>{item.reason}</p>
              <p class="effect">{item.expectedEffect}</p>
              <small>{item.disclosure}</small>
              <a href={item.href}>Review this evidence path</a>
            </li>
          {/each}
        </ul>
        <p class="note">{impact.limitation}</p>
      </details>
    {/if}

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
  .claims,.diagnostics,.impacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0 0;padding:0;list-style:none}
  .claims>li,.diagnostics>li,.impacts>li{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .claim-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .claim-head strong,.diagnostics strong{font-size:var(--text-xs);line-height:1.4}
  .state{flex:0 0 auto;padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .state-ready{border-color:color-mix(in srgb,var(--success) 45%,var(--border));color:var(--success)}
  .state-limited,.state-not_ready{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  .claims p,.diagnostics p{margin:6px 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .claim-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}.claims a{font:650 var(--text-2xs) var(--mono)}.claim-actions button{min-height:36px;padding:7px 9px;font-size:var(--text-2xs)}
  .claims .missing{color:var(--text)}
  .claims b{font-weight:700}
  details{margin-top:12px;border-top:1px solid var(--border)}
  summary{padding:12px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .diagnostics{margin-top:0}
  .diagnostics span{color:var(--muted);font:var(--text-2xs) var(--mono)}
  .note,.limit,.passport-status{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .impact-intro,.impact-counts{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}.impact-counts{margin-top:5px}.impact-counts strong{color:var(--text)}.impacts{margin-top:9px}.impact-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.impact-head strong{font-size:var(--text-xs)}.mode{flex:0 0 auto;color:var(--accent);font:650 var(--text-2xs) var(--mono)}.impacts p,.impacts small{display:block;margin:5px 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.impacts .effect,.impacts .fact-id b,.impacts .basis b,.impacts .limitation b{color:var(--text)}.impacts a{font:650 var(--text-2xs) var(--mono)}
  .canonical-state{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.canonical-state span{padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--text);font:650 var(--text-2xs) var(--mono)}.canonical-state span[data-tone='caution']{border-color:color-mix(in srgb,var(--amber) 45%,var(--border))}.canonical-state span[data-tone='conflict']{border-color:color-mix(in srgb,var(--danger) 45%,var(--border))}.impact-contributors{display:grid;gap:5px;margin:7px 0 0;padding:7px 0 0;border-top:1px solid var(--border);list-style:none}.impact-contributors li{min-width:0}.impact-contributors strong,.impact-contributors span{display:block;overflow-wrap:anywhere}.impact-contributors strong{font-size:var(--text-2xs)}.impact-contributors span{color:var(--muted);font-size:var(--text-2xs)}.impacts .limitation{padding-left:8px;border-left:1px solid var(--amber);overflow-wrap:anywhere}.impacts .fact-id,.impacts .context-note,.impacts .basis{overflow-wrap:anywhere}
  .limit{padding-top:10px;border-top:1px solid var(--border)}
  @media(max-width:760px){
    header{display:grid}
    .counts{width:100%}.counts span{flex:1}
    .claims,.diagnostics,.impacts{grid-template-columns:minmax(0,1fr)}
    .claim-actions{align-items:stretch;flex-direction:column}.claim-actions button{width:100%}
  }
</style>
