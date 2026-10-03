import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CT_RESPONSE_CERTIFICATE_GROUPS,
  MAX_CT_RESPONSE_DOMAINS_PER_GROUP,
  MAX_CT_RESPONSE_HOSTNAMES_PER_GROUP,
  MAX_CT_RESPONSE_HOSTNAMES_PER_MATCH,
  MAX_CT_RESPONSE_RESULTS,
  MAX_CT_RESPONSE_TIMESTAMP_LENGTH,
} from '../lib/ct-response-bounds.mts';
import {
  MIN_INFORMATIVE_HASH_BITS,
  hammingDistanceHex,
  isInformativePerceptualHash,
  isPerceptualHash,
} from '../lib/perceptual-hash-comparison.mts';
import {
  MAX_HTTP_ATTEMPTS as MAX_SHARED_HTTP_ATTEMPTS,
  MAX_HTTP_ERROR_LENGTH as MAX_SHARED_HTTP_ERROR_LENGTH,
  MAX_HTTP_EVIDENCE_REDIRECTS,
  MAX_HTTP_PROVENANCE_URL as MAX_SHARED_HTTP_PROVENANCE_URL,
} from '../lib/http-evidence-bounds.mts';
import { MAX_CANDIDATE_SOURCE_LENGTH } from '../lib/candidate-provenance-bounds.mts';
import {
  recordOrEmpty,
  recordOrNull,
} from '../lib/bounded-contract-normalizers.mts';
import {
  WHOISLEUTH_PROJECT_URL,
  WHOISLEUTH_REQUEST_POLICY_URL,
  WHOISLEUTH_SITE_ORIGIN,
  WHOISLEUTH_SOURCE_ISSUES_URL,
  WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL,
  WHOISLEUTH_SOURCE_REPOSITORY_URL,
} from '../lib/project-metadata.mts';
import {
  normalizeBoundedSemanticVersion,
  normalizeBoundedStableSemanticVersion,
} from '../lib/semantic-version.mts';
import {
  MAX_CT_CANDIDATES,
  MAX_CT_CERTIFICATE_GROUPS,
  MAX_CT_GROUP_DOMAINS,
  MAX_CT_GROUP_HOSTNAMES,
  MAX_CT_HOSTNAMES,
  MAX_CT_TIMESTAMP_LENGTH,
  MAX_CT_SOURCE_LENGTH,
} from '../frontend/src/lib/analysis/ct-results.ts';
import { MAX_SOURCE_LENGTH } from '../frontend/src/lib/candidate-handoff-core.ts';
import { MAX_HTTP_SUMMARY_REDIRECTS } from '../frontend/src/lib/analysis/http-summary.ts';
import {
  MAX_HTTP_ATTEMPTS,
  MAX_HTTP_ERROR_LENGTH,
  MAX_HTTP_PROVENANCE_URL,
  MAX_HTTP_REDIRECTS,
} from '../lib/http-intelligence.mts';

test('certificate response normalizer exposes the shared collector bounds', () => {
  assert.equal(MAX_CT_CANDIDATES, MAX_CT_RESPONSE_RESULTS);
  assert.equal(MAX_CT_HOSTNAMES, MAX_CT_RESPONSE_HOSTNAMES_PER_MATCH);
  assert.equal(MAX_CT_TIMESTAMP_LENGTH, MAX_CT_RESPONSE_TIMESTAMP_LENGTH);
  assert.equal(MAX_CT_CERTIFICATE_GROUPS, MAX_CT_RESPONSE_CERTIFICATE_GROUPS);
  assert.equal(MAX_CT_GROUP_DOMAINS, MAX_CT_RESPONSE_DOMAINS_PER_GROUP);
  assert.equal(MAX_CT_GROUP_HOSTNAMES, MAX_CT_RESPONSE_HOSTNAMES_PER_GROUP);
});

test('perceptual hash validation and comparison use one browser-safe contract', () => {
  assert.equal(MIN_INFORMATIVE_HASH_BITS, 10);
  assert.equal(isPerceptualHash('0123456789abcdef'), true);
  assert.equal(isPerceptualHash('0123456789abcdeg'), false);
  assert.equal(isInformativePerceptualHash('0000000000000000'), false);
  assert.equal(isInformativePerceptualHash('0f0f0f0f0f0f0f0f'), true);
  assert.equal(hammingDistanceHex('0000000000000000', 'ffffffffffffffff'), 64);
});

test('rich and compact HTTP evidence share the retained redirect bound', () => {
  assert.equal(MAX_HTTP_EVIDENCE_REDIRECTS, 5);
  assert.equal(MAX_HTTP_REDIRECTS, MAX_HTTP_EVIDENCE_REDIRECTS);
  assert.equal(MAX_HTTP_SUMMARY_REDIRECTS, MAX_HTTP_EVIDENCE_REDIRECTS);
  assert.equal(MAX_HTTP_ATTEMPTS, MAX_SHARED_HTTP_ATTEMPTS);
  assert.equal(MAX_HTTP_PROVENANCE_URL, MAX_SHARED_HTTP_PROVENANCE_URL);
  assert.equal(MAX_HTTP_ERROR_LENGTH, MAX_SHARED_HTTP_ERROR_LENGTH);
});

test('candidate collectors and handoffs share the provenance-label bound', () => {
  assert.equal(MAX_CANDIDATE_SOURCE_LENGTH, 253);
  assert.equal(MAX_CT_SOURCE_LENGTH, MAX_CANDIDATE_SOURCE_LENGTH);
  assert.equal(MAX_SOURCE_LENGTH, MAX_CANDIDATE_SOURCE_LENGTH);
});

test('shared record coercion keeps null and empty-object failure modes explicit', () => {
  const value = { state: 'observed' };
  assert.equal(recordOrNull(value), value);
  assert.equal(recordOrEmpty(value), value);
  assert.equal(recordOrNull([]), null);
  assert.deepEqual(recordOrEmpty([]), {});
  assert.equal(recordOrNull(null), null);
  assert.deepEqual(recordOrEmpty(null), {});
});

test('public project URLs derive from one canonical origin', () => {
  assert.equal(WHOISLEUTH_SITE_ORIGIN, 'https://www.whoisleuth.com');
  assert.equal(WHOISLEUTH_PROJECT_URL, `${WHOISLEUTH_SITE_ORIGIN}/`);
  assert.equal(WHOISLEUTH_REQUEST_POLICY_URL, `${WHOISLEUTH_SITE_ORIGIN}/request-policy`);
  assert.equal(WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL, `git+${WHOISLEUTH_SOURCE_REPOSITORY_URL}.git`);
  assert.equal(WHOISLEUTH_SOURCE_ISSUES_URL, `${WHOISLEUTH_SOURCE_REPOSITORY_URL}/issues`);
});

test('release, runtime, and frontend versions share strict semantic-version parsing', () => {
  assert.equal(normalizeBoundedSemanticVersion('1.2.3-rc.1+build.4'), '1.2.3-rc.1+build.4');
  assert.equal(normalizeBoundedStableSemanticVersion('1.2.3'), '1.2.3');
  assert.throws(() => normalizeBoundedSemanticVersion('1.2.3-01'), /leading zeroes/u);
  assert.throws(() => normalizeBoundedSemanticVersion(' 1.2.3'), /bounded semantic-version/u);
  assert.throws(() => normalizeBoundedStableSemanticVersion('1.2.3-rc.1'), /prerelease or build/u);
  assert.throws(() => normalizeBoundedStableSemanticVersion('1.2.3+build.4'), /prerelease or build/u);
});
