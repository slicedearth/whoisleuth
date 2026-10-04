/** Shared vector geometry for the interface and downloadable identity assets. */
export const BRAND_MARK_VIEWBOX = '0 0 64 64';
export const BRAND_MARK_LENS = 'M42 37L60 55Q63 58 60 61Q57 64 54 61L36 43ZM20 4H34Q37 4 39 6L49 16Q51 18 51 21V34Q51 37 49 39L39 49Q37 51 34 51H20Q17 51 15 49L5 39Q3 37 3 34V21Q3 18 5 16L15 6Q17 4 20 4ZM21 10Q19 10 18 11L10 19Q9 20 9 22V33Q9 35 10 36L18 44Q19 45 21 45H33Q35 45 36 44L44 36Q45 35 45 33V22Q45 20 44 19L36 11Q35 10 33 10Z';
export const BRAND_MARK_LINKS = 'M18.5 23H35.5L27 36.5Z';
export const BRAND_MARK_NODES = 'M22.7 23a4.2 4.2 0 1 1-8.4 0 4.2 4.2 0 1 1 8.4 0ZM39.7 23a4.2 4.2 0 1 1-8.4 0 4.2 4.2 0 1 1 8.4 0ZM31.2 36.5a4.2 4.2 0 1 1-8.4 0 4.2 4.2 0 1 1 8.4 0Z';

// Drawn letterforms keep the wordmark independent of installed fonts.
export const BRAND_WORDMARK_VIEWBOX = '-3 0 308 42';
export const BRAND_WORDMARK_PRIMARY = 'M1 5L8 36L16.5 16L25 36L32 5M46 5V36M46 20.5H68M68 5V36M86 5H100Q106 5 106 11V30Q106 36 100 36H86Q80 36 80 30V11Q80 5 86 5ZM120 5V36M158 9Q152 4 144 5Q133 5 133 13Q133 20 144 21L149 22Q159 24 158 30Q158 37 146 37Q137 37 132 32';
export const BRAND_WORDMARK_SECONDARY = 'M173 5V36M185 25H207V23Q207 14 196 14Q185 14 185 25Q185 36 196 36Q203 36 207 32M221 14V27Q221 36 231 36Q242 36 242 26M242 14V36M256 6V29Q256 36 264 36M248 15H266M279 5V36M279 24Q279 14 289 14Q300 14 300 24V36';

export const BRAND_PALETTE = Object.freeze({ primary: '#39adfd', secondary: '#6be1a3', lightPrimary: '#005b91', lightSecondary: '#006b49' });

export function brandMarkSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_MARK_VIEWBOX}"><title>WHOISleuth</title><path fill="${BRAND_PALETTE.primary}" d="${BRAND_MARK_LENS}"/><path fill="none" stroke="${BRAND_PALETTE.secondary}" stroke-width="2.4" stroke-linejoin="round" d="${BRAND_MARK_LINKS}"/><path fill="${BRAND_PALETTE.secondary}" d="${BRAND_MARK_NODES}"/></svg>\n`;
}

export function brandLogoSvg(light = false): string {
  const primary = light ? BRAND_PALETTE.lightPrimary : BRAND_PALETTE.primary;
  const secondary = light ? BRAND_PALETTE.lightSecondary : BRAND_PALETTE.secondary;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 388 64"><title>WHOISleuth</title><path fill="${primary}" d="${BRAND_MARK_LENS}"/><path fill="none" stroke="${secondary}" stroke-width="2.4" stroke-linejoin="round" d="${BRAND_MARK_LINKS}"/><path fill="${secondary}" d="${BRAND_MARK_NODES}"/><g transform="translate(82 10)" fill="none" stroke-width="5.5" stroke-linecap="square" stroke-linejoin="round"><path stroke="${primary}" d="${BRAND_WORDMARK_PRIMARY}"/><path stroke="${secondary}" d="${BRAND_WORDMARK_SECONDARY}"/></g></svg>\n`;
}
