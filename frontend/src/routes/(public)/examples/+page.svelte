<script lang="ts">
  import PublicExampleGallery from '#lib/components/PublicExampleGallery.svelte';
  import PublicReferenceDocument from '#lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '#lib/components/PublicSeo.svelte';

  const pageSections = [
    { href: '#worked-outcomes-title', label: 'Investigation outcomes' },
    { href: '#example-gallery-title', label: 'Example formats' },
    { href: '#interpretation-title', label: 'How to read them' },
  ] as const;
</script>

<PublicSeo title="Synthetic input and output examples | WHOISleuth" description="Open validated command inputs, reserved-domain Lookup plans, offline reviews and case handoff previews." path="/examples" />

<PublicReferenceDocument
  currentHref="/examples"
  eyebrow="Command examples"
  title="Prepare inputs and understand the output"
  summary={['See how an investigation can end with a useful answer, an unresolved question or a scoped follow-up. Then inspect fictional file examples validated or formatted by the same code as the local CLI.']}
  sections={pageSections}
>
  {#snippet actions()}
    <a class="primary" href="/cli">Open the CLI reference</a>
    <a class="btn" href="/demo">Try the synthetic demo</a>
  {/snippet}

  <p class="example-boundary">All examples use fixed fictional data. Opening or downloading them runs no command.</p>

  <section class="worked-outcomes" aria-labelledby="worked-outcomes-title">
    <h2 id="worked-outcomes-title">Start with the investigation outcome</h2>
    <p>These fictional walkthroughs show what the evidence supports and what the analyst does next.</p>
    <div class="outcome-grid">
      <article id="source-disagreement">
        <h3>Two sources disagree</h3>
        <p><strong>Outcome:</strong> Keep both accounts. A report of no form does not erase a capture showing one when the reviewed conditions are unknown.</p>
        <details><summary>Evidence and next step</summary>
          <p>A supplied capture shows a password form. A separate review reports none, but records neither its path nor viewport.</p>
          <p>Link both accounts to the conclusion and identify the missing comparison conditions. A later timeout does not settle their disagreement.</p>
          <a href="/methodology#method-example-conflicting-page-accounts">Inspect the two source accounts</a>
          <a href="/demo?practice=contradictory-sources#case-practice">Try the conflicting-source practice</a>
        </details>
      </article>
      <article id="separate-response-scopes">
        <h3>One page changes; the advertisement is unresolved</h3>
        <p><strong>Outcome:</strong> Close only the reviewed page action. The separate advertisement and the wider case remain open.</p>
        <details><summary>Evidence and next step</summary>
          <p>A complete later review of the same page under comparable conditions no longer reproduces the credential form. The advertisement was not rechecked.</p>
          <p>Retain the exact page, observation time and comparison scope. This does not establish permanent removal, advertisement removal or general safety.</p>
          <p>In the default sign-in-page practice, record an evidence-linked conclusion, then use <strong>Rehearse separate response scopes</strong> to review the page and advertisement independently. Deliveries are simulated, not sent.</p>
          <a href="/demo?practice=credential-form#case-practice">Try the page-and-advertisement walkthrough</a>
        </details>
      </article>
      <article id="related-hosts">
        <h3>Shared infrastructure is not shared control</h3>
        <p><strong>Outcome:</strong> Keep the two pages and affected identities distinct. Their shared parent and edge address provide a lead, not attribution.</p>
        <details><summary>Evidence and next step</summary>
          <p>Two supplied page captures make different identity claims. A failed recheck of one page says nothing about the later state of its sibling.</p>
          <p>Review each source in <strong>Related hosts with different affected identities</strong> and try the optional inference exercise before deciding what the relationship supports.</p>
          <a href="/demo?practice=related-hosts#case-practice">Open the related-host practice</a>
        </details>
      </article>
      <article id="amended-handoff">
        <h3>Amend the handoff without replacing its history</h3>
        <p><strong>Outcome:</strong> Prepare a separate amendment linked to the original packet and request. The earlier delivery remains unchanged.</p>
        <details><summary>Evidence and next step</summary>
          <p>A recipient asks for dated exact-page evidence after a fictional delivery. The original packet digest and request remain recorded, while a later capture is unavailable.</p>
          <p>In <strong>A recipient asks for more evidence</strong>, select retained evidence, explain the gap and create a drafting amendment. Preparing it is not delivery or recipient acceptance; the exercise does not rehearse sending.</p>
          <a href="/demo?practice=requested-amendment#case-practice">Open the amendment practice</a>
        </details>
      </article>
    </div>
  </section>

  <PublicExampleGallery />

  <aside class="interpretation card" aria-labelledby="interpretation-title">
    <h2 id="interpretation-title">How to read the examples</h2>
    <p>Input examples are starting points, not findings to retain unchanged. A plan records intended collection, an offline review assesses supplied material, and a case pack records an export.</p>
  </aside>
</PublicReferenceDocument>

<style>
  .worked-outcomes{margin-bottom:42px;min-width:0}.worked-outcomes>h2{margin:0 0 12px}.worked-outcomes p{line-height:1.65;overflow-wrap:anywhere}.outcome-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));align-items:start;gap:28px}.outcome-grid article{min-width:0;padding-block:16px;border-top:1px solid var(--border)}.outcome-grid h3{margin:0;font-size:var(--text-md)}.outcome-grid summary{min-height:44px;padding-block:10px;cursor:pointer}.outcome-grid a{display:inline-block;min-height:44px;padding-block:10px;line-height:1.5;color:var(--interface-accent);text-decoration:underline;text-underline-offset:3px}
  .example-boundary{margin:0 0 42px;padding:14px 16px;border-left:3px solid var(--interface-accent);background:var(--panel);color:var(--muted);line-height:1.55}.interpretation{margin-top:34px;padding:18px;border-left:3px solid var(--interface-accent)}.interpretation h2{margin:0 0 7px;font:700 var(--text-md) var(--mono)}.interpretation p{margin:0;color:var(--muted);line-height:1.6}
</style>
