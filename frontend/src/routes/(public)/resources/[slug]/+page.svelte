<script lang="ts">
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import PublicResourceCards from '$lib/components/PublicResourceCards.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import {
    PUBLIC_RESOURCES,
    type PublicResource,
  } from '$lib/public-resources';
  import {
    WHOISLEUTH_PROJECT_URL,
    WHOISLEUTH_SITE_ORIGIN,
    WHOISLEUTH_SOURCE_REPOSITORY_URL,
  } from '../../../../../../lib/project-metadata.mts';

  let { data }: { data: { resource: PublicResource } } = $props();
  const resource = $derived(data.resource);
  const related = $derived(PUBLIC_RESOURCES
    .filter((candidate) => candidate.slug !== resource.slug)
    .slice(0, 4));
  const articleSchema = $derived({
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: resource.title,
    description: resource.description,
    url: `${WHOISLEUTH_SITE_ORIGIN}/resources/${resource.slug}`,
    isPartOf: {
      '@type': 'WebSite',
      name: 'WHOISleuth',
      url: WHOISLEUTH_PROJECT_URL,
    },
  });
</script>

<PublicSeo
  title={`${resource.title} | WHOISleuth`}
  description={resource.description}
  path={`/resources/${resource.slug}`}
  structuredData={articleSchema}
/>

<article class="resource-page">
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <a href="/resources">Resources</a><span aria-hidden="true">/</span><span>{resource.shortTitle}</span>
  </nav>

  <header>
    <p class="eyebrow">{resource.eyebrow}</p>
    <h1>{resource.title}</h1>
    {#each resource.summary as paragraph}<p>{paragraph}</p>{/each}
    <div class="actions">
      <a class="primary" href={resource.demoHref}>{resource.demoLabel}</a>
      <a class="btn" href={resource.guideHref}>{resource.guideLabel}</a>
    </div>
  </header>

  <section aria-labelledby="workflow-title">
    <div class="section-intro"><p class="eyebrow">Practical workflow</p><h2 id="workflow-title">Work from the question to the evidence.</h2></div>
    <ol class="steps">
      {#each resource.steps as step, index}
        <li><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>
      {/each}
    </ol>
  </section>

  <section aria-labelledby="evidence-title">
    <div class="section-intro"><p class="eyebrow">Source boundaries</p><h2 id="evidence-title">What each evidence class can support.</h2></div>
    <div class="evidence-table" role="table" aria-label="Evidence sources and limitations">
      <div class="table-head" role="row"><span role="columnheader">Source</span><span role="columnheader">Useful for</span><span role="columnheader">Important limit</span></div>
      {#each resource.evidence as item}
        <div role="row"><div role="cell"><strong>{item.source}</strong></div><span role="cell">{item.usefulFor}</span><span role="cell">{item.limitation}</span></div>
      {/each}
    </div>
  </section>

  <section class="questions" aria-labelledby="questions-title">
    <div class="section-intro"><p class="eyebrow">Before deciding</p><h2 id="questions-title">Questions worth answering.</h2></div>
    <ul>{#each resource.questions as question}<li>{question}</li>{/each}</ul>
  </section>

  <aside class="repository card">
    <div><p class="eyebrow">Inspect the implementation</p><h2>Review the contract behind this workflow.</h2></div>
    <div><p>The repository documentation records collection bounds, provenance, privacy decisions and deliberate limitations.</p><a href={`${WHOISLEUTH_SOURCE_REPOSITORY_URL}/blob/main/${resource.repositoryDoc}`} target="_blank" rel="noopener">Open {resource.repositoryDoc}</a></div>
  </aside>
</article>

<section class="related" aria-labelledby="related-title">
  <div class="section-intro"><h2 id="related-title">Continue with another investigation topic.</h2></div>
  <PublicResourceCards resources={related} compact />
</section>

<style>
  .resource-page{display:grid;gap:0}.breadcrumbs{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin:0 0 26px;color:var(--muted);font:650 var(--text-2xs) var(--mono);line-height:1.4}.breadcrumbs a{position:static;display:inline;margin:0;padding:0;border:0;border-radius:0;color:var(--accent);line-height:inherit}.breadcrumbs a::before{content:none}.breadcrumbs a:hover{border:0;background:none}
  article>header{max-width:900px;padding-bottom:62px}article>header h1{max-width:850px;margin:.35rem 0 1.2rem;font:750 clamp(2.25rem,5vw,3.75rem)/1.02 var(--mono);letter-spacing:-.06em}article>header>p:not(.eyebrow){max-width:73ch;color:var(--muted);font-size:clamp(1rem,1.5vw,1.1rem);line-height:1.75}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}
  article section,.related{padding:60px 0;border-top:1px solid var(--border)}.section-intro{max-width:780px;margin-bottom:25px}.section-intro h2,.repository h2{margin:.3rem 0 .65rem;font:700 clamp(1.65rem,3.4vw,2.45rem) var(--mono);letter-spacing:-.04em}
  .steps{display:grid;margin:0;padding:0;list-style:none}.steps li{display:grid;grid-template-columns:54px minmax(0,1fr);gap:18px;padding:20px 0;border-top:1px solid var(--border)}.steps li:last-child{border-bottom:1px solid var(--border)}.steps>li>span{color:var(--accent);font:700 var(--text-xs) var(--mono)}.steps h3{margin:0;font:700 1.02rem var(--mono)}.steps p{max-width:78ch;margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.65}
  .evidence-table{border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden}.evidence-table>div{display:grid;grid-template-columns:.7fr 1fr 1.3fr;gap:18px;padding:14px 16px;border-top:1px solid var(--border);font-size:var(--text-xs);line-height:1.55}.evidence-table>div:first-child{border-top:0}.evidence-table .table-head{background:var(--panel-raised);color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.evidence-table>div:not(.table-head)>span{color:var(--muted)}
  .questions ul{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}.questions li{padding:18px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel);font-size:var(--text-sm);line-height:1.55}.questions li::before{content:'?';display:block;margin-bottom:10px;color:var(--accent);font:800 1rem var(--mono)}
  .repository{display:grid;grid-template-columns:.9fr 1.1fr;gap:38px;margin:20px 0 65px;padding:clamp(22px,4vw,36px);border-left:3px solid var(--accent)}.repository p{margin:0;color:var(--muted);line-height:1.65}.repository a{display:inline-flex;margin-top:13px;color:var(--accent);font:700 var(--text-2xs) var(--mono)}
  @media(max-width:760px){.evidence-table{border:0;overflow:visible}.evidence-table .table-head{display:none}.evidence-table>div{grid-template-columns:1fr;gap:6px;margin-top:8px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-md)}.evidence-table>div>div strong::before{content:'Source · ';color:var(--muted);font:650 var(--text-2xs) var(--mono)}.questions ul,.repository{grid-template-columns:1fr}.repository{gap:8px}}
</style>
