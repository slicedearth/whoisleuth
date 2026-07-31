import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildInvestigationLineage,
  INVESTIGATION_LINEAGE_VERSION,
  MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED,
} from '../frontend/src/lib/analysis/investigation-lineage.ts';
import {
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
} from '../frontend/src/lib/analysis/investigation-projection.ts';

const NOW = '2026-07-31T00:00:00.000Z';

function projection(overrides: Record<string, unknown> = {}) {
  return {
    schema: INVESTIGATION_PROJECTION_SCHEMA,
    version: INVESTIGATION_PROJECTION_VERSION,
    generatedAt: NOW,
    sources: {},
    entities: [
      { id: 'case:a', type: 'case', canonical: 'case-a', label: 'Case A' },
      { id: 'domain:a', type: 'domain', canonical: 'a.invalid', label: 'a.invalid' },
      { id: 'ip:one', type: 'ip_address', canonical: '192.0.2.1', label: '192.0.2.1' },
      { id: 'certificate:one', type: 'certificate', canonical: 'abc', label: 'Certificate abc' },
    ],
    observations: [],
    relationships: [
      {
        id: 'relationship:root',
        type: 'case_documents_domain',
        from: 'case:a',
        to: 'domain:a',
        classification: 'direct',
        method: 'Explicit case evidence',
      },
      {
        id: 'relationship:ip',
        type: 'domain_resolved_to_ip',
        from: 'domain:a',
        to: 'ip:one',
        classification: 'normalized',
        method: 'Exact normalized address',
        complete: true,
        truncated: false,
        limitations: ['Shared hosting is common.'],
      },
      {
        id: 'relationship:certificate',
        type: 'domain_presented_certificate',
        from: 'ip:one',
        to: 'certificate:one',
        classification: 'derived',
        method: 'Observed endpoint certificate',
        complete: null,
        truncated: false,
      },
    ],
    limitations: [],
    truncated: false,
    ...overrides,
  };
}

describe('bounded investigation lineage', () => {
  test('derives deterministic multi-hop paths from explicit domain roots', () => {
    const result = buildInvestigationLineage(projection());
    assert.equal(result.version, INVESTIGATION_LINEAGE_VERSION);
    assert.equal(result.state, 'ready');
    assert.equal(result.paths.length, 2);

    const direct = result.paths.find((path) => path.target.id === 'ip:one');
    const nested = result.paths.find((path) => path.target.id === 'certificate:one');
    assert.ok(direct);
    assert.ok(nested);
    assert.equal(direct.seed.id, 'domain:a');
    assert.deepEqual(direct.seedMethods, ['case_documents_domain']);
    assert.equal(direct.hopCount, 1);
    assert.equal(direct.scopeDistance, 1);
    assert.equal(direct.immediateParent.id, 'domain:a');
    assert.equal(direct.classification, 'normalized');
    assert.equal(direct.complete, true);
    assert.deepEqual(direct.limitations, ['Shared hosting is common.']);
    assert.equal(nested.hopCount, 2);
    assert.equal(nested.immediateParent.id, 'ip:one');
    assert.equal(nested.classification, 'derived');
    assert.equal(nested.complete, null);
    assert.deepEqual(nested.steps.map((step) => step.relationshipId), [
      'relationship:ip',
      'relationship:certificate',
    ]);

    assert.deepEqual(buildInvestigationLineage(projection()), result);
  });

  test('does not treat unanchored domains as investigation roots', () => {
    const value = projection();
    value.relationships = value.relationships.filter((item) => item.id !== 'relationship:root');
    const result = buildInvestigationLineage(value);
    assert.equal(result.state, 'ready');
    assert.deepEqual(result.paths, []);
  });

  test('stops cycles and reports malformed or future projections explicitly', () => {
    const value = projection();
    value.relationships.push({
      id: 'relationship:cycle',
      type: 'ip_resolves_to_domain',
      from: 'certificate:one',
      to: 'domain:a',
      classification: 'derived',
      method: 'Synthetic cycle',
    });
    const cycle = buildInvestigationLineage(value);
    assert.equal(cycle.paths.length, 2);
    assert.equal(buildInvestigationLineage(null).state, 'absent');
    assert.equal(buildInvestigationLineage({ schema: 'wrong', version: 1 }).state, 'invalid');
    assert.equal(buildInvestigationLineage({
      ...projection(),
      version: INVESTIGATION_PROJECTION_VERSION + 1,
    }).state, 'unsupported');
  });

  test('caps paths per seed and discloses truncation', () => {
    const value = projection({
      entities: [
        { id: 'case:a', type: 'case', canonical: 'case-a', label: 'Case A' },
        { id: 'domain:a', type: 'domain', canonical: 'a.invalid', label: 'a.invalid' },
        ...Array.from({ length: MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED + 1 }, (_, index) => ({
          id: `ip:${index}`,
          type: 'ip_address',
          canonical: `192.0.2.${index}`,
          label: `192.0.2.${index}`,
        })),
      ],
      relationships: [
        {
          id: 'relationship:root',
          type: 'case_documents_domain',
          from: 'case:a',
          to: 'domain:a',
          classification: 'direct',
          method: 'Explicit case evidence',
        },
        ...Array.from({ length: MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED + 1 }, (_, index) => ({
          id: `relationship:${String(index).padStart(3, '0')}`,
          type: 'domain_resolved_to_ip',
          from: 'domain:a',
          to: `ip:${index}`,
          classification: 'normalized',
          method: 'Exact normalized address',
        })),
      ],
    });
    const result = buildInvestigationLineage(value);
    assert.equal(result.paths.length, MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED);
    assert.equal(result.truncated, true);
    assert.match(result.limitations.at(-1) ?? '', /omitted/u);
  });

  test('does not mutate untrusted projection input', () => {
    const value = projection();
    const before = structuredClone(value);
    buildInvestigationLineage(value);
    assert.deepEqual(value, before);
  });
});
