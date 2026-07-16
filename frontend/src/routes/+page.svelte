<script lang="ts">import { workspaces } from '$lib/workspaces';</script>
<svelte:head><title>WHOISleuth · Domain intelligence</title></svelte:head>
<section class="heading"><div><p class="eyebrow">Domain intelligence console</p><h1>Investigate domains. Protect brands.</h1><p>Combine RDAP, WHOIS, DNS, website signals, and Certificate Transparency data to find, assess, monitor, and respond to suspicious domains.</p></div></section>
<div class="grid">{#each workspaces as item,i}<a class="card" href={item.href}><span>0{i+1}</span><h2>{item.label}</h2><p>{item.detail}</p><strong>Open →</strong></a>{/each}</div>
<style>
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
  .grid a{display:flex;flex-direction:column;min-height:172px;padding:20px}
  .grid span{color:var(--accent);font:600 var(--text-2xs) var(--mono);letter-spacing:.08em}
  .grid h2{margin:10px 0 6px;font:700 1.25rem var(--mono);letter-spacing:-.02em}
  .grid p{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .grid a strong{margin-top:auto;padding-top:14px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  @media(max-width:650px){.grid{grid-template-columns:1fr}.grid a{min-height:0}}
</style>
