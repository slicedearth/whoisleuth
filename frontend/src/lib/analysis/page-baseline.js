// Browser-local official-site baseline model for Brand Profiles. This module
// deliberately accepts only bounded, normalized page-identity fields. Raw
// HTML, URLs, headers, redirect inventories, and parser diagnostics never
// cross this storage boundary.

import { normalizeDomain } from './case-model.js';
import { isInformativeFaviconHash } from './utils.js';

export const PAGE_BASELINE_VERSION = 1;
export const PAGE_IDENTITY_VERSION = 3;
export const PAGE_FINGERPRINT_VERSION = 1;
export const MAX_BASELINE_TITLE_LENGTH = 200;
export const MAX_BASELINE_RESOURCE_HOSTS = 30;
export const MAX_BASELINE_IDENTIFIERS = 30;

const SHA256_RE = /^[a-f0-9]{64}$/i;
const SIMHASH_RE = /^[a-f0-9]{16}$/i;
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_HTML_TOKENS = 4096;
const MAX_TEXT_TOKENS = 8192;
const MAX_FORMS = 50;
const MAX_FORM_CONTROLS = 500;

/** @param {unknown} value */
function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value */
function timestamp(value) {
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || CONTROL_RE.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** @param {unknown} value @param {number} maximum */
function count(value, maximum) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

/** @param {unknown} value */
function sha256(value) {
  return typeof value === 'string' && SHA256_RE.test(value) ? value.toLowerCase() : null;
}

/** @param {unknown} value */
function boundedTitle(value) {
  if (typeof value !== 'string' || value.length > MAX_BASELINE_TITLE_LENGTH || CONTROL_RE.test(value)) return null;
  return value.trim().replace(/\s+/g, ' ') || null;
}

/** @param {unknown} raw @param {string} countKey @param {number} maximum */
function shaComponent(raw, countKey, maximum) {
  const value = record(raw);
  if (!value || value.algorithm !== 'sha256') return null;
  const digest = sha256(value.value);
  const observedCount = count(value[countKey], maximum);
  if (!digest || observedCount === null) return null;
  return { algorithm: 'sha256', value: digest, [countKey]: observedCount, truncated: value.truncated === true };
}

/** @param {unknown} raw */
function visibleTextComponent(raw) {
  const value = record(raw);
  if (!value || value.algorithm !== 'simhash64-v1' || typeof value.value !== 'string' || !SIMHASH_RE.test(value.value)) return null;
  const tokenCount = count(value.tokenCount, MAX_TEXT_TOKENS);
  const featureCount = count(value.featureCount, MAX_TEXT_TOKENS);
  if (tokenCount === null || featureCount === null) return null;
  return {
    algorithm: 'simhash64-v1',
    value: value.value.toLowerCase(),
    tokenCount,
    featureCount,
    truncated: value.truncated === true,
  };
}

/** @param {unknown} raw */
function domComponent(raw) {
  const value = record(raw);
  if (!value || value.algorithm !== 'sha256' || value.parser !== 'static-tag-sequence-v1') return null;
  const digest = sha256(value.value);
  const nodeCount = count(value.nodeCount, MAX_HTML_TOKENS);
  if (!digest || nodeCount === null) return null;
  return {
    algorithm: 'sha256',
    value: digest,
    nodeCount,
    parser: 'static-tag-sequence-v1',
    truncated: value.truncated === true,
  };
}

/** @param {unknown} raw */
function formComponent(raw) {
  const value = record(raw);
  if (!value || value.algorithm !== 'sha256') return null;
  const digest = sha256(value.value);
  const formCount = count(value.formCount, MAX_FORMS);
  const controlCount = count(value.controlCount, MAX_FORM_CONTROLS);
  if (!digest || formCount === null || controlCount === null) return null;
  return {
    algorithm: 'sha256',
    value: digest,
    formCount,
    controlCount,
    truncated: value.truncated === true,
  };
}

/** @param {unknown} raw */
function resourceHostComponent(raw) {
  const value = record(raw);
  if (!value || value.algorithm !== 'set-sha256' || !Array.isArray(value.values)) return null;
  const values = new Set();
  for (const candidate of value.values.slice(0, MAX_BASELINE_RESOURCE_HOSTS * 4)) {
    const host = normalizeDomain(candidate);
    if (host) values.add(host);
    if (values.size >= MAX_BASELINE_RESOURCE_HOSTS) break;
  }
  const sorted = [...values].sort();
  const digest = value.value === null ? null : sha256(value.value);
  if ((sorted.length > 0 && !digest) || (sorted.length === 0 && value.value !== null)) return null;
  return {
    algorithm: 'set-sha256',
    value: digest,
    values: sorted,
    truncated: value.truncated === true || value.values.length > MAX_BASELINE_RESOURCE_HOSTS,
  };
}

/** @param {unknown} raw */
function identifierComponent(raw) {
  const value = record(raw);
  if (!value || value.algorithm !== 'set-sha256' || !Array.isArray(value.values)) return null;
  const values = [];
  const seen = new Set();
  for (const candidate of value.values.slice(0, MAX_BASELINE_IDENTIFIERS * 4)) {
    const item = record(candidate);
    if (!item || typeof item.type !== 'string' || typeof item.value !== 'string') continue;
    if (!/^[a-z-]{1,40}$/.test(item.type) || !/^[A-Z0-9-]{1,64}$/.test(item.value)) continue;
    const key = `${item.type}:${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({ type: item.type, value: item.value });
    if (values.length >= MAX_BASELINE_IDENTIFIERS) break;
  }
  values.sort((left, right) => left.type.localeCompare(right.type) || left.value.localeCompare(right.value));
  const digest = value.value === null ? null : sha256(value.value);
  if ((values.length > 0 && !digest) || (values.length === 0 && value.value !== null)) return null;
  return {
    algorithm: 'set-sha256',
    value: digest,
    values,
    truncated: value.truncated === true || value.values.length > MAX_BASELINE_IDENTIFIERS,
  };
}

/** @param {unknown} value */
function faviconSha(value) {
  return sha256(value);
}

/** @param {unknown} value */
function faviconPHash(value) {
  return typeof value === 'string' && isInformativeFaviconHash(value) ? value.toLowerCase() : null;
}

/**
 * Strictly normalizes a persisted baseline and drops every unknown field.
 * Unsupported/future schema versions and incomplete core fingerprint shapes
 * fail closed so old code never misinterprets newer evidence.
 * @param {unknown} raw
 */
export function normalizePageBaseline(raw) {
  const value = record(raw);
  if (!value || value.baselineVersion !== PAGE_BASELINE_VERSION) return null;
  const domain = normalizeDomain(value.domain);
  const lookupDomain = normalizeDomain(value.lookupDomain);
  const observedAt = timestamp(value.observedAt);
  const pageIdentityVersion = count(value.pageIdentityVersion, PAGE_IDENTITY_VERSION);
  const fingerprintVersion = count(value.fingerprintVersion, PAGE_FINGERPRINT_VERSION);
  const normalizedHtml = shaComponent(value.normalizedHtml, 'tokenCount', MAX_HTML_TOKENS);
  const domStructure = domComponent(value.domStructure);
  if (!domain || !lookupDomain || !observedAt || pageIdentityVersion !== PAGE_IDENTITY_VERSION
    || fingerprintVersion !== PAGE_FINGERPRINT_VERSION || !normalizedHtml || !domStructure) return null;

  const visibleText = value.visibleText == null ? null : visibleTextComponent(value.visibleText);
  const formStructure = value.formStructure == null ? null : formComponent(value.formStructure);
  const resourceHosts = resourceHostComponent(value.resourceHosts);
  const trackingIdentifiers = identifierComponent(value.trackingIdentifiers);
  if (!resourceHosts || !trackingIdentifiers) return null;
  const optionalComponentInvalid = (value.visibleText != null && !visibleText)
    || (value.formStructure != null && !formStructure);
  const truncated = value.truncated === true || optionalComponentInvalid || normalizedHtml.truncated || domStructure.truncated
    || visibleText?.truncated === true || formStructure?.truncated === true
    || resourceHosts.truncated || trackingIdentifiers.truncated;
  return {
    baselineVersion: PAGE_BASELINE_VERSION,
    domain,
    lookupDomain,
    observedAt,
    pageIdentityVersion,
    fingerprintVersion,
    pageTitle: boundedTitle(value.pageTitle),
    canonicalHost: value.canonicalHost == null ? null : normalizeDomain(value.canonicalHost) || null,
    faviconHash: faviconSha(value.faviconHash),
    faviconPHash: faviconPHash(value.faviconPHash),
    normalizedHtml,
    visibleText,
    domStructure,
    formStructure,
    resourceHosts,
    trackingIdentifiers,
    complete: value.complete === true && !truncated,
    truncated,
  };
}

/** @param {unknown} value */
function canonicalHost(value) {
  const item = record(value);
  if (!item || typeof item.url !== 'string' || item.url.length > 2048 || CONTROL_RE.test(item.url)) return null;
  try {
    const url = new URL(item.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? normalizeDomain(url.hostname) || null
      : null;
  } catch {
    return null;
  }
}

/**
 * Builds a baseline from one deep availability response. Returns null when
 * the response does not contain the current core page-fingerprint contract.
 * @param {unknown} rawDomain
 * @param {unknown} rawAvailability
 */
export function createPageBaseline(rawDomain, rawAvailability) {
  const domain = normalizeDomain(rawDomain);
  const availability = record(rawAvailability);
  const identity = record(availability?.pageIdentity);
  const fingerprints = record(identity?.fingerprints);
  if (!domain || !availability || !identity || !fingerprints || identity.source !== 'html') return null;
  return normalizePageBaseline({
    baselineVersion: PAGE_BASELINE_VERSION,
    domain,
    lookupDomain: normalizeDomain(availability.domain) || domain,
    observedAt: identity.observedAt,
    pageIdentityVersion: identity.identityVersion,
    fingerprintVersion: fingerprints.fingerprintVersion,
    pageTitle: availability.pageTitle,
    canonicalHost: canonicalHost(identity.canonical),
    faviconHash: availability.faviconHash,
    faviconPHash: availability.faviconPHash,
    normalizedHtml: fingerprints.normalizedHtml,
    visibleText: fingerprints.visibleText,
    domStructure: fingerprints.domStructure,
    formStructure: fingerprints.formStructure,
    resourceHosts: fingerprints.resourceHosts,
    trackingIdentifiers: fingerprints.identifiers,
    complete: identity.complete === true && fingerprints.complete === true,
    truncated: identity.truncated === true || fingerprints.truncated === true,
  });
}
