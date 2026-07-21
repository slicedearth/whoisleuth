// Covers lib/html-signals.mts - the regex-based signals pulled from an
// already-fetched homepage HTML (page title, password field, phishing
// language, external asset hotlinking). Pure text-in/object-out, no
// network access needed.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_FORM_ACTION_ORIGINS,
  MAX_FORMS,
  MAX_CONTACT_DOMAINS,
  MAX_EMBEDDED_ORIGINS,
  MAX_IDENTITY_TAGS,
  MAX_RESOURCE_ORIGINS,
  MAX_RESOURCE_TAGS,
  MAX_TRACKING_IDENTIFIERS,
  PAGE_IDENTITY_VERSION,
  extractHtmlSignals,
  extractPageIdentity,
} = require('../lib/html-signals.mts');

describe('pageTitle', () => {
  test('extracts and trims a <title> tag', () => {
    const html = '<html><head><title>  Acme Bank - Secure Login  </title></head></html>';
    assert.equal(extractHtmlSignals(html, 'example.com').pageTitle, 'Acme Bank - Secure Login');
  });

  test('collapses internal whitespace/newlines', () => {
    const html = '<title>Acme\n  Bank\tLogin</title>';
    assert.equal(extractHtmlSignals(html, 'example.com').pageTitle, 'Acme Bank Login');
  });

  test('strips C0 and DEL controls before retaining a title', () => {
    const html = '<title>Account\x00\x07 review\x7f centre</title>';
    const title = extractHtmlSignals(html, 'example.com').pageTitle;
    assert.equal(title, 'Account review centre');
    assert.equal(/[\x00-\x1f\x7f]/.test(title), false);
  });

  test('is null when there is no title tag', () => {
    const html = '<html><body>no title here</body></html>';
    assert.equal(extractHtmlSignals(html, 'example.com').pageTitle, null);
  });

  test('is null for an empty title tag', () => {
    assert.equal(extractHtmlSignals('<title></title>', 'example.com').pageTitle, null);
  });

  test('truncates a very long title', () => {
    const longTitle = 'A'.repeat(300);
    const result = extractHtmlSignals(`<title>${longTitle}</title>`, 'example.com').pageTitle;
    assert.ok(result.length <= 201); // 200 chars + the ellipsis character
    assert.ok(result.endsWith('…'));
  });
});

describe('hasPasswordField', () => {
  test('detects a password input regardless of attribute order/quoting', () => {
    assert.equal(extractHtmlSignals('<input type="password" name="pw">', 'example.com').hasPasswordField, true);
    assert.equal(extractHtmlSignals("<input name='pw' type='password'>", 'example.com').hasPasswordField, true);
  });

  test('is false with no password field', () => {
    assert.equal(extractHtmlSignals('<input type="text" name="q">', 'example.com').hasPasswordField, false);
  });
});

describe('phishingLanguageMatch', () => {
  test('matches known urgency/credential-harvesting phrasing', () => {
    const html = '<body>Please verify your account to continue.</body>';
    assert.equal(extractHtmlSignals(html, 'example.com').phishingLanguageMatch, 'verify your account');
  });

  test('is case-insensitive', () => {
    const html = '<body>SECURITY ALERT: unusual activity detected</body>';
    assert.equal(extractHtmlSignals(html, 'example.com').phishingLanguageMatch, 'SECURITY ALERT');
  });

  test('is null for ordinary copy', () => {
    const html = '<body>Welcome to our site. Browse our products below.</body>';
    assert.equal(extractHtmlSignals(html, 'example.com').phishingLanguageMatch, null);
  });

  test('retained phrase text cannot contain control characters', () => {
    const match = extractHtmlSignals('<body>security alert\x07</body>', 'example.com').phishingLanguageMatch;
    assert.equal(match, 'security alert');
    assert.equal(/[\x00-\x1f\x7f]/.test(match), false);
  });
});

describe('externalAssetHosts', () => {
  test('collects hosts from absolute img/script/link src/href, deduped', () => {
    const html = `
      <img src="https://evil-cdn.example/logo.png">
      <script src="//evil-cdn.example/app.js"></script>
      <link rel="stylesheet" href="https://other.example/style.css">
    `;
    const hosts = extractHtmlSignals(html, 'lookalike.test').externalAssetHosts;
    assert.deepEqual([...hosts].sort(), ['evil-cdn.example', 'other.example']);
  });

  test('ignores relative URLs (same-origin, nothing external to extract)', () => {
    const html = '<img src="/img/logo.png"><script src="app.js"></script>';
    assert.deepEqual(extractHtmlSignals(html, 'example.com').externalAssetHosts, []);
  });

  test('excludes the domain\'s own host (with or without a www. prefix)', () => {
    const html = '<img src="https://www.example.com/logo.png"><img src="https://example.com/hero.png">';
    assert.deepEqual(extractHtmlSignals(html, 'example.com').externalAssetHosts, []);
  });

  test('only looks at img/script/link tags, not ordinary <a href> links', () => {
    const html = '<a href="https://example.com/real-site">Visit the real site</a>';
    assert.deepEqual(extractHtmlSignals(html, 'lookalike.test').externalAssetHosts, []);
  });

  test('rejects control-bearing external asset hosts', () => {
    const html = '<img src="https://evil\x07.example/logo.png"><img src="https://safe.example/logo.png">';
    assert.deepEqual(extractHtmlSignals(html, 'lookalike.test').externalAssetHosts, ['safe.example']);
  });
});

describe('pageIdentity', () => {
  const observedAt = '2026-07-13T04:05:06.000Z';

  function identity(html, options = {}) {
    return extractPageIdentity(html, 'example.com', {
      baseUrl: 'https://example.com/start/index.html',
      observedAt,
      ...options,
    });
  }

  test('extracts bounded document and Open Graph identity metadata', () => {
    const result = identity(`
      <html lang="EN-au"><head>
        <link rel="alternate canonical" href="/account?token=secret#section">
        <meta property="og:title" content=" Example Account Centre ">
        <meta property="og:site_name" content="Example Portal">
        <meta property="og:url" content="https://www.example.com/welcome?campaign=private">
        <meta name="generator" content="Example CMS 4">
      </head></html>
    `);

    assert.equal(result.identityVersion, PAGE_IDENTITY_VERSION);
    assert.equal(result.version, 1);
    assert.equal(result.status, 'success');
    assert.equal(result.observedAt, observedAt);
    assert.equal(result.source, 'html');
    assert.equal(result.documentLanguage, 'en-au');
    assert.deepEqual(result.canonical, {
      url: 'https://example.com/account', queryOmitted: true, pathTruncated: false,
    });
    assert.equal(result.openGraph.title, 'Example Account Centre');
    assert.equal(result.openGraph.siteName, 'Example Portal');
    assert.deepEqual(result.openGraph.url, {
      url: 'https://www.example.com/welcome', queryOmitted: true, pathTruncated: false,
    });
    assert.equal(result.generator, 'Example CMS 4');
    assert.match(result.limitations.join(' '), /Query strings and fragments were omitted/);
    assert.doesNotMatch(JSON.stringify(result), /secret|campaign=private/);
  });

  test('resolves a meta-refresh target against the final response URL', () => {
    const result = identity('<meta content="0; URL=../login?session=secret" http-equiv="refresh">');
    assert.deepEqual(result.metaRefresh, {
      url: 'https://example.com/login', queryOmitted: true, pathTruncated: false,
    });
  });

  test('rejects credential-bearing, non-HTTP, control-bearing, and empty URLs', () => {
    const result = identity(`
      <link rel="canonical" href="https://user:password@example.com/private">
      <meta property="og:url" content="javascript:alert(1)">
      <meta http-equiv="refresh" content="0; url=https://safe.example/\u0007bad">
      <form action="   "></form>
    `);
    assert.equal(result.canonical, null);
    assert.equal(result.openGraph.url, null);
    assert.equal(result.metaRefresh, null);
    assert.equal(result.forms.count, 1);
    assert.equal(result.diagnostics.discardedUrls, 3);
    assert.doesNotMatch(JSON.stringify(result), /password/);
  });

  test('normalizes forms without retaining action paths or query values', () => {
    const result = identity(`
      <form method="POST" action="/session?csrf=secret"></form>
      <form method="post" action="http://collect.example/submit?credential=secret"></form>
      <form action="https://collect.example/other"></form>
      <form></form>
    `);
    assert.deepEqual(result.forms, {
      count: 4,
      postCount: 2,
      insecureActionCount: 1,
      externalActionOrigins: ['http://collect.example', 'https://collect.example'],
      truncated: false,
    });
    assert.doesNotMatch(JSON.stringify(result.forms), /session|submit|credential|csrf|secret/);
  });

  test('sorts and deduplicates external form-action origins', () => {
    const result = identity(`
      <form action="https://z.example/one"></form>
      <form action="https://a.example/two"></form>
      <form action="https://z.example/three"></form>
    `);
    assert.deepEqual(result.forms.externalActionOrigins, ['https://a.example', 'https://z.example']);
  });

  test('bounds forms while preserving explicit partial provenance', () => {
    const html = Array.from({ length: MAX_FORMS + 1 }, (_, index) => `<form method="post" action="/form-${index}"></form>`).join('');
    const result = identity(html);
    assert.equal(result.forms.count, MAX_FORMS);
    assert.equal(result.forms.postCount, MAX_FORMS);
    assert.equal(result.forms.truncated, true);
    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.match(result.limitations.join(' '), new RegExp(`first ${MAX_FORMS} forms`));
  });

  test('bounds external form-action origins independently of form count', () => {
    const html = Array.from({ length: MAX_FORM_ACTION_ORIGINS + 1 }, (_, index) => `<form action="https://external-${index}.example/path"></form>`).join('');
    const result = identity(html);
    assert.equal(result.forms.count, MAX_FORM_ACTION_ORIGINS + 1);
    assert.equal(result.forms.externalActionOrigins.length, MAX_FORM_ACTION_ORIGINS);
    assert.equal(result.forms.truncated, true);
    assert.equal(result.status, 'partial');
  });

  test('reports an upstream body cap as partial even when extracted fields are valid', () => {
    const result = identity('<html lang="en"><form></form></html>', { sourceTruncated: true });
    assert.equal(result.documentLanguage, 'en');
    assert.equal(result.status, 'partial');
    assert.equal(result.truncated, true);
    assert.match(result.limitations.join(' '), /body capture reached its byte limit/);
  });

  test('caps the number and length of inspected tags', () => {
    const tooManyTags = Array.from({ length: MAX_IDENTITY_TAGS + 1 }, () => '<meta name="generator" content="cms">').join('');
    const countLimited = identity(tooManyTags);
    assert.equal(countLimited.diagnostics.tagsExamined, MAX_IDENTITY_TAGS);
    assert.equal(countLimited.status, 'partial');

    const oversized = identity(`<meta name="generator" content="${'x'.repeat(5000)}">`);
    assert.equal(oversized.generator, null);
    assert.equal(oversized.status, 'partial');
  });

  test('replaces an overlong retained path with its bounded origin', () => {
    const result = identity(`<link rel="canonical" href="https://example.com/${'a'.repeat(2500)}?secret=value">`);
    assert.deepEqual(result.canonical, {
      url: 'https://example.com/', queryOmitted: true, pathTruncated: true,
    });
    assert.equal(result.status, 'partial');
    assert.match(result.limitations.join(' '), /path was replaced by its origin/);
  });

  test('falls back safely when the supplied domain and base URL are invalid', () => {
    const result = extractPageIdentity('<link rel="canonical" href="/safe">', '\u0000', {
      baseUrl: 'not a URL', observedAt,
    });
    assert.equal(result.canonical.url, 'https://invalid.example/safe');
  });

  test('returns an empty, complete summary when no identity tags are present', () => {
    const result = identity('<main>ordinary text</main>');
    assert.equal(result.status, 'success');
    assert.equal(result.complete, true);
    assert.equal(result.documentLanguage, null);
    assert.equal(result.canonical, null);
    assert.deepEqual(result.openGraph, { title: null, siteName: null, url: null });
    assert.deepEqual(result.forms.externalActionOrigins, []);
  });

  test('can leave page identity absent while preserving established flat signals', () => {
    const result = extractHtmlSignals('<title>Example</title><input type="password">', 'example.com', {
      includePageIdentity: false,
    });
    assert.equal(result.pageIdentity, null);
    assert.equal(result.technologyProfile, null);
    assert.equal(result.pageTitle, 'Example');
    assert.equal(result.hasPasswordField, true);
  });

  test('derives bounded technology indicators from the same captured HTML', () => {
    const result = extractHtmlSignals('<meta name="generator" content="Hugo 0.1"><astro-island></astro-island>', 'example.com', {
      httpServer: 'Caddy', observedAt,
    });
    assert.deepEqual(result.technologyProfile.findings.map((item) => item.id), ['hugo', 'astro', 'caddy']);
    assert.equal(result.technologyProfile.source, 'derived');
    assert.equal(result.technologyProfile.observedAt, observedAt);
  });

  test('can omit technology analysis while preserving page identity', () => {
    const result = extractHtmlSignals('<meta name="generator" content="Hugo 0.1">', 'example.com', {
      includeTechnologyProfile: false,
    });
    assert.equal(result.pageIdentity.source, 'html');
    assert.equal(result.technologyProfile, null);
  });

  test('summarizes normalized resource types and external origins without retaining paths', () => {
    const result = identity(`
      <img src="https://cdn.example/images/logo.png?token=secret">
      <img src="https://cdn.example/images/logo.png?token=other">
      <script src="/assets/app.js"></script>
      <link rel="stylesheet" href="https://style.example/css/main.css">
      <link rel="canonical" href="/not-a-resource">
      <video src="https://media.example/movie.mp4" poster="https://cdn.example/poster.jpg"></video>
    `);
    assert.equal(result.resources.count, 5);
    assert.deepEqual(result.resources.byType, {
      image: 2, script: 1, stylesheet: 1, link: 0, frame: 0, media: 1, object: 0,
    });
    assert.deepEqual(result.resources.externalOrigins, [
      'https://cdn.example', 'https://media.example', 'https://style.example',
    ]);
    assert.doesNotMatch(JSON.stringify(result.resources), /logo\.png|app\.js|main\.css|movie\.mp4|secret|token=/);
  });

  test('retains bounded embedded origins separately from general resources', () => {
    const result = identity(`
      <iframe src="https://frame.example/login?secret=value"></iframe>
      <object data="https://object.example/plugin.bin"></object>
      <embed src="/same-origin.bin">
    `);
    assert.deepEqual(result.embeddedOrigins, ['https://frame.example', 'https://object.example']);
    assert.equal(result.resources.byType.frame, 1);
    assert.equal(result.resources.byType.object, 2);
    assert.doesNotMatch(JSON.stringify(result.embeddedOrigins), /login|plugin|secret/);
  });

  test('extracts only normalized domains from mail contact links', () => {
    const result = identity(`
      <a href="mailto:person@example.com,other@Sub.Example.com?subject=private">Contact</a>
      <a href="mailto:user@bücher.example">International contact</a>
      <a href="mailto:local@localhost">Invalid local address</a>
      <a href="mailto:not-an-address">Invalid</a>
    `);
    assert.deepEqual(result.contactDomains, ['example.com', 'sub.example.com', 'xn--bcher-kva.example']);
    assert.doesNotMatch(JSON.stringify(result.contactDomains), /person|other|user|subject|private/);
  });

  test('summarizes explicit and risky download destinations without retaining filenames', () => {
    const result = identity(`
      <a download href="https://files.example/reports/ordinary.pdf?account=secret">Report</a>
      <a href="https://payload.example/releases/tool.EXE?token=secret">Installer</a>
      <a href="/archive.zip">Archive</a>
      <a href="/ordinary-page">Page</a>
    `);
    assert.deepEqual(result.downloads, {
      count: 3,
      explicitCount: 1,
      riskyCount: 2,
      externalOrigins: ['https://files.example', 'https://payload.example'],
      riskyFileTypes: ['exe', 'zip'],
      truncated: false,
    });
    assert.doesNotMatch(JSON.stringify(result.downloads), /ordinary\.pdf|tool\.EXE|archive\.zip|account|token|secret/);
  });

  test('extracts, normalizes, deduplicates, and sorts recognized tracking identifiers', () => {
    const result = identity(`
      <script src="https://metrics.example/tag.js?id=gtm-ab12"></script>
      <script>window.ids = ['GTM-AB12', 'G-ABC1234567', 'ua-123456-7', 'AW-123456789'];</script>
    `);
    assert.deepEqual(result.trackingIdentifiers, [
      { type: 'advertising-property', value: 'AW-123456789' },
      { type: 'analytics-property', value: 'G-ABC1234567' },
      { type: 'legacy-analytics-property', value: 'UA-123456-7' },
      { type: 'tag-container', value: 'GTM-AB12' },
    ]);
  });

  test('caps external resource origins and reports partial provenance', () => {
    const html = Array.from({ length: MAX_RESOURCE_ORIGINS + 1 }, (_, index) => `<script src="https://cdn-${index}.example/app.js"></script>`).join('');
    const result = identity(html);
    assert.equal(result.resources.externalOrigins.length, MAX_RESOURCE_ORIGINS);
    assert.equal(result.resources.truncated, true);
    assert.equal(result.status, 'partial');
    assert.match(result.limitations.join(' '), /external resource origins were retained/);
  });

  test('caps embedded origins and contact domains independently', () => {
    const frames = Array.from({ length: MAX_EMBEDDED_ORIGINS + 1 }, (_, index) => `<iframe src="https://frame-${index}.example/"></iframe>`).join('');
    const contacts = Array.from({ length: MAX_CONTACT_DOMAINS + 1 }, (_, index) => `<a href="mailto:user@contact-${index}.example">Mail</a>`).join('');
    const result = identity(`${frames}${contacts}`);
    assert.equal(result.embeddedOrigins.length, MAX_EMBEDDED_ORIGINS);
    assert.equal(result.contactDomains.length, MAX_CONTACT_DOMAINS);
    assert.equal(result.status, 'partial');
  });

  test('caps relationship tags, srcset candidates, and tracking identifiers', () => {
    const tags = Array.from({ length: MAX_RESOURCE_TAGS + 1 }, () => '<img src="/same.png">').join('');
    const srcset = Array.from({ length: 21 }, (_, index) => `/image-${index}.png ${index + 1}w`).join(',');
    const trackers = Array.from({ length: MAX_TRACKING_IDENTIFIERS + 1 }, (_, index) => `GTM-${index.toString(36).toUpperCase().padStart(4, '0')}`).join(' ');
    const result = identity(`${tags}<img srcset="${srcset}"><script>${trackers}</script>`);
    assert.equal(result.resources.truncated, true);
    assert.equal(result.trackingIdentifiers.length, MAX_TRACKING_IDENTIFIERS);
    assert.equal(result.status, 'partial');
  });

  test('skips data-bearing srcsets rather than parsing encoded commas as resources', () => {
    const result = identity('<img srcset="data:image/svg+xml,%3Csvg%3E,%3C/svg%3E 1x, /real.png 2x">');
    assert.equal(result.resources.count, 0);
    assert.equal(result.resources.truncated, true);
    assert.equal(result.status, 'partial');
    assert.match(result.limitations.join(' '), /srcset URL candidates could not be safely enumerated/);
  });

  test('caps ordinary srcset candidates deterministically', () => {
    const srcset = Array.from({ length: 21 }, (_, index) => `/image-${index}.png ${index + 1}w`).join(',');
    const result = identity(`<img srcset="${srcset}">`);
    assert.equal(result.resources.count, 20);
    assert.equal(result.resources.truncated, true);
    assert.equal(result.status, 'partial');
  });

  test('does not treat comments or raw-text element bodies as live markup', () => {
    const result = identity(`
      <!-- <iframe src="https://comment.example/"></iframe> -->
      <!-- GTM-NOPE -->
      <script>const fake = '<form action="https://script.example/submit"></form><img src="https://script.example/pixel.png">'; const tracker = 'GTM-REAL';</script>
      <template><a href="mailto:hidden@template.example">Hidden</a> GTM-HIDE</template>
      <iframe src="https://real.example/frame"></iframe>
    `);
    assert.deepEqual(result.embeddedOrigins, ['https://real.example']);
    assert.deepEqual(result.resources.externalOrigins, ['https://real.example']);
    assert.deepEqual(result.contactDomains, []);
    assert.equal(result.forms.count, 0);
    assert.deepEqual(result.trackingIdentifiers, [{ type: 'tag-container', value: 'GTM-REAL' }]);
  });
});
