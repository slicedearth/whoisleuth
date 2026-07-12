// Covers lib/html-signals.js - the regex-based signals pulled from an
// already-fetched homepage HTML (page title, password field, phishing
// language, external asset hotlinking). Pure text-in/object-out, no
// network access needed.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractHtmlSignals } = require('../lib/html-signals');

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
