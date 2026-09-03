<script lang="ts">
  import { evidenceStatusChipClass } from '$lib/analysis/evidence-status-tone.ts';

  type JsonRecord = Record<string, unknown>;
  type RiskContext = {
    contribution: number;
    eligibleProviderCount: number;
    independentPublisherCount: number;
    freshestAgeDays: number | null;
    unknownAgeProviderCount: number;
  };

  let { providers, riskContext, riskModelVersion, showValue, formatDate }: {
    providers: JsonRecord[];
    riskContext: RiskContext;
    riskModelVersion: number | null;
    showValue: (value: unknown) => string;
    formatDate: (value: unknown) => string;
  } = $props();

  const record = (value: unknown): JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};

  function providerChipClass(state: unknown): string {
    return evidenceStatusChipClass(state);
  }
</script>

<section class="threat-intelligence evidence-card card" aria-labelledby="threat-intelligence-title">
  <header class="section-head"><div><p class="eyebrow">External intelligence</p><h4 id="threat-intelligence-title">Archived provider verdicts</h4></div><span>Separately attributed</span></header>
  <p class="card-note">Third-party observations remain attributed and do not decide availability. Risk changes only when qualifying records agree across at least two publisher families.</p>
  {#if riskContext.eligibleProviderCount}
    <p class="callout warn external-risk-context">
      {#if riskContext.contribution}
        Risk context: {riskContext.independentPublisherCount} independent publisher families contributed +{riskContext.contribution} under model v{riskModelVersion ?? '—'}.
      {:else}
        Risk context: {riskContext.eligibleProviderCount} qualifying provider observation{riskContext.eligibleProviderCount === 1 ? '' : 's'} represented {riskContext.independentPublisherCount} publisher family; no points were added because independent corroboration was absent.
      {/if}
      {#if riskContext.freshestAgeDays !== null} Newest qualifying record age: {riskContext.freshestAgeDays} day{riskContext.freshestAgeDays === 1 ? '' : 's'}.{/if}
      {#if riskContext.unknownAgeProviderCount} {riskContext.unknownAgeProviderCount} qualifying provider observation{riskContext.unknownAgeProviderCount === 1 ? ' has' : 's have'} unknown age.{/if}
    </p>
  {/if}
  {#each providers as provider}
    {@const providerIdentity = record(provider.provider)}
    {@const providerObservation = record(provider.observation)}
    {@const findings = Array.isArray(provider.findings) ? provider.findings.map(record) : []}
    <article>
      <div class="threat-source"><strong>{showValue(providerIdentity.label)}</strong><span class="chip {providerChipClass(provider.state)}">{showValue(provider.state)}</span></div>
      {#if provider.detail}<p>{showValue(provider.detail)}</p>{/if}
      {#if findings.length}<ul>{#each findings as finding}<li class="callout warn"><div><strong>{showValue(finding.category)}</strong><span>{[`Severity: ${showValue(finding.severity)}`, `Confidence: ${showValue(finding.confidence)}`, finding.providerVerdict, finding.lastObservedAt ? formatDate(finding.lastObservedAt) : null].filter(Boolean).join(' · ')}</span></div>{#if finding.detail}<p>{showValue(finding.detail)}</p>{/if}{#if typeof finding.referenceUrl === 'string'}<a href={finding.referenceUrl} target="_blank" rel="noopener noreferrer">View attributed provider record<span class="sr-only"> (opens in a new tab)</span></a>{/if}</li>{/each}</ul>{/if}
      {#if Array.isArray(providerObservation.limitations) && providerObservation.limitations.length}<details class="disclosure"><summary>Limitations</summary><ul class="limitation-list">{#each providerObservation.limitations as limitation}<li>{showValue(limitation)}</li>{/each}</ul></details>{/if}
    </article>
  {/each}
</section>

<style>
  .evidence-card{padding:var(--card-pad)}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .evidence-card .disclosure ul{display:grid;gap:7px;margin:10px 12px;padding-left:18px}
  .evidence-card .disclosure li{font-size:var(--text-xs);overflow-wrap:anywhere}
  .threat-intelligence>article{margin-top:12px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .threat-source{display:flex;justify-content:space-between;gap:10px;align-items:start}
  .threat-source strong{font-size:var(--text-sm)}
  .threat-source .chip{text-transform:capitalize}
  .threat-intelligence article>p{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .threat-intelligence article ul{display:grid;gap:8px;margin:10px 0 0;padding:0;list-style:none}
  .threat-intelligence li.callout{margin:0;overflow-wrap:anywhere}
  .threat-intelligence li>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 10px}
  .threat-intelligence li>div strong{color:var(--text);font-size:var(--text-xs)}
  .threat-intelligence li span{color:var(--muted);font-size:var(--text-2xs)}
  .threat-intelligence li p{margin:5px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .threat-intelligence li a{display:inline-block;margin-top:6px;color:var(--accent);font-size:var(--text-xs);text-decoration:underline}
  .limitation-list li{color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:650px){.threat-source{flex-direction:column;gap:6px}}
</style>
