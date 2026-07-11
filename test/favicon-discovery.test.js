// Covers lib/favicon.js's extractIconUrls - discovering the favicon a page
// actually declares via <link rel="...icon...">, rather than only probing
// /favicon.ico. Motivated by real sites (e.g. npm) that serve no
// /favicon.ico and only point to a CDN PNG this way.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractIconUrls, buildFaviconCandidates } = require('../lib/favicon');

const BASE = 'https://example.com/';

describe('extractIconUrls', () => {
  test('resolves a relative icon href against the page origin', () => {
    const html = '<link rel="icon" href="/assets/fav.png">';
    assert.deepEqual(extractIconUrls(html, BASE), ['https://example.com/assets/fav.png']);
  });

  test('resolves an absolute CDN href (the npm case)', () => {
    const html = '<link rel="icon" type="image/png" href="https://static.example-cdn.com/abc.png">';
    assert.deepEqual(extractIconUrls(html, BASE), ['https://static.example-cdn.com/abc.png']);
  });

  test('accepts "shortcut icon" and protocol-relative hrefs', () => {
    const html = '<link rel="shortcut icon" href="//cdn.example.com/f.ico">';
    assert.deepEqual(extractIconUrls(html, BASE), ['https://cdn.example.com/f.ico']);
  });

  test('orders standard icons ahead of apple-touch-icon', () => {
    const html = `
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="icon" href="/standard.png">
    `;
    assert.deepEqual(extractIconUrls(html, BASE), [
      'https://example.com/standard.png',
      'https://example.com/touch.png',
    ]);
  });

  test('passes data: URIs through verbatim', () => {
    const html = '<link rel="icon" href="data:image/png;base64,AAAA">';
    assert.deepEqual(extractIconUrls(html, BASE), ['data:image/png;base64,AAAA']);
  });

  test('ignores non-icon links and links without an href', () => {
    const html = `
      <link rel="stylesheet" href="/style.css">
      <link rel="preconnect" href="https://fonts.example.com">
      <link rel="icon">
    `;
    assert.deepEqual(extractIconUrls(html, BASE), []);
  });

  test('drops non-http(s) schemes like javascript:', () => {
    const html = `
      <link rel="icon" href="javascript:alert(1)">
      <link rel="icon" href="/ok.png">
    `;
    assert.deepEqual(extractIconUrls(html, BASE), ['https://example.com/ok.png']);
  });

  test('returns an empty list for HTML with no link tags', () => {
    assert.deepEqual(extractIconUrls('<html><body>no links</body></html>', BASE), []);
  });
});

describe('buildFaviconCandidates', () => {
  test('falls back to both conventional ICO and SVG paths', () => {
    assert.deepEqual(buildFaviconCandidates('example.com'), [
      'https://example.com/favicon.ico',
      'https://example.com/favicon.svg',
      'http://example.com/favicon.ico',
      'http://example.com/favicon.svg',
    ]);
  });
});
