<script lang="ts">
  let {
    title,
    description,
    path,
    indexable = true,
    website = false,
    structuredData = null,
  }: {
    title: string;
    description: string;
    path: string;
    indexable?: boolean;
    website?: boolean;
    structuredData?: Record<string, unknown> | null;
  } = $props();

  const siteOrigin = 'https://whoisleuth.com';
  const canonicalUrl = $derived(`${siteOrigin}${path}`);
  const robots = $derived(indexable
    ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    : 'noindex, nofollow');
  const schemaJson = $derived(JSON.stringify(website
    ? {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'WHOISleuth',
        url: `${siteOrigin}/`,
      }
    : structuredData).replaceAll('<', '\\u003c'));
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description}>
  <meta name="robots" content={robots}>
  <link rel="canonical" href={canonicalUrl}>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="WHOISleuth">
  <meta property="og:locale" content="en_AU">
  <meta property="og:title" content={title}>
  <meta property="og:description" content={description}>
  <meta property="og:url" content={canonicalUrl}>
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content={title}>
  <meta name="twitter:description" content={description}>
  {#if website || structuredData}<svelte:element this={'script'} type="application/ld+json">{schemaJson}</svelte:element>{/if}
</svelte:head>
