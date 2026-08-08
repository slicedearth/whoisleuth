<script lang="ts">
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import PublicGoalPaths from '$lib/components/PublicGoalPaths.svelte';
  import OfflineInvestigationScenarios from '$lib/components/OfflineInvestigationScenarios.svelte';
  import {
    commonMistakes,
    glossaryTerms,
    guideFaqs,
    publicGuideGoals,
    referenceGuides,
    resultStates,
    toolGuides,
  } from '$lib/public-guide';

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: guideFaqs.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

</script>

<PublicSeo
  title="How to use WHOISleuth | Guide and glossary"
  description="Learn how to investigate a domain, find brand lookalikes, interpret WHOIS and RDAP evidence, save findings, and understand common domain-intelligence terms."
  path="/guide"
  structuredData={faqSchema}
/>

<header class="guide-hero">
  <p class="eyebrow">Learn</p>
  <h1>Use WHOISleuth with confidence.</h1>
  <p>Choose a task, then use the source-state and glossary references to interpret results without overstating them.</p>
  <div class="guide-actions"><a class="primary" href="/demo">Try the synthetic demo</a><a class="btn" href="/resources">Browse the topic library</a><PublicConsoleCta /></div>
</header>

<nav class="guide-index card" aria-label="Guide sections">
  <a href="#start">Start here</a>
  <a href="#practice">Practice</a>
  <a href="#tools">Tools</a>
  <a href="#reference">Reference</a>
  <a href="#results">Read results</a>
  <a href="#glossary">Glossary</a>
  <a href="#faq">FAQ</a>
  <a href="#mistakes">Common mistakes</a>
</nav>

<section id="start" class="guide-section" aria-labelledby="start-title">
  <div class="section-intro"><h2 id="start-title">Choose the outcome you need.</h2><p>There is no single required route through the console. These paths cover the most common starting points.</p></div>
  <PublicGoalPaths goals={publicGuideGoals} linkSteps ariaLabel="Common WHOISleuth workflow map" />
</section>

<section id="practice" class="guide-section" aria-labelledby="practice-title">
  <div class="section-intro"><h2 id="practice-title">Practice the decision, not just the click path.</h2><p>Work through deterministic examples for Brand sweep, Infrastructure pivot, and New-domain triage before starting a live collection.</p></div>
  <OfflineInvestigationScenarios />
</section>

<section id="tools" class="guide-section" aria-labelledby="tools-title">
  <div class="section-intro"><h2 id="tools-title">Know where to go next.</h2><p>Each tool has a distinct role. Deeper collection is deliberate and does not begin merely because you open a page.</p></div>
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

<section id="reference" class="guide-section" aria-labelledby="reference-title">
  <div class="section-intro"><h2 id="reference-title">Check coverage before drawing a conclusion.</h2><p>Reference pages explain the evidence boundaries behind the investigation tools. They do not run a lookup or make a registry request.</p></div>
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

<section id="results" class="guide-section" aria-labelledby="results-title">
  <div class="section-intro"><p class="eyebrow">Read the result</p><h2 id="results-title">Source health is part of the evidence.</h2><p>Registration status is authority-aware. DNS, certificates, websites and external intelligence add context, but do not override an authoritative registry answer.</p></div>
  <article class="result-layout card" aria-labelledby="result-layout-title">
    <div><p class="eyebrow">Lookup layout</p><h3 id="result-layout-title">Start with the decision, then open the evidence you need.</h3><p>At a glance shows collection quality and at most three task-aware next actions. Focus changes evidence-family order for a general, brand, acquisition, incident-response or owned-domain review; acquisition presents Opportunity first while other tasks present Risk first. A saved-context preview builds its disposable local search only after you open it. Detailed assessment adds questions, claim readiness, portable hand-off, and acquisition review without repeating the action list or changing evidence.</p></div>
    <ol>
      <li><strong>Registration</strong><span>Compare registry, registrar RDAP and WHOIS without merging their authority.</span></li>
      <li><strong>Web and DNS</strong><span>Review point-in-time DNS, HTTP, TLS, page, technology and posture evidence.</span></li>
      <li><strong>Relationships and history</strong><span>Switch between source coverage, exact relationships and dated lifecycle events.</span></li>
      <li><strong>Source quality</strong><span>Check completeness, freshness, timing, provenance and request diagnostics.</span></li>
      <li><strong>Case and response</strong><span>Retain reviewed facts and prepare actions without automatic submission.</span></li>
      <li><strong>Advanced evidence</strong><span>Open optional provider context and the bounded raw response only when required.</span></li>
    </ol>
    <p class="layout-note">Each family can be opened or collapsed independently. On smaller screens, use Jump to section to move through the result without a horizontal navigation strip. Export actions are grouped under Export and do not send the result anywhere.</p>
  </article>
  <div class="state-grid">
    {#each resultStates as state}
      <article><h3>{state.term}</h3><p>{state.definition}</p></article>
    {/each}
  </div>
  <aside class="interpretation card">
    <strong>Risk is a review aid, not a verdict.</strong>
    <p>The score lists its contributing observations. Shared infrastructure, similar pages and recent registrations can raise priority, but none of them alone proves ownership, intent, maliciousness or safety.</p>
  </aside>
</section>

<section id="glossary" class="guide-section" aria-labelledby="glossary-title">
  <div class="section-intro"><h2 id="glossary-title">Domain investigation terms.</h2><p>Short definitions for the protocols, records and workflow labels used throughout WHOISleuth.</p></div>
  <dl class="glossary-grid">
    {#each glossaryTerms as item}
      <div><dt>{item.term}</dt><dd>{item.definition}</dd></div>
    {/each}
  </dl>
</section>

<section id="faq" class="guide-section" aria-labelledby="faq-title">
  <div class="section-intro"><h2 id="faq-title">Common questions.</h2><p>Practical answers about interpretation, privacy and saved investigation work.</p></div>
  <div class="faq-list card">
    {#each guideFaqs as item}
      <details><summary>{item.question}</summary><p>{item.answer}</p></details>
    {/each}
  </div>
</section>

<section id="mistakes" class="guide-section" aria-labelledby="mistakes-title">
  <div class="section-intro"><h2 id="mistakes-title">Keep the conclusion narrower than the evidence.</h2></div>
  <ul class="mistake-list card">{#each commonMistakes as item}<li>{item}</li>{/each}</ul>
  <div class="closing-actions"><a class="primary" href="/demo">Walk through the demo</a><PublicConsoleCta /></div>
</section>

<style>
  .guide-hero{max-width:780px;padding:12px 0 48px}.guide-hero h1{margin:.35rem 0 1rem;font:750 clamp(2.35rem,5vw,3.65rem)/1 var(--mono);letter-spacing:-.06em}.guide-hero>p:not(.eyebrow){max-width:60ch;color:var(--muted);font-size:clamp(1rem,1.6vw,1.12rem);line-height:1.7}
  .guide-actions,.closing-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.guide-actions a,.closing-actions a{min-height:42px}
  .guide-index{display:flex;position:sticky;top:8px;z-index:10;gap:5px;margin:0 0 52px;padding:6px;overflow-x:auto;background:rgb(var(--panel-rgb) / .94);backdrop-filter:blur(8px)}.guide-index a{flex:0 0 auto;padding:9px 11px;border-radius:var(--radius-sm);color:var(--muted);font:650 var(--text-2xs) var(--mono);white-space:nowrap}.guide-index a:hover,.guide-index a:focus-visible{color:var(--text);background:rgb(var(--accent-rgb) / .08)}
  .guide-section{padding:62px 0;border-top:1px solid var(--border);scroll-margin-top:74px}.section-intro{max-width:790px;margin-bottom:24px}.section-intro h2{margin:.3rem 0 .65rem;font:700 clamp(1.6rem,3.4vw,2.45rem) var(--mono);letter-spacing:-.04em}.section-intro>p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.65}
  .tool-guide,.reference-guide{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.tool-guide article,.reference-guide article{padding:20px}.tool-guide h3,.reference-guide h3{margin:0 0 16px;color:var(--accent);font:700 1.05rem var(--mono)}.tool-guide dl,.reference-guide dl{display:grid;gap:1px;margin:0;background:var(--border)}.tool-guide dl div,.reference-guide dl div{display:grid;grid-template-columns:128px minmax(0,1fr);gap:12px;padding:10px;background:var(--panel)}.tool-guide dt,.reference-guide dt{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.tool-guide dd,.reference-guide dd{margin:0;font-size:var(--text-xs);line-height:1.5}
  .state-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:0 24px}.state-grid article{padding:16px 0;border-top:1px solid var(--border)}.state-grid h3{margin:0;color:var(--accent2);font:700 var(--text-sm) var(--mono)}.state-grid p{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.interpretation{margin-top:12px;padding:19px;border-left:3px solid var(--amber)}.interpretation strong{font:700 var(--text-sm) var(--mono)}.interpretation p{margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}
  .result-layout{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:26px;margin-bottom:24px;padding:22px}.result-layout h3{margin:4px 0 8px;font:700 clamp(1.1rem,2vw,1.35rem) var(--mono);line-height:1.25}.result-layout p{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}.result-layout ol{display:grid;gap:1px;margin:0;padding:0;background:var(--border);list-style:none}.result-layout li{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;padding:10px 12px;background:var(--panel)}.result-layout li strong{color:var(--accent);font:700 var(--text-xs) var(--mono)}.result-layout li span{color:var(--muted);font-size:var(--text-xs);line-height:1.45}.result-layout .layout-note{grid-column:1 / -1;padding-top:14px;border-top:1px solid var(--border)}
  .glossary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 30px;margin:0}.glossary-grid>div{display:grid;grid-template-columns:145px minmax(0,1fr);gap:15px;padding:16px 0;border-top:1px solid var(--border)}.glossary-grid dt{color:var(--accent);font:700 var(--text-xs) var(--mono)}.glossary-grid dd{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .faq-list{overflow:hidden}.faq-list details{padding:0;border-top:1px solid var(--border)}.faq-list details:first-child{border-top:0}.faq-list summary{padding:16px 48px 16px 18px;font:700 var(--text-sm) var(--mono)}.faq-list details p{margin:0;padding:0 18px 18px;color:var(--muted);font-size:var(--text-sm);line-height:1.65}
  .mistake-list{display:grid;gap:10px;margin:0;padding:20px 20px 20px 42px}.mistake-list li{padding-left:5px;color:var(--muted);font-size:var(--text-sm);line-height:1.55}.mistake-list li::marker{color:var(--amber)}
  @media(max-width:900px){.glossary-grid,.result-layout{grid-template-columns:1fr}.result-layout .layout-note{grid-column:auto}}
  @media(max-width:680px){
    .guide-index{display:grid;position:relative;top:auto;grid-template-columns:repeat(2,minmax(0,1fr));overflow:visible}
    .guide-index a{min-width:0;white-space:normal}
    .tool-guide,.reference-guide,.state-grid{grid-template-columns:1fr}
    .tool-guide dl div,.reference-guide dl div,.glossary-grid>div,.result-layout li{grid-template-columns:1fr;gap:4px}
    .guide-section{scroll-margin-top:20px}
  }
</style>
