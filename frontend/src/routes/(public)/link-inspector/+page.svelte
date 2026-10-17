<script lang="ts">
  import PublicLinkInspector from '#lib/components/PublicLinkInspector.svelte';
  import PublicReferenceDocument from '#lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '#lib/components/PublicSeo.svelte';
  const sections = [{ href: '#inspect', label: 'Inspect a link' }, { href: '#read', label: 'Read the result' }];
</script>

<PublicSeo title="Offline Link Inspector | WHOISleuth" description="Inspect pasted links and displayed destinations locally, without opening them or signing in." path="/link-inspector" />
<PublicReferenceDocument currentHref="/link-inspector" eyebrow="Local review" title="Inspect a link without opening it"
  summary={['Review a supplied hostname, displayed destination and embedded links. No sign-in is needed.']} {sections}>
  <section id="inspect" aria-labelledby="inspect-title">
    <h2 id="inspect-title">Review supplied links</h2>
    <p>Input processing stays in this page after its assets load. Ordinary site assets and session checks can contact WHOISleuth; this tool does not contact supplied destinations or save your input.</p>
    <PublicLinkInspector />
  </section>
  <section id="read" aria-labelledby="read-title">
    <h2 id="read-title">Read the result</h2>
    <p>Choose Use a fictional example to fill reserved links, then choose Review links to inspect them. Neither action opens a destination.</p>
    <p>A hostname or embedded destination is a parsing result, not evidence that a service exists or is safe. No redirects, DNS records, certificates or reputation sources are checked.</p>
    <p>Supplied text and normalised parsed URLs are different representations. Paths, queries and fragments stay hidden in a separate disclosure until you reveal them. Copy only the value you intend to share; clearing this page does not clear the clipboard.</p>
    <p>Input and results clear when you edit, reset or leave this page. They are excluded from guide printing. For broader local file review, see the <a href="/resources#tool-lookup">offline intake guide</a>.</p>
  </section>
</PublicReferenceDocument>
