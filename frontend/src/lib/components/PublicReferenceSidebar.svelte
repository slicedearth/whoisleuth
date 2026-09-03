<script lang="ts">
  import {
    PUBLIC_REFERENCE_GROUPS,
    publicReferenceDestination,
  } from '$lib/public-reference-navigation';

  let { currentPath }: { currentPath: string } = $props();
  const currentLabel = $derived(publicReferenceDestination(currentPath)?.label ?? 'Documentation');
</script>

<aside class="reference-sidebar">
  <nav class="reference-tree" aria-label="Documentation">
    <a class="reference-title" href="/resources"><span>WHOISleuth</span><strong>Documentation</strong></a>
    {#each PUBLIC_REFERENCE_GROUPS as group}
      <section aria-labelledby={`reference-group-${group.label.toLowerCase().replaceAll(' ', '-')}`}>
        <h2 id={`reference-group-${group.label.toLowerCase().replaceAll(' ', '-')}`}>{group.label}</h2>
        {#each group.items as item}
          <a class:active={item.href === currentPath} aria-current={item.href === currentPath ? 'page' : undefined} href={item.href}>{item.label}</a>
        {/each}
      </section>
    {/each}
  </nav>

  <details class="reference-browser">
    <summary><span>Browse documentation</span><strong>{currentLabel}</strong></summary>
    <nav class="independent-grid" aria-label="Documentation">
      {#each PUBLIC_REFERENCE_GROUPS as group}
        <section aria-labelledby={`mobile-reference-group-${group.label.toLowerCase().replaceAll(' ', '-')}`}>
          <h2 id={`mobile-reference-group-${group.label.toLowerCase().replaceAll(' ', '-')}`}>{group.label}</h2>
          {#each group.items as item}
            <a class:active={item.href === currentPath} aria-current={item.href === currentPath ? 'page' : undefined} href={item.href}>{item.label}</a>
          {/each}
        </section>
      {/each}
    </nav>
  </details>
</aside>

<style>
  .reference-sidebar{position:sticky;top:18px;min-width:0;max-height:calc(100vh - 36px);overflow-y:auto;scrollbar-width:thin}
  .reference-tree{padding-right:18px}
  .reference-title{display:grid;gap:2px;margin-bottom:24px;padding:0 8px;color:var(--text);font-family:var(--mono)}
  .reference-title span{color:var(--muted);font-size:var(--text-2xs);letter-spacing:.06em;text-transform:uppercase}
  .reference-title strong{font-size:var(--text-sm)}
  .reference-tree section+section{margin-top:20px}
  h2{margin:0 8px 7px;color:var(--muted);font:700 .58rem var(--mono);letter-spacing:.08em;text-transform:uppercase}
  .reference-tree section>a{display:block;padding:7px 8px;border-radius:var(--radius-sm);color:var(--muted);font:650 var(--text-xs) var(--mono);line-height:1.35}
  .reference-tree section>a:hover,.reference-tree section>a:focus-visible{color:var(--text);background:rgb(var(--accent-rgb) / .07)}
  .reference-tree section>a.active{color:var(--accent);background:rgb(var(--accent-rgb) / .09);box-shadow:inset 2px 0 var(--accent)}
  .reference-browser{display:none}
  @media(max-width:1080px){
    .reference-sidebar{position:static;max-height:none;overflow:visible}
    .reference-tree{display:none}
    .reference-browser{display:block;margin:0 0 28px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
    .reference-browser>summary{display:flex;min-height:46px;align-items:center;justify-content:space-between;gap:14px;padding:10px 13px;list-style:none;font-family:var(--mono)}
    .reference-browser>summary::-webkit-details-marker{display:none}
    .reference-browser>summary::after{content:'+';flex:0 0 auto;color:var(--accent);font-weight:750}
    .reference-browser[open]>summary::after{content:'−'}
    .reference-browser>summary span{color:var(--muted);font-size:var(--text-2xs)}
    .reference-browser>summary strong{margin-left:auto;color:var(--text);font-size:var(--text-xs);text-align:right}
    .reference-browser>nav{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;padding:16px;border-top:1px solid var(--border)}
    .reference-browser section{min-width:0}
    .reference-browser h2{margin-inline:0}
    .reference-browser section>a{display:block;padding:6px 0;color:var(--muted);font:650 var(--text-xs) var(--mono);line-height:1.4;overflow-wrap:anywhere}
    .reference-browser section>a:hover,.reference-browser section>a:focus-visible,.reference-browser section>a.active{color:var(--accent)}
  }
  @media(max-width:520px){.reference-browser>nav{grid-template-columns:1fr}}
</style>
