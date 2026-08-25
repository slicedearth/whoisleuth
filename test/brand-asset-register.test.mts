import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBrandAssetRegister,
  MAX_BRAND_ASSET_CASE_REFERENCES,
  MAX_BRAND_ASSET_RELATIONSHIP_REFERENCES,
  MAX_BRAND_ASSET_ROWS,
} from '../frontend/src/lib/analysis/brand-asset-register.ts';

const PROFILE_ID = 'profile-main';
const OTHER_PROFILE_ID = 'profile-other';
const NOW = '2026-08-13T00:00:00.000Z';
const LATER = '2026-08-13T01:00:00.000Z';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    name: 'Fixture profile',
    officialDomains: ['official.example'],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    updatedAt: NOW,
    ...overrides,
  };
}

function caseRecord(
  id: string,
  domain: string,
  brandProfileIds: string[] = [PROFILE_ID],
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    domain,
    brandProfileIds,
    source: 'manual',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function relationship(
  id: string,
  domains: string[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    type: 'nameserver_set',
    label: 'Untrusted label',
    method: 'Untrusted method',
    normalizedValue: 'ns1.private.example',
    displayValue: 'must-not-project',
    domains,
    source: 'bulk_relationship_analysis',
    sourceVersion: 1,
    observedAt: NOW,
    retainedAt: NOW,
    complete: true,
    truncated: false,
    limitations: ['must-not-project'],
    ...overrides,
  };
}

function readyInput(overrides: Record<string, unknown> = {}) {
  return {
    profiles: [profile()],
    activeProfileId: PROFILE_ID,
    cases: [],
    relationships: [],
    sourceStates: {
      profiles: 'ready',
      activePreference: 'ready',
      cases: 'ready',
      relationships: 'ready',
    },
    ...overrides,
  } as const;
}

test('merges authored, exact Case, and observed overlap without upgrading the primary role', () => {
  const projection = buildBrandAssetRegister(readyInput({
    profiles: [profile({
      officialDomains: ['overlap.example'],
      approvedPartnerDomains: ['overlap.example'],
      allowlistedDomains: ['overlap.example'],
    })],
    cases: [caseRecord('case-overlap', 'overlap.example')],
    relationships: [relationship('relationship-overlap', ['overlap.example', 'lead.example'])],
  }));

  assert.equal(projection.state, 'ready');
  assert.deepEqual(projection.rows.map((row) => row.domain), ['overlap.example', 'lead.example']);
  const overlap = projection.rows[0]!;
  assert.equal(overlap.primaryClassification, 'authored_official');
  assert.deepEqual(overlap.classifications, [
    'authored_official',
    'authored_partner',
    'authored_allowlisted',
    'retained_case_scope',
    'observed_relationship_lead',
  ]);
  assert.equal(overlap.explanations.length, 4);
  assert.match(overlap.explanations.at(-1) ?? '', /more than one authored role/u);
  assert.equal(projection.rows[1]?.primaryClassification, 'observed_relationship_lead');
});

test('deduplicates duplicate observations and remains deterministic when observations are reordered', () => {
  const older = relationship('relationship-shared', ['official.example', 'lead.example']);
  const newer = relationship('relationship-shared', ['official.example', 'lead.example'], {
    observedAt: LATER,
    retainedAt: LATER,
  });
  const distinct = relationship('relationship-distinct', ['official.example', 'lead.example'], {
    observedAt: LATER,
  });
  const tiedComplete = relationship('relationship-tied', ['official.example', 'complete-tie.example']);
  const tiedPartial = relationship('relationship-tied', ['official.example', 'partial-tie.example'], {
    complete: false,
    truncated: true,
  });
  const left = buildBrandAssetRegister(readyInput({
    relationships: [older, tiedComplete, newer, distinct, tiedPartial, newer],
  }));
  const right = buildBrandAssetRegister(readyInput({
    relationships: [tiedPartial, newer, distinct, older, tiedComplete, newer],
  }));

  assert.deepEqual(left, right);
  const lead = left.rows.find((row) => row.domain === 'lead.example')!;
  assert.deepEqual(lead.relationshipReferences.map((reference) => reference.id), [
    'relationship-shared',
    'relationship-distinct',
  ]);
  assert.equal(lead.timestamps.latestObservedAt, LATER);
  assert.equal(left.rows.some((row) => row.domain === 'complete-tie.example'), false);
  assert.equal(left.rows.find((row) => row.domain === 'partial-tie.example')?.observationalCompleteness, 'partial');
});

test('keeps source unavailability distinct from a ready-empty source', () => {
  const empty = buildBrandAssetRegister(readyInput());
  assert.equal(empty.state, 'ready');
  assert.equal(empty.sources.cases.recordCount, 0);
  assert.equal(empty.sources.relationships.recordCount, 0);
  assert.equal(empty.rows[0]?.coverage, 'complete');
  assert.equal(empty.rows[0]?.observationalCompleteness, 'not_applicable');

  const unavailable = buildBrandAssetRegister(readyInput({
    sourceStates: {
      profiles: 'ready',
      activePreference: 'ready',
      cases: 'unavailable',
      relationships: 'unavailable',
    },
  }));
  assert.equal(unavailable.state, 'partial');
  assert.equal(unavailable.sources.cases.recordCount, null);
  assert.equal(unavailable.sources.relationships.recordCount, null);
  assert.equal(unavailable.rows[0]?.coverage, 'partial');
  assert.equal(unavailable.rows[0]?.observationalCompleteness, 'not_applicable');

  const profileUnavailable = buildBrandAssetRegister(readyInput({
    sourceStates: {
      profiles: 'unavailable',
      activePreference: 'ready',
      cases: 'ready',
      relationships: 'ready',
    },
  }));
  assert.equal(profileUnavailable.state, 'unavailable');
  assert.deepEqual(profileUnavailable.rows, []);
});

test('reports loading, no-active-profile, and unresolved-active-profile as separate states', () => {
  const loading = buildBrandAssetRegister(readyInput({
    sourceStates: {
      profiles: 'loading',
      activePreference: 'ready',
      cases: 'ready',
      relationships: 'ready',
    },
  }));
  assert.equal(loading.state, 'loading');
  assert.deepEqual(loading.rows, []);

  const absent = buildBrandAssetRegister(readyInput({ activeProfileId: '' }));
  assert.equal(absent.state, 'no_active_profile');

  const unresolved = buildBrandAssetRegister(readyInput({ activeProfileId: 'missing-profile' }));
  assert.equal(unresolved.state, 'unresolved_active_profile');
  assert.equal(unresolved.activeProfileId, 'missing-profile');
});

test('marks incomplete and truncated observation evidence as partial', () => {
  const projection = buildBrandAssetRegister(readyInput({
    relationships: [relationship('relationship-partial', ['official.example', 'lead.example'], {
      complete: false,
      truncated: true,
    })],
  }));
  assert.equal(projection.state, 'partial');
  const lead = projection.rows.find((row) => row.domain === 'lead.example')!;
  assert.equal(lead.observationalCompleteness, 'partial');
  assert.equal(lead.coverage, 'partial');
  assert.equal(lead.relationshipReferences[0]?.completeness, 'partial');
});

test('normalizes IDNA domains before exact FQDN deduplication', () => {
  const projection = buildBrandAssetRegister(readyInput({
    profiles: [profile({ officialDomains: ['café.example'] })],
    cases: [caseRecord('case-idna', 'xn--caf-dma.example')],
  }));
  assert.equal(projection.rows.length, 1);
  assert.equal(projection.rows[0]?.key, 'FQDN/xn--caf-dma.example');
  assert.deepEqual(projection.rows[0]?.classifications, ['authored_official', 'retained_case_scope']);
});

test('excludes unrelated profiles and Cases from the direct anchor set', () => {
  const projection = buildBrandAssetRegister(readyInput({
    profiles: [
      profile(),
      profile({ id: OTHER_PROFILE_ID, officialDomains: ['unrelated.example'] }),
    ],
    cases: [caseRecord('case-other', 'other-case.example', [OTHER_PROFILE_ID])],
    relationships: [relationship('relationship-unrelated', ['unrelated.example', 'excluded-lead.example'])],
  }));
  assert.deepEqual(projection.rows.map((row) => row.domain), ['official.example']);
  assert.equal(projection.sources.cases.matchedCount, 0);
  assert.equal(projection.sources.relationships.matchedCount, 0);
});

test('qualifies official-asset hosts only on exact or label-boundary subdomain matches', () => {
  const exact = relationship('relationship-asset-exact', ['exact-lead.example'], {
    type: 'official_asset',
    normalizedValue: 'official.example',
  });
  const subdomain = relationship('relationship-asset-subdomain', ['subdomain-lead.example'], {
    type: 'official_asset',
    normalizedValue: 'cdn.official.example',
  });
  const suffixTrap = relationship('relationship-asset-suffix-trap', ['suffix-trap.example'], {
    type: 'official_asset',
    normalizedValue: 'not-official.example',
  });
  const childTrap = relationship('relationship-asset-child-trap', ['child-trap.example'], {
    type: 'official_asset',
    normalizedValue: 'official.example.attacker.invalid',
  });
  const projection = buildBrandAssetRegister(readyInput({
    relationships: [suffixTrap, exact, childTrap, subdomain],
  }));
  assert.deepEqual(projection.rows.map((row) => row.domain), [
    'official.example',
    'exact-lead.example',
    'subdomain-lead.example',
  ]);
});

test('freezes direct anchors so observed candidates cannot expand transitively', () => {
  const projection = buildBrandAssetRegister(readyInput({
    relationships: [
      relationship('relationship-first-hop', ['official.example', 'first-hop.example']),
      relationship('relationship-second-hop', ['first-hop.example', 'second-hop.example']),
    ],
  }));
  assert.deepEqual(projection.rows.map((row) => row.domain), ['official.example', 'first-hop.example']);
  assert.equal(projection.sources.relationships.matchedCount, 1);
});

test('preserves every direct row and deterministically caps candidate output', () => {
  const relationships = Array.from({ length: 300 }, (_, observationIndex) => relationship(
    `relationship-${observationIndex}`,
    [
      'official.example',
      ...Array.from({ length: 49 }, (_, domainIndex) => `candidate-${observationIndex}-${domainIndex}.invalid`),
    ],
    {
      observedAt: new Date(Date.parse(NOW) + observationIndex * 1_000).toISOString(),
      retainedAt: new Date(Date.parse(NOW) + observationIndex * 500).toISOString(),
    },
  ));
  const projection = buildBrandAssetRegister(readyInput({ relationships }));
  assert.equal(projection.rows.length, MAX_BRAND_ASSET_ROWS);
  assert.ok(projection.rows.some((row) => row.domain === 'official.example'));
  assert.equal(projection.omissions.rows, 12_701);
  assert.equal(projection.omissions.relationshipReferences, 288);
  assert.equal(projection.state, 'partial');
  assert.ok(projection.rows.some((row) => row.domain === 'candidate-299-0.invalid'));
  assert.equal(projection.rows.some((row) => row.domain === 'candidate-0-0.invalid'), false);
});

test('uses independent latest observation and retention times for capped candidate ordering', () => {
  const highPriorityRelationships = Array.from({ length: 41 }, (_, observationIndex) => relationship(
    `relationship-high-${observationIndex}`,
    [
      'official.example',
      ...Array.from(
        { length: observationIndex < 40 ? 49 : 38 },
        (_, domainIndex) => `high-${observationIndex}-${domainIndex}.invalid`,
      ),
    ],
    {
      observedAt: '2026-08-14T00:00:00.000Z',
      retainedAt: NOW,
    },
  ));
  const projection = buildBrandAssetRegister(readyInput({
    relationships: [
      ...highPriorityRelationships,
      relationship('relationship-order-common', [
        'official.example',
        'a-lower-retention.invalid',
        'z-higher-retention.invalid',
      ]),
      relationship('relationship-order-lower', ['official.example', 'a-lower-retention.invalid'], {
        observedAt: '2026-08-12T00:00:00.000Z',
        retainedAt: '2026-08-14T00:00:00.000Z',
      }),
      relationship('relationship-order-higher', ['official.example', 'z-higher-retention.invalid'], {
        observedAt: '2026-08-12T00:00:00.000Z',
        retainedAt: '2026-08-15T00:00:00.000Z',
      }),
    ],
  }));

  assert.equal(projection.rows.length, MAX_BRAND_ASSET_ROWS);
  assert.equal(projection.omissions.rows, 1);
  assert.equal(projection.rows.some((row) => row.domain === 'z-higher-retention.invalid'), true);
  assert.equal(projection.rows.some((row) => row.domain === 'a-lower-retention.invalid'), false);
});

test('caps per-row Case and relationship provenance and reports exact omissions', () => {
  const cases = Array.from({ length: 15 }, (_, index) => caseRecord(`case-${index}`, 'official.example', [PROFILE_ID], {
    createdAt: new Date(Date.parse(NOW) + index * 1_000).toISOString(),
  }));
  const relationships = Array.from({ length: 15 }, (_, index) => relationship(
    `relationship-${index}`,
    ['official.example'],
    { observedAt: new Date(Date.parse(NOW) + index * 1_000).toISOString() },
  ));
  const projection = buildBrandAssetRegister(readyInput({ cases, relationships }));
  const row = projection.rows[0]!;
  assert.equal(row.caseReferences.length, MAX_BRAND_ASSET_CASE_REFERENCES);
  assert.equal(row.relationshipReferences.length, MAX_BRAND_ASSET_RELATIONSHIP_REFERENCES);
  assert.equal(projection.omissions.caseReferences, 3);
  assert.equal(projection.omissions.relationshipReferences, 3);
  assert.equal(row.coverage, 'partial');
  assert.equal(row.observationalCompleteness, 'partial');
});

test('enforces hard source input caps without treating truncation as completeness', () => {
  const relationships = Array.from({ length: 1_201 }, (_, index) => relationship(
    `relationship-input-${index}`,
    ['official.example', `input-${index}.invalid`],
  ));
  const projection = buildBrandAssetRegister(readyInput({ relationships }));
  assert.equal(projection.sources.relationships.recordCount, 300);
  assert.equal(projection.sources.relationships.truncated, true);
  assert.equal(projection.state, 'partial');
});

test('serialized projection excludes sensitive and unapproved source fields without mutating inputs', () => {
  const input = readyInput({
    profiles: [profile({
      name: 'Sensitive profile name',
      trademarkOwner: 'Private owner',
      trademarkRegistration: 'Private registration',
      pageBaseline: { rawHtml: '<main>private</main>' },
      futureSchemaField: { privateMarker: 'profile-private-value' },
    })],
    cases: [caseRecord('case-private', 'case.example', [PROFILE_ID], {
      notes: [{ body: 'case-secret' }],
      tags: ['case-private-tag'],
      evidenceHistory: [{ rawWhois: 'whois-secret', contact: 'person@example.invalid' }],
      decisions: [{ value: 'private-decision' }],
      actions: [{ value: 'private-action' }],
      assertions: [{ value: 'private-assertion' }],
      score: 99,
    })],
    relationships: [relationship('relationship-private', ['official.example', 'lead.example'], {
      normalizedValue: 'pivot-secret',
      displayValue: 'display-secret',
      limitations: ['relationship-secret'],
      completeUrl: 'https://private.example/path?marker=private-value#fragment',
    })],
  });
  const before = structuredClone(input);
  const serialized = JSON.stringify(buildBrandAssetRegister(input));
  assert.deepEqual(input, before);
  for (const forbidden of [
    'Sensitive profile name',
    'Private owner',
    'Private registration',
    'profile-private-value',
    'case-secret',
    'case-private-tag',
    'whois-secret',
    'person@example.invalid',
    'private-decision',
    'private-action',
    'private-assertion',
    'pivot-secret',
    'display-secret',
    'relationship-secret',
    'https://private.example',
    'marker=private-value',
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
});
