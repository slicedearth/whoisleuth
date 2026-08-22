import { expect, test } from './fixtures';
import {
  NON_INDEXED_PRERENDERED_ROUTES,
  PUBLIC_PRERENDERED_ROUTES,
} from '../lib/prerendered-routes.mts';
import { WHOISLEUTH_SITE_ORIGIN } from '../lib/project-metadata.mts';

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
    expect(html).toContain('<meta property="og:image" content="https://whoisleuth.com/social-preview.png"');
    expect(html).toContain('<meta property="og:image:width" content="1280"');
    expect(html).toContain('<meta property="og:image:height" content="640"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<meta name="twitter:image" content="https://whoisleuth.com/social-preview.png"');
    expect(html).toMatch(/WHOISleuth \d+\.\d+\.\d+ · build (?:[a-f0-9]{7}|local)/u);
    expect(html).toMatch(/href="https:\/\/github\.com\/slicedearth\/whoisleuth(?:\/tree\/[a-f0-9]{7,64})?"/u);

    if (path === '/') {
      const schema = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1];
      expect(schema).toBeTruthy();
      expect(JSON.parse(schema!)).toEqual({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'WHOISleuth',
        url: 'https://whoisleuth.com/',
      });
    }

    if (path === '/resources') {
      const schema = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1];
      expect(schema).toBeTruthy();
      const parsed = JSON.parse(schema!);
      expect(parsed).toMatchObject({ '@context': 'https://schema.org' });
      expect(parsed['@graph']).toHaveLength(2);
      const collection = parsed['@graph'].find((item: { '@type'?: string }) => item['@type'] === 'CollectionPage');
      const faq = parsed['@graph'].find((item: { '@type'?: string }) => item['@type'] === 'FAQPage');
      expect(collection?.hasPart).toHaveLength(8);
      expect(faq?.mainEntity).toHaveLength(21);
      expect(faq?.mainEntity[0]).toMatchObject({ '@type': 'Question', acceptedAnswer: { '@type': 'Answer' } });
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
  expect(robots).toContain('Sitemap: https://whoisleuth.com/sitemap.xml');
  expect(robots).not.toContain('Disallow: /login');

  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of PUBLIC_PRERENDERED_ROUTES) {
    const canonical = `${WHOISLEUTH_SITE_ORIGIN}${path === '/' ? '/' : path}`;
    expect(sitemap).toContain(`<loc>${canonical}</loc>`);
  }
  expect(sitemap.match(/<loc>/gu)).toHaveLength(PUBLIC_PRERENDERED_ROUTES.length);
  for (const path of NON_INDEXED_PRERENDERED_ROUTES) {
    expect(sitemap).not.toContain(`https://whoisleuth.com${path}`);
  }
});
