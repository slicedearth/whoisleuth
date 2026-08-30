// Static client-side behaviour indicators derived from the existing bounded
// HTML tokenizer pass. Scripts are never fetched or executed. Only fixed
// indicator identifiers, descriptions, evidence classes, and bounded counts
// leave this module; script references and contents are discarded.

import { createObservation } from '../packages/evidence/observation.mts';
import {
  CLIENT_BEHAVIOR_PROFILE_VERSION,
  MAX_CLIENT_BEHAVIOR_INDICATORS,
} from './lookup-child-profile-contract.mts';
import {
  analyzeStaticHtml,
  type StaticHtmlAnalysis,
} from './static-html-analysis.mts';

type ClientBehaviorIndicatorId =
  | 'inline_event_handlers'
  | 'client_navigation'
  | 'form_interception'
  | 'service_worker'
  | 'browser_storage'
  | 'clipboard_access'
  | 'dynamic_code_evaluation'
  | 'browser_fingerprinting'
  | 'persistent_connection';
type ClientBehaviorIndicator = {
  id: ClientBehaviorIndicatorId;
  label: string;
  evidenceClass: 'static_markup' | 'inline_script';
  occurrences: number;
  explanation: string;
};
type ClientBehaviorProfileInput = {
  html?: unknown;
  htmlAnalysis?: StaticHtmlAnalysis;
  observedAt?: unknown;
  sourceTruncated?: unknown;
};

const MAX_INDICATOR_OCCURRENCES = 999;

function boundedOccurrences(value: number): number {
  return Math.max(1, Math.min(MAX_INDICATOR_OCCURRENCES, value));
}

function patternCount(value: string, pattern: RegExp): number {
  let count = 0;
  for (const _match of value.matchAll(pattern)) {
    count += 1;
    if (count >= MAX_INDICATOR_OCCURRENCES) break;
  }
  return count;
}

function analyzeClientBehavior(input: ClientBehaviorProfileInput = {}) {
  const htmlAnalysis = input.htmlAnalysis ?? analyzeStaticHtml(input.html);
  const markup = htmlAnalysis.markup;
  const inlineScripts = htmlAnalysis.scripts
    .filter((script) => script.reference === null)
    .map((script) => script.inlineContent)
    .join('\n');
  const indicators: ClientBehaviorIndicator[] = [];

  function add(
    id: ClientBehaviorIndicatorId,
    label: string,
    evidenceClass: ClientBehaviorIndicator['evidenceClass'],
    occurrences: number,
    explanation: string,
  ): void {
    if (occurrences <= 0 || indicators.length >= MAX_CLIENT_BEHAVIOR_INDICATORS) return;
    indicators.push({ id, label, evidenceClass, occurrences: boundedOccurrences(occurrences), explanation });
  }

  add(
    'inline_event_handlers',
    'Inline event handlers',
    'static_markup',
    patternCount(markup, /\son[a-z]{2,24}="/gu),
    'Inline HTML event-handler attributes were observed.',
  );
  add(
    'client_navigation',
    'Client-side navigation',
    'inline_script',
    patternCount(inlineScripts, /\b(?:history\.(?:pushState|replaceState)|location\.(?:assign|replace)|window\.location)\b/gu),
    'Inline script contains a client-side navigation API.',
  );
  add(
    'form_interception',
    'Form interception',
    'inline_script',
    patternCount(inlineScripts, /(?:addEventListener\s*\(\s*['"]submit['"]|\.onsubmit\s*=|preventDefault\s*\()/gu),
    'Inline script contains a form-submission or default-action interception marker.',
  );
  add(
    'service_worker',
    'Service worker registration',
    'inline_script',
    patternCount(inlineScripts, /\bnavigator\.serviceWorker\.register\s*\(/gu),
    'Inline script contains a service-worker registration call.',
  );
  add(
    'browser_storage',
    'Browser storage access',
    'inline_script',
    patternCount(inlineScripts, /\b(?:localStorage|sessionStorage|indexedDB)\b/gu),
    'Inline script references a browser-local storage API.',
  );
  add(
    'clipboard_access',
    'Clipboard access',
    'inline_script',
    patternCount(inlineScripts, /\bnavigator\.clipboard\b/gu),
    'Inline script references the browser clipboard API.',
  );
  add(
    'dynamic_code_evaluation',
    'Dynamic code evaluation',
    'inline_script',
    patternCount(inlineScripts, /(?:\beval\s*\(|\bnew\s+Function\s*\()/gu),
    'Inline script contains a dynamic code-evaluation API.',
  );
  add(
    'browser_fingerprinting',
    'Browser fingerprinting surfaces',
    'inline_script',
    patternCount(inlineScripts, /(?:toDataURL\s*\(|getImageData\s*\(|AudioContext\b|WEBGL_debug_renderer_info\b)/gu),
    'Inline script references an API commonly used in browser-fingerprint calculations.',
  );
  add(
    'persistent_connection',
    'Persistent client connection',
    'inline_script',
    patternCount(inlineScripts, /\b(?:WebSocket|EventSource)\s*\(/gu),
    'Inline script contains a persistent browser-connection constructor.',
  );

  const sourceTruncated = input.sourceTruncated === true;
  const truncated = sourceTruncated
    || htmlAnalysis.inputLimitReached
    || htmlAnalysis.tagLimitReached
    || htmlAnalysis.scriptLimitReached
    || htmlAnalysis.inlineLimitReached;
  const limitations = [
    'Indicators come only from bounded static markup and retained inline-script prefixes; referenced scripts are not fetched and no code is executed.',
    'An observed API or handler can be normal application behaviour and does not establish vulnerability, tracking, credential theft, maliciousness, reachability, or execution.',
    'No script contents, script references, paths, queries, hashes, arbitrary attributes, or matched source fragments are retained.',
    'No indicator means only that the bounded retained static evidence did not match this fixed catalogue.',
  ];
  if (truncated) limitations.push('The captured page or static script/token boundaries were reached, so behaviour indicators may be incomplete.');

  return {
    clientBehaviorProfileVersion: CLIENT_BEHAVIOR_PROFILE_VERSION,
    ...createObservation({
      status: truncated ? 'partial' : 'success',
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'derived',
      complete: !truncated,
      truncated,
      limitations,
      diagnostics: {
        indicatorsObserved: indicators.length,
        scriptElementsExamined: htmlAnalysis.scripts.length,
        inlineCharactersExamined: htmlAnalysis.inlineCharactersExamined,
      },
    }),
    scriptSummary: {
      elementsObserved: htmlAnalysis.scripts.length,
      referencedScripts: htmlAnalysis.scripts.filter((script) => script.reference !== null).length,
      inlineScripts: htmlAnalysis.scripts.filter((script) => script.reference === null).length,
      moduleScripts: htmlAnalysis.scripts.filter((script) => script.mediaType === 'module').length,
    },
    indicators,
  };
}

export {
  CLIENT_BEHAVIOR_PROFILE_VERSION,
  MAX_CLIENT_BEHAVIOR_INDICATORS,
  analyzeClientBehavior,
};

export type {
  ClientBehaviorIndicator,
  ClientBehaviorIndicatorId,
  ClientBehaviorProfileInput,
};
