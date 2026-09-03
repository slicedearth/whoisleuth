<script lang="ts">
  import { onMount } from 'svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import { preloadBestEffort, preloadOnIdle } from '$lib/idle-preload';
  import PublicReferenceDocument from '$lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import { PUBLIC_COVERAGE_SUMMARY } from '$lib/generated/public-coverage-summary';

  let catalogueOpen = $state(false);
  const moduleController = new AbortController();
  function preloadCatalogue() {
    preloadBestEffort(() => import('$lib/components/PublicCoverageCatalogue.svelte'), moduleController.signal);
  }
  onMount(() => {
    const cancelIdlePreload = preloadOnIdle(preloadCatalogue);
    return () => {
      cancelIdlePreload();
      moduleController.abort();
    };
  });
  const pageSections = [
    { href: '#distinctions', label: 'Coverage labels' },
    { href: '#snapshot', label: 'Inventory' },
    { href: '#exclusions', label: 'Current scope' },
    { href: '#full-catalogue', label: 'Capability details' },
  ] as const;
</script>

<PublicSeo title="Capability and registry coverage | WHOISleuth" description="Implemented, contract-reviewed and optional WHOISleuth capabilities, plus the reviewed registry snapshot." path="/coverage" />

<PublicReferenceDocument
  currentHref="/coverage"
  eyebrow="Current coverage"
  title="Capability and registry coverage"
  summary={['What is implemented, contract-reviewed, optional, or evaluated only at runtime.']}
  sections={pageSections}
>

<section class="distinctions" id="distinctions" aria-labelledby="distinctions-title"><div class="section-intro"><p class="eyebrow">Coverage labels</p><h2 id="distinctions-title">Implementation, review and runtime</h2><p>These labels distinguish checked-in support, deterministic review and live availability.</p></div><div class="distinction-grid">{#each PUBLIC_COVERAGE_SUMMARY.distinctions as item}<article><h3>{item.label}</h3><p>{item.description}</p></article>{/each}</div></section>

<section class="snapshot" id="snapshot" aria-labelledby="snapshot-title"><div class="section-intro"><p class="eyebrow">Inventory</p><h2 id="snapshot-title">Capability and registry metadata</h2><p>Registry counts reflect the recorded review date.</p></div><div class="snapshot-grid"><article><span>Capability families</span><strong>{PUBLIC_COVERAGE_SUMMARY.summary.capabilityFamilies}</strong><small>Versioned capability definitions</small></article><article><span>CLI operations</span><strong>{PUBLIC_COVERAGE_SUMMARY.summary.cliOperations}</strong><small>Installed commands</small></article><article><span>Active TLD snapshot</span><strong>{PUBLIC_COVERAGE_SUMMARY.summary.registrySnapshot.counts.activeTlds}</strong><small>Reviewed {PUBLIC_COVERAGE_SUMMARY.summary.registrySnapshot.verifiedAt}</small></article><article><span>RDAP service groups</span><strong>{PUBLIC_COVERAGE_SUMMARY.summary.registrySnapshot.counts.rdapBootstrapServiceGroups}</strong><small>{PUBLIC_COVERAGE_SUMMARY.summary.registrySnapshot.exceptionCount} snapshot exceptions</small></article></div><p class="snapshot-interpretation">{PUBLIC_COVERAGE_SUMMARY.summary.registrySnapshot.interpretation}</p></section>

<section class="exclusions" id="exclusions" aria-labelledby="exclusions-title"><div class="section-intro"><p class="eyebrow">Current scope</p><h2 id="exclusions-title">Unsupported and excluded behaviour</h2></div><ul class="card">{#each PUBLIC_COVERAGE_SUMMARY.intentionallyExcluded as item}<li>{item}</li>{/each}</ul></section>

<section class="full-catalogue" id="full-catalogue" aria-labelledby="full-catalogue-title"><div><p class="eyebrow">Capability details</p><h2 id="full-catalogue-title">Browse all capability families</h2><p>Filter the current capability inventory by analyst job or availability.</p></div>{#if !catalogueOpen}<button class="primary" type="button" onpointerenter={preloadCatalogue} onfocus={preloadCatalogue} onclick={() => catalogueOpen = true}>Open capability catalogue</button>{/if}</section>
{#if catalogueOpen}<DeferredSurface load={() => import('$lib/components/PublicCoverageCatalogue.svelte')} loadingLabel="Loading capability details." unavailableLabel="Capability details could not be loaded." />{/if}
</PublicReferenceDocument>

<style>
  .distinctions,.snapshot,.exclusions{padding:58px 0;border-top:1px solid var(--border)}.section-intro{max-width:790px;margin-bottom:22px}.section-intro h2,.full-catalogue h2{margin:.3rem 0 .6rem;font:700 clamp(1.5rem,3vw,2.25rem) var(--mono);letter-spacing:-.04em}.section-intro p:not(.eyebrow),.full-catalogue p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.65}.distinction-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.distinction-grid article{padding:16px;border:1px solid var(--border);border-radius:var(--radius-sm)}.distinction-grid h3{margin:0;font:700 var(--text-sm) var(--mono)}.distinction-grid p{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .snapshot-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border)}.snapshot-grid article{display:grid;gap:6px;padding:16px;background:var(--panel)}.snapshot-grid span,.snapshot-grid small{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.snapshot-grid strong{color:var(--interface-accent);font:750 1.7rem var(--mono)}.snapshot-interpretation{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.exclusions ul{margin:0;padding:18px 18px 18px 42px}.exclusions li{color:var(--muted);line-height:1.55}.exclusions li+li{margin-top:7px}
  .full-catalogue{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:58px 0 24px;border-top:1px solid var(--border)}.full-catalogue>div{max-width:760px}.full-catalogue button{flex:0 0 auto;min-height:42px;padding:10px 14px}
  @media(max-width:850px){.distinction-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.snapshot-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.full-catalogue{align-items:flex-start;flex-direction:column}}
  @media(max-width:520px){.distinction-grid,.snapshot-grid{grid-template-columns:1fr}.full-catalogue button{width:100%}}
</style>
