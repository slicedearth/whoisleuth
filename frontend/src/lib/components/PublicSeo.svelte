<script lang="ts">
  import { WHOISLEUTH_SITE_ORIGIN } from '../../../../lib/project-metadata.mts';

  let {
    title,
    description,
    path,
    indexable = true,
    website = false,
    structuredData = null,
    imagePath = '/social-preview.png',
    imageAlt = 'WHOISleuth evidence topology connecting a domain to separately attributed intelligence sources',
  }: {
    title: string;
    description: string;
    path: string;
    indexable?: boolean;
    website?: boolean;
    structuredData?: Record<string, unknown> | null;
    imagePath?: string;
    imageAlt?: string;
  } = $props();

  const canonicalUrl = $derived(`${WHOISLEUTH_SITE_ORIGIN}${path}`);
  const imageUrl = $derived(`${WHOISLEUTH_SITE_ORIGIN}${imagePath}`);
  const robots = $derived(indexable
    ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    : 'noindex, nofollow');
  const schemaJson = $derived(JSON.stringify(website
    ? {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'WHOISleuth',
        url: `${WHOISLEUTH_SITE_ORIGIN}/`,
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
  <meta property="og:image" content={imageUrl}>
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="640">
  <meta property="og:image:alt" content={imageAlt}>
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content={title}>
  <meta name="twitter:description" content={description}>
  <meta name="twitter:image" content={imageUrl}>
  <meta name="twitter:image:alt" content={imageAlt}>
  {#if website || structuredData}<svelte:element this={'script'} type="application/ld+json">{schemaJson}</svelte:element>{/if}
</svelte:head>
