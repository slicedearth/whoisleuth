<script lang="ts">
  let {
    label,
    links,
  }: {
    label: string;
    links: Array<{ href: `#${string}`; label: string }>;
  } = $props();
</script>

<div class="local-nav-shell">
  <nav class="local-nav" aria-label={label}>
    {#each links as link}
      <a href={link.href}>{link.label}</a>
    {/each}
  </nav>
</div>
