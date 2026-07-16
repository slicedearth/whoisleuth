<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    eyebrow,
    title,
    description,
    children,
  }: {
    eyebrow: string;
    title: string;
    description: string;
    children?: Snippet;
  } = $props();
</script>

<section class="heading">
  <div>
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p>{description}</p>
  </div>
  {#if children}{@render children()}{/if}
</section>
