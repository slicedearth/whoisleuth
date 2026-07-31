<script lang="ts">
  import type { PublicResource } from '$lib/public-resources';

  let {
    resources,
    compact = false,
  }: {
    resources: readonly PublicResource[];
    compact?: boolean;
  } = $props();
</script>

<div class="resource-grid" class:compact>
  {#each resources as resource}
    <article>
      <p class="eyebrow">{resource.eyebrow}</p>
      <h3>
        <a href={`/resources/${resource.slug}`}>
          <span>{resource.shortTitle}</span>
          <span aria-hidden="true">→</span>
        </a>
      </h3>
      <p>{resource.description}</p>
    </article>
  {/each}
</div>

<style>
  .resource-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  article{display:grid;min-width:0;gap:9px;padding:20px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  h3{margin:0;font:700 1.05rem var(--mono);letter-spacing:-.025em}
  h3 a{display:flex;gap:10px;justify-content:space-between;color:var(--text)}
  h3 a span:first-child{min-width:0}
  h3 a span:last-child{flex:0 0 auto;color:var(--accent)}
  h3 a:hover{color:var(--accent)}
  article>p:not(.eyebrow){margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.6}
  .compact{grid-template-columns:repeat(4,minmax(0,1fr))}
  .compact article{padding:16px}
  .compact article>p:not(.eyebrow){display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3}
  @media(max-width:980px){.compact{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:680px){.resource-grid,.compact{grid-template-columns:1fr}}
</style>
