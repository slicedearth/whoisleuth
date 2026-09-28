<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    id,
    title,
    family,
    children,
  }: {
    id: string;
    title: string;
    family: 'overview' | 'registry' | 'web' | 'relationships' | 'quality' | 'analyst' | 'raw';
    children: Snippet;
  } = $props();
</script>

<section class={`result-section family-${family}`} {id} aria-labelledby={`${id}-title`}>
  <h3 id={`${id}-title`}>{title}</h3>
  {@render children()}
</section>

<style>
  .result-section {
    --section-accent: var(--accent2);
    margin-top: 26px;
  }
  .family-registry {
    --section-accent: var(--evidence-registry);
  }
  .family-web {
    --section-accent: var(--evidence-web);
  }
  .family-relationships {
    --section-accent: var(--evidence-network);
  }
  .family-quality {
    --section-accent: var(--evidence-derived);
  }
  .family-analyst {
    --section-accent: var(--evidence-analyst);
  }
  .family-raw {
    --section-accent: var(--muted);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 12px;
    color: var(--section-accent);
    font: 700 var(--text-2xs) var(--mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  h3::before {
    content: '//';
    color: var(--muted);
  }
  h3::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--section-accent) 60%, var(--border)),
      var(--border) 42%
    );
  }
  .result-section > :global(.card),
  .result-section > :global(.evidence-component) {
    margin-top: 12px;
  }
  .result-section > :global(:nth-child(2)) {
    margin-top: 0;
  }
</style>
