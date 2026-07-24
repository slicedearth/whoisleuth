<script lang="ts">
  import type { AnalystEvidencePivot } from '$lib/analysis/analyst-evidence-pivots.ts';

  let { pivots }: { pivots: AnalystEvidencePivot[] } = $props();
</script>

{#if pivots.length}
  <details class="analyst-pivots card">
    <summary>
      <span>
        <span class="eyebrow">Analyst tools</span>
        <span class="summary-title" role="heading" aria-level="4">External evidence pivots</span>
        <span class="summary-detail">Optional passive destinations derived from validated evidence</span>
      </span>
      <span class="count">{pivots.length}</span>
    </summary>

    <div class="pivot-body">
      <p class="privacy-note">
        WHOISleuth does not contact these destinations, prefetch their pages, retain their results, or use
        them for availability or scoring. A destination receives the displayed value only after you open
        its link.
      </p>

      <ul>
        {#each pivots as pivot (pivot.id)}
          <li>
            <span class={`pivot-icon category-${pivot.category}`} aria-hidden="true">
              {#if pivot.category === 'registration'}
                <svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/></svg>
              {:else if pivot.category === 'network'}
                <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.5"/><circle cx="18.5" cy="6" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="m7.3 10.9 8.9-4M7.3 13.1l8.9 4"/></svg>
              {:else if pivot.category === 'certificate'}
                <svg viewBox="0 0 24 24"><path d="M6 3.5h9l3 3V17H6zM15 3.5v3h3M9 9.5h6M9 13h4"/><path d="m10 17 2 3 2-3"/></svg>
              {:else if pivot.category === 'history'}
                <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/></svg>
              {:else}
                <svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5.5c0 4.4-2.8 7.4-7 9-4.2-1.6-7-4.6-7-9V6z"/><path d="M9 12h6M12 9v6"/></svg>
              {/if}
            </span>
            <span class="pivot-copy">
              <small>{pivot.destination}</small>
              <strong>{pivot.label}</strong>
              <span>{pivot.description}</span>
              <code>{pivot.sharedValue}</code>
              <span class="disclosure" id={`pivot-disclosure-${pivot.id}`}>{pivot.disclosure}</span>
            </span>
            <a
              class="btn small"
              href={pivot.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={`pivot-disclosure-${pivot.id}`}
              aria-label={`Open ${pivot.destination}: ${pivot.label} in a new tab`}
            >Open <span aria-hidden="true">↗</span></a>
          </li>
        {/each}
      </ul>

      <p class="interpretation">
        External records remain separately attributed leads. Missing or neutral results do not establish
        absence, inactivity, or safety.
      </p>
    </div>
  </details>
{/if}

<style>
  .analyst-pivots{padding:0;overflow:hidden}
  summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:16px 18px;cursor:pointer;list-style:none}
  summary::-webkit-details-marker{display:none}
  summary>span:first-child{display:grid;min-width:0}
  summary::before{content:">";align-self:center;color:var(--accent2);font:800 var(--text-sm) var(--mono);transition:transform .16s ease}
  details[open]>summary::before{transform:rotate(90deg)}
  .summary-title{margin-top:2px;color:var(--text);font:700 var(--text-md) var(--mono)}
  .summary-detail{margin-top:4px;color:var(--muted);font-size:var(--text-xs)}
  .count{display:grid;width:30px;height:30px;flex:0 0 auto;place-items:center;border:1px solid rgb(var(--accent2-rgb) / .45);border-radius:50%;background:rgb(var(--accent2-rgb) / .08);color:var(--accent2);font:700 var(--text-xs) var(--mono)}
  .pivot-body{padding:0 18px 18px;border-top:1px solid var(--border)}
  .privacy-note,.interpretation{margin:14px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .privacy-note{padding:11px 12px;border-left:3px solid var(--accent2);background:rgb(var(--accent2-rgb) / .05)}
  ul{display:grid;gap:8px;margin:14px 0 0;padding:0;list-style:none}
  li{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:11px;align-items:start;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .pivot-icon{display:grid;width:36px;height:36px;place-items:center;border:1px solid rgb(var(--accent-rgb) / .35);border-radius:var(--radius-sm);background:rgb(var(--accent-rgb) / .06);color:var(--accent)}
  .pivot-icon.category-registration{border-color:rgb(var(--accent2-rgb) / .35);background:rgb(var(--accent2-rgb) / .06);color:var(--accent2)}
  .pivot-icon.category-certificate,.pivot-icon.category-history{border-color:rgb(var(--amber-rgb) / .38);background:rgb(var(--amber-rgb) / .06);color:var(--amber)}
  .pivot-icon.category-reputation{border-color:rgb(var(--violet-rgb) / .38);background:rgb(var(--violet-rgb) / .06);color:var(--violet)}
  .pivot-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
  .pivot-copy{display:grid;min-width:0}
  .pivot-copy small{color:var(--muted);font:650 var(--text-2xs) var(--mono);letter-spacing:.03em;text-transform:uppercase}
  .pivot-copy strong{margin-top:2px;font:700 var(--text-sm) var(--mono)}
  .pivot-copy>span:not(.disclosure){margin-top:4px;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  code{width:fit-content;max-width:100%;margin-top:7px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;color:var(--accent);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .disclosure{margin-top:6px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  li>.btn{align-self:center;white-space:nowrap}
  .interpretation{padding-top:12px;border-top:1px solid var(--border)}
  @media(max-width:620px){
    summary{padding:14px}
    .pivot-body{padding:0 14px 14px}
    li{grid-template-columns:34px minmax(0,1fr)}
    .pivot-icon{width:34px;height:34px}
    li>.btn{grid-column:1/-1;width:100%}
  }
  @media(prefers-reduced-motion:reduce){summary::before{transition:none}}
</style>
