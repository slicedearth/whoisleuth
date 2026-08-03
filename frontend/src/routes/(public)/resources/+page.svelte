<script lang="ts">
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import PublicResourceCards from '$lib/components/PublicResourceCards.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import { PUBLIC_RESOURCES } from '$lib/public-resources';
  import { WHOISLEUTH_SITE_ORIGIN } from '../../../../../lib/project-metadata.mts';

  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'WHOISleuth domain investigation resources',
    description: 'Practical source-aware guides for domain registration, lookalikes, certificates, network context, Bulk comparison and local-first investigation.',
    url: `${WHOISLEUTH_SITE_ORIGIN}/resources`,
    hasPart: PUBLIC_RESOURCES.map((resource) => ({
      '@type': 'TechArticle',
      headline: resource.title,
      url: `${WHOISLEUTH_SITE_ORIGIN}/resources/${resource.slug}`,
    })),
  };
</script>

<PublicSeo
  title="Domain investigation resources | WHOISleuth"
  description="Practical guides to WHOIS and RDAP, lookalike domains, certificate transparency, Bulk comparison, IP and ASN context, and local-first investigation."
  path="/resources"
  structuredData={collectionSchema}
/>

<header class="resource-hero">
  <p class="eyebrow">Learn by investigation task</p>
  <h1>Understand the evidence before using the result.</h1>
  <p>Each guide explains what a source can answer, where it can fail, and how WHOISleuth keeps the conclusion narrower than the available evidence.</p>
  <div><a class="primary" href="/demo">Try the synthetic demo</a><PublicConsoleCta /></div>
</header>

<section aria-labelledby="resources-title">
  <div class="section-intro">
    <h2 id="resources-title">Choose a focused topic.</h2>
    <p>These pages use fixed examples and existing project evidence. They do not run a lookup or generate public pages for real domains.</p>
  </div>
  <PublicResourceCards resources={PUBLIC_RESOURCES} />
</section>

<aside class="principle card">
  <div><p class="eyebrow">A consistent boundary</p><h2>Missing evidence is not a clean result.</h2></div>
  <p>Unsupported, skipped, partial, unavailable and inconclusive sources remain visible throughout the workflow. Registration authority, supporting observations and analyst decisions stay separately attributed.</p>
</aside>

<style>
  .resource-hero{max-width:850px;padding:10px 0 58px}.resource-hero h1{margin:.35rem 0 1rem;font:750 clamp(2.35rem,5vw,3.7rem)/1.02 var(--mono);letter-spacing:-.06em}.resource-hero>p:not(.eyebrow){max-width:68ch;color:var(--muted);font-size:clamp(1rem,1.6vw,1.12rem);line-height:1.7}.resource-hero>div{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
  section{padding:58px 0;border-top:1px solid var(--border)}.section-intro{max-width:760px;margin-bottom:24px}.section-intro h2,.principle h2{margin:.25rem 0 .65rem;font:700 clamp(1.65rem,3.4vw,2.45rem) var(--mono);letter-spacing:-.04em}.section-intro p,.principle>p{margin:0;color:var(--muted);line-height:1.65}
  .principle{display:grid;grid-template-columns:.8fr 1.2fr;gap:40px;margin-top:40px;padding:clamp(22px,4vw,36px);border-left:3px solid var(--accent2)}
  @media(max-width:680px){.principle{grid-template-columns:1fr;gap:10px}}
</style>
