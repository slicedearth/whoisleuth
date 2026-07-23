import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  GENERATED_CONFUSABLE_GROUPS,
  GENERATED_CONFUSABLE_MAPPING_VERSION,
  GENERATED_CONFUSABLE_STATS,
  GENERATED_GENERATION_CONFUSABLE_GROUPS,
} from '../lib/generated/unicode-confusables-17.mts';
import {
  MAX_CONFUSABLE_SOURCE_BYTES,
  MAX_GENERATION_CONFUSABLES_PER_ASCII,
  MAX_PROJECTED_CONFUSABLES,
  MAX_SKELETON_CONFUSABLES_PER_ASCII,
} from '../lib/idn-confusable-policy.mts';
import {
  generateConfusableProjection,
  generateConfusableProjectionWithPolicy,
  renderConfusableProjectionModule,
} from '../lib/unicode-confusable-projection.mts';
import {
  MAX_SEED_CANDIDATE_GROWTH_RATIO,
  MAX_TOTAL_CANDIDATE_GROWTH_RATIO,
  buildUnicodeConfusableAudit,
  main,
  parseArguments,
  skeletonWithConfusableGroups,
} from '../tools/unicode-confusable-audit.mts';

const FIXTURE_PATH = path.resolve('fixtures/unicode-confusables-sample.txt');
const FIXTURE_SHA256 = 'b5b2b3e065acda4e3e951b6e1614c5e95ecc773fa0d64ccf7e2f6fe70d9d8603';

function capture() {
  let value = '';
  return { stream: { write(chunk) { value += String(chunk); } }, value: () => value };
}

describe('bounded Unicode confusable source projection', () => {
  test('parses a deterministic fixture with explicit source policy and bounds', async () => {
    const source = await readFile(FIXTURE_PATH, 'utf8');
    const projection = generateConfusableProjectionWithPolicy(source, {
      unicodeVersion: '17.0.0',
      url: 'https://unicode.example/security/confusables.txt',
      sha256: FIXTURE_SHA256,
      license: 'Unicode-3.0',
      mappingVersion: 'fixture-bounded-v1',
    });

    assert.equal(projection.mappingVersion, 'fixture-bounded-v1');
    assert.equal(projection.stats.sourceBytes, Buffer.byteLength(source));
    assert.equal(projection.stats.parsedMappings, 11);
    assert.equal(projection.stats.rejectedMalformedLines, 1);
    assert.ok(projection.skeletonGroups.f.includes('ꬵ'));
    assert.ok(projection.skeletonGroups.f.includes('ք'));
    assert.ok(projection.generationGroups.g.includes('ց'));
    assert.ok(projection.generationGroups.s.includes('𐑈'));
    assert.ok(projection.stats.projectedMappings <= MAX_PROJECTED_CONFUSABLES);
  });

  test('refuses unpinned, oversized, and invalid-policy input', async () => {
    const source = await readFile(FIXTURE_PATH, 'utf8');
    assert.throws(() => generateConfusableProjection(source), /pinned SHA-256/);
    assert.throws(
      () => generateConfusableProjectionWithPolicy(source, {
        unicodeVersion: '17.0.0',
        url: 'http://unicode.example/confusables.txt',
        sha256: FIXTURE_SHA256,
        license: 'Unicode-3.0',
        mappingVersion: 'fixture-v1',
      }),
      /source policy is invalid/,
    );
    assert.throws(() => generateConfusableProjection('x'.repeat(MAX_CONFUSABLE_SOURCE_BYTES + 1)), /byte limit/);
  });

  test('renders a reviewable environment-neutral module', async () => {
    const source = await readFile(FIXTURE_PATH, 'utf8');
    const projection = generateConfusableProjectionWithPolicy(source, {
      unicodeVersion: '17.0.0',
      url: 'https://unicode.example/security/confusables.txt',
      sha256: FIXTURE_SHA256,
      license: 'Unicode-3.0',
      mappingVersion: 'fixture-bounded-v1',
    });
    const rendered = renderConfusableProjectionModule(projection);
    assert.match(rendered, /Do not edit this projection by hand/);
    assert.match(rendered, /GENERATED_CONFUSABLE_GROUPS/);
    assert.match(rendered, /GENERATED_GENERATION_CONFUSABLE_GROUPS/);
    assert.doesNotMatch(rendered, /node:/);
  });
});

describe('checked-in Unicode confusable calibration', () => {
  test('improves labelled coverage without new false positives or excessive growth', () => {
    const report = buildUnicodeConfusableAudit();
    assert.equal(report.status, 'pass');
    assert.equal(report.mappingVersion, GENERATED_CONFUSABLE_MAPPING_VERSION);
    assert.ok(report.calibration.proposed.truePositive > report.calibration.current.truePositive);
    assert.equal(report.calibration.proposed.falsePositive, 0);
    assert.equal(report.calibration.proposed.falseNegative, 0);
    assert.ok(report.candidateVolume.totalGrowthRatio <= MAX_TOTAL_CANDIDATE_GROWTH_RATIO);
    assert.ok(report.candidateVolume.maximumSeedGrowthRatio <= MAX_SEED_CANDIDATE_GROWTH_RATIO);
    assert.deepEqual(report.failures, []);
  });

  test('keeps every checked-in group and generation subset inside policy caps', () => {
    const projectedCount = Object.values(GENERATED_CONFUSABLE_GROUPS)
      .reduce((total, values) => total + [...values].length, 0);
    const generatedCount = Object.values(GENERATED_GENERATION_CONFUSABLE_GROUPS)
      .reduce((total, values) => total + [...values].length, 0);
    assert.equal(projectedCount, GENERATED_CONFUSABLE_STATS.projectedMappings);
    assert.equal(generatedCount, GENERATED_CONFUSABLE_STATS.generationMappings);
    for (const [ascii, values] of Object.entries(GENERATED_CONFUSABLE_GROUPS)) {
      assert.ok([...values].length <= MAX_SKELETON_CONFUSABLES_PER_ASCII, ascii);
    }
    for (const [ascii, values] of Object.entries(GENERATED_GENERATION_CONFUSABLE_GROUPS)) {
      assert.ok([...values].length <= MAX_GENERATION_CONFUSABLES_PER_ASCII, ascii);
      for (const value of values) assert.ok(GENERATED_CONFUSABLE_GROUPS[ascii].includes(value), `${ascii}: ${value}`);
    }
  });

  test('matches mixed and whole-label additions while retaining unrelated negatives', () => {
    assert.equal(skeletonWithConfusableGroups('քւց', GENERATED_CONFUSABLE_GROUPS), 'fig');
    assert.equal(skeletonWithConfusableGroups('𐑈ecure', GENERATED_CONFUSABLE_GROUPS), 'secure');
    assert.notEqual(skeletonWithConfusableGroups('shape', GENERATED_CONFUSABLE_GROUPS), 'scope');
  });

  test('rejects malformed calibration input without echoing its values', () => {
    assert.throws(
      () => buildUnicodeConfusableAudit([{ id: 'bad', category: 'test', reference: 'secret value', observed: 'x', expectedMatch: true }]),
      /bounded domain-label/,
    );
  });
});

describe('Unicode confusable maintenance command', () => {
  test('accepts bounded command options and rejects ambiguous ones', () => {
    assert.deepEqual(parseArguments([]), { source: null, write: false, json: false });
    assert.deepEqual(parseArguments(['--source', 'confusables.txt', '--json']), {
      source: 'confusables.txt',
      write: false,
      json: true,
    });
    assert.throws(() => parseArguments(['--write']), /requires --source/);
    assert.throws(() => parseArguments(['--other']), /Unknown/);
  });

  test('runs offline against the checked-in projection', async () => {
    const stdout = capture();
    const stderr = capture();
    assert.equal(await main(['--json'], { stdout: stdout.stream, stderr: stderr.stream }), 0);
    const report = JSON.parse(stdout.value());
    assert.equal(report.status, 'pass');
    assert.equal(report.sourceCheck, 'not supplied');
    assert.equal(stderr.value(), '');
  });

  test('refuses a source that does not match the pinned production digest', async () => {
    const stdout = capture();
    const stderr = capture();
    assert.equal(await main(['--source', FIXTURE_PATH], { stdout: stdout.stream, stderr: stderr.stream }), 2);
    assert.equal(stdout.value(), '');
    assert.match(stderr.value(), /pinned SHA-256/);
    assert.doesNotMatch(stderr.value(), /ARMENIAN|DESERET/);
  });
});
