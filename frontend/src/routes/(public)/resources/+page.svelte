<script lang="ts">
  import { onMount } from 'svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import { preloadBestEffort, preloadOnIdle } from '$lib/idle-preload';
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import PublicGoalPaths from '$lib/components/PublicGoalPaths.svelte';
  import PublicReferenceDocument from '$lib/components/PublicReferenceDocument.svelte';
  import PublicResourceCards from '$lib/components/PublicResourceCards.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import {
    commonMistakes,
    glossaryTerms,
    guideFaqs,
    publicGuideGoals,
    referenceGuides,
    resultStates,
    toolGuides,
  } from '$lib/public-guide';
  import { PUBLIC_RESOURCES } from '$lib/public-resources';
  import { publicResourceHubNavigation } from '$lib/workspaces';
  import { WHOISLEUTH_SITE_ORIGIN } from '../../../../../lib/project-metadata.mts';

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'WHOISleuth domain investigation resources',
    description: 'Guidance for domain registration, lookalikes, certificates, network context, Bulk comparison and local investigation.',
    url: `${WHOISLEUTH_SITE_ORIGIN}/resources`,
    hasPart: PUBLIC_RESOURCES.map((resource) => ({
      '@type': 'TechArticle',
      headline: resource.title,
      url: `${WHOISLEUTH_SITE_ORIGIN}/resources/${resource.slug}`,
    })),
  };
  let practiceOpen = $state(false);
  const moduleController = new AbortController();
  function preloadPractice() {
    preloadBestEffort(() => import('$lib/components/OfflineInvestigationScenarios.svelte'), moduleController.signal);
  }
  onMount(() => {
    const cancelIdlePreload = preloadOnIdle(preloadPractice);
    return () => {
      cancelIdlePreload();
      moduleController.abort();
    };
  });
  const resourceSections = [
    { href: '#start', label: 'Start here' },
    { href: '#topics', label: 'Topics' },
    { href: '#practice', label: 'Practice' },
    { href: '#tools', label: 'Tools' },
    { href: '#reference', label: 'Reference' },
    { href: '#privacy', label: 'Privacy' },
    { href: '#results', label: 'Read results' },
    { href: '#glossary', label: 'Glossary' },
    { href: '#faq', label: 'FAQ' },
    { href: '#mistakes', label: 'Common mistakes' },
  ] as const;
</script>

<PublicSeo
  title="Domain investigation resources and guide | WHOISleuth"
  description="Choose a WHOISleuth task, interpret WHOIS and RDAP evidence, and practise with fictional examples."
  path="/resources"
  {structuredData}
/>

<PublicReferenceDocument
  currentHref="/resources"
  eyebrow="Resources"
  title="Guides for common investigation tasks"
  summary={['Choose a task, read a focused evidence guide, or practise with fictional examples.']}
  sections={resourceSections}
>
  {#snippet actions()}
    <a class="primary" href="/demo">Try the synthetic demo</a><PublicConsoleCta />
  {/snippet}

<section id="start" class="resource-section" aria-labelledby="start-title">
  <div class="section-intro"><h2 id="start-title">Choose a task</h2><p>These steps cover common starting points.</p></div>
  <PublicGoalPaths goals={publicGuideGoals} linkSteps ariaLabel="Common WHOISleuth tasks" />
</section>

<section id="topics" class="resource-section" aria-labelledby="topics-title">
  <div class="section-intro">
    <p class="eyebrow">Topic library</p>
    <h2 id="topics-title">Evidence guides</h2>
    <p>Each guide explains one source or investigation question using fixed examples.</p>
  </div>
  <PublicResourceCards resources={PUBLIC_RESOURCES} />
</section>

<section id="practice" class="resource-section" aria-labelledby="practice-title">
  <div class="section-intro"><h2 id="practice-title">Practise with fictional evidence</h2><p>Open three fixed exercises.</p></div>
  {#if !practiceOpen}<button class="primary" type="button" onpointerenter={preloadPractice} onfocus={preloadPractice} onclick={() => practiceOpen = true}>Open offline practice</button>{/if}
  {#if practiceOpen}<DeferredSurface load={() => import('$lib/components/OfflineInvestigationScenarios.svelte')} loadingLabel="Loading offline practice." unavailableLabel="Offline practice could not be loaded." />{/if}
</section>

<section id="tools" class="resource-section" aria-labelledby="tools-title">
  <div class="section-intro"><h2 id="tools-title">Choose the right tool</h2><p>Each tool has a distinct role.</p></div>
  <div class="tool-guide">
    {#each toolGuides as tool}
      <article class="card" id={`tool-${tool.id}`}>
        <h3>{tool.name}</h3>
        <dl>
          <div><dt>Use it when</dt><dd>{tool.useWhen}</dd></div>
          <div id={`tool-${tool.id}-input`}><dt>What you provide</dt><dd>{tool.input}</dd></div>
          <div id={`tool-${tool.id}-result`}><dt>What you receive</dt><dd>{tool.result}</dd></div>
          <div id={`tool-${tool.id}-next`}><dt>What to do next</dt><dd>{tool.next}</dd></div>
        </dl>
      </article>
    {/each}
  </div>
</section>

<section id="reference" class="resource-section" aria-labelledby="reference-title">
  <div class="section-intro"><h2 id="reference-title">Product and source references</h2><p>Command-line use, evidence rules, implemented coverage and example output.</p></div>
  <nav class="reference-pages" aria-label="Product references">
    {#each publicResourceHubNavigation as item}
      <a href={item.href}><strong>{item.label}</strong><span>{item.detail}</span></a>
    {/each}
  </nav>
  <div class="reference-guide">
    {#each referenceGuides as resource}
      <article class="card" id={`reference-${resource.id}`}>
        <h3>{resource.name}</h3>
        <dl>
          <div><dt>Use it when</dt><dd>{resource.useWhen}</dd></div>
          <div><dt>What you provide</dt><dd>{resource.input}</dd></div>
          <div><dt>What you receive</dt><dd>{resource.result}</dd></div>
          <div><dt>What to do next</dt><dd>{resource.next}</dd></div>
        </dl>
      </article>
    {/each}
  </div>
</section>

<section id="privacy" class="resource-section" aria-labelledby="privacy-title">
  <div class="section-intro"><h2 id="privacy-title">Privacy and data handling</h2><p>The privacy policy explains network recipients, browser storage, exports, retention and deletion.</p></div>
  <a class="reference-link" href="/privacy">Read the privacy policy <span aria-hidden="true">→</span></a>
</section>

<section id="results" class="resource-section" aria-labelledby="results-title">
  <div class="section-intro"><p class="eyebrow">Read the result</p><h2 id="results-title">Source health is part of the evidence</h2><p>Registration status is authority-aware. DNS, certificates, websites and external intelligence add context, but do not override an authoritative registry answer.</p></div>
  <article class="result-layout card" aria-labelledby="result-layout-title">
    <div><p class="eyebrow">Lookup layout</p><h3 id="result-layout-title">Start with the decision, then open the evidence you need</h3><p>At a glance separates complete, limited, disagreeing and unresolved evidence. The analyst question changes section order for the selected task; it does not change the evidence.</p></div>
    <ol>
      <li><strong>Registration</strong><span>Compare registry, registrar RDAP and WHOIS without merging their authority.</span></li>
      <li><strong>Web and DNS</strong><span>Review point-in-time DNS, HTTP, TLS, page, technology and posture evidence.</span></li>
      <li><strong>Relationships and history</strong><span>Switch between source coverage, exact relationships and dated lifecycle events.</span></li>
      <li><strong>Source quality</strong><span>Check completeness, freshness, timing, provenance and request diagnostics.</span></li>
      <li><strong>Case and response</strong><span>Retain reviewed facts and prepare actions without automatic submission.</span></li>
      <li><strong>Advanced evidence</strong><span>Open optional provider context and the full validated lookup response when required.</span></li>
    </ol>
    <p class="layout-note">Each family can be opened or collapsed independently. On smaller screens, use Jump to section to move through the result without a horizontal navigation strip. Export actions are grouped under Export and do not send the result anywhere.</p>
  </article>
  <div class="state-grid">
    {#each resultStates as state}
      <article><h3>{state.term}</h3><p>{state.definition}</p></article>
    {/each}
  </div>
  <aside class="interpretation card">
    <strong>Risk prioritises review.</strong>
    <p>Open the explanation to see the model, contributing observations and sensitivity. Corroborate shared infrastructure, page similarity and recent registration before acting.</p>
  </aside>
</section>

<section id="glossary" class="resource-section" aria-labelledby="glossary-title">
  <div class="section-intro"><h2 id="glossary-title">Domain investigation terms</h2><p>Short definitions for the protocols, records and labels used throughout WHOISleuth.</p></div>
  <dl class="glossary-grid">
    {#each glossaryTerms as item}
      <div><dt>{item.term}</dt><dd>{item.definition}</dd></div>
    {/each}
  </dl>
</section>

<section id="faq" class="resource-section" aria-labelledby="faq-title">
  <div class="section-intro"><h2 id="faq-title">Common questions</h2><p>Practical answers about interpretation, privacy and saved investigation work.</p></div>
  <div class="faq-list card">
    {#each guideFaqs as item}
      <details><summary>{item.question}</summary><p>{item.answer}</p></details>
    {/each}
  </div>
</section>

<section id="mistakes" class="resource-section" aria-labelledby="mistakes-title">
  <div class="section-intro"><h2 id="mistakes-title">Keep the conclusion narrower than the evidence</h2></div>
  <ul class="mistake-list card">{#each commonMistakes as item}<li>{item}</li>{/each}</ul>
  <div class="closing-actions"><a class="primary" href="/demo">Walk through the demo</a><PublicConsoleCta /></div>
</section>
</PublicReferenceDocument>

<style>
  .closing-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.closing-actions a{min-height:42px}
  .reference-link{display:inline-flex;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  .resource-section{padding:62px 0;border-top:1px solid var(--border);scroll-margin-top:74px}.section-intro{max-width:790px;margin-bottom:24px}.section-intro h2{margin:.3rem 0 .65rem;font:700 clamp(1.6rem,3.4vw,2.45rem) var(--mono);letter-spacing:-.04em}.section-intro>p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.65}
  .reference-pages{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 12px}.reference-pages a{display:grid;min-width:0;gap:6px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.reference-pages a:hover,.reference-pages a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}.reference-pages strong{color:var(--accent);font:700 var(--text-sm) var(--mono)}.reference-pages span{color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .tool-guide,.reference-guide{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.tool-guide article,.reference-guide article{padding:20px}.tool-guide article:last-child:nth-child(odd),.reference-guide article:only-child{grid-column:1/-1}.tool-guide article:last-child:nth-child(odd) dl,.reference-guide article:only-child dl{grid-template-columns:repeat(2,minmax(0,1fr))}.tool-guide h3,.reference-guide h3{margin:0 0 16px;color:var(--accent);font:700 1.05rem var(--mono)}.tool-guide dl,.reference-guide dl{display:grid;gap:1px;margin:0;background:var(--border)}.tool-guide dl div,.reference-guide dl div{display:grid;grid-template-columns:128px minmax(0,1fr);gap:12px;padding:10px;background:var(--panel)}.tool-guide dt,.reference-guide dt{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.tool-guide dd,.reference-guide dd{margin:0;font-size:var(--text-xs);line-height:1.5}
  .state-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:0 24px}.state-grid article{padding:16px 0;border-top:1px solid var(--border)}.state-grid h3{margin:0;color:var(--interface-accent);font:700 var(--text-sm) var(--mono)}.state-grid p{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.interpretation{margin-top:12px;padding:19px;border-left:3px solid var(--amber)}.interpretation strong{font:700 var(--text-sm) var(--mono)}.interpretation p{margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}
  .result-layout{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:26px;margin-bottom:24px;padding:22px}.result-layout h3{margin:4px 0 8px;font:700 clamp(1.1rem,2vw,1.35rem) var(--mono);line-height:1.25}.result-layout p{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}.result-layout ol{display:grid;gap:1px;margin:0;padding:0;background:var(--border);list-style:none}.result-layout li{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;padding:10px 12px;background:var(--panel)}.result-layout li strong{color:var(--accent);font:700 var(--text-xs) var(--mono)}.result-layout li span{color:var(--muted);font-size:var(--text-xs);line-height:1.45}.result-layout .layout-note{grid-column:1 / -1;padding-top:14px;border-top:1px solid var(--border)}
  .glossary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 30px;margin:0}.glossary-grid>div{display:grid;grid-template-columns:145px minmax(0,1fr);gap:15px;padding:16px 0;border-top:1px solid var(--border)}.glossary-grid dt{color:var(--accent);font:700 var(--text-xs) var(--mono)}.glossary-grid dd{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .faq-list{overflow:hidden}.faq-list details{padding:0;border-top:1px solid var(--border)}.faq-list details:first-child{border-top:0}.faq-list summary{padding:16px 48px 16px 18px;font:700 var(--text-sm) var(--mono)}.faq-list details p{margin:0;padding:0 18px 18px;color:var(--muted);font-size:var(--text-sm);line-height:1.65}
  .mistake-list{display:grid;gap:10px;margin:0;padding:20px 20px 20px 42px}.mistake-list li{padding-left:5px;color:var(--muted);font-size:var(--text-sm);line-height:1.55}.mistake-list li::marker{color:var(--amber)}
  @media(max-width:900px){.glossary-grid,.result-layout{grid-template-columns:1fr}.reference-pages{grid-template-columns:repeat(2,minmax(0,1fr))}.result-layout .layout-note{grid-column:auto}}
  @media(max-width:680px){
    .reference-pages,.tool-guide,.reference-guide,.state-grid{grid-template-columns:1fr}
    .tool-guide article:last-child:nth-child(odd),.reference-guide article:only-child{grid-column:auto}
    .tool-guide article:last-child:nth-child(odd) dl,.reference-guide article:only-child dl{grid-template-columns:1fr}
    .tool-guide dl div,.reference-guide dl div,.glossary-grid>div,.result-layout li{grid-template-columns:1fr;gap:4px}
    .resource-section{scroll-margin-top:20px}
  }
</style>
