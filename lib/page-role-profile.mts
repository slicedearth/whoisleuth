// Bounded, explainable page-role classification over the static HTML already
// captured by Deep Lookup. The classifier emits fixed labels and evidence
// descriptions only; it does not retain page text, arbitrary attributes, URLs,
// or matched markup, and it never treats a role as proof of intent or safety.

import { createObservation } from '../packages/evidence/observation.mts';
import {
  MAX_PAGE_ROLE_EVIDENCE,
  MAX_PAGE_ROLE_FINDINGS,
  PAGE_ROLE_PROFILE_VERSION,
} from './lookup-child-profile-contract.mts';
import {
  analyzeStaticHtml,
  type StaticHtmlAnalysis,
} from './static-html-analysis.mts';

type PageRole =
  | 'access_challenge'
  | 'authentication'
  | 'commerce'
  | 'support_contact'
  | 'parked_sale'
  | 'content'
  | 'unknown';
type PageRoleConfidence = 'high' | 'medium' | 'low';
type PageRoleFinding = {
  role: PageRole;
  label: string;
  confidence: PageRoleConfidence;
  evidence: string[];
};
type PageRoleProfileInput = {
  html?: unknown;
  htmlAnalysis?: StaticHtmlAnalysis;
  pageTitle?: unknown;
  activityStatus?: unknown;
  observedAt?: unknown;
  sourceTruncated?: unknown;
};

const MAX_ROLE_TITLE_CHARS = 200;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

function boundedLowercase(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || CONTROL_CHARACTER_RE.test(value)) return '';
  return value.trim().toLowerCase();
}

function addFinding(
  findings: PageRoleFinding[],
  role: PageRole,
  label: string,
  confidence: PageRoleConfidence,
  evidence: string[],
): void {
  if (!evidence.length || findings.length >= MAX_PAGE_ROLE_FINDINGS) return;
  findings.push({
    role,
    label,
    confidence,
    evidence: evidence.slice(0, MAX_PAGE_ROLE_EVIDENCE),
  });
}

function analyzePageRole(input: PageRoleProfileInput = {}) {
  const htmlAnalysis = input.htmlAnalysis ?? analyzeStaticHtml(input.html);
  const markup = htmlAnalysis.markup;
  const title = boundedLowercase(input.pageTitle, MAX_ROLE_TITLE_CHARS);
  const activityStatus = boundedLowercase(input.activityStatus, 40);
  const forms = htmlAnalysis.forms;
  const findings: PageRoleFinding[] = [];

  const challengeEvidence: string[] = [];
  if (/(?:captcha|recaptcha|hcaptcha|turnstile|cf-chl|challenge-form|verify-human)/u.test(markup)) {
    challengeEvidence.push('Static challenge or human-verification marker observed');
  }
  if (/(?:just a moment|checking your browser|verify you are human|access denied)/u.test(title)) {
    challengeEvidence.push('Page title is consistent with an access challenge');
  }
  addFinding(findings, 'access_challenge', 'Access challenge', challengeEvidence.length > 1 ? 'high' : 'medium', challengeEvidence);

  const authenticationEvidence: string[] = [];
  if (forms.categories.password > 0) authenticationEvidence.push('Password-purpose input observed');
  if (forms.categories.username > 0 || forms.categories.email > 0) {
    authenticationEvidence.push('Username or email-purpose input observed');
  }
  if (/(?:login|log-in|signin|sign-in|authentication|current-password|new-password)/u.test(markup)) {
    authenticationEvidence.push('Static authentication marker observed');
  }
  addFinding(
    findings,
    'authentication',
    'Authentication',
    forms.categories.password > 0 ? 'high' : 'medium',
    authenticationEvidence,
  );

  const commerceEvidence: string[] = [];
  if (forms.categories.payment > 0) commerceEvidence.push('Payment-purpose input observed');
  if (/(?:checkout|shopping-cart|add-to-cart|product-price|woocommerce|shopify-payment)/u.test(markup)) {
    commerceEvidence.push('Static commerce or checkout marker observed');
  }
  addFinding(findings, 'commerce', 'Commerce', forms.categories.payment > 0 ? 'high' : 'medium', commerceEvidence);

  const supportEvidence: string[] = [];
  if (/(?:contact|support|helpdesk|customer-service)/u.test(markup)) {
    supportEvidence.push('Static support or contact marker observed');
  }
  if (forms.formsObserved > 0 && forms.categories.password === 0 && forms.categories.payment === 0) {
    supportEvidence.push('Non-credential form surface observed');
  }
  addFinding(findings, 'support_contact', 'Support or contact', 'low', supportEvidence);

  const parkedEvidence: string[] = [];
  if (activityStatus === 'parked') parkedEvidence.push('Existing activity analysis classified the page as parked');
  if (/(?:domain-for-sale|buy-this-domain|parking-page|sedoparking)/u.test(markup)) {
    parkedEvidence.push('Static domain-sale or parking marker observed');
  }
  addFinding(findings, 'parked_sale', 'Parked or for sale', activityStatus === 'parked' ? 'high' : 'medium', parkedEvidence);

  const contentEvidence: string[] = [];
  if (/<(?:article|main)(?:\s|>)/u.test(markup)) contentEvidence.push('Semantic article or main-content element observed');
  if (/<(?:h1|h2)(?:\s|>)/u.test(markup)) contentEvidence.push('Static heading structure observed');
  addFinding(findings, 'content', 'Content or publication', contentEvidence.length > 1 ? 'medium' : 'low', contentEvidence);

  if (!findings.length) {
    findings.push({
      role: 'unknown',
      label: 'Unclassified',
      confidence: 'low',
      evidence: ['No bounded role signature matched the retained static evidence'],
    });
  }

  const sourceTruncated = input.sourceTruncated === true;
  const truncated = sourceTruncated || htmlAnalysis.inputLimitReached || htmlAnalysis.tagLimitReached;
  const limitations = [
    'Roles are heuristic review labels derived from bounded static HTML and semantic form declarations, not proof of a site purpose, legitimacy, safety, ownership, or intent.',
    'JavaScript-rendered content, page interaction, authenticated content, and text outside the retained title are not evaluated.',
    'Only fixed role labels and evidence descriptions are retained; page text, arbitrary attributes, matched markup, and URLs are discarded.',
  ];
  if (truncated) limitations.push('The captured page or static tokenization reached a limit, so later role evidence may be absent.');

  return {
    pageRoleProfileVersion: PAGE_ROLE_PROFILE_VERSION,
    ...createObservation({
      status: truncated ? 'partial' : 'success',
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'derived',
      complete: !truncated,
      truncated,
      limitations,
      diagnostics: {
        rolesObserved: findings.length,
        formsObserved: forms.formsObserved,
        tagsExamined: htmlAnalysis.tagsExamined,
      },
    }),
    primaryRole: findings[0]?.role ?? 'unknown',
    findings,
  };
}

export {
  MAX_PAGE_ROLE_EVIDENCE,
  MAX_PAGE_ROLE_FINDINGS,
  PAGE_ROLE_PROFILE_VERSION,
  analyzePageRole,
};

export type {
  PageRole,
  PageRoleConfidence,
  PageRoleFinding,
  PageRoleProfileInput,
};
