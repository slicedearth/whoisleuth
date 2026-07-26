<script lang="ts">
  import type {
    LookupTiming,
    LookupTimingSource,
  } from '$lib/analysis/lookup-response.js';

  let { timing }: { timing: LookupTiming } = $props();

  const sourceLabels: Record<LookupTimingSource, string> = {
    rdap: 'Registry RDAP',
    whois: 'WHOIS chain',
    domain_evidence: 'Domain evidence',
    registrar_rdap: 'Registrar RDAP',
    network_context: 'Network context',
    security_txt: 'security.txt',
    external_intelligence: 'Archived web intelligence',
    malware_host_intelligence: 'Malware host intelligence',
    malware_ioc_intelligence: 'Malware infrastructure intelligence',
  };

  function duration(value: number): string {
    if (value < 1_000) return `${value} ms`;
    return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
  }
</script>

<section class="collection-timing card" aria-labelledby="collection-timing-title">
  <header>
    <div>
      <p class="eyebrow">Request diagnostics</p>
      <h4 id="collection-timing-title">Collection timing</h4>
    </div>
    <span class="chip info">{duration(timing.totalMs)} total</span>
  </header>

  <p class="timing-note">
    Reported after the final response. Source branches overlap, so their durations do not add up to the total.
    A settled branch can still report partial, unavailable, or not-found evidence in its source card.
  </p>

  <ul>
    {#each timing.sources as source}
      <li>
        <span class="source">{sourceLabels[source.source]}</span>
        <span class:rejected={source.outcome === 'rejected'} class="outcome">
          {source.outcome === 'rejected' ? 'request error' : 'settled'}
        </span>
        <span class="duration">{duration(source.durationMs)}</span>
        <span class="settled">at +{duration(source.completedAfterMs)}</span>
      </li>
    {/each}
  </ul>
</section>

<style>
  .collection-timing{padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  header h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  header .chip{flex:0 0 auto}
  .timing-note{max-width:78ch;margin:10px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  ul{display:grid;gap:1px;margin:14px 0 0;padding:0;border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;list-style:none}
  li{display:grid;grid-template-columns:minmax(140px,1.4fr) minmax(92px,.6fr) minmax(70px,.45fr) minmax(78px,.5fr);gap:10px;align-items:center;min-width:0;padding:9px 11px;background:rgb(var(--bg-rgb) / .42);font:650 var(--text-xs) var(--mono)}
  li+li{border-top:1px solid var(--border)}
  .source{min-width:0;overflow-wrap:anywhere;color:var(--text)}
  .outcome{color:var(--accent);text-transform:capitalize}
  .outcome.rejected{color:var(--danger)}
  .duration,.settled{color:var(--muted);font-variant-numeric:tabular-nums;text-align:right}
  @media(max-width:620px){
    li{grid-template-columns:minmax(0,1fr) auto;gap:5px 10px}
    .duration,.settled{text-align:left}
    .settled{text-align:right}
  }
</style>
