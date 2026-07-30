import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  REVIEWED_STATIC_PAGE_PATTERN_PACKS,
  reviewedStaticPagePatternPackExport,
} from '../frontend/src/lib/analysis/static-page-pattern-packs.ts';
import { mergeDetectionRules } from '../frontend/src/lib/analysis/detection-rule-model.ts';

describe('reviewed static page-pattern packs', () => {
  test('contain fixed non-scoring rules using only supported conditions', () => {
    assert.equal(REVIEWED_STATIC_PAGE_PATTERN_PACKS.length, 3);
    for (const pack of REVIEWED_STATIC_PAGE_PATTERN_PACKS) {
      const exported = reviewedStaticPagePatternPackExport(pack.id);
      const merged = mergeDetectionRules([], exported);
      assert.equal(merged.skipped, 0);
      assert.equal(merged.added, pack.rules.length);
      assert.ok(merged.rules.every((rule) => rule.riskDelta === 0));
    }
  });

  test('returns defensive copies and rejects unknown packs', () => {
    const first = reviewedStaticPagePatternPackExport('credential-overlap');
    const second = reviewedStaticPagePatternPackExport('credential-overlap');
    assert.notEqual(first.rules, second.rules);
    assert.notEqual(first.rules[0]?.conditions, second.rules[0]?.conditions);
    assert.throws(() => reviewedStaticPagePatternPackExport('missing'), /unavailable/);
  });
});
