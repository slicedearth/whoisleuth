import { expect, test } from './fixtures';

const publicPages = [
  {
    path: '/',
    canonical: 'https://whoisleuth.com/',
    title: 'WHOISleuth | WHOIS, RDAP and domain intelligence',
    heading: 'Understand a domain.',
  },
  {
    path: '/demo',
    canonical: 'https://whoisleuth.com/demo',
    title: 'Domain investigation demo | WHOISleuth',
    heading: 'Use the investigation workflow without touching a live target.',
  },
  {
    path: '/privacy',
    canonical: 'https://whoisleuth.com/privacy',
    title: 'Privacy policy | WHOISleuth',
    heading: 'Privacy policy',
  },
  {
    path: '/terms',
    canonical: 'https://whoisleuth.com/terms',
    title: 'Terms and acceptable use | WHOISleuth',
    heading: 'Terms and acceptable use',
  },
  {
    path: '/request-policy',
    canonical: 'https://whoisleuth.com/request-policy',
    title: 'Outbound request policy | WHOISleuth',
    heading: 'Outbound request policy',
  },
  {
    path: '/resources',
    canonical: 'https://whoisleuth.com/resources',
    title: 'Domain investigation resources and guide | WHOISleuth',
    heading: 'Learn the workflow. Understand the evidence.',
  },
  {
    path: '/resources/open-source-domain-intelligence',
    canonical: 'https://whoisleuth.com/resources/open-source-domain-intelligence',
    title: 'Open-source domain intelligence without a hidden verdict | WHOISleuth',
    heading: 'Open-source domain intelligence without a hidden verdict',
  },
  {
    path: '/resources/rdap-vs-whois',
    canonical: 'https://whoisleuth.com/resources/rdap-vs-whois',
    title: 'RDAP versus WHOIS: why registration sources disagree | WHOISleuth',
    heading: 'RDAP versus WHOIS: why registration sources disagree',
  },
  {
    path: '/resources/lookalike-domain-checker',
    canonical: 'https://whoisleuth.com/resources/lookalike-domain-checker',
    title: 'Find and review lookalike domains without treating similarity as abuse | WHOISleuth',
    heading: 'Find and review lookalike domains without treating similarity as abuse',
  },
  {
    path: '/resources/certificate-transparency-brand-protection',
    canonical: 'https://whoisleuth.com/resources/certificate-transparency-brand-protection',
    title: 'Use Certificate Transparency as a brand-protection lead | WHOISleuth',
    heading: 'Use Certificate Transparency as a brand-protection lead',
  },
  {
    path: '/resources/domain-investigation-workflow',
    canonical: 'https://whoisleuth.com/resources/domain-investigation-workflow',
    title: 'A source-aware domain investigation workflow | WHOISleuth',
    heading: 'A source-aware domain investigation workflow',
  },
  {
    path: '/resources/bulk-domain-comparison',
    canonical: 'https://whoisleuth.com/resources/bulk-domain-comparison',
    title: 'Compare multiple domains without flattening incomplete evidence | WHOISleuth',
    heading: 'Compare multiple domains without flattening incomplete evidence',
  },
  {
    path: '/resources/ip-asn-investigation',
    canonical: 'https://whoisleuth.com/resources/ip-asn-investigation',
    title: 'Add IP and ASN context without claiming the origin host | WHOISleuth',
    heading: 'Add IP and ASN context without claiming the origin host',
  },
  {
    path: '/resources/local-first-osint',
    canonical: 'https://whoisleuth.com/resources/local-first-osint',
    title: 'Why local-first storage matters for domain investigations | WHOISleuth',
    heading: 'Why local-first storage matters for domain investigations',
  },
] as const;

test('public pages expose prerendered search and sharing metadata', async ({ request }) => {
  for (const expected of publicPages) {
    const response = await request.get(expected.path);
    expect(response.ok(), expected.path).toBe(true);
    const html = await response.text();

    expect(html).toContain(`<title>${expected.title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${expected.canonical}"`);
    expect(html).toContain('<meta name="description"');
    expect(html).toContain('<meta name="robots" content="index, follow,');
    expect(html).toContain('<meta property="og:site_name" content="WHOISleuth"');
    expect(html).toContain('<meta property="og:url"');
    expect(html).toContain('<meta property="og:image" content="https://whoisleuth.com/social-preview.png"');
    expect(html).toContain('<meta property="og:image:width" content="1280"');
    expect(html).toContain('<meta property="og:image:height" content="640"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<meta name="twitter:image" content="https://whoisleuth.com/social-preview.png"');
    expect(html).toContain(expected.heading);
    expect(html).toMatch(/WHOISleuth \d+\.\d+\.\d+ · build (?:[a-f0-9]{7}|local)/u);
    expect(html).toMatch(/href="https:\/\/github\.com\/slicedearth\/whoisleuth(?:\/tree\/[a-f0-9]{7,64})?"/u);

    if (expected.path === '/') {
      const schema = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1];
      expect(schema).toBeTruthy();
      expect(JSON.parse(schema!)).toEqual({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'WHOISleuth',
        url: 'https://whoisleuth.com/',
      });
    }

    if (expected.path === '/resources') {
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
  for (const path of ['/login', '/dashboard', '/brands', '/discover', '/bulk', '/lookup', '/monitor', '/registry-support']) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    if (path !== '/login') expect(html).not.toContain('Start new work, continue something saved');
  }
});

test('crawler files expose only public pages', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /api/');
  expect(robots).toContain('Disallow: /.netlify/functions/');
  expect(robots).toContain('Sitemap: https://whoisleuth.com/sitemap.xml');
  expect(robots).not.toContain('Disallow: /login');

  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const page of publicPages) expect(sitemap).toContain(`<loc>${page.canonical}</loc>`);
  expect(sitemap.match(/<loc>/gu)).toHaveLength(publicPages.length);
  for (const path of ['/login', '/dashboard', '/brands', '/discover', '/bulk', '/lookup', '/monitor', '/registry-support']) {
    expect(sitemap).not.toContain(`https://whoisleuth.com${path}`);
  }
});
