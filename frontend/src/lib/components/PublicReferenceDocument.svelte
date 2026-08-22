<script lang="ts">
  import type { Snippet } from 'svelte';
  import PublicSectionNavigation from '$lib/components/PublicSectionNavigation.svelte';
  import { PUBLIC_REFERENCE_DESTINATIONS } from '$lib/public-reference-navigation';

  let {
    currentHref,
    eyebrow,
    title,
    summary,
    sections = [],
    sectionNavigation = 'rail',
    actions,
    children,
  }: {
    currentHref: string;
    eyebrow: string;
    title: string;
    summary: readonly string[];
    sections?: readonly Readonly<{ href: string; label: string }>[];
    sectionNavigation?: 'rail' | 'inline';
    actions?: Snippet;
    children: Snippet;
  } = $props();

  const currentIndex = $derived(PUBLIC_REFERENCE_DESTINATIONS.findIndex((item) => item.href === currentHref));
  const previous = $derived(currentIndex > 0 ? PUBLIC_REFERENCE_DESTINATIONS[currentIndex - 1] : null);
  const next = $derived(currentIndex >= 0 && currentIndex < PUBLIC_REFERENCE_DESTINATIONS.length - 1
    ? PUBLIC_REFERENCE_DESTINATIONS[currentIndex + 1]
    : null);
</script>

<article class="reference-document">
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    {#if currentHref === '/resources'}
      <span>Documentation</span>
    {:else}
      <a href="/resources">Documentation</a><span aria-hidden="true">/</span><span>{title}</span>
    {/if}
  </nav>

  <header class="reference-heading">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    {#each summary as paragraph}<p>{paragraph}</p>{/each}
    {#if actions}<div class="reference-actions">{@render actions()}</div>{/if}
  </header>

  {#if sections.length > 0 && sectionNavigation === 'inline'}
    <PublicSectionNavigation items={sections} ariaLabel={`${title} sections`} layout="inline" />
  {/if}
  <div class="reference-body" class:has-sections={sections.length > 0 && sectionNavigation === 'rail'}>
    {#if sections.length > 0 && sectionNavigation === 'rail'}<PublicSectionNavigation items={sections} ariaLabel={`${title} sections`} />{/if}
    <div class="reference-content">{@render children()}</div>
  </div>

  {#if previous || next}
    <nav class="reference-pagination" aria-label="Related documentation">
      {#if previous}<a class="previous" href={previous.href}><span>Previous</span><strong>{previous.label}</strong></a>{:else}<span></span>{/if}
      {#if next}<a class="next" href={next.href}><span>Next</span><strong>{next.label}</strong></a>{/if}
    </nav>
  {/if}
</article>

<style>
  .reference-document{min-width:0}
  .breadcrumbs{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin:0 0 22px;color:var(--muted);font:650 var(--text-2xs) var(--mono);line-height:1.4}
  .breadcrumbs a{color:var(--accent)}
  .reference-heading{max-width:850px;padding:0 0 46px}
  .reference-heading h1{max-width:820px;margin:.35rem 0 1rem;font:750 clamp(2.15rem,5vw,3.65rem)/1.03 var(--mono);letter-spacing:-.06em}
  .reference-heading>p:not(.eyebrow){max-width:72ch;margin:.65rem 0 0;color:var(--muted);font-size:clamp(.98rem,1.5vw,1.08rem);line-height:1.7}
  .reference-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
  .reference-body{min-width:0}
  .reference-body.has-sections{display:grid;grid-template-columns:minmax(0,1fr) 176px;gap:clamp(28px,4vw,48px);align-items:start}
  .reference-body.has-sections :global(.public-section-navigation){grid-column:2;grid-row:1}
  .reference-content{min-width:0;grid-column:1;grid-row:1}
  .reference-pagination{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:58px;padding-top:22px;border-top:1px solid var(--border)}
  .reference-pagination a{display:grid;gap:5px;min-width:0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .reference-pagination a:hover,.reference-pagination a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}
  .reference-pagination a.next{text-align:right}
  .reference-pagination span{color:var(--muted);font:650 .58rem var(--mono);letter-spacing:.07em;text-transform:uppercase}
  .reference-pagination strong{color:var(--accent);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  @media(max-width:1040px){
    .reference-body.has-sections{grid-template-columns:1fr;gap:22px}
    .reference-body.has-sections :global(.public-section-navigation){grid-column:1;grid-row:1}
    .reference-content{grid-column:1;grid-row:2}
  }
  @media(max-width:520px){.reference-pagination{grid-template-columns:1fr}.reference-pagination>span{display:none}.reference-pagination a.next{text-align:left}}
</style>
