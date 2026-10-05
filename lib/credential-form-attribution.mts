import {
  classifyStaticCredentialInput, staticControlDisabled, MAX_STATIC_FORMS, MAX_STATIC_INPUTS,
  type StaticHtmlAnalysis, type StaticHtmlElement,
} from './static-html-analysis.mts';
import {
  CREDENTIAL_CATEGORY_NAMES, MAX_FORM_DESTINATIONS,
  type CredentialFormAttribution, type CredentialFormDestination,
} from '../packages/evidence/credential-form-attribution.mts';

const attribute = (element: StaticHtmlElement, name: string): string | undefined =>
  element.attributes.find(item => item.name === name)?.value;

/** HTML Auto buttons submit only without command attributes or a select parent. */
export function staticControlIsSubmitter(element: StaticHtmlElement, parent?: StaticHtmlElement): boolean {
  const type = (attribute(element, 'type') ?? '').toLowerCase();
  if (element.name === 'input') return type === 'submit' || type === 'image';
  if (element.name !== 'button') return false;
  if (type === 'submit') return true;
  if (type === 'button' || type === 'reset') return false;
  return attribute(element, 'command') === undefined && attribute(element, 'commandfor') === undefined
    && !(parent?.html && parent.name === 'select');
}

// Uses the existing bounded, inert-template-free tree. IDs and control values
// are transient association inputs; only ordinal forms and fixed categories
// leave this projection.
export function attributeCredentialForms(analysis: StaticHtmlAnalysis, documentUrl: string, sourceTruncated = false): CredentialFormAttribution {
  const elements = analysis.elements;
  const firstId = new Map<string, number>();
  const firstLegends = new Map<number, number>();
  let firstUncertainId = Number.POSITIVE_INFINITY;
  const formIndices: number[] = [];
  let complete = !sourceTruncated && !analysis.inputLimitReached && !analysis.tagLimitReached && !analysis.forms.truncated;
  for (const [index, element] of elements.entries()) {
    if (element.attributesTruncated && attribute(element, 'id') === undefined) firstUncertainId = Math.min(firstUncertainId, index);
    const id = attribute(element, 'id');
    if (id !== undefined && id.length <= 4096 && !firstId.has(id)) firstId.set(id, index);
    if (element.html && element.name === 'form') {
      if (formIndices.length < MAX_STATIC_FORMS) formIndices.push(index);
      else complete = false;
    }
    if (element.html && element.name === 'legend' && element.parent !== null && !firstLegends.has(element.parent)) firstLegends.set(element.parent, index);
  }
  const ancestor = (index: number, name: string): number | null => {
    for (let parent = elements[index]?.parent ?? null; parent !== null; parent = elements[parent]?.parent ?? null) {
      const element = elements[parent]!;
      if (element.html && element.name === name) return parent;
    }
    return null;
  };
  const owner = (index: number): number | null => {
    const element = elements[index]!;
    if (element.attributesTruncated) return null;
    for (let parent = element.parent; parent !== null; parent = elements[parent]?.parent ?? null) {
      if (elements[parent]?.name === 'fieldset' && elements[parent]?.attributesTruncated) return null;
    }
    const explicit = attribute(element, 'form');
    if (explicit !== undefined) {
      const selected = firstId.get(explicit);
      // A clipped earlier ID could shadow this form in the browser's first-ID
      // lookup. Do not attribute its controls to the later retained match.
      return selected !== undefined && selected < firstUncertainId && elements[selected]?.html && elements[selected]?.name === 'form' ? selected : null;
    }
    return ancestor(index, 'form');
  };
  const destination = (form: StaticHtmlElement, submitter?: StaticHtmlElement): CredentialFormDestination => {
    const method = (submitter && attribute(submitter, 'formmethod')) ?? attribute(form, 'method') ?? 'get';
    if (method.toLowerCase() === 'dialog') return { relationship: 'no_submission', origin: null };
    if (form.attributesTruncated || submitter?.attributesTruncated) return { relationship: 'unknown', origin: null };
    const action = (submitter && attribute(submitter, 'formaction')) ?? attribute(form, 'action');
    if (action !== undefined && (action.length > 4096 || /[\u0000-\u001f\u007f]/u.test(action))) return { relationship: 'unknown', origin: null };
    try {
      const source = new URL(documentUrl);
      // Missing/empty actions use the document URL, not the <base> URL.
      if (action?.trim() && analysis.baseHrefState === 'invalid') return { relationship: 'unknown', origin: null };
      const target = new URL(action?.trim() || documentUrl, analysis.effectiveBaseUrl ?? documentUrl);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.origin.length > 320) return { relationship: 'unknown', origin: null };
      return { relationship: target.origin === source.origin ? 'same_origin' : 'external', origin: target.origin };
    } catch { return { relationship: 'unknown', origin: null }; }
  };
  const forms = formIndices.map((index, ordinal) => ({
    index: ordinal + 1,
    categories: Object.fromEntries(CREDENTIAL_CATEGORY_NAMES.map(name => [name, 0])) as CredentialFormAttribution['forms'][number]['categories'],
    destinations: [destination(elements[index]!)],
  }));
  const formRows = new Map(formIndices.map((index, ordinal) => [index, forms[ordinal]!]));
  let unassociatedInputs = 0;
  let controls = 0;
  for (const [index, element] of elements.entries()) {
    if (!element.html || !['input', 'button'].includes(element.name)) continue;
    if (++controls > MAX_STATIC_INPUTS) { complete = false; break; }
    if (staticControlDisabled(elements, index, firstLegends)) continue;
    const categories = element.name === 'input' ? classifyStaticCredentialInput(element.attributes) : { values: [], truncated: false };
    if (categories.truncated || element.attributesTruncated) complete = false;
    const ownerIndex = owner(index);
    const row = ownerIndex === null ? undefined : formRows.get(ownerIndex);
    if (categories.values.length) {
      if (!row) { unassociatedInputs++; complete = false; }
      else for (const category of categories.values) row.categories[category]++;
    }
    const submitter = staticControlIsSubmitter(element, element.parent === null ? undefined : elements[element.parent]);
    if (row && ownerIndex !== null && submitter && (attribute(element, 'formaction') !== undefined || attribute(element, 'formmethod') !== undefined)) {
      const next = destination(elements[ownerIndex]!, element);
      if (!row.destinations.some(value => value.relationship === next.relationship && value.origin === next.origin)) {
        if (row.destinations.length >= MAX_FORM_DESTINATIONS) complete = false;
        else row.destinations.push(next);
      }
    }
  }
  if (forms.some(form => form.destinations.some(value => value.relationship === 'unknown'))) complete = false;
  return { forms, unassociatedInputs, complete };
}
