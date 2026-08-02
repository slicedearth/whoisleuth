import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const APPROVED_MARK_SHA256 = '4510a0e616d436a95968399e1d3a53dbfab59c72a1087df30c117b31dee757bf';

test('the shared WHOISleuth mark preserves the approved vector source', async () => {
  const svg = await readFile(new URL('../frontend/static/favicon.svg', import.meta.url), 'utf8');
  const paths = svg.match(/<path\b/g) ?? [];

  assert.match(svg, /<svg[^>]+viewBox="34 38 448 448"/);
  assert.equal(paths.length, 8);
  assert.doesNotMatch(svg, /<(?:image|script|foreignObject)\b/i);
  assert.doesNotMatch(svg, /data:image|(?:xlink:)?href=/i);
  assert.doesNotMatch(svg, /<!DOCTYPE|<!ENTITY/i);
  assert.equal(createHash('sha256').update(svg).digest('hex'), APPROVED_MARK_SHA256);
});

test('the website, browser favicon, and README use the same approved vector', async () => {
  const component = await readFile(new URL('../frontend/src/lib/components/BrandMark.svelte', import.meta.url), 'utf8');
  const appHtml = await readFile(new URL('../frontend/src/app.html', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(component, /src="\/favicon\.svg"/);
  assert.match(component, /alt=""/);
  assert.match(appHtml, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  assert.ok(
    appHtml.indexOf('%sveltekit.head%') < appHtml.indexOf('<script src="/theme-init.js"></script>'),
    'the generated CSP meta policy must precede theme initialization',
  );
  assert.match(
    readme,
    /^<h1 align="center"><img src="frontend\/static\/favicon\.svg" width="44" height="44" align="middle" alt="" \/>&nbsp;WHOISleuth<\/h1>/,
  );
  assert.doesNotMatch(readme, /^<p align="center">\s*<img src="frontend\/static\/favicon\.svg"/);
});
