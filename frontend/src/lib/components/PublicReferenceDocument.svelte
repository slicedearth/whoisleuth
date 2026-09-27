<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import PublicReferenceSidebar from '$lib/components/PublicReferenceSidebar.svelte';
  import { PUBLIC_REFERENCE_DESTINATIONS, relatedPublicReferences } from '$lib/public-reference-navigation';
  import { revealDocumentationTarget } from '$lib/documentation-anchors';
  import { WHOISLEUTH_SITE_ORIGIN } from '../../../../packages/analysis/project-metadata.mts';

  let {
    currentHref,
    eyebrow,
    title,
    summary,
    sections = [],
    actions,
    children,
  }: {
    currentHref: string;
    eyebrow: string;
    title: string;
    summary: readonly string[];
    sections?: readonly Readonly<{ href: string; label: string }>[];
    actions?: Snippet;
    children: Snippet;
  } = $props();

  const currentDestination = $derived(PUBLIC_REFERENCE_DESTINATIONS.find((item) => item.href === currentHref) ?? null);
  const breadcrumbLabel = $derived(currentHref === '/resources' ? 'Resources' : currentDestination?.label ?? title);
  const breadcrumbItems = $derived([
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: `${WHOISLEUTH_SITE_ORIGIN}/`,
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Resources',
      item: `${WHOISLEUTH_SITE_ORIGIN}/resources`,
    },
    ...(currentHref === '/resources' ? [] : [{
      '@type': 'ListItem',
      position: 3,
      name: breadcrumbLabel,
      item: `${WHOISLEUTH_SITE_ORIGIN}${currentHref}`,
    }]),
  ]);
  const breadcrumbJson = $derived(JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems,
  }).replaceAll('<', '\\u003c'));
  const related = $derived(relatedPublicReferences(currentHref));
  let article: HTMLElement;
  onMount(() => {
    const openedForPrint: HTMLDetailsElement[] = [];
    const beforePrint = () => {
      for (const detail of article.querySelectorAll('details:not([open])')) {
        if (detail instanceof HTMLDetailsElement) { openedForPrint.push(detail); detail.open = true; }
      }
    };
    const afterPrint = () => { for (const detail of openedForPrint.splice(0)) detail.open = false; };
    const revealHash = () => {
      const target = document.getElementById(location.hash.slice(1));
      if (!target || !article.contains(target)) return;
      revealDocumentationTarget(target);
      target.scrollIntoView({ block: 'start' });
    };
    const frame = requestAnimationFrame(revealHash);
    addEventListener('hashchange', revealHash);
    addEventListener('beforeprint', beforePrint);
    addEventListener('afterprint', afterPrint);
    return () => { cancelAnimationFrame(frame); removeEventListener('hashchange', revealHash); removeEventListener('beforeprint', beforePrint); removeEventListener('afterprint', afterPrint); afterPrint(); };
  });
</script>

<svelte:head>
  <svelte:element this={'script'} type="application/ld+json">{breadcrumbJson}</svelte:element>
</svelte:head>

<div class="reference-shell">
  <PublicReferenceSidebar currentPath={currentHref} currentTitle={title} currentSections={sections} />
  <article class="reference-document" bind:this={article}>
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="/">Home</a><span aria-hidden="true">/</span>
      {#if currentHref === '/resources'}
        <span aria-current="page">Resources</span>
      {:else}
        <a href="/resources">Resources</a><span class="breadcrumb-current-separator" aria-hidden="true">/</span><span class="breadcrumb-current" aria-current="page">{breadcrumbLabel}</span>
      {/if}
    </nav>

    <header class="reference-heading">
      <p class="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {#each summary as paragraph}<p>{paragraph}</p>{/each}
      {#if actions}<div class="reference-actions">{@render actions()}</div>{/if}
    </header>

    <div class="reference-body"><div class="reference-content">{@render children()}</div></div>

    {#if related.length}
      <nav class="reference-pagination" aria-label="Related documentation">
        {#each related as item}<a href={item.href}><strong>{item.label}</strong><span>{item.detail}</span></a>{/each}
      </nav>
    {/if}
    <button class="btn print-document" type="button" onclick={() => window.print()}>Print this guide</button>
  </article>
</div>

<style>
  .reference-shell{display:grid;grid-template-columns:248px minmax(0,1fr);gap:clamp(36px,4vw,64px);align-items:start;--reference-anchor-offset:24px}
  .reference-document{min-width:0;max-width:1120px;font-family:var(--font-sans);line-height:1.65}
  .breadcrumbs{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin:0 0 16px;color:var(--muted);font:650 var(--text-2xs) var(--font-sans);line-height:1.4}
  .breadcrumbs a{color:var(--accent)}
  .reference-heading{max-width:900px;padding:0 0 32px}
  .reference-heading h1{max-width:820px;margin:.35rem 0 .8rem;font:750 clamp(1.9rem,4vw,2.8rem)/1.15 var(--font-sans);letter-spacing:-.035em}
  .reference-heading>p:not(.eyebrow){max-width:72ch;margin:.65rem 0 0;color:var(--muted);font-size:1rem;line-height:1.6}
  .reference-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
  .reference-body,.reference-content{min-width:0}
  .reference-content :global(p){max-width:74ch}
  .reference-content :global(h2),.reference-content :global(h3){text-wrap:balance}
  .reference-content :global(pre){line-height:1.65}
  .reference-content :global([id]){scroll-margin-top:var(--reference-anchor-offset)}
  .reference-content :global(.section-intro h2){font:700 clamp(1.45rem,2.5vw,1.9rem)/1.25 var(--font-sans);letter-spacing:-.025em}
  .reference-pagination{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:58px;padding-top:22px;border-top:1px solid var(--border)}
  .reference-pagination a{display:grid;gap:5px;min-width:0;padding:18px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .reference-pagination a:hover,.reference-pagination a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}
  .reference-pagination span{color:var(--muted);font:400 var(--text-xs)/1.5 var(--font-sans)}
  .reference-pagination strong{color:var(--accent);font:700 var(--text-sm) var(--font-sans);overflow-wrap:anywhere}
  .print-document{margin-top:24px;min-height:44px}
  @media(max-width:1080px){.reference-shell{grid-template-columns:1fr;gap:0;--reference-anchor-offset:72px}.reference-document{width:100%;margin-inline:auto}}
  @media(max-width:520px){
    .breadcrumbs{margin-bottom:10px}
    .breadcrumb-current-separator,.reference-heading .eyebrow{display:none}
    .breadcrumb-current{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .reference-heading{padding-bottom:18px}
    .reference-heading h1{font-size:1.7rem;line-height:1.18;margin:0 0 .6rem}
    .reference-heading>p:not(.eyebrow){font-size:.9375rem;line-height:1.5}
    .reference-actions{margin-top:12px}
    .reference-pagination{grid-template-columns:1fr}
  }
  @media print {
    :global(body:has(.reference-shell) *) { visibility:hidden; }
    .reference-document,.reference-document :global(*) { visibility:visible; }
    .reference-shell { display:block; }.reference-document { max-width:none; --text:#111; --muted:#333; --accent:#111; --interface-accent:#111; --panel:white; --panel-raised:#f5f5f5; --surface:white; --bg:white; --border:#aaa; color:#111; background:white; }
    .reference-document :global(pre) { white-space:pre-wrap; overflow-wrap:anywhere; }
    .reference-document :global(nav),.reference-document :global(button),.reference-document :global(.reference-actions),.reference-document :global(form) { display:none!important; }
    .reference-document :global(details) { break-inside:auto; }.reference-document :global(h2),.reference-document :global(h3) { break-after:avoid; }
    :global(body:has(.reference-shell)) { background:white; color:black; }
    :global(body:has(.reference-shell))::before { display:none; }
    :global(body:has(.reference-shell) .documentation-shell) { width:100%; padding:0; background:white; }
    :global(body:has(.reference-shell) .public-header),:global(body:has(.reference-shell) .public-footer),:global(body:has(.reference-shell) .reference-sidebar) { display:none!important; }
  }
</style>
