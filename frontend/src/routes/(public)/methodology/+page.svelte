<script lang="ts">
  import PublicReferenceDocument from '#lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '#lib/components/PublicSeo.svelte';
  import AnalystFieldCards from '#lib/components/AnalystFieldCards.svelte';
  import { PUBLIC_METHODOLOGY } from '#lib/generated/public-methodology.ts';

  const token = (value: string) => value.replaceAll('_', ' ');
  let printFieldCardsOnly = $state(false);
  const pageSections = [...PUBLIC_METHODOLOGY.topics.map((topic) => ({
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
  @media print{
    .print-cards-only .topic-grid{display:none}
    details{border:0;padding:0}details>summary,details>p,.print-choice{display:none}
  }
</style>
