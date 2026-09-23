// Versioned policy for projecting the Unicode UTS #39 confusables data into
// WHOISleuth's intentionally small domain-label mapping. The full upstream
// table is never shipped to browsers or consulted at runtime.

export const UNICODE_CONFUSABLE_DATA_VERSION = '18.0.0';
export const UNICODE_CONFUSABLE_SOURCE_URL = `https://www.unicode.org/Public/${UNICODE_CONFUSABLE_DATA_VERSION}/security/confusables.txt`;
export const UNICODE_CONFUSABLE_SOURCE_SHA256 = '6ed3ee967c9dfdf6677d563c9985182fbc50a2efb7d6059cd57b2e2ce18f5b92';
export const UNICODE_CONFUSABLE_LICENSE = 'Unicode-3.0';

export const CONFUSABLE_PROJECTION_SCHEMA = 'whoisleuth.unicode-confusable-projection';
export const CONFUSABLE_PROJECTION_VERSION = 1;
export const MAX_CONFUSABLE_SOURCE_BYTES = 1_000_000;
export const MAX_CONFUSABLE_SOURCE_LINES = 12_000;
export const MAX_CONFUSABLE_SOURCE_LINE_LENGTH = 768;
export const MAX_CONFUSABLE_SOURCE_CODEPOINTS = 1;
export const MAX_CONFUSABLE_TARGET_CODEPOINTS = 18;
export const MAX_CONFUSABLE_ASCII_TARGETS = 26;
export const MAX_SKELETON_CONFUSABLES_PER_ASCII = 12;
export const MAX_GENERATION_CONFUSABLES_PER_ASCII = 8;
export const MAX_PROJECTED_CONFUSABLES = MAX_CONFUSABLE_ASCII_TARGETS * MAX_SKELETON_CONFUSABLES_PER_ASCII;

export const ACCEPTED_CONFUSABLE_SCRIPTS = Object.freeze([
  'Latin',
  'Cyrillic',
  'Greek',
  'Armenian',
  'Coptic',
  'Deseret',
  'Lisu',
] as const);

// Existing reviewed mappings are priority seeds, not an independent data
// source. Keeping their order prevents a Unicode refresh from unexpectedly
// displacing already-calibrated characters when a per-letter cap is reached.
export const REVIEWED_SKELETON_CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  a: 'аαɑ',
  b: 'ьƄ',
  c: 'сϲⅽᴄⲥ𐐽',
  d: 'ԁⅾꓒ',
  e: 'еεҽꬲ',
  f: 'ϝꞙƒ',
  g: 'ɡ',
  h: 'һհ',
  i: 'іιıɪɩⲓꙇ',
  j: 'јϳ',
  k: 'κк',
  l: 'ӏⅼǀꓲ',
  m: 'мⅿ',
  n: 'ոռ',
  o: 'оοօᴏⲟ',
  p: 'рρϱⲣ',
  q: 'ԛգզ',
  r: 'гꭇ',
  s: 'ѕꜱƽ',
  t: 'тτ',
  u: 'υսᴜꭎ',
  v: 'ѵνᴠ',
  w: 'ԝաᴡш',
  x: 'хχ',
  y: 'уүʏγⲩ',
  z: 'ᴢ',
});

export const REVIEWED_GENERATION_CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  a: 'аαɑ',
  b: 'ь',
  c: 'сᴄⲥ𐐽',
  d: 'ԁꓒ',
  e: 'еεҽꬲ',
  f: 'ϝꞙƒ',
  g: 'ɡ',
  h: 'һհ',
  i: 'іιıɪɩⲓꙇ',
  j: 'јϳ',
  k: 'κк',
  l: 'ӏǀꓲ',
  m: 'м',
  n: 'ոռ',
  // Keep the complete previously generated o-set when newer source mappings
  // compete for the same bounded generation slots.
  o: 'оοօᴏⲟᴑꬽσ',
  p: 'рρⲣ',
  q: 'ԛգզ',
  r: 'гꭇ',
  s: 'ѕꜱƽ',
  t: 'тτ',
  u: 'υսᴜꭎ',
  v: 'ѵνᴠ',
  w: 'ԝաᴡш',
  x: 'хχ',
  y: 'уүʏγⲩ',
  z: 'ᴢ',
});
