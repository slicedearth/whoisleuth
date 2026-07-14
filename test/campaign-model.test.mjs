import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCampaignDomain,
  assertCampaignStoreBudget,
  buildCampaignExport,
  CAMPAIGN_SCHEMA_VERSION,
  campaignStoreVersion,
  createCampaign,
  MAX_CAMPAIGNS,
  MAX_CAMPAIGN_DESCRIPTION_LENGTH,
  MAX_CAMPAIGN_DOMAINS,
  MAX_CAMPAIGN_INPUT_RECORDS,
  MAX_CAMPAIGN_NAME_LENGTH,
  mergeCampaigns,
  normalizeCampaign,
  normalizeCampaignDomains,
  normalizeCampaignStore,
  removeCampaignDomain,
  serializeCampaignStore,
  updateCampaign,
} from '../frontend/src/lib/analysis/campaign-model.js';

const NOW = '2026-07-14T00:00:00.000Z';

function campaign(overrides = {}) {
  return {
    id: 'campaign-1',
    name: 'Observed cluster',
    description: 'Working analyst grouping.',
    domains: ['one.invalid', 'two.invalid'],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

test('normalizes campaign text, domains, timestamps and identity', () => {
  const result = normalizeCampaign({
    id: '../unsafe',
    name: `  ${'N'.repeat(MAX_CAMPAIGN_NAME_LENGTH + 20)}  `,
    description: 'D'.repeat(MAX_CAMPAIGN_DESCRIPTION_LENGTH + 20),
    domains: ['HTTPS://Example.INVALID/path', 'example.invalid.', 'bad value'],
    createdAt: 'not-a-date',
    updatedAt: '2026-07-02T00:00:00Z',
  }, NOW);
  assert.ok(result.id.startsWith('campaign-'));
  assert.equal(result.name.length, MAX_CAMPAIGN_NAME_LENGTH);
  assert.equal(result.description.length, MAX_CAMPAIGN_DESCRIPTION_LENGTH);
  assert.deepEqual(result.domains, ['example.invalid']);
  assert.equal(result.createdAt, NOW);
  assert.equal(result.updatedAt, '2026-07-02T00:00:00.000Z');
});

test('rejects records without a usable name', () => {
  assert.equal(normalizeCampaign({ name: '   ' }, NOW), null);
  assert.equal(normalizeCampaign(null, NOW), null);
});

test('flattens campaign names and removes unsafe description controls', () => {
  const result = normalizeCampaign({
    id: 'text-normalization',
    name: '  Multi\nline\tname  ',
    description: 'First\r\nsecond\u0000\u0007\nthird',
    createdAt: NOW,
  }, NOW);
  assert.equal(result.name, 'Multi line name');
  assert.equal(result.description, 'First\nsecond\nthird');
});

test('normalizes, sorts, deduplicates and bounds domain membership', () => {
  const values = Array.from({ length: MAX_CAMPAIGN_DOMAINS + 10 }, (_, index) => `node-${String(index).padStart(3, '0')}.invalid`);
  const result = normalizeCampaignDomains([...values.reverse(), values[0], 'not a domain']);
  assert.equal(result.length, MAX_CAMPAIGN_DOMAINS);
  assert.deepEqual(result, [...result].sort());
  assert.equal(new Set(result).size, result.length);
});

test('normalizes a store by recency and caps campaign count', () => {
  const records = Array.from({ length: MAX_CAMPAIGNS + 4 }, (_, index) => campaign({
    id: `campaign-${index}`,
    name: `Campaign ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
  }));
  const result = normalizeCampaignStore({ version: 1, campaigns: records });
  assert.equal(result.version, CAMPAIGN_SCHEMA_VERSION);
  assert.equal(result.campaigns.length, MAX_CAMPAIGNS);
  assert.equal(result.campaigns[0].id, `campaign-${MAX_CAMPAIGNS + 3}`);
  assert.equal(result.campaigns.at(-1).id, 'campaign-4');
});

test('duplicate ids recover to the newest record', () => {
  const result = normalizeCampaignStore([
    campaign({ name: 'Older', updatedAt: '2026-07-01T00:00:00.000Z' }),
    campaign({ name: 'Newer', updatedAt: '2026-07-03T00:00:00.000Z' }),
  ]);
  assert.equal(result.campaigns.length, 1);
  assert.equal(result.campaigns[0].name, 'Newer');
});

test('equal-time duplicate recovery and store ordering are input-order independent', () => {
  const duplicateA = campaign({ id: 'duplicate', name: 'Alpha', updatedAt: NOW });
  const duplicateZ = campaign({ id: 'duplicate', name: 'Zulu', updatedAt: NOW });
  const sameNameA = campaign({ id: 'same-a', name: 'Same', updatedAt: NOW });
  const sameNameB = campaign({ id: 'same-b', name: 'Same', updatedAt: NOW });
  const forward = normalizeCampaignStore([duplicateA, sameNameB, duplicateZ, sameNameA]);
  const reverse = normalizeCampaignStore([sameNameA, duplicateZ, sameNameB, duplicateA]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.campaigns.find((item) => item.id === 'duplicate').name, 'Zulu');
  assert.deepEqual(forward.campaigns.filter((item) => item.name === 'Same').map((item) => item.id), ['same-a', 'same-b']);
});

test('creates a bounded campaign without mutating the source array', () => {
  const original = [campaign()];
  const result = createCampaign(original, { name: '  New investigation  ', description: 'Context' }, NOW);
  assert.equal(original.length, 1);
  assert.equal(result.campaigns.length, 2);
  assert.equal(result.record.name, 'New investigation');
  assert.equal(result.record.createdAt, NOW);
});

test('refuses to create beyond the campaign limit', () => {
  const records = Array.from({ length: MAX_CAMPAIGNS }, (_, index) => campaign({ id: `c-${index}` }));
  assert.throws(() => createCampaign(records, { name: 'Overflow' }, NOW), /limited to/);
});

test('updates known fields while preserving creation identity', () => {
  const original = campaign();
  const result = updateCampaign([original], original.id, { name: 'Renamed', description: 'Updated', domains: ['new.invalid'] }, NOW);
  assert.equal(result.record.id, original.id);
  assert.equal(result.record.createdAt, original.createdAt);
  assert.equal(result.record.updatedAt, NOW);
  assert.deepEqual(result.record.domains, ['new.invalid']);
  assert.equal(original.name, 'Observed cluster');
});

test('requires a name and an existing campaign when updating', () => {
  assert.throws(() => updateCampaign([campaign()], 'missing', {}, NOW), /no longer exists/);
  assert.throws(() => updateCampaign([campaign()], 'campaign-1', { name: ' ' }, NOW), /name is required/);
});

test('adds a normalized domain once and removes it without mutation', () => {
  const source = [campaign({ domains: [] })];
  const added = addCampaignDomain(source, 'campaign-1', 'HTTPS://NEW.INVALID/path', NOW);
  assert.equal(added.added, true);
  assert.deepEqual(added.record.domains, ['new.invalid']);
  assert.deepEqual(source[0].domains, []);
  const duplicate = addCampaignDomain(added.campaigns, 'campaign-1', 'new.invalid', NOW);
  assert.equal(duplicate.added, false);
  const removed = removeCampaignDomain(added.campaigns, 'campaign-1', 'new.invalid', NOW);
  assert.deepEqual(removed.record.domains, []);
});

test('rejects invalid and over-limit domain additions', () => {
  assert.throws(() => addCampaignDomain([campaign()], 'campaign-1', 'not valid', NOW), /valid case domain/);
  const full = campaign({ domains: Array.from({ length: MAX_CAMPAIGN_DOMAINS }, (_, index) => `d-${index}.invalid`) });
  assert.throws(() => addCampaignDomain([full], full.id, 'another.invalid', NOW), /limited to/);
});

test('merges matching ids additively while newer metadata wins', () => {
  const local = campaign({ name: 'Local', domains: ['local.invalid'], updatedAt: '2026-07-02T00:00:00.000Z' });
  const imported = campaign({ name: 'Imported', domains: ['imported.invalid'], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z' });
  const result = mergeCampaigns([local], { version: 1, campaigns: [imported] });
  assert.equal(result.added, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.campaigns[0].name, 'Imported');
  assert.deepEqual(result.campaigns[0].domains, ['imported.invalid', 'local.invalid']);
  assert.equal(result.campaigns[0].createdAt, '2026-06-01T00:00:00.000Z');
});

test('an older import cannot overwrite local metadata', () => {
  const local = campaign({ name: 'Local', description: 'Keep me', updatedAt: '2026-07-04T00:00:00.000Z' });
  const imported = campaign({ name: 'Old import', description: 'Old', domains: ['extra.invalid'], updatedAt: '2026-07-03T00:00:00.000Z' });
  const result = mergeCampaigns([local], { version: 1, campaigns: [imported] });
  assert.equal(result.campaigns[0].name, 'Local');
  assert.equal(result.campaigns[0].description, 'Keep me');
  assert.ok(result.campaigns[0].domains.includes('extra.invalid'));
});

test('imports new records, skips malformed records and is idempotent', () => {
  const payload = { version: 1, campaigns: [campaign({ id: 'portable' }), { id: 'bad', name: ' ' }] };
  const first = mergeCampaigns([], payload);
  assert.deepEqual({ added: first.added, updated: first.updated, skipped: first.skipped }, { added: 1, updated: 0, skipped: 1 });
  const second = mergeCampaigns(first.campaigns, payload);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.campaigns.length, 1);
});

test('bounds recovery and import work before iterating attacker-controlled arrays', () => {
  const oversized = Array.from({ length: MAX_CAMPAIGN_INPUT_RECORDS + 25 }, (_, index) => campaign({
    id: `input-${index}`,
    name: `Input ${index}`,
  }));
  assert.equal(normalizeCampaignStore(oversized).campaigns.length, MAX_CAMPAIGNS);
  const result = mergeCampaigns([], { version: 1, campaigns: oversized });
  assert.equal(result.campaigns.length, MAX_CAMPAIGNS);
  assert.equal(result.added, MAX_CAMPAIGNS);
  assert.equal(result.skipped, oversized.length - MAX_CAMPAIGNS);
});

test('rejects a future import version before changing local data', () => {
  assert.throws(() => mergeCampaigns([campaign()], { version: 2, campaigns: [] }), /newer schema 2/);
  assert.throws(() => mergeCampaigns([campaign()], { version: 1.5, campaigns: [] }), /newer schema 1.5/);
});

test('rejects a different named export schema', () => {
  assert.throws(() => mergeCampaigns([], { schema: 'whoisleuth.case-report', version: 1, campaigns: [] }), /not a WHOISleuth campaign export/);
});

test('reports a parsed store version without interpreting other values', () => {
  assert.equal(campaignStoreVersion({ version: 1 }), 1);
  assert.equal(campaignStoreVersion({ version: 1.5 }), 1.5);
  assert.equal(campaignStoreVersion({ version: '1' }), null);
  assert.equal(campaignStoreVersion(null), null);
});

test('serialization contains only normalized campaign fields', () => {
  const parsed = JSON.parse(serializeCampaignStore([{ ...campaign(), secret: 'drop me' }]));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.campaigns[0].secret, undefined);
  assert.deepEqual(Object.keys(parsed.campaigns[0]), ['id', 'name', 'description', 'domains', 'createdAt', 'updatedAt']);
});

test('the store budget returns safe data and rejects oversized collections', () => {
  assert.equal(assertCampaignStoreBudget([campaign()]).campaigns.length, 1);
  const longLabel = 'a'.repeat(60);
  const records = Array.from({ length: MAX_CAMPAIGNS }, (_, campaignIndex) => campaign({
    id: `large-${campaignIndex}`,
    name: `Large ${campaignIndex}`,
    domains: Array.from({ length: MAX_CAMPAIGN_DOMAINS }, (_, domainIndex) =>
      `c${campaignIndex}d${domainIndex}${'a'.repeat(50)}.${longLabel}.${longLabel}.${longLabel}.invalid`,
    ),
  }));
  assert.throws(() => assertCampaignStoreBudget(records), /Campaign storage is full/);
});

test('builds a deterministic portable export without case evidence or notes', () => {
  const result = buildCampaignExport([{ ...campaign(), evidence: { raw: true }, notes: [{ body: 'private' }] }], NOW);
  assert.equal(result.schema, 'whoisleuth.campaigns');
  assert.equal(result.version, 1);
  assert.equal(result.exportedAt, NOW);
  assert.equal(result.campaigns[0].evidence, undefined);
  assert.equal(result.campaigns[0].notes, undefined);
  assert.match(result.limitations, /do not prove/);
});

test('normalization and export do not mutate input records', () => {
  const source = campaign({ domains: ['B.invalid', 'a.invalid'] });
  const before = structuredClone(source);
  normalizeCampaignStore([source]);
  buildCampaignExport([source], NOW);
  assert.deepEqual(source, before);
});
