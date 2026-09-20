import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildInvestigationLineage,
  INVESTIGATION_LINEAGE_VERSION,
  MAX_INVESTIGATION_LINEAGE_PATHS,
  MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED,
  MAX_INVESTIGATION_LINEAGE_STEPS,
} from '../frontend/src/lib/analysis/investigation-lineage.ts';
import {
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
  buildInvestigationProjection,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.ts';
import { BRAND_PROFILE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { CAMPAIGN_SCHEMA_VERSION } from '../frontend/src/lib/analysis/campaign-model.ts';

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

  test('visits dense cyclic mail graphs once per seed without exhausting the structural work bound', () => {
    const domains = Array.from({ length: 10 }, (_, index) => `domain-${index}.test`);
    const graph = buildInvestigationProjection({
      cases: { version: CASE_SCHEMA_VERSION, cases: domains.map((domain, index) => ({
        id: `case-${index}`, domain, status: 'reviewing', disposition: 'unreviewed',
        source: 'lookup', createdAt: NOW, updatedAt: NOW, evidenceHistory: [],
        evidencePins: domains.filter((target) => target !== domain).map((target, pinIndex) => ({
          id: `pin-${index}-${pinIndex}`, field: 'MX', category: 'dns',
          label: 'Imported mail-server observation', value: `10 ${target}`,
          source: 'Reviewed DNS observations', sourceSchema: {
            collection: 'external_observations', schema: 'whoisleuth.dns-observation-rows', version: 1,
          },
          observedAt: NOW, createdAt: NOW, completeness: 'complete', limitations: [],
        })),
      })) },
      brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [] },
      campaigns: { version: CAMPAIGN_SCHEMA_VERSION, campaigns: [] },
      relationshipRows: [],
    }, { generatedAt: NOW });
    assert.equal(graph.relationships.filter((edge) => edge.type === 'domain_uses_mail_server').length, 90);
    assert.equal(graph.truncated, false);
    const result = buildInvestigationLineage(graph);
    assert.equal(result.state, 'ready');
    assert.equal(result.paths.length, 90);
    assert.equal(result.truncated, false);
    for (const seed of domains) {
      const paths = result.paths.filter((path) => path.seed.label === seed);
      assert.deepEqual(paths.map((path) => path.target.label).sort(), domains.filter((target) => target !== seed).sort());
      assert.ok(paths.every((path) => path.hopCount === 1 && path.steps.length === 1));
    }
    assert.deepEqual(buildInvestigationLineage({
      ...graph, entities: [...graph.entities].reverse(), relationships: [...graph.relationships].reverse(),
    }), result);
  });

  test('keeps the first shortest path and its incomplete provenance instead of choosing a favourable alternative', () => {
    const value = projection();
    value.relationships = [
      value.relationships[0]!,
      { ...value.relationships[1]!, id: 'relationship:a-first', complete: false,
        truncated: true, limitations: ['First observation was incomplete.'] },
      { ...value.relationships[1]!, id: 'relationship:z-alternative', complete: true,
        truncated: false, limitations: [] },
      value.relationships[2]!,
    ];
    const result = buildInvestigationLineage(value);
    const nested = result.paths.find((path) => path.target.id === 'certificate:one');
    assert.ok(nested);
    assert.equal(nested.complete, false);
    assert.equal(nested.truncated, true);
    assert.equal(nested.steps[0]!.relationshipId, 'relationship:a-first');
    assert.deepEqual(nested.limitations, ['First observation was incomplete.']);
    assert.deepEqual(buildInvestigationLineage({ ...value, relationships: [...value.relationships].reverse() }), result);
  });

  test('distinguishes a complete path at the depth bound from an omitted child', () => {
    const root = projection().relationships[0]!;
    for (const extra of [0, 1]) {
      const depth = MAX_INVESTIGATION_LINEAGE_STEPS + extra;
      const nodes = Array.from({ length: depth + 1 }, (_, index) => ({
        id: index === 0 ? 'domain:a' : `domain:${index}`, type: 'domain', label: `domain-${index}.test`,
      }));
      const value = projection({
        entities: [projection().entities[0]!, ...nodes],
        relationships: [root, ...nodes.slice(1).map((node, index) => ({
          id: `relationship:${index}`, type: 'domain_aliases_to_domain',
          from: nodes[index]!.id, to: node.id, classification: 'direct', method: 'Exact alias', complete: true,
        })), { id: 'relationship:cycle', type: 'domain_aliases_to_domain',
          from: nodes.at(-1)!.id, to: nodes[0]!.id, classification: 'direct', method: 'Exact alias', complete: true }],
      });
      const result = buildInvestigationLineage(value);
      assert.equal(result.paths.length, MAX_INVESTIGATION_LINEAGE_STEPS);
      assert.equal(result.paths.at(-1)!.hopCount, MAX_INVESTIGATION_LINEAGE_STEPS);
      assert.equal(result.truncated, extra === 1);
    }
  });

  test('reconciles exact per-seed and global output boundaries without hiding omissions', () => {
    const seedCount = MAX_INVESTIGATION_LINEAGE_PATHS / MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED;
    for (const extra of [0, 1]) {
      const seeds = Array.from({ length: seedCount + extra }, (_, index) => ({
        id: `domain:${index}`, type: 'domain', label: `seed-${index}.test`,
      }));
      const targets = Array.from({ length: MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED - 1 }, (_, index) => ({
        id: `ip:${index}`, type: 'ip_address', label: `192.0.2.${index}`,
      }));
      const edge = (from: string, to: string, type: string) => ({
        id: `relationship:${from}-${to}`, from, to, type, classification: 'direct', method: 'Exact observed edge', complete: true,
      });
      const result = buildInvestigationLineage(projection({
        entities: [{ id: 'case:a', type: 'case', label: 'Case A' },
          { id: 'domain:hub', type: 'domain', label: 'hub.test' }, ...seeds, ...targets],
        relationships: [
          ...seeds.map((seed) => edge('case:a', seed.id, 'case_documents_domain')),
          ...seeds.map((seed) => edge(seed.id, 'domain:hub', 'domain_aliases_to_domain')),
          ...targets.map((target) => edge('domain:hub', target.id, 'domain_resolved_to_ip')),
        ],
      }));
      assert.equal(result.paths.length, MAX_INVESTIGATION_LINEAGE_PATHS);
      assert.equal(result.truncated, extra === 1);
      for (const seed of new Set(result.paths.map((path) => path.seed.id))) {
        assert.equal(result.paths.filter((path) => path.seed.id === seed).length, MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED);
      }
    }
  });

  test('does not mutate untrusted projection input', () => {
    const value = projection();
    const before = structuredClone(value);
    buildInvestigationLineage(value);
    assert.deepEqual(value, before);
  });
});
