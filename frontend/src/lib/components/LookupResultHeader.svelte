<script lang="ts">
  let {
    title,
    state,
    isSubdomain,
    registrableDomain,
    inputHostname,
    onExport,
  }: {
    title: string;
    state: string;
    isSubdomain: boolean;
    registrableDomain: string;
    inputHostname: string;
    onExport: () => void;
  } = $props();
</script>

<div class="result-head">
  <div>
    <p class="eyebrow">Result</p>
    <h2>{title}</h2>
    {#if isSubdomain}
      <p>Showing registry data for {registrableDomain}; submitted hostname: {inputHostname}.</p>
    {/if}
  </div>
  <div class="result-actions">
    <span class="chip info">{state}</span>
    <button class="btn" onclick={onExport}>Export evidence JSON</button>
  </div>
</div>

<style>
  .result-head{display:flex;align-items:end;justify-content:space-between;gap:12px 20px;margin:30px 0 0}
  .result-head h2{margin:0;font:700 clamp(1.5rem,3.4vw,2rem) var(--mono);letter-spacing:-.03em;overflow-wrap:anywhere}
  .result-head p{margin:6px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .result-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
  .result-actions .chip{text-transform:capitalize;font-size:var(--text-xs)}
  @media(max-width:650px){
    .result-head{align-items:flex-start;flex-direction:column}
    .result-actions{width:100%}
  }
</style>
