<script lang="ts">
  import { onMount } from 'svelte';

  let {
    label,
    links,
    trackCurrent = false,
  }: {
    label: string;
    links: Array<{ href: `#${string}`; label: string }>;
    trackCurrent?: boolean;
  } = $props();

  let activeHref = $state('');

  onMount(() => {
    if (!trackCurrent || links.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = links
        .map((link) => ({ link, element: document.getElementById(link.href.slice(1)) }))
        .filter((entry): entry is { link: (typeof links)[number]; element: HTMLElement } => Boolean(entry.element));
      if (sections.length === 0) return;
      const threshold = window.innerWidth <= 900 ? 138 : 112;
      let current = sections[0].link.href;
      for (const section of sections) {
        if (section.element.getBoundingClientRect().top <= threshold) current = section.link.href;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = sections.at(-1)?.link.href ?? current;
      }
      activeHref = current;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  });
</script>

<div class="local-nav-shell">
  <nav class="local-nav" aria-label={label}>
    {#if trackCurrent}<span class="local-nav-prompt" aria-hidden="true">trace://</span>{/if}
    {#each links as link}
      <a
        href={link.href}
        class:active={trackCurrent && activeHref === link.href}
        aria-current={trackCurrent && activeHref === link.href ? 'location' : undefined}
        onclick={() => activeHref = link.href}
      >{link.label}</a>
    {/each}
  </nav>
</div>
