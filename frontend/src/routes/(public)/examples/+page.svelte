<script lang="ts">
  import PublicExampleGallery from '$lib/components/PublicExampleGallery.svelte';
  import PublicReferenceDocument from '$lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';

  const pageSections = [
    { href: '#example-gallery-title', label: 'Example formats' },
    { href: '#interpretation-title', label: 'How to read them' },
  ] as const;
</script>

<PublicSeo title="Synthetic output examples | WHOISleuth" description="Open reserved-domain Lookup plans, offline reviews, command plans and Case handoff previews." path="/examples" />

<PublicReferenceDocument
  currentHref="/examples"
  eyebrow="Example outputs"
  title="See the output before running a command"
  summary={['Reserved-domain examples formatted by the same code as the local CLI.']}
  sections={pageSections}
>
  {#snippet actions()}
    <a class="primary" href="/cli">Open the CLI reference</a>
    <a class="btn" href="/demo">Try the synthetic demo</a>
  {/snippet}

  <p class="example-boundary">All examples use fixed fictional data. Opening or downloading them runs no command.</p>

  <PublicExampleGallery />

  <aside class="interpretation card" aria-labelledby="interpretation-title">
    <h2 id="interpretation-title">How to read the examples</h2>
    <p>A plan records intended collection, an offline review assesses supplied material, and a Case pack records an export.</p>
  </aside>
</PublicReferenceDocument>

<style>
  .example-boundary{margin:0 0 42px;padding:14px 16px;border-left:3px solid var(--interface-accent);background:var(--panel);color:var(--muted);line-height:1.55}.interpretation{margin-top:34px;padding:18px;border-left:3px solid var(--interface-accent)}.interpretation h2{margin:0 0 7px;font:700 var(--text-md) var(--mono)}.interpretation p{margin:0;color:var(--muted);line-height:1.6}
</style>
