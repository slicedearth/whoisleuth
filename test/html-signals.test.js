// Covers lib/html-signals.js - the regex-based signals pulled from an
// already-fetched homepage HTML (page title, password field, phishing
// language, external asset hotlinking). Pure text-in/object-out, no
// network access needed.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_FORM_ACTION_ORIGINS,
  MAX_FORMS,
  MAX_IDENTITY_TAGS,
  PAGE_IDENTITY_VERSION,
  extractHtmlSignals,
  extractPageIdentity,
} = require('../lib/html-signals');

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
    assert.equal(result.pageTitle, 'Example');
    assert.equal(result.hasPasswordField, true);
  });
});
