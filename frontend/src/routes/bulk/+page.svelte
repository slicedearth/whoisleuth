<script lang="ts">
  import { onMount } from 'svelte';
  import { loadCandidateHandoff, type CandidateHandoff } from '$lib/candidate-handoff';
  let handoff = $state<CandidateHandoff | null>(null);
  onMount(() => { handoff = loadCandidateHandoff(); });
</script>

<svelte:head><title>Bulk analysis · WHOISleuth</title></svelte:head>
<section class="heading"><div><p class="eyebrow">Assess</p><h1>Bulk analysis</h1><p>Scan, filter, cluster, shortlist, and export candidate domains.</p></div></section>
{#if handoff}
  <section class="handoff card"><p class="eyebrow">Discovery handoff</p><h2>{handoff.candidates.length} candidates ready</h2><p>Received from {handoff.source.replaceAll('-',' ')}. The scanning queue and triage table are the next migration slice.</p><div>{#each handoff.candidates.slice(0,12) as candidate}<span>{candidate.domain}</span>{/each}{#if handoff.candidates.length>12}<span>+{handoff.candidates.length-12} more</span>{/if}</div></section>
{:else}
  <section class="empty card"><h2>No candidate set loaded</h2><p>Generate candidates in Discover, or wait for direct paste and CSV import in the next migration slice.</p><a href="/discover">Open Discover →</a></section>
{/if}
<style>.handoff,.empty{padding:28px}.handoff h2,.empty h2{margin:0}.handoff>p:not(.eyebrow),.empty p{color:var(--muted)}.handoff div{display:flex;flex-wrap:wrap;gap:7px;margin-top:20px}.handoff span{padding:7px 9px;border:1px solid var(--border);border-radius:999px;color:#bfd0e1;background:#0a1624;font-size:.68rem}.empty{min-height:300px;display:grid;place-content:center;text-align:center}.empty a{color:var(--accent);font-weight:700}</style>
