<script lang="ts">let {eyebrow,title,description}:{eyebrow:string,title:string,description:string}=$props();</script>
<svelte:head><title>{title} · WHOISleuth</title></svelte:head><section class="heading"><div><p class="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></section><section class="empty card"><h2>Migration in progress</h2><p>The production implementation remains authoritative until this workspace reaches feature parity.</p></section>
<style>.empty{display:grid;min-height:360px;place-content:center;padding:40px;text-align:center}.empty p{color:var(--muted)}</style>
