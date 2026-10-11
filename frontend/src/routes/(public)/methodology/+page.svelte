<script lang="ts">
  import PublicReferenceDocument from '#lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '#lib/components/PublicSeo.svelte';
  import AnalystFieldCards from '#lib/components/AnalystFieldCards.svelte';
  import EvidenceTimestamp from '#lib/components/EvidenceTimestamp.svelte';
  import { PUBLIC_METHODOLOGY } from '#lib/generated/public-methodology.ts';

  const token = (value: string) => value.replaceAll('_', ' ');
  let printFieldCardsOnly = $state(false);
  const pageSections = [{ href: '#worked-claims', label: 'Inspect a claim' }, ...PUBLIC_METHODOLOGY.topics.map((topic) => ({
    href: `#method-${topic.id}`,
    label: topic.title,
  })), { href: '#analyst-field-cards', label: 'Analyst field cards' }];
</script>

<PublicSeo title="Evidence methodology | WHOISleuth" description="Current WHOISleuth rules for authority, evidence sources, source states, analyst decisions and request modes." path="/methodology" />

<PublicReferenceDocument
  currentHref="/methodology"
  eyebrow="Current evidence rules"
  title="Evidence methodology"
  summary={['How WHOISleuth attributes evidence, records source state and limits conclusions.']}
  sections={pageSections}
>
  <div class:print-cards-only={printFieldCardsOnly}>
    <section class="worked-examples" id="worked-claims" aria-labelledby="worked-claims-title">
      <h2 id="worked-claims-title">Inspect a claim</h2>
      <p>Open a fictional example to follow the claim back to its source accounts. These are the same supplied records used in the <a href="/examples">input examples</a>, not live findings.</p>
      {#each PUBLIC_METHODOLOGY.examples as example}
        <details id={`method-example-${example.id}`}>
          <summary>{example.title}</summary>
          <p><strong>Claim:</strong> {example.claim}</p>
          <p><strong>What follows:</strong> {example.conclusion}</p>
          <ul class="source-links" aria-label={`${example.title} source links`}>
            {#each example.sources as source}<li><a href={`#method-source-${example.id}-${source.id}`}>{source.role}: {source.label}</a></li>{/each}
          </ul>
          <div class="source-accounts">
            {#each example.sources as source}
              <article id={`method-source-${example.id}-${source.id}`} aria-label={source.label}>
                <h3>{source.role}</h3>
                <p>{source.value}</p>
                <dl>
                  <dt>Source</dt><dd>{source.source}</dd>
                  <dt>{source.sourceState === 'unavailable' ? 'Attempt recorded at' : 'Observed at'}</dt><dd><EvidenceTimestamp value={source.observedAt} copyable={false} /></dd>
                  <dt>Observation hostname</dt><dd>{#if source.observationHostname}<code>{source.observationHostname}</code>{:else}Not recorded{/if}</dd>
                  <dt>Source state</dt><dd>{source.sourceState}</dd>
                  <dt>Coverage</dt><dd>{source.completeness}</dd>
                </dl>
                <ul>{#each source.limitations as limitation}<li>{limitation}</li>{/each}</ul>
              </article>
            {/each}
          </div>
          <h3>Still unknown</h3>
          <ul>{#each example.unknowns as unknown}<li>{unknown}</li>{/each}</ul>
          <nav class="example-links" aria-label={`${example.title} references`}><a href={example.rule.href}>{example.rule.label}</a><a href={example.example.href}>{example.example.label}</a></nav>
        </details>
      {/each}
    </section>
    <div class="topic-grid">
      {#each PUBLIC_METHODOLOGY.topics as topic}
        <article id={`method-${topic.id}`}>
          <h2>{topic.title}</h2>
          <p>{topic.summary}</p>
          <ul aria-label={`${topic.title} terms`}>
            {#each topic.states as state}<li>{token(state)}</li>{/each}
          </ul>
        </article>
      {/each}
    </div>
    <details id="analyst-field-cards">
      <summary>Analyst field cards</summary>
      <p>Keep a compact reference beside your investigation. Use <strong>Print this guide</strong> below to print or save a PDF.</p>
      <label class="print-choice"><input type="checkbox" bind:checked={printFieldCardsOnly} /> Print field cards only</label>
      <AnalystFieldCards />
    </details>
  </div>
</PublicReferenceDocument>

<style>
  .worked-examples{margin-bottom:24px;min-width:0;overflow-wrap:anywhere}
  .worked-examples h2{margin-top:0}.worked-examples h3{font-size:var(--text-md)}
  .worked-examples :is(summary,a){scroll-margin-block:var(--reference-anchor-offset,24px) 12px}
  .worked-examples p,.worked-examples li{line-height:1.65}.worked-examples li+li{margin-top:6px}
  .source-links a,.example-links a{display:inline-flex;align-items:center;min-height:44px;color:var(--accent)}
  .source-accounts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start;margin:20px 0}
  .source-accounts article{min-width:0;border-left:2px solid var(--border);padding-left:16px;scroll-margin-top:var(--reference-anchor-offset,24px)}
  .source-accounts h3{margin:0}.source-accounts dl{margin:14px 0;line-height:1.55}
  .source-accounts dt{margin-top:8px;font-weight:650}.source-accounts dd{margin:0;color:var(--muted)}
  .source-accounts ul{padding-left:20px;color:var(--muted)}
  .example-links{display:flex;flex-wrap:wrap;gap:8px 24px}
  .topic-grid{display:grid}
  .topic-grid article{min-width:0;padding:30px 0;border-top:1px solid var(--border)}
  .topic-grid h2{margin:0;font:700 clamp(1.3rem,2.2vw,1.65rem)/1.3 var(--font-sans);letter-spacing:-.02em}
  .topic-grid p{margin:12px 0 16px;color:var(--text);font-size:1rem;line-height:1.7}
  .topic-grid ul{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0;padding:0;list-style:none}
  .topic-grid li{color:var(--muted);font-size:.875rem;line-height:1.5}
  details{padding:22px 0;border-top:1px solid var(--border)}
  summary{min-height:44px;align-content:center;cursor:pointer;font:700 var(--text-lg)/1.4 var(--font-sans)}
  details>p{color:var(--muted)}
  .print-choice{display:flex;align-items:center;gap:10px;min-height:44px;margin:10px 0 20px;cursor:pointer;font-size:var(--text-sm)}
  .print-choice input{width:18px;height:18px;flex:none}
  @media(max-width:700px){.source-accounts{grid-template-columns:1fr;gap:20px}}
  @media print{
    .print-cards-only .topic-grid,.print-cards-only .worked-examples{display:none}
    details{border:0;padding:0}details>summary,details>p,.print-choice{display:none}
    .worked-examples details>summary,.worked-examples details>p{display:block}
    .source-links{display:none}.source-accounts article{break-inside:avoid}
  }
</style>
