// Explainable, browser-local comparison of two bounded page baselines. This
// module deliberately reports each component independently: it does not
// produce an aggregate similarity score, risk factor, or maliciousness
// verdict. Inputs pass through the strict baseline normalizer before use.

import { normalizePageBaseline } from './page-baseline.ts';
import { hammingDistanceHex } from './utils.ts';

export const PAGE_COMPARISON_VERSION = 1;

type PageBaseline = NonNullable<ReturnType<typeof normalizePageBaseline>>;
type DigestComponent = { value: string; truncated: boolean };
type PageComparisonStatus = 'same' | 'overlap' | 'different' | 'not_observed' | 'unavailable';
type PageComparisonComponent = {
  id: string;
  label: string;
  method: string;
  status: PageComparisonStatus;
  outcome: string;
  detail: string;
  partial: boolean;
  sharedValues: string[];
  hammingDistance?: number;
  agreementPercent?: number;
  referenceCount?: number;
  observedCount?: number;
  sharedCount?: number;
};

function component(
  id: string,
  label: string,
  method: string,
  status: PageComparisonStatus,
  outcome: string,
  detail: string,
  partial: boolean,
): PageComparisonComponent {
  return { id, label, method, status, outcome, detail, partial, sharedValues: [] };
}

/**
 * Compares two mandatory digest components. A match or difference applies to
 * the bounded captured material only; the partial flag keeps a capped capture
 * from being presented as a conclusion about the complete page.
 * @param {string} id
 * @param {string} label
 * @param {string} detailLabel
 */
function digestComponent(
  id: string,
  label: string,
  detailLabel: string,
  reference: DigestComponent,
  observed: DigestComponent,
): PageComparisonComponent {
  const same = reference.value === observed.value;
  const partial = reference.truncated || observed.truncated;
  return component(
    id,
    label,
    'Exact SHA-256 equality',
    same ? 'same' : 'different',
    `${same ? 'Same' : 'Different'} captured digest${partial ? ' · partial evidence' : ''}`,
    `${detailLabel} hashes ${same ? 'are equal' : 'differ'} for the bounded material captured on each page.`,
    partial,
  );
}

function visibleTextComponent(
  reference: PageBaseline['visibleText'],
  observed: PageBaseline['visibleText'],
): PageComparisonComponent {
  if (!reference && !observed) {
    return component('visible_text', 'Visible text', '64-bit SimHash distance', 'not_observed', 'Not observed', 'Neither capture produced a visible-text fingerprint.', false);
  }
  if (!reference || !observed) {
    return component('visible_text', 'Visible text', '64-bit SimHash distance', 'unavailable', 'Not comparable', 'Only one capture produced a visible-text fingerprint.', Boolean(reference?.truncated || observed?.truncated));
  }
  const distance = hammingDistanceHex(reference.value, observed.value);
  if (distance === null) {
    return component('visible_text', 'Visible text', '64-bit SimHash distance', 'unavailable', 'Not comparable', 'The visible-text fingerprints use an unsupported or malformed representation.', true);
  }
  const agreementPercent = Math.round(((64 - distance) / 64) * 100);
  return {
    ...component(
      'visible_text',
      'Visible text',
      '64-bit SimHash distance',
      distance === 0 ? 'same' : 'different',
      `${agreementPercent}% bit agreement${reference.truncated || observed.truncated ? ' · partial evidence' : ''}`,
      `The fingerprints differ by ${distance} of 64 bits. Bit agreement is a fuzzy comparison aid, not a percentage of copied text.`,
      reference.truncated || observed.truncated,
    ),
    hammingDistance: distance,
    agreementPercent,
  };
}

function formComponent(
  reference: PageBaseline['formStructure'],
  observed: PageBaseline['formStructure'],
): PageComparisonComponent {
  if (!reference && !observed) {
    return component('form_structure', 'Form structure', 'Exact SHA-256 equality', 'not_observed', 'No forms fingerprinted', 'Neither capture contained a form structure to fingerprint.', false);
  }
  if (!reference || !observed) {
    return component('form_structure', 'Form structure', 'Exact SHA-256 equality', 'unavailable', 'Not comparable', 'Only one capture produced a form-structure fingerprint.', Boolean(reference?.truncated || observed?.truncated));
  }
  return digestComponent('form_structure', 'Form structure', 'Form-structure', reference, observed);
}

function intersect(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} noun
 */
function setComponent<T>(
  id: string,
  label: string,
  noun: string,
  reference: { values: T[]; truncated: boolean },
  observed: { values: T[]; truncated: boolean },
  key: (value: T) => string,
): PageComparisonComponent {
  const referenceValues = reference.values.map(key);
  const observedValues = observed.values.map(key);
  const sharedValues = intersect(referenceValues, observedValues);
  const partial = reference.truncated || observed.truncated;
  const quantity = (count: number) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  if (!referenceValues.length && !observedValues.length) {
    return {
      ...component(id, label, 'Bounded set overlap', 'not_observed', `No ${noun}s observed`, `Neither capture retained any ${noun}s.`, partial),
      referenceCount: 0,
      observedCount: 0,
      sharedCount: 0,
      sharedValues: [],
    };
  }
  const same = referenceValues.length === observedValues.length && sharedValues.length === referenceValues.length;
  const status = same ? 'same' : sharedValues.length ? 'overlap' : 'different';
  const outcome = same
    ? `Same ${noun} set`
    : sharedValues.length
      ? `${quantity(sharedValues.length)} shared`
      : `No shared ${noun}s`;
  return {
    ...component(
      id,
      label,
      'Bounded set overlap',
      status,
      `${outcome}${partial ? ' · partial evidence' : ''}`,
      `${quantity(sharedValues.length)} shared across ${quantity(referenceValues.length)} in the baseline and ${quantity(observedValues.length)} in this capture.`,
      partial,
    ),
    referenceCount: referenceValues.length,
    observedCount: observedValues.length,
    sharedCount: sharedValues.length,
    sharedValues,
  };
}

/**
 * Compares an official-site baseline with a current bounded page capture.
 * Returns null unless both inputs satisfy the current strict baseline schema.
 * @param {unknown} rawReference
 * @param {unknown} rawObserved
 */
export function comparePageBaselines(rawReference: unknown, rawObserved: unknown) {
  const reference = normalizePageBaseline(rawReference);
  const observed = normalizePageBaseline(rawObserved);
  if (!reference || !observed) return null;

  const components = [
    digestComponent('normalized_html', 'Normalized HTML', 'Normalized-HTML', reference.normalizedHtml, observed.normalizedHtml),
    visibleTextComponent(reference.visibleText, observed.visibleText),
    digestComponent('dom_structure', 'DOM structure', 'Static tag-sequence', reference.domStructure, observed.domStructure),
    formComponent(reference.formStructure, observed.formStructure),
    setComponent('resource_hosts', 'External resource hosts', 'host', reference.resourceHosts, observed.resourceHosts, (value) => value),
    setComponent('tracking_identifiers', 'Tracking identifiers', 'identifier', reference.trackingIdentifiers, observed.trackingIdentifiers, (value) => `${value.type}:${value.value}`),
  ];
  const counts = { same: 0, overlap: 0, different: 0, notObserved: 0, unavailable: 0 };
  for (const item of components) {
    if (item.status === 'not_observed') counts.notObserved += 1;
    else if (item.status === 'unavailable') counts.unavailable += 1;
    else counts[item.status] += 1;
  }

  return {
    comparisonVersion: PAGE_COMPARISON_VERSION,
    reference: {
      domain: reference.domain,
      observedAt: reference.observedAt,
      complete: reference.complete,
      truncated: reference.truncated,
    },
    observed: {
      domain: observed.domain,
      observedAt: observed.observedAt,
      complete: observed.complete,
      truncated: observed.truncated,
    },
    partial: reference.truncated || observed.truncated || components.some((item) => item.partial),
    components,
    counts,
  };
}
