<script lang="ts">
  let {
    title,
    state: resultState,
    isSubdomain,
    registrableDomain,
    inputHostname,
    onExport,
    onReportExport = null,
    onBriefExport = null,
  }: {
    title: string;
    state: string;
    isSubdomain: boolean;
    registrableDomain: string;
    inputHostname: string;
    onExport: () => void;
    onReportExport?: ((includeAttribution: boolean) => void) | null;
    onBriefExport?: (() => void) | null;
  } = $props();

  let exportMenuOpen = $state(false);
  let includeAttribution = $state(true);
  function runExport(action: () => void) {
    action();
    exportMenuOpen = false;
  }
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
    <span class="chip info">{resultState}</span>
    <details class="export-menu" bind:open={exportMenuOpen}>
      <summary class="btn">Export <span aria-hidden="true">▾</span></summary>
      <div class="export-options" role="group" aria-label="Export Lookup result">
        {#if onReportExport}
          <button type="button" onclick={() => runExport(() => onReportExport(includeAttribution))}>Download report</button>
          <label class="export-choice">
            <input type="checkbox" bind:checked={includeAttribution}>
            <span>Include generator footer</span>
          </label>
        {/if}
        {#if onBriefExport}
          <button type="button" onclick={() => runExport(onBriefExport)}>Download brief</button>
        {/if}
        <button type="button" onclick={() => runExport(onExport)}>Export evidence JSON</button>
      </div>
    </details>
  </div>
</div>

<style>
  .result-head{display:flex;align-items:end;justify-content:space-between;gap:12px 20px;margin:30px 0 0}
  .result-head h2{margin:0;font:700 clamp(1.5rem,3.4vw,2rem) var(--mono);letter-spacing:-.03em;overflow-wrap:anywhere}
  .result-head p{margin:6px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .result-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
  .result-actions .chip{text-transform:capitalize;font-size:var(--text-xs)}
  .export-menu{position:relative}
  .export-menu>summary{display:flex;align-items:center;gap:7px;cursor:pointer;list-style:none}
  .export-menu>summary::-webkit-details-marker{display:none}
  .export-menu>summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .export-options{position:absolute;z-index:18;top:calc(100% + 6px);right:0;display:grid;min-width:210px;padding:5px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);box-shadow:0 14px 34px rgb(var(--shadow-rgb) / .24)}
  .export-options button{width:100%;padding:9px 10px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--text);font:650 var(--text-xs) var(--mono);text-align:left;cursor:pointer}
  .export-options button:hover,.export-options button:focus-visible{background:rgb(var(--accent-rgb) / .09);color:var(--accent)}
  .export-choice{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-top:1px solid var(--border);color:var(--muted);font:var(--text-2xs) var(--mono);line-height:1.4;cursor:pointer}.export-choice input{flex:0 0 auto;margin-top:2px}
  @media(max-width:650px){
    .result-head{align-items:flex-start;flex-direction:column}
    .result-actions{width:100%;justify-content:space-between}
    .export-options{right:0;max-width:calc(100vw - 40px)}
  }
</style>
