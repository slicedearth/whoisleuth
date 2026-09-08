// Covers lib/favicon.mts's extractIconUrls - discovering the favicon a page
// actually declares via <link rel="...icon...">, rather than only probing
// /favicon.ico. Declared image candidates retain the same bounded fallback.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildFaviconCandidates, extractIconUrls, fetchFaviconHash } from '../lib/favicon.mts';
import { MAX_FAVICON_BYTES, MAX_FAVICON_CANDIDATES } from '../lib/outbound-request-bounds.mts';
import { EXACT_ONLY_GIF, EXACT_ONLY_SVG, faviconTransparencyFixtures } from './favicon-image-fixtures.mts';

const BASE = 'https://example.com/';

describe('extractIconUrls', () => {
  test('resolves a relative icon href against the page origin', () => {
    const html = '<link rel="icon" href="/assets/fav.png">';
    assert.deepEqual(extractIconUrls(html, BASE), ['https://example.com/assets/fav.png']);
  });

  test('resolves an absolute asset-host href', () => {
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

  test('uses native attributes, excludes inert links and requires an actual icon relation', () => {
    assert.deepEqual(extractIconUrls(`
      <!-- <link rel=icon href=/comment.png> -->
      <script/><link rel=icon href=/script.png></script>
      <template><link rel=icon href=/template.png></template>
      <link rel=not-an-icon href=/unrelated.png>
      <link rel=icon href="/real?a=1&amp;b=2">
    `, BASE), ['https://example.com/real?a=1&b=2']);
  });

  test('keeps bounded inline icons larger than the general attribute projection', () => {
    const uri = `data:image/svg+xml,${encodeURIComponent(EXACT_ONLY_SVG.toString().replace('/>', `${' '.repeat(5000)}/>`))}`;
    assert.deepEqual(extractIconUrls(`<link rel=icon href="${uri}">`, BASE), [uri]);
  });

  test('resolves page bases and preserves standard-icon priority within the candidate bound', () => {
    const html = `<base href="/assets/"><link rel=apple-touch-icon href=touch.png>${Array.from({ length: MAX_FAVICON_CANDIDATES + 1 }, (_, index) => `<link rel=icon href=${index}.png>`).join('')}`;
    assert.deepEqual(extractIconUrls(html, BASE), Array.from({ length: MAX_FAVICON_CANDIDATES }, (_, index) => `https://example.com/assets/${index}.png`));
  });
});

describe('favicon image admission', () => {
  test('shared HTTP error bodies cannot create favicon evidence or end candidate fallback', async () => {
    let calls = 0;
    for (const domain of ['alpha.example', 'beta.example']) {
      assert.equal(await fetchFaviconHash(domain, { fetcher: async () => {
        calls += 1;
        return new Response('<!doctype html><title>Unavailable</title><p>Try later</p>', { headers: { 'content-type': 'image/png' } });
      } }), null);
    }
    assert.equal(calls, MAX_FAVICON_CANDIDATES * 2);
  });

  test('continues after HTML and retains valid exact-only SVG and GIF bytes', async () => {
    for (const bytes of [EXACT_ONLY_SVG, EXACT_ONLY_GIF]) {
      let calls = 0;
      const result = await fetchFaviconHash('example.test', { fetcher: async () => {
        calls += 1;
        return new Response(calls === 1 ? '<h1>Not found</h1>' : new Uint8Array(bytes));
      } });
      assert.deepEqual(result, { hash: createHash('sha256').update(bytes).digest('hex'), phash: null });
      assert.equal(calls, 2);
    }
  });

  test('hashes declared inline images without a request and rejects disguised HTML', async () => {
    for (const bytes of [EXACT_ONLY_SVG, ...faviconTransparencyFixtures().map((fixture) => fixture.bytes)]) {
      const result = await fetchFaviconHash('example.test', {
        html: `<link rel=icon href="data:image/png;base64,${bytes.toString('base64')}">`,
        fetcher: async () => { throw new Error('Inline image must not request a candidate.'); },
      });
      assert.equal(result?.hash, createHash('sha256').update(bytes).digest('hex'));
    }
    let calls = 0;
    const result = await fetchFaviconHash('example.test', {
      html: `<link rel=icon href="data:image/png;base64,${Buffer.from('<html>Error</html>').toString('base64')}">`,
      fetcher: async () => { calls += 1; return new Response('', { status: 404 }); },
    });
    assert.equal(result, null);
    assert.equal(calls, MAX_FAVICON_CANDIDATES - 1);
  });

  test('rejects incomplete containers, embedded SVG error pages and over-bound data', async () => {
    const png = faviconTransparencyFixtures()[0]!.bytes;
    for (const bytes of [
      png.subarray(0, png.length - 1),
      Buffer.from(`<html><body>${EXACT_ONLY_SVG}</body></html>`),
      Buffer.from(`<title>Error</title>${EXACT_ONLY_SVG}`),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'),
      Buffer.alloc(MAX_FAVICON_BYTES + 1),
    ]) {
      let calls = 0;
      const result = await fetchFaviconHash('example.test', { fetcher: async () => {
        calls += 1;
        return new Response(new Uint8Array(bytes));
      } });
      assert.equal(result, null);
      assert.equal(calls, MAX_FAVICON_CANDIDATES);
    }
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
