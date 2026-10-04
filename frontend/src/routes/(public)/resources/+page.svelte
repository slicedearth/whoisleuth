<script lang="ts">
  import { onMount } from 'svelte';
  import DeferredSurface from '#lib/components/DeferredSurface.svelte';
  import { preloadBestEffort, preloadOnIdle } from '#lib/idle-preload.ts';
  import PublicConsoleCta from '#lib/components/PublicConsoleCta.svelte';
  import PublicGoalPaths from '#lib/components/PublicGoalPaths.svelte';
  import PublicReferenceDocument from '#lib/components/PublicReferenceDocument.svelte';
  import PublicResourceCards from '#lib/components/PublicResourceCards.svelte';
  import PublicSeo from '#lib/components/PublicSeo.svelte';
  import {
    commonMistakes,
    glossaryTerms,
    guideFaqs,
    publicGuideGoals,
    referenceGuides,
    resultStates,
    toolGuides,
  } from '#lib/public-guide.ts';
  import { PUBLIC_RESOURCES } from '#lib/public-resources.ts';
  import { documentationAnchor } from '#lib/documentation-anchors.ts';
  import { publicResourceHubNavigation } from '#lib/workspaces.ts';
  import { WHOISLEUTH_SITE_ORIGIN } from '../../../../../packages/analysis/project-metadata.mts';

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
    preloadBestEffort(() => import('#lib/components/OfflineInvestigationScenarios.svelte'), moduleController.signal);
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
  <div class="section-intro"><h2 id="start-title">Choose a task</h2></div>
  <PublicGoalPaths goals={publicGuideGoals} linkSteps ariaLabel="Common WHOISleuth tasks" />
</section>

<section id="topics" class="resource-section" aria-labelledby="topics-title">
  <div class="section-intro">
    <h2 id="topics-title">Evidence guides</h2>
    <p>Work through a specific investigation question.</p>
  </div>
  <PublicResourceCards resources={PUBLIC_RESOURCES} />
</section>

<section id="practice" class="resource-section" aria-labelledby="practice-title">
  <div class="section-intro"><h2 id="practice-title">Practise with fictional evidence</h2><p>Try three short exercises or <a href="/demo#case-practice">work through a Case from evidence review to recheck</a>. Case scenarios include exact-page scope, shared platforms, conflicting captures, account actions and source reuse.</p></div>
  {#if !practiceOpen}<button class="primary" type="button" onpointerenter={preloadPractice} onfocus={preloadPractice} onclick={() => practiceOpen = true}>Open offline practice</button>{/if}
  {#if practiceOpen}<DeferredSurface load={() => import('#lib/components/OfflineInvestigationScenarios.svelte')} props={{}} loadingLabel="Loading offline practice." unavailableLabel="Offline practice could not be loaded." />{/if}
</section>

<section id="tools" class="resource-section" aria-labelledby="tools-title">
  <div class="section-intro"><h2 id="tools-title">Choose the right tool</h2></div>
  <div class="tool-guide">
    {#each toolGuides as tool}
      <details class="tool-entry compact-disclosure" id={`tool-${tool.id}`}>
        <summary><span><strong>{tool.name}</strong><span>{tool.useWhen}</span></span></summary>
        <dl>
          <div id={`tool-${tool.id}-input`}><dt>What you provide</dt><dd>{tool.input}</dd></div>
          <div id={`tool-${tool.id}-result`}><dt>What you receive</dt><dd>{tool.result}</dd></div>
          <div id={`tool-${tool.id}-next`}><dt>What to do next</dt><dd>{tool.next}</dd></div>
        </dl>
      </details>
    {/each}
  </div>
</section>

<section id="reference" class="resource-section" aria-labelledby="reference-title">
  <div class="section-intro"><h2 id="reference-title">Product and source references</h2><p>Commands, evidence rules, supported sources and example output.</p></div>
  <nav class="reference-pages responsive-grid" aria-label="Product references">
    {#each publicResourceHubNavigation as item}
      <a href={item.href}><strong>{item.label}</strong><span>{item.detail}</span></a>
    {/each}
  </nav>
  <div class="reference-guide responsive-grid">
    {#each referenceGuides as resource}
      <article id={`reference-${resource.id}`}>
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

<section id="results" class="resource-section layout-container" aria-labelledby="results-title">
  <div class="section-intro"><h2 id="results-title">Source health is part of the evidence</h2><p>Registration status comes from authoritative evidence, not website activity. DNS, certificates, websites and external intelligence each answer different questions.</p></div>
  <article class="result-layout" aria-labelledby="result-layout-title">
    <h3 id="result-layout-title">Find your way around a Lookup result</h3>
    <p>Start with At a glance, then open the evidence relevant to your question.</p>
    <ol>
      <li><strong>Registration</strong><span>Compare registry, registrar RDAP and WHOIS without merging their authority.</span></li>
      <li><strong>Web and DNS</strong><span>Review point-in-time DNS, HTTP, TLS, page, technology and posture evidence.</span></li>
      <li><strong>Relationships and history</strong><span>Switch between source coverage, exact relationships and dated lifecycle events.</span></li>
      <li><strong>Source quality</strong><span>Check completeness, freshness, timing, provenance and request diagnostics.</span></li>
      <li><strong>Case and response</strong><span>Retain reviewed facts and prepare actions without automatic submission.</span></li>
      <li><strong>Advanced evidence</strong><span>Open optional provider context and the full validated lookup response when required.</span></li>
    </ol>
    <p class="layout-note">Use Jump to section to move around a long result. Export saves a local copy.</p>
  </article>
  <div class="state-grid">
    {#each resultStates as state}
      <article id={`state-${documentationAnchor(state.term)}`}><h3>{state.term}</h3><p>{state.definition}</p></article>
    {/each}
  </div>
  <aside class="interpretation">
    <strong>Risk prioritises review.</strong>
    <p>Open the explanation to see the model, contributing observations and sensitivity. Corroborate shared infrastructure, page similarity and recent registration before acting.</p>
  </aside>
</section>

<details id="glossary" class="resource-section reference-fold">
  <summary><h2 id="glossary-title">Domain investigation terms</h2></summary>
  <p>Search documentation for a specific term, or browse the glossary.</p>
  <dl class="glossary-grid">
    {#each glossaryTerms as item}
      <div id={`term-${documentationAnchor(item.term)}`}><dt>{item.term}</dt><dd>{item.definition}</dd></div>
    {/each}
  </dl>
</details>

<section id="faq" class="resource-section" aria-labelledby="faq-title">
  <div class="section-intro"><h2 id="faq-title">Common questions</h2><p>Practical answers about interpretation, privacy and saved investigation work.</p></div>
  <div class="faq-list">
    {#each guideFaqs as item}
      <details id={`question-${documentationAnchor(item.question)}`}><summary>{item.question}</summary><p>{item.answer}</p></details>
    {/each}
  </div>
</section>

<section id="mistakes" class="resource-section" aria-labelledby="mistakes-title">
  <div class="section-intro"><h2 id="mistakes-title">Common interpretation mistakes</h2></div>
  <ul class="mistake-list">{#each commonMistakes as item}<li>{item}</li>{/each}</ul>
</section>
</PublicReferenceDocument>

<style>
  .tool-guide{display:grid;gap:8px}.tool-entry{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .tool-entry summary{padding:18px;font:400 var(--text-sm)/1.5 var(--font-sans)}.tool-entry summary>span{display:inline-grid;gap:6px;max-width:calc(100% - 28px);vertical-align:top}.tool-entry summary strong{color:var(--accent);font-size:var(--text-md)}.tool-entry summary span span{color:var(--muted)}.tool-entry dl{padding:0 18px 18px}
  .reference-fold{border-inline:0;border-bottom:0;border-radius:0;background:transparent}.reference-fold summary{padding:0 0 16px}.reference-fold h2{display:inline;font:700 clamp(1.45rem,2.5vw,1.9rem)/1.3 var(--font-sans)}.reference-fold>p{color:var(--muted);line-height:1.6}
  .reference-link{display:inline-flex;align-items:center;gap:10px;min-height:44px;color:var(--accent);font-weight:650}
  .resource-section{padding:32px 0;border-top:1px solid var(--border)}.section-intro{max-width:790px;margin-bottom:24px}.section-intro h2{margin:0 0 .65rem;font:700 clamp(1.45rem,2.5vw,1.9rem)/1.25 var(--font-sans);letter-spacing:-.025em}.section-intro>p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.65}
  .reference-pages{--grid-min:180px;--grid-gap:8px;margin:0 0 12px}.reference-pages a{display:grid;min-width:0;gap:6px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.reference-pages a:hover,.reference-pages a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}.reference-pages strong{color:var(--accent);font:700 var(--text-sm) var(--mono)}.reference-pages span{color:var(--muted);font-size:var(--type-supporting-size);line-height:1.45}
  .tool-guide,.reference-guide{--grid-min:330px;--grid-gap:10px}.reference-guide article{padding:20px}.reference-guide article:only-child{grid-column:1 / -1}.reference-guide article:only-child dl{grid-template-columns:repeat(2,minmax(0,1fr))}.reference-guide h3{margin:0 0 16px;color:var(--accent);font:700 1.05rem var(--mono)}.tool-guide dl,.reference-guide dl{display:grid;gap:1px;margin:0;background:var(--border)}.tool-guide dl div,.reference-guide dl div{display:grid;grid-template-columns:128px minmax(0,1fr);gap:12px;padding:10px;background:var(--panel)}.tool-guide dt,.reference-guide dt{color:var(--muted);font:650 var(--type-label-size) var(--mono)}.tool-guide dd,.reference-guide dd{margin:0;font-size:var(--type-supporting-size);line-height:1.5}
  .state-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:0 24px}.state-grid article{padding:16px 0;border-top:1px solid var(--border)}.state-grid h3{margin:0;color:var(--interface-accent);font:700 var(--text-sm) var(--mono)}.state-grid p{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.interpretation{margin-top:12px;padding:19px;border-left:3px solid var(--amber)}.interpretation strong{font:700 var(--text-sm) var(--mono)}.interpretation p{margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}
  .result-layout{margin-bottom:32px}.result-layout h3{margin:0 0 8px;font:700 1.125rem/1.4 var(--font-sans)}.result-layout p{margin:0;color:var(--muted);line-height:1.65}.result-layout ol{display:grid;gap:0;margin:20px 0;padding:0;list-style:none}.result-layout li{display:grid;grid-template-columns:190px minmax(0,1fr);gap:20px;padding:12px 0;border-bottom:1px solid var(--border)}.result-layout li strong{font-size:.9375rem}.result-layout li span{color:var(--muted);font-size:.9375rem;line-height:1.6}
  .glossary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 30px;margin:0}.glossary-grid>div{display:grid;grid-template-columns:145px minmax(0,1fr);gap:15px;padding:16px 0;border-top:1px solid var(--border)}.glossary-grid dt{color:var(--accent);font:700 var(--text-xs) var(--mono)}.glossary-grid dd{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .faq-list details{padding:0;border:0;border-top:1px solid var(--border);border-radius:0;background:transparent}.faq-list summary{padding:18px 0;font:650 1rem/1.5 var(--font-sans)}.faq-list details p{margin:0;padding:0 0 18px;color:var(--muted);font-size:.9375rem;line-height:1.65}
  .mistake-list{display:grid;gap:12px;margin:0;padding-left:22px}.mistake-list li{padding-left:5px;color:var(--muted);font-size:.9375rem;line-height:1.65}.mistake-list li::marker{color:var(--muted)}
  @media(max-width:900px){.glossary-grid{grid-template-columns:1fr}}
  @media(max-width:680px){
    .state-grid{grid-template-columns:1fr}
    .reference-guide article:only-child{grid-column:auto}
    .reference-guide article:only-child dl{grid-template-columns:1fr}
    .tool-guide dl div,.reference-guide dl div,.glossary-grid>div,.result-layout li{grid-template-columns:1fr;gap:4px}
  }
</style>
