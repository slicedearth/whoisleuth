<script lang="ts">
  import type { CollectionPreflight } from '$lib/analysis/collection-preflight.ts';

  let {
    preflight,
    open = false,
  }: {
    preflight: CollectionPreflight;
    open?: boolean;
  } = $props();
</script>

<details class="collection-preflight" {open}>
  <summary>
    <span>{preflight.heading}</span>
    <small>{preflight.targetCount || 'No'} target{preflight.targetCount === 1 ? '' : 's'}</small>
  </summary>
  <div class="preflight-body">
    <p>{preflight.summary}</p>
    {#if preflight.sources.length}
      <ul class="source-list" aria-label="Planned source families">
        {#each preflight.sources as source}
          <li class:optional={source.state === 'optional'} class:disabled={source.state === 'disabled'}>
            <span><strong>{source.label}</strong><small>{source.state}</small></span>
            <p>{source.disclosure}</p>
          </li>
        {/each}
      </ul>
    {/if}
    <dl>
      <div><dt>Retention</dt><dd>{preflight.persistence}</dd></div>
      {#if preflight.controls.length}<div><dt>Controls</dt><dd><ul>{#each preflight.controls as note}<li>{note}</li>{/each}</ul></dd></div>{/if}
      {#if preflight.cautions.length}<div><dt>Limits</dt><dd><ul>{#each preflight.cautions as note}<li>{note}</li>{/each}</ul></dd></div>{/if}
    </dl>
  </div>
</details>

<style>
  .collection-preflight{margin-top:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--bg-rgb) / .42)}
  summary{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 12px;cursor:pointer}
  summary span{font:700 var(--text-xs) var(--mono)}
  summary small{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .preflight-body{display:grid;gap:10px;padding:0 12px 12px;border-top:1px solid var(--border)}
  .preflight-body>p{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .source-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .source-list li{min-width:0;padding:8px 9px;border:1px solid rgb(var(--accent-rgb) / .28);border-radius:var(--radius-sm);background:rgb(var(--accent-rgb) / .04)}
  .source-list li.optional{border-color:var(--border);background:var(--surface)}
  .source-list li.disabled{opacity:.72;border-style:dashed}
  .source-list span{display:flex;justify-content:space-between;gap:7px}
  .source-list strong{font:700 var(--text-2xs) var(--mono)}
  .source-list small{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .source-list p{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  dl{display:grid;gap:8px;margin:0}
  dl div{display:grid;grid-template-columns:72px minmax(0,1fr);gap:9px}
  dt{color:var(--text);font:700 var(--text-2xs) var(--mono)}
  dd{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  dd ul{display:grid;gap:3px;margin:0;padding-left:17px}
  @media(max-width:600px){.source-list{grid-template-columns:1fr}dl div{grid-template-columns:1fr;gap:3px}}
</style>
