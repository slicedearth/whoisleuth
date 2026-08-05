export const BRAND_MIMICRY_REVIEW_VERSION = 1;

export type BrandMimicryReviewState = 'relationship' | 'context' | 'unavailable';

export type BrandMimicryReviewItem = Readonly<{
  id: 'credential_surface' | 'favicon' | 'official_asset' | 'page_component' | 'phishing_language';
  label: string;
  state: BrandMimicryReviewState;
  detail: string;
  provenance: string;
  sharedValues: readonly string[];
}>;

export type BrandMimicryReview = Readonly<{
  version: 1;
  label: string;
  partial: boolean;
  items: readonly BrandMimicryReviewItem[];
  limitations: readonly string[];
}>;

type UnknownRecord = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_ITEMS = 12;
const MAX_SHARED_VALUES = 8;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown, maximum = 240): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function strings(value: unknown, maximum = MAX_SHARED_VALUES): string[] {
  if (!Array.isArray(value)) return [];
  const values = new Set<string>();
  for (const item of value.slice(0, maximum * 2)) {
    const normalized = text(item, 180);
    if (normalized) values.add(normalized);
    if (values.size >= maximum) break;
  }
  return [...values];
}

function relationshipItem(
  id: BrandMimicryReviewItem['id'],
  label: string,
  detail: string,
  provenance: string,
  sharedValues: readonly string[] = [],
): BrandMimicryReviewItem {
  return { id, label, state: 'relationship', detail, provenance, sharedValues };
}

/**
 * Organises already-collected brand and page observations into independent,
 * explainable review cues. It intentionally does not produce a similarity
 * score or infer copying, ownership, intent, or maliciousness.
 */
export function buildBrandMimicryReview(input: Readonly<{
  hasActiveProfile?: unknown;
  trustedDomainKind?: unknown;
  profileSignals?: unknown;
  pageComparison?: unknown;
  hasPasswordField?: unknown;
  phishingLanguageMatch?: unknown;
}>): BrandMimicryReview | null {
  if (input.hasActiveProfile !== true || text(input.trustedDomainKind, 40)) return null;

  const signals = record(input.profileSignals);
  const comparison = record(input.pageComparison);
  const components = Array.isArray(comparison.components)
    ? comparison.components.slice(0, 8).map(record)
    : [];
  const items: BrandMimicryReviewItem[] = [];

  if (signals.faviconMatch === true) {
    items.push(relationshipItem(
      'favicon',
      'Exact official favicon relationship',
      'The observed favicon digest equals the active profile favicon digest.',
      'Derived from separately captured SHA-256 favicon digests',
    ));
  } else if (signals.faviconNearMatch === true) {
    items.push(relationshipItem(
      'favicon',
      'Similar official favicon relationship',
      'The observed perceptual favicon digest is within the configured bounded distance of the active profile favicon.',
      'Derived from separately captured perceptual favicon digests',
    ));
  }

  if (signals.reusesOfficialAssets === true) {
    items.push(relationshipItem(
      'official_asset',
      'Official-domain asset relationship',
      'Static HTML referenced at least one asset host that is also an official domain in the active profile.',
      'Derived from bounded static resource-host extraction and the active profile',
    ));
  }

  for (const component of components) {
    const status = text(component.status, 32);
    if (status !== 'same' && status !== 'overlap') continue;
    const label = text(component.label, 100) || 'Page component';
    const outcome = text(component.outcome, 180) || 'A comparable relationship was observed.';
    const method = text(component.method, 120);
    items.push(relationshipItem(
      'page_component',
      `${label} relationship`,
      outcome,
      method ? `Bounded official-site comparison using ${method}` : 'Bounded official-site comparison',
      strings(component.sharedValues),
    ));
    if (items.length >= MAX_ITEMS) break;
  }

  if (input.hasPasswordField === true && items.length < MAX_ITEMS) {
    items.push({
      id: 'credential_surface',
      label: 'Credential-entry surface observed',
      state: 'context',
      detail: 'The bounded static page capture contained a password field. This is common on legitimate sites and is context for manual review, not a relationship by itself.',
      provenance: 'Direct static HTML form observation',
      sharedValues: [],
    });
  }

  const phishingLanguage = text(input.phishingLanguageMatch, 160);
  if (phishingLanguage && items.length < MAX_ITEMS) {
    items.push({
      id: 'phishing_language',
      label: 'Review-language phrase observed',
      state: 'context',
      detail: `The bounded static page text matched the phrase “${phishingLanguage}”. The match is a review cue and does not establish deceptive intent.`,
      provenance: 'Direct bounded static HTML text observation',
      sharedValues: [],
    });
  }

  const hasComparison = comparison.comparisonVersion === 1;
  if (!items.length && !hasComparison) {
    items.push({
      id: 'page_component',
      label: 'Official-page comparison unavailable',
      state: 'unavailable',
      detail: 'No compatible current and official-site page fingerprints were available. This does not indicate that the pages differ.',
      provenance: 'Official-site baseline and current page source health',
      sharedValues: [],
    });
  }

  const relationshipCount = items.filter((item) => item.state === 'relationship').length;
  const contextCount = items.filter((item) => item.state === 'context').length;
  const unavailableCount = items.filter((item) => item.state === 'unavailable').length;
  return {
    version: BRAND_MIMICRY_REVIEW_VERSION,
    label: relationshipCount
      ? `${relationshipCount} relationship cue${relationshipCount === 1 ? '' : 's'} observed`
      : contextCount
        ? `${contextCount} contextual cue${contextCount === 1 ? '' : 's'} observed`
        : unavailableCount
          ? 'Comparison evidence unavailable'
          : 'No relationship cue observed in comparable components',
    partial: comparison.partial === true,
    items: items.slice(0, MAX_ITEMS),
    limitations: [
      'Each cue is independent. WHOISleuth does not combine these observations into a mimicry or maliciousness score.',
      'Shared favicons, assets, resource hosts, trackers, templates, text, or form structures can result from legitimate providers and common libraries.',
      'Static collection does not execute page scripts and may miss content produced after page load.',
      'A relationship cue does not prove copying, common ownership, control, intent, or maliciousness.',
    ],
  };
}
