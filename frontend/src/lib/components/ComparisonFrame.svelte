<script lang="ts">
  import type { Snippet } from 'svelte';
  let { header, left, right, context, children }: {
    header: Snippet;
    left: Snippet;
    right: Snippet;
    context?: Snippet;
    children: Snippet;
  } = $props();
</script>

<div class="comparison-frame">
  <header>{@render header()}</header>
  <div class="comparison-sides">
    <div>{@render left()}</div>
    <div>{@render right()}</div>
  </div>
  {#if context}<div class="comparison-context">{@render context()}</div>{/if}
  <div class="comparison-result">{@render children()}</div>
</div>

<style>
  .comparison-frame{container:comparison-frame/inline-size}.comparison-frame,.comparison-result{min-width:0}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .comparison-sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:14px}
  .comparison-sides>div{min-width:0;overflow-wrap:anywhere}
  .comparison-context{min-width:0;margin-top:16px}
  .comparison-result{margin-top:16px}
  @container comparison-frame (max-width:700px){.comparison-sides{grid-template-columns:1fr;gap:14px}.comparison-sides>div+div{border-top:1px solid var(--border);padding-top:14px}}
</style>
