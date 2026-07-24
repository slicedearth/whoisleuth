<script lang="ts">
  import { onMount, tick } from 'svelte';

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
  let navigation = $state<HTMLElement>();
  let showStartFade = $state(false);
  let showEndFade = $state(false);
  const linkElements: Record<string, HTMLAnchorElement> = {};

  function registerLink(element: HTMLAnchorElement, href: string) {
    linkElements[href] = element;
    return {
      destroy() {
        if (linkElements[href] === element) delete linkElements[href];
      },
    };
  }

  function updateOverflowCues() {
    if (!navigation) return;
    showStartFade = navigation.scrollLeft > 4;
    showEndFade = navigation.scrollLeft + navigation.clientWidth < navigation.scrollWidth - 4;
  }

  function keepActiveVisible(href: string) {
    const element = linkElements[href];
    if (!navigation || !element || navigation.scrollWidth <= navigation.clientWidth) return;
    const start = element.offsetLeft;
    const end = start + element.offsetWidth;
    const visibleStart = navigation.scrollLeft + 14;
    const visibleEnd = navigation.scrollLeft + navigation.clientWidth - 14;
    if (start >= visibleStart && end <= visibleEnd) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    navigation.scrollTo({
      left: Math.max(0, start - (navigation.clientWidth - element.offsetWidth) / 2),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }

  function selectHref(href: string) {
    activeHref = href;
    void tick().then(() => keepActiveVisible(href));
  }

  onMount(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      updateOverflowCues();
      if (trackCurrent && links.length > 0) {
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
        if (current !== activeHref) selectHref(current);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    navigation?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      navigation?.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  });
</script>

<div class="local-nav-shell" class:show-start-fade={showStartFade} class:show-end-fade={showEndFade}>
  <nav class="local-nav" aria-label={label} bind:this={navigation}>
    {#if trackCurrent}<span class="local-nav-prompt" aria-hidden="true">trace://</span>{/if}
    {#each links as link}
      <a
        href={link.href}
        use:registerLink={link.href}
        class:active={trackCurrent && activeHref === link.href}
        aria-current={trackCurrent && activeHref === link.href ? 'location' : undefined}
        onclick={() => selectHref(link.href)}
      >{link.label}</a>
    {/each}
  </nav>
</div>
