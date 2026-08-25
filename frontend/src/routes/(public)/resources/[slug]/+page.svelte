<script lang="ts">
  import PublicReferenceDocument from '$lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import {
    type PublicResource,
  } from '$lib/public-resources';
  import {
    WHOISLEUTH_PROJECT_URL,
    WHOISLEUTH_SITE_ORIGIN,
    WHOISLEUTH_SOURCE_REPOSITORY_URL,
  } from '../../../../../../lib/project-metadata.mts';

  let { data }: { data: { resource: PublicResource } } = $props();
  const resource = $derived(data.resource);
  const pageSections = [
    { href: '#steps', label: 'Suggested steps' },
    { href: '#evidence', label: 'Source boundaries' },
    { href: '#primary-references', label: 'Primary references' },
    { href: '#questions', label: 'Before deciding' },
    { href: '#technical-reference', label: 'Technical reference' },
  ] as const;
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
  title={`${resource.seoTitle} | WHOISleuth`}
  description={resource.description}
  path={`/resources/${resource.slug}`}
  structuredData={articleSchema}
/>

<PublicReferenceDocument
  currentHref={`/resources/${resource.slug}`}
  eyebrow={resource.eyebrow}
  title={resource.title}
  summary={resource.summary}
  sections={pageSections}
>
  {#snippet actions()}
    <a class="primary" href={resource.demoHref}>{resource.demoLabel}</a>
    <a class="btn" href={resource.guideHref}>{resource.guideLabel}</a>
  {/snippet}

<article class="resource-page">

  <section id="steps" aria-labelledby="steps-title">
    <div class="section-intro"><p class="eyebrow">Suggested steps</p><h2 id="steps-title">Review the question and supporting evidence</h2></div>
    <ol class="steps">
      {#each resource.steps as step, index}
        <li><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>
      {/each}
    </ol>
  </section>

  <section id="evidence" aria-labelledby="evidence-title">
    <div class="section-intro"><p class="eyebrow">Source boundaries</p><h2 id="evidence-title">What each evidence class can support</h2></div>
    <div class="evidence-table" role="table" aria-label="Evidence sources and limitations">
      <div class="table-head" role="row"><span role="columnheader">Source</span><span role="columnheader">Useful for</span><span role="columnheader">Important limit</span></div>
      {#each resource.evidence as item}
        <div role="row"><div role="cell"><strong>{item.source}</strong></div><span role="cell">{item.usefulFor}</span><span role="cell">{item.limitation}</span></div>
      {/each}
    </div>
  </section>

  <section class="primary-references" id="primary-references" aria-labelledby="primary-references-title">
    <div class="section-intro"><p class="eyebrow">Primary references</p><h2 id="primary-references-title">Specifications behind this guide</h2><p>Use these sources to verify the protocol and evidence boundaries described above.</p></div>
    <ul>
      {#each resource.references as reference}
        <li>
          <a href={reference.href} target="_blank" rel="noopener noreferrer">
            <strong>{reference.label}</strong>
            <span>{reference.description}</span>
            <span class="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      {/each}
    </ul>
  </section>

  <section class="questions" id="questions" aria-labelledby="questions-title">
    <div class="section-intro"><p class="eyebrow">Before deciding</p><h2 id="questions-title">Questions worth answering</h2></div>
    <ul>{#each resource.questions as question}<li>{question}</li>{/each}</ul>
  </section>

  <aside class="repository card" id="technical-reference" aria-labelledby="technical-reference-title">
    <div><p class="eyebrow">Technical reference</p><h2 id="technical-reference-title">Read the relevant implementation contract</h2></div>
    <div><p>The repository documentation records collection bounds, provenance and privacy decisions.</p><a href={`${WHOISLEUTH_SOURCE_REPOSITORY_URL}/blob/main/${resource.repositoryDoc}`} target="_blank" rel="noopener">Open {resource.repositoryDoc}<span class="sr-only"> (opens in a new tab)</span></a></div>
  </aside>
</article>
</PublicReferenceDocument>

<style>
  .resource-page{display:grid;gap:0}.resource-page>section{padding:60px 0;border-top:1px solid var(--border)}.section-intro{max-width:780px;margin-bottom:25px}.section-intro h2,.repository h2{margin:.3rem 0 .65rem;font:700 clamp(1.65rem,3.4vw,2.45rem) var(--mono);letter-spacing:-.04em}
  .steps{display:grid;margin:0;padding:0;list-style:none}.steps li{display:grid;grid-template-columns:54px minmax(0,1fr);gap:18px;padding:20px 0;border-top:1px solid var(--border)}.steps li:last-child{border-bottom:1px solid var(--border)}.steps>li>span{color:var(--accent);font:700 var(--text-xs) var(--mono)}.steps h3{margin:0;font:700 1.02rem var(--mono)}.steps p{max-width:78ch;margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.65}
  .evidence-table{border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden}.evidence-table>div{display:grid;grid-template-columns:.7fr 1fr 1.3fr;gap:18px;padding:14px 16px;border-top:1px solid var(--border);font-size:var(--text-xs);line-height:1.55}.evidence-table>div:first-child{border-top:0}.evidence-table .table-head{background:var(--panel-raised);color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.evidence-table>div:not(.table-head)>span{color:var(--muted)}
  .primary-references .section-intro>p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.65}.primary-references ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:8px;margin:0;padding:0;list-style:none}.primary-references a{display:grid;height:100%;gap:8px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.primary-references a:hover,.primary-references a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}.primary-references strong{color:var(--accent);font:700 var(--text-xs) var(--mono);line-height:1.45}.primary-references span:not(.sr-only){color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .questions ul{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}.questions li{padding:18px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel);font-size:var(--text-sm);line-height:1.55}.questions li::before{content:'?';display:block;margin-bottom:10px;color:var(--interface-accent);font:800 1rem var(--mono)}
  .repository{display:grid;grid-template-columns:.9fr 1.1fr;gap:38px;margin:20px 0 65px;padding:clamp(22px,4vw,36px);border-left:3px solid var(--accent)}.repository p{margin:0;color:var(--muted);line-height:1.65}.repository a{display:inline-flex;margin-top:13px;color:var(--accent);font:700 var(--text-2xs) var(--mono)}
  @media(max-width:760px){.evidence-table{border:0;overflow:visible}.evidence-table .table-head{display:none}.evidence-table>div{grid-template-columns:1fr;gap:6px;margin-top:8px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-md)}.evidence-table>div>div strong::before{content:'Source · ';color:var(--muted);font:650 var(--text-2xs) var(--mono)}.questions ul,.repository{grid-template-columns:1fr}.repository{gap:8px}}
</style>
