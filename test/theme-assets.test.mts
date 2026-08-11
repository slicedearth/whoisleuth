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

test('the website, browser favicons, and README use the same approved mark', async () => {
  const component = await readFile(new URL('../frontend/src/lib/components/BrandMark.svelte', import.meta.url), 'utf8');
  const approvedSvg = await readFile(new URL('../frontend/static/favicon.svg', import.meta.url), 'utf8');
  const appHtml = await readFile(new URL('../frontend/src/app.html', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const ico = await readFile(new URL('../frontend/static/favicon.ico', import.meta.url));

  const pathGeometry = (source: string) => [...source.matchAll(/<path\b[^>]*\bd="([^"]+)"/gsu)].map((match) => {
    const path = match[1] ?? '';
    return {
      commands: (path.match(/[a-z]/giu) ?? []).join(''),
      numbers: (path.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/gu) ?? []).map(Number),
    };
  });
  assert.match(component, /<svg[^>]+viewBox="34 38 448 448"/s);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /focusable="false"/);
  assert.match(component, /fill:var\(--brand-mark-primary\)/);
  assert.match(component, /fill:var\(--brand-mark-secondary\)/);
  assert.deepEqual(pathGeometry(component), pathGeometry(approvedSvg));
  assert.doesNotMatch(component, /<(?:image|script|foreignObject)\b|\{@html\}|(?:xlink:)?href=/i);
  assert.match(appHtml, /<link rel="icon" href="\/favicon\.ico" sizes="64x64">/);
  assert.match(appHtml, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  assert.deepEqual([...ico.subarray(0, 8)], [0, 0, 1, 0, 1, 0, 64, 64]);
  assert.ok(
    appHtml.indexOf('%sveltekit.head%') < appHtml.indexOf('<script src="/theme-init.js"></script>'),
    'the generated CSP meta policy must precede theme initialization',
  );
  assert.match(
    readme,
    /^<p align="center"><img src="frontend\/static\/favicon\.svg" width="64" height="64" alt="WHOISleuth mark" \/><\/p>\n<h1 align="center">WHOISleuth<\/h1>/,
  );
});
