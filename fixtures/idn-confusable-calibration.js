'use strict';

// Reserved, synthetic label pairs for comparing a proposed mapping with the
// checked-in baseline. Expected matches describe visual skeleton equivalence,
// not maliciousness, ownership, or activity.
module.exports = Object.freeze([
  Object.freeze({
    id: 'whole-script-cyrillic',
    category: 'whole-script',
    reference: 'scope',
    observed: 'ѕсоре',
    expectedMatch: true,
  }),
  Object.freeze({
    id: 'mixed-coptic-latin',
    category: 'mixed-script',
    reference: 'cope',
    observed: 'ⲥope',
    expectedMatch: true,
  }),
  Object.freeze({
    id: 'whole-script-armenian-expansion',
    category: 'whole-script',
    reference: 'fig',
    observed: 'քւց',
    expectedMatch: true,
  }),
  Object.freeze({
    id: 'armenian-g-expansion',
    category: 'mixed-script',
    reference: 'gateway',
    observed: 'ցateway',
    expectedMatch: true,
  }),
  Object.freeze({
    id: 'deseret-s-expansion',
    category: 'mixed-script',
    reference: 'secure',
    observed: '𐑈ecure',
    expectedMatch: true,
  }),
  Object.freeze({
    id: 'latin-p-expansion',
    category: 'same-script',
    reference: 'portal',
    observed: 'þortal',
    expectedMatch: true,
  }),
  Object.freeze({
    id: 'latin-y-expansion',
    category: 'same-script',
    reference: 'young',
    observed: 'ỿoung',
    expectedMatch: true,
  }),
  Object.freeze({
    id: 'greek-r-expansion',
    category: 'mixed-script',
    reference: 'route',
    observed: 'ᴦoute',
    expectedMatch: true,
  }),
  Object.freeze({
    id: 'unrelated-ascii-shape',
    category: 'negative',
    reference: 'scope',
    observed: 'shape',
    expectedMatch: false,
  }),
  Object.freeze({
    id: 'unrelated-ascii-portal',
    category: 'negative',
    reference: 'portal',
    observed: 'parcel',
    expectedMatch: false,
  }),
  Object.freeze({
    id: 'unrelated-ascii-secure',
    category: 'negative',
    reference: 'secure',
    observed: 'rescue',
    expectedMatch: false,
  }),
  Object.freeze({
    id: 'unrelated-cyrillic-label',
    category: 'negative',
    reference: 'example',
    observed: 'пример',
    expectedMatch: false,
  }),
  Object.freeze({
    id: 'unrelated-japanese-label',
    category: 'negative',
    reference: 'example',
    observed: '日本',
    expectedMatch: false,
  }),
]);
