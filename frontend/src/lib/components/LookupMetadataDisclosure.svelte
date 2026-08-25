<script lang="ts">
  import type { HomepageMetadataDisplay } from '$lib/analysis/lookup-homepage-metadata-display.ts';

  let { label, metadata }: { label: string; metadata: HomepageMetadataDisplay } = $props();
</script>

<details class="metadata-disclosure disclosure">
  <summary><span>{label}</span><small>{metadata.status}</small></summary>
  <dl>
    {#each metadata.rows as row (row.id)}
      <dt>{row.label}</dt><dd>{row.value}</dd>
    {/each}
  </dl>
  {#if metadata.limitations.length}<p class="metadata-limitations">{metadata.limitations.join(' ')}</p>{/if}
  <p>{metadata.note}</p>
</details>

<style>
  .metadata-disclosure{min-width:0}
  summary{display:flex;min-width:0;align-items:baseline;justify-content:space-between;gap:10px}
  summary span{min-width:0;overflow-wrap:anywhere}
  summary small{flex:0 0 auto;color:var(--muted);font-size:var(--text-2xs);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  dl{display:grid;grid-template-columns:minmax(150px,210px) minmax(0,1fr);gap:8px;margin:10px 12px;padding:0;font-size:var(--text-xs)}
  dd{min-width:0;margin:0;overflow-wrap:anywhere}
  p{margin:10px 12px;color:var(--muted);font-size:var(--text-xs);line-height:1.55;overflow-wrap:anywhere}
  .metadata-limitations{color:var(--text)}
  @media(max-width:650px){
    dl{grid-template-columns:minmax(0,1fr);gap:4px}
    dt{margin-top:6px}
  }
</style>
