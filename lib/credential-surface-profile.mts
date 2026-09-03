// Privacy-minimized credential-surface evidence derived from live input and
// form start tags in the already-captured deep-Lookup homepage response. The
// shared tokenizer projects only fixed categories and bounded counts; field
// names, values, labels, placeholders, arbitrary attributes, and action URLs
// never enter this profile.

import { createObservation } from '../packages/evidence/observation.mts';
import { CREDENTIAL_SURFACE_PROFILE_VERSION } from './lookup-child-profile-contract.mts';
import {
  MAX_STATIC_FORMS,
  MAX_STATIC_INPUTS,
  analyzeStaticHtml,
  type StaticHtmlAnalysis,
} from './static-html-analysis.mts';

type CredentialSurfaceProfileInput = {
  html?: unknown;
  htmlAnalysis?: StaticHtmlAnalysis;
  baseUrl?: unknown;
  observedAt?: unknown;
  sourceTruncated?: unknown;
};

function analyzeCredentialSurfaceProfile(input: CredentialSurfaceProfileInput = {}) {
  const htmlAnalysis = input.htmlAnalysis ?? analyzeStaticHtml(input.html, { baseUrl: input.baseUrl });
  const forms = htmlAnalysis.forms;
  const sourceTruncated = input.sourceTruncated === true;
  const truncated = sourceTruncated
    || htmlAnalysis.inputLimitReached
    || htmlAnalysis.tagLimitReached
    || forms.truncated;
  const unclassifiedActions = forms.actions.unclassified;
  const partial = truncated || unclassifiedActions > 0;
  const limitations = [
    'Static input categories use only bounded type and autocomplete declarations; JavaScript-rendered, non-semantic, disabled, and hidden controls are not classified.',
    'Category counts can overlap when one input declares more than one recognised purpose.',
    'External submission can be legitimate and does not establish phishing, unsafe handling, ownership, intent, or maliciousness.',
    'No field names, values, labels, placeholders, complete action URLs, paths, queries, fragments, or arbitrary attributes are retained.',
  ];
  if (sourceTruncated || htmlAnalysis.inputLimitReached) {
    limitations.push('The captured homepage body was truncated, so credential-surface evidence may be incomplete.');
  }
  if (htmlAnalysis.tagLimitReached) {
    limitations.push('Static tokenization reached its tag boundary, so later form or input elements may be absent.');
  }
  if (forms.truncated) {
    limitations.push(`Form or input profiling reached an element-count or attribute-classification boundary. At most the first ${MAX_STATIC_FORMS} forms and ${MAX_STATIC_INPUTS} input elements were eligible.`);
  }
  if (unclassifiedActions > 0) {
    limitations.push(`${unclassifiedActions} form action${unclassifiedActions === 1 ? ' could' : 's could'} not be safely classified.`);
  }

  return {
    credentialSurfaceVersion: CREDENTIAL_SURFACE_PROFILE_VERSION,
    ...createObservation({
      status: partial ? 'partial' : 'success',
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'html',
      complete: !partial,
      truncated,
      limitations,
      diagnostics: {
        formsObserved: forms.formsObserved,
        inputsObserved: forms.inputsObserved,
        classifiedInputs: forms.classifiedInputs,
        unclassifiedActions,
      },
    }),
    forms: {
      count: forms.formsObserved,
      methods: { ...forms.methods },
      actions: { ...forms.actions },
    },
    inputs: {
      count: forms.inputsObserved,
      classifiedCount: forms.classifiedInputs,
      categories: { ...forms.categories },
    },
  };
}

export {
  CREDENTIAL_SURFACE_PROFILE_VERSION,
  analyzeCredentialSurfaceProfile,
};

export type {
  CredentialSurfaceProfileInput,
};
