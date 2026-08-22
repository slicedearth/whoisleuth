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
  <section class="method-topics" aria-labelledby="method-topics-title"><div class="section-intro"><p class="eyebrow">Implemented rules</p><h2 id="method-topics-title">Keep conclusions within the evidence</h2><p>Live source availability is evaluated when an operation runs.</p></div><div class="topic-grid">{#each PUBLIC_METHODOLOGY.topics as topic, index}<article id={`method-${topic.id}`}><header><span>{String(index + 1).padStart(2, '0')}</span><h3>{topic.title}</h3></header><p>{topic.summary}</p><ul aria-label={`${topic.title} terms`}>{#each topic.states as state}<li>{token(state)}</li>{/each}</ul></article>{/each}</div></section>
</PublicReferenceDocument>

<style>
  .section-intro h2{margin:.3rem 0 .65rem;font:700 clamp(1.45rem,3vw,2.2rem) var(--mono);letter-spacing:-.04em}.section-intro p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.65}
  .method-topics{padding:20px 0 62px}.section-intro{max-width:790px;margin-bottom:24px}.topic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.topic-grid article{min-width:0;padding:18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.topic-grid header{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;align-items:start}.topic-grid header>span{display:grid;width:28px;height:28px;place-items:center;border:1px solid var(--border);border-radius:50%;color:var(--interface-accent);font:700 var(--text-2xs) var(--mono)}.topic-grid h3{margin:4px 0 0;font:700 var(--text-sm) var(--mono)}.topic-grid p{margin:13px 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}.topic-grid ul{display:flex;flex-wrap:wrap;gap:5px;margin:0;padding:0;list-style:none}.topic-grid li{padding:5px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 .56rem var(--mono);text-transform:uppercase}
  @media(max-width:850px){.topic-grid{grid-template-columns:1fr}}
</style>
