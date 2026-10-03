<script lang="ts">
  import PublicReferenceDocument from '$lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import { PUBLIC_METHODOLOGY } from '$lib/generated/public-methodology';

  const token = (value: string) => value.replaceAll('_', ' ');
  const pageSections = PUBLIC_METHODOLOGY.topics.map((topic) => ({
    href: `#method-${topic.id}`,
    label: topic.title,
  }));
</script>

<PublicSeo title="Evidence methodology | WHOISleuth" description="Current WHOISleuth rules for authority, evidence sources, source states, analyst decisions and request modes." path="/methodology" />

<PublicReferenceDocument
  currentHref="/methodology"
  eyebrow="Current evidence rules"
  title="Evidence methodology"
  summary={['How WHOISleuth attributes evidence, records source state and limits conclusions.']}
  sections={pageSections}
>
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
</PublicReferenceDocument>

<style>
  .topic-grid{display:grid}
  .topic-grid article{min-width:0;padding:30px 0;border-top:1px solid var(--border)}
  .topic-grid h2{margin:0;font:700 clamp(1.3rem,2.2vw,1.65rem)/1.3 var(--font-sans);letter-spacing:-.02em}
  .topic-grid p{margin:12px 0 16px;color:var(--text);font-size:1rem;line-height:1.7}
  .topic-grid ul{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0;padding:0;list-style:none}
  .topic-grid li{color:var(--muted);font-size:.875rem;line-height:1.5}
</style>
