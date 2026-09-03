import { expect, test } from './fixtures';
import {
  NON_INDEXED_PRERENDERED_ROUTES,
  PUBLIC_PRERENDERED_ROUTES,
} from '../lib/prerendered-routes.mts';
import { WHOISLEUTH_SITE_ORIGIN } from '../lib/project-metadata.mts';
import { PUBLIC_REFERENCE_DESTINATIONS } from '../frontend/src/lib/public-reference-navigation.ts';
import { PUBLIC_RESOURCES } from '../frontend/src/lib/public-resources.ts';

type StructuredData = Record<string, unknown>;

function structuredDataDocuments(html: string): StructuredData[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)]
    .map((match) => JSON.parse(match[1]!) as StructuredData);
}

function schemaByType(documents: readonly StructuredData[], type: string): StructuredData | undefined {
  for (const document of documents) {
    if (document['@type'] === type) return document;
    const graph = document['@graph'];
    if (!Array.isArray(graph)) continue;
    const match = graph.find((item): item is StructuredData => (
      typeof item === 'object' && item !== null && item['@type'] === type
    ));
    if (match) return match;
  }
  return undefined;
}

test('public pages expose prerendered search and sharing metadata', async ({ request }) => {
  for (const path of PUBLIC_PRERENDERED_ROUTES) {
    const canonical = `${WHOISLEUTH_SITE_ORIGIN}${path === '/' ? '/' : path}`;
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    const html = await response.text();

    expect(html).toMatch(/<title>[^<]+<\/title>/u);
    expect(html).toContain(`<link rel="canonical" href="${canonical}"`);
    expect(html).toMatch(/<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/u);
    expect(html).toContain('<meta name="description"');
    expect(html).toContain('<meta name="robots" content="index, follow,');
    expect(html).toContain('<meta property="og:site_name" content="WHOISleuth"');
    expect(html).toContain('<meta property="og:url"');
    expect(html).toContain(`<meta property="og:image" content="${WHOISLEUTH_SITE_ORIGIN}/social-preview.png"`);
    expect(html).toContain('<meta property="og:image:width" content="1280"');
    expect(html).toContain('<meta property="og:image:height" content="640"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`<meta name="twitter:image" content="${WHOISLEUTH_SITE_ORIGIN}/social-preview.png"`);
    expect(html).toMatch(/WHOISleuth \d+\.\d+\.\d+ · build (?:[a-f0-9]{7}|local)/u);
    expect(html).toMatch(/href="https:\/\/github\.com\/slicedearth\/whoisleuth(?:\/tree\/[a-f0-9]{7,64})?"/u);
    const schemas = structuredDataDocuments(html);

    if (path === '/') {
      expect(schemaByType(schemas, 'WebSite')).toEqual({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'WHOISleuth',
        url: `${WHOISLEUTH_SITE_ORIGIN}/`,
      });
    }

    if (path === '/resources') {
      const collection = schemaByType(schemas, 'CollectionPage');
      expect(collection).toMatchObject({ '@context': 'https://schema.org' });
      expect(collection?.hasPart).toHaveLength(PUBLIC_RESOURCES.length);
      expect(schemaByType(schemas, 'FAQPage')).toBeUndefined();
    }

    const referenceDestination = PUBLIC_REFERENCE_DESTINATIONS.find((item) => item.href === path);
    if (referenceDestination) {
      const breadcrumb = schemaByType(schemas, 'BreadcrumbList');
      expect(breadcrumb).toBeTruthy();
      const items = breadcrumb?.itemListElement as StructuredData[];
      expect(items[0]).toMatchObject({ position: 1, name: 'Home', item: `${WHOISLEUTH_SITE_ORIGIN}/` });
      expect(items[1]).toMatchObject({ position: 2, name: 'Resources', item: `${WHOISLEUTH_SITE_ORIGIN}/resources` });
      if (path === '/resources') {
        expect(items).toHaveLength(2);
      } else {
        expect(items).toHaveLength(3);
        expect(items[2]).toMatchObject({ position: 3, name: referenceDestination.label, item: canonical });
      }
    }
  }
});

test('legacy Guide URLs redirect to the consolidated Resources canonical', async ({ request }) => {
  const response = await request.get('/guide', { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe('/resources');
});

test('sign-in and protected console shells are excluded from search', async ({ request }) => {
  for (const path of NON_INDEXED_PRERENDERED_ROUTES) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    if (path !== '/login' && path !== '/contact') expect(html).not.toContain('Start new work, continue something saved');
  }
});

test('crawler files expose only public pages', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /api/');
  expect(robots).toContain('Disallow: /.netlify/functions/');
  expect(robots).toContain(`Sitemap: ${WHOISLEUTH_SITE_ORIGIN}/sitemap.xml`);
  expect(robots).not.toContain('Disallow: /login');

  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of PUBLIC_PRERENDERED_ROUTES) {
    const canonical = `${WHOISLEUTH_SITE_ORIGIN}${path === '/' ? '/' : path}`;
    expect(sitemap).toContain(`<loc>${canonical}</loc>`);
  }
  expect(sitemap.match(/<loc>/gu)).toHaveLength(PUBLIC_PRERENDERED_ROUTES.length);
  for (const path of NON_INDEXED_PRERENDERED_ROUTES) {
    expect(sitemap).not.toContain(`${WHOISLEUTH_SITE_ORIGIN}${path}`);
  }
  expect(sitemap).not.toContain('https://whoisleuth.com/');
});
