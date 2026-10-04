import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { brandMarkSvg, brandLogoSvg, BRAND_MARK_LENS, BRAND_MARK_LINKS, BRAND_MARK_NODES } from '../packages/contracts/brand-identity.mts';

test('static identity variants derive from the shared interface vectors without embedded resources', async () => {
  for (const [file, expected] of [['favicon.svg', brandMarkSvg()], ['logo.svg', brandLogoSvg()], ['logo-light.svg', brandLogoSvg(true)]] as const) {
    const svg = await readFile(new URL(`../frontend/static/${file}`, import.meta.url), 'utf8');
    assert.equal(svg, expected);
    for (const geometry of [BRAND_MARK_LENS, BRAND_MARK_LINKS, BRAND_MARK_NODES]) assert.ok(svg.includes(`d="${geometry}"`));
    assert.doesNotMatch(svg, /<(?:image|script|foreignObject)\b|data:image|(?:xlink:)?href=|<!DOCTYPE|<!ENTITY/i);
  }
  const component = await readFile(new URL('../frontend/src/lib/components/BrandMark.svelte', import.meta.url), 'utf8');
  assert.match(component, /from '\$lib\/brand-identity'/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /focusable="false"/);
  assert.match(component, /fill:var\(--brand-mark-primary\)/);
  assert.match(component, /fill:var\(--brand-mark-secondary\)/);
  assert.doesNotMatch(component, /\{@html\}|<(?:image|foreignObject)\b/i);
});

test('the favicon contains complete native-size PNG entries and public surfaces retain accessible identity', async () => {
  const appHtml = await readFile(new URL('../frontend/src/app.html', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const wordmark = await readFile(new URL('../frontend/src/lib/components/BrandWordmark.svelte', import.meta.url), 'utf8');
  const social = await readFile(new URL('../frontend/static/social-preview.svg', import.meta.url), 'utf8');
  const ico = await readFile(new URL('../frontend/static/favicon.ico', import.meta.url));
  assert.deepEqual([...ico.subarray(0, 6)], [0, 0, 1, 0, 4, 0]);
  let expectedOffset = 70;
  for (const [index, size] of [16, 32, 48, 64].entries()) {
    const offset = 6 + index * 16;
    assert.equal(ico[offset], size); assert.equal(ico[offset + 1], size);
    const bytes = ico.readUInt32LE(offset + 8), start = ico.readUInt32LE(offset + 12);
    assert.equal(start, expectedOffset); assert.ok(bytes > 24 && start + bytes <= ico.length);
    const png = ico.subarray(start, start + bytes);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
    expectedOffset += bytes;
  }
  assert.equal(expectedOffset, ico.length);
  assert.match(appHtml, /<link rel="icon" href="\/favicon\.ico" sizes="16x16 32x32 48x48 64x64">/);
  assert.match(appHtml, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  assert.match(wordmark, /class="sr-only">WHOISleuth<\/span>/);
  assert.match(wordmark, /from '\$lib\/brand-identity'/);
  assert.match(social, /<image href="logo\.svg"/);
  const head = appHtml.indexOf('%sveltekit.head%');
  const theme = appHtml.indexOf('<script src="/theme-init.js"></script>');
  assert.ok(head >= 0 && theme >= 0 && head < theme, 'the generated CSP policy precedes theme initialisation');
  assert.match(readme, /^<p align="center"><img src="frontend\/static\/favicon\.svg" width="64" height="64" alt="WHOISleuth mark" \/><\/p>\n<h1 align="center">WHOISleuth<\/h1>/);
});
