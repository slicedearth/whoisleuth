import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { brandMarkSvg, brandLogoSvg } from '../packages/contracts/brand-identity.mts';

/** Regenerate the static identity assets from the same vectors used by Svelte. */
async function main() {
  if (process.argv.slice(2).join(' ') !== '--write') throw new Error('Usage: node tools/brand-assets.mts --write');
  const root = new URL('../frontend/static/', import.meta.url);
  const mark = brandMarkSvg();
  const logo = brandLogoSvg();
  const social = await readFile(new URL('social-preview.svg', root), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route('**/*', route => route.abort());
    const pictures: { size: number; bytes: Buffer }[] = [];
    for (const size of [16, 32, 48, 64]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${mark}`);
      pictures.push({ size, bytes: await page.screenshot({ type: 'png', omitBackground: true }) });
    }
    const header = Buffer.alloc(6 + pictures.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(pictures.length, 4);
    let offset = header.length;
    pictures.forEach(({ size, bytes }, index) => {
      const entry = 6 + index * 16;
      header[entry] = size; header[entry + 1] = size;
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
      offset += bytes.length;
    });
    await page.setViewportSize({ width: 1280, height: 640 });
    const renderedSocial = social.replace('<image href="logo.svg" x="70" y="58" width="340" height="60" />',
      logo.replace('<svg ', '<svg x="70" y="58" width="340" height="60" '));
    if (renderedSocial === social) throw new Error('Social preview must reference the shared logo asset.');
    await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${renderedSocial}`);
    const socialPng = await page.screenshot({ type: 'png' });
    await writeFile(new URL('favicon.svg', root), mark);
    await writeFile(new URL('logo.svg', root), logo);
    await writeFile(new URL('logo-light.svg', root), brandLogoSvg(true));
    await writeFile(new URL('favicon.ico', root), Buffer.concat([header, ...pictures.map(picture => picture.bytes)]));
    await writeFile(new URL('social-preview.png', root), socialPng);
  } finally { await browser.close(); }
  process.stdout.write('Updated the shared vector logo, four favicon sizes and social preview.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
