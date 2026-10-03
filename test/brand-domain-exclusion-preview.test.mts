import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_BRAND_PREVIEW_DOMAINS, partitionBrandCandidates, previewBrandDomainExclusions,
  profileDomainKind, profileDomainMatch, type BrandProfileSignalProfile,
} from '../frontend/src/lib/analysis/brand-profile-signals.ts';
import { MAX_ALLOWLIST_DRAFT_CHARACTERS } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { MAX_GENERATED_CONTEXT } from '../frontend/src/lib/candidate-handoff-core.ts';

function profile(patch: Partial<BrandProfileSignalProfile> = {}): BrandProfileSignalProfile {
  return { officialDomains: ['official.example'], approvedPartnerDomains: ['partner.example'],
    allowlistedDomains: ['allowed.example'], officialFaviconHash: '', officialFaviconPHash: '', ...patch };
}

test('exact exclusion explanations preserve role precedence and the existing matcher', () => {
  const current = profile({ officialDomains: ['Shared.Example.'], approvedPartnerDomains: ['shared.example'], allowlistedDomains: ['shared.example'] });
  const result = profileDomainMatch(' SHARED.EXAMPLE. ', current);
  assert.deepEqual(result, { kind: 'official', matchedDomain: 'shared.example', reason: 'Exact official-domain declaration' });
  assert.equal(result?.kind, profileDomainKind('shared.example', current));
  assert.equal(profileDomainMatch('sub.shared.example', current), null);
  assert.equal(profileDomainMatch('unshared.example', current), null);
  assert.equal(profileDomainMatch('shared.example', null), null);
});

test('partner and allowlist explanations identify different exact declarations', () => {
  assert.equal(profileDomainMatch('partner.example', profile())?.kind, 'partner');
  assert.equal(profileDomainMatch('allowed.example', profile())?.kind, 'allowlisted');
  assert.match(profileDomainMatch('partner.example', profile())?.reason ?? '', /approved-partner/u);
  assert.match(profileDomainMatch('allowed.example', profile())?.reason ?? '', /allowlist entry/u);
});

test('partition preserves independent candidate records and source order without mutation', () => {
  const candidates = [
    { domain: 'allowed.example', source: 'one', mutationTypes: ['keyword'] },
    { domain: 'sub.allowed.example', source: 'two', mutationTypes: ['dictionary'] },
    { domain: 'allowed.example', source: 'three', mutationTypes: ['certificate'] },
  ];
  const before = structuredClone(candidates), current = profile();
  const result = partitionBrandCandidates(candidates, current);
  assert.deepEqual(result.filtered, [candidates[1]]);
  assert.deepEqual(result.excluded.map(row => row.candidate.source), ['one', 'three']);
  assert.equal(result.excluded[0]?.candidate, candidates[0]);
  assert.equal(result.truncated, false);
  assert.deepEqual(candidates, before);
});

test('unavailable and loading profile context never imply an evaluated exclusion', () => {
  const candidates = [{ domain: 'allowed.example' }];
  for (const state of ['loading', 'unavailable'] as const) {
    const result = partitionBrandCandidates(candidates, profile(), state);
    assert.deepEqual(result.filtered, candidates);
    assert.deepEqual(result.excluded, []);
    assert.ok(result.limitation);
    assert.equal(previewBrandDomainExclusions('allowed.example', profile(), profile(), state).state, 'unavailable');
  }
});

test('candidate partition bounds admission before constructing excluded rows', () => {
  const candidates = Array.from({ length: MAX_GENERATED_CONTEXT + 1 }, () => ({ domain: 'allowed.example' }));
  const result = partitionBrandCandidates(candidates, profile());
  assert.equal(result.excluded.length, MAX_GENERATED_CONTEXT);
  assert.equal(result.truncated, true);
  assert.equal(result.filtered.length, 0);
});

test('saved-versus-draft preview explains exact addition and removal without changing lists', () => {
  const saved = profile(), draft = profile({ allowlistedDomains: ['added.example'] });
  const before = structuredClone({ saved, draft });
  const result = previewBrandDomainExclusions('allowed.example, added.example, sub.added.example, official.example', saved, draft);
  assert.equal(result.state, 'ready');
  assert.equal(result.newlyExcluded, 1);
  assert.equal(result.returned, 1);
  assert.deepEqual(result.rows.map(row => row.change), ['returned', 'newly_excluded', 'unchanged', 'unchanged']);
  assert.equal(result.rows[2]?.after, null);
  assert.equal(result.rows[3]?.after?.kind, 'official');
  assert.deepEqual({ saved, draft }, before);
});

test('removing an overlapping allowlist entry does not remove official or partner scope', () => {
  const saved = profile({ allowlistedDomains: ['official.example', 'partner.example'] }), draft = profile({ allowlistedDomains: [] });
  const result = previewBrandDomainExclusions('official.example\npartner.example', saved, draft);
  assert.equal(result.returned, 0);
  assert.deepEqual(result.rows.map(row => row.after?.kind), ['official', 'partner']);
});

test('previews remain scoped to the supplied Brand and do not consult another profile', () => {
  const first = profile({ allowlistedDomains: ['candidate.example'] }), second = profile({ allowlistedDomains: [] });
  assert.equal(previewBrandDomainExclusions('candidate.example', first, first).rows[0]?.after?.kind, 'allowlisted');
  assert.equal(previewBrandDomainExclusions('candidate.example', second, second).rows[0]?.after, null);
});

test('a declaration-kind change remains visible without pretending the candidate was newly excluded', () => {
  const saved = profile(), draft = profile({ approvedPartnerDomains: ['allowed.example'] });
  const result = previewBrandDomainExclusions('allowed.example', saved, draft);
  assert.equal(result.rows[0]?.before?.kind, 'allowlisted');
  assert.equal(result.rows[0]?.after?.kind, 'partner');
  assert.equal(result.rows[0]?.change, 'unchanged');
  assert.equal(result.newlyExcluded, 0);
});

test('preview uses existing domain input normalization and canonical deduplication', () => {
  const result = previewBrandDomainExclusions('domain\nAllowed.Example.\nallowed.example', profile(), profile());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.domain, 'allowed.example');
  assert.equal(result.rows[0]?.before?.kind, 'allowlisted');
});

test('invalid names, patterns, URLs and non-text input reject the whole preview', () => {
  for (const input of ['valid.example\n*.example', 'https://allowed.example/path', 'allowed.example?query=value',
    'allowed.example\nnot_a_domain', 'allowed.example\n127.0.0.1', 'allowed.example\u0000', '', null]) {
    const result = previewBrandDomainExclusions(input, profile(), profile());
    assert.equal(result.state, 'invalid');
    assert.deepEqual(result.rows, []);
  }
});

test('oversized previews fail closed rather than showing an arbitrary partial impact', () => {
  for (const input of ['a'.repeat(MAX_ALLOWLIST_DRAFT_CHARACTERS + 1),
    Array.from({ length: MAX_BRAND_PREVIEW_DOMAINS + 1 }, (_, index) => `domain-${index}.example`).join('\n')]) {
    const result = previewBrandDomainExclusions(input, profile(), profile());
    assert.equal(result.state, 'invalid');
    assert.equal(result.rows.length, 0);
  }
});
