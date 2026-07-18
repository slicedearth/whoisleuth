import { expect, test } from './fixtures';

const publicPages = [
  {
    path: '/',
    canonical: 'https://whoisleuth.com/',
    title: 'WHOISleuth | WHOIS, RDAP and domain intelligence',
    heading: 'Investigate domains.',
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
    expect(html).toContain('<meta name="twitter:card" content="summary"');
    expect(html).toContain(expected.heading);

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
  }
});

test('sign-in and protected console shells are excluded from search', async ({ request }) => {
  for (const path of ['/login', '/dashboard', '/brands', '/discover', '/bulk', '/lookup', '/monitor', '/registry-support']) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    if (path !== '/login') expect(html).not.toContain('Investigation dashboard');
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
  for (const path of ['/login', '/dashboard', '/brands', '/discover', '/bulk', '/lookup', '/monitor', '/registry-support']) {
    expect(sitemap).not.toContain(`https://whoisleuth.com${path}`);
  }
});
