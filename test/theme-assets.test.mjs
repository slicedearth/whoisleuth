import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the shared Signal Lens logo keeps its lens transparent and readable at favicon sizes', async () => {
  const svg = await readFile(new URL('../frontend/static/favicon.svg', import.meta.url), 'utf8');
  assert.match(svg, /<circle class="primary lens" cx="26" cy="26" r="17" fill="none"/);
  assert.doesNotMatch(svg, /<circle class="primary lens"[^>]+fill="#[0-9a-f]+"/i);
  assert.match(svg, /class="full"/);
  assert.match(svg, /d="m18 20 14-2-7 16-7-14Z"/);
  assert.match(svg, /class="compact"/);
  assert.match(svg, /@media\(max-width:20px\)/);
  assert.match(svg, /@media\(prefers-color-scheme:light\)/);
  assert.match(svg, /\.primary\{stroke:#075f9f\}/);
  assert.match(svg, /\.secondary-fill\{fill:#0b6e47\}/);
});

test('the website mark follows the selected theme and the README keeps it beside the wordmark', async () => {
  const component = await readFile(new URL('../frontend/src/lib/components/BrandMark.svelte', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(component, /class="primary"/);
  assert.match(component, /\.primary\{stroke:var\(--accent\)\}/);
  assert.match(component, /\.secondary\{stroke:var\(--accent2\)\}/);
  assert.match(component, /\.secondary-fill\{fill:var\(--accent2\)\}/);
  assert.match(
    readme,
    /^<h1 align="center"><img src="frontend\/static\/favicon\.svg" width="48" height="48" alt="" \/> WHOISleuth<\/h1>/,
  );
  assert.doesNotMatch(readme, /^<p align="center">\s*<img src="frontend\/static\/favicon\.svg"/);
});
