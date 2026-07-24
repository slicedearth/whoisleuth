<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

{@render children()}

<style>
  :global(button),:global(a),:global(input),:global(select),:global(textarea),:global(summary){outline-offset:3px}
  :global(:focus-visible){outline:2px solid var(--accent)}
  :global(button:disabled){cursor:not-allowed;opacity:.58}
  @media(prefers-reduced-motion:reduce){
    :global(html){scroll-behavior:auto}
    :global(*),:global(*::before),:global(*::after){scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}
  }
</style>
