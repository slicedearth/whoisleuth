<script lang="ts">
  import { PRIVACY_DATA_FLOW_SUMMARY } from '$lib/generated/privacy-data-flow-summary';
  import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../../../../lib/project-metadata.mts';

  export let headingLevel: 'h2' | 'h3' = 'h2';
  export let headingId = 'privacy-data-flow-catalogue';
</script>

<section class="catalogue-summary card" aria-labelledby={headingId} data-testid="privacy-data-flow-summary">
  <div class="catalogue-copy">
    <p class="eyebrow">Fixed public contract</p>
    <svelte:element this={headingLevel} id={headingId}>Structured privacy and data-flow catalogue</svelte:element>
    <p>{PRIVACY_DATA_FLOW_SUMMARY.summary}</p>
    <p class="catalogue-limit">The catalogue contains contract metadata only. Opening this guidance makes no capability or provider request and retains no investigation target.</p>
    <div class="catalogue-links">
      <a href={`${WHOISLEUTH_SOURCE_REPOSITORY_URL}/blob/main/docs/privacy-data-flow-catalogue.md`} target="_blank" rel="noopener noreferrer">Read the concise catalogue<span class="sr-only"> (opens in a new tab)</span></a>
      <a href={`${WHOISLEUTH_SOURCE_REPOSITORY_URL}/raw/refs/heads/main/docs/privacy-data-flow-catalogue.json`} target="_blank" rel="noopener noreferrer">Open version {PRIVACY_DATA_FLOW_SUMMARY.version} JSON<span class="sr-only"> (opens in a new tab)</span></a>
    </div>
  </div>
  <ul aria-label="Privacy processing classes">
    {#each PRIVACY_DATA_FLOW_SUMMARY.principalBoundaries as boundary}
      <li>{boundary}</li>
    {/each}
  </ul>
</section>

<style>
  .catalogue-summary{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(220px,.65fr);gap:clamp(20px,4vw,44px);padding:clamp(20px,4vw,34px);min-width:0;border-left:3px solid var(--interface-accent)}
  .catalogue-copy{min-width:0}.catalogue-copy :global(h2),.catalogue-copy :global(h3){margin:.3rem 0 .7rem;font:700 clamp(1.25rem,2.5vw,1.8rem) var(--mono);letter-spacing:-.035em;overflow-wrap:anywhere}.catalogue-copy>p:not(.eyebrow){margin:.55rem 0;color:var(--muted);font-size:var(--text-sm);line-height:1.65}.catalogue-copy .catalogue-limit{color:var(--text)}
  .catalogue-links{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:16px}.catalogue-links a{overflow-wrap:anywhere;font:650 var(--text-xs) var(--mono)}
  ul{display:grid;align-content:start;gap:8px;margin:0;padding:0;list-style:none}li{min-width:0;padding:9px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:rgb(var(--accent-rgb) / .04);font:650 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  @media(max-width:720px){.catalogue-summary{grid-template-columns:minmax(0,1fr)}}
</style>
