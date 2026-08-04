import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LOOKALIKE_CALIBRATION_INPUT_SCHEMA,
  buildLookalikeCalibration,
} from '../cli/lookalike-calibration.mts';

const NOW = '2026-08-04T00:00:00.000Z';

describe('lookalike review-yield calibration', () => {
  test('summarizes exact analyst dispositions without retaining candidates or tuning generation', () => {
    const report = buildLookalikeCalibration(JSON.stringify({
      schema: LOOKALIKE_CALIBRATION_INPUT_SCHEMA,
      version: 1,
      records: [
        { id: 'candidate-1', mutationFamilies: ['homoglyph', 'tld_substitution'], disposition: 'suspicious' },
        { id: 'candidate-2', mutationFamilies: ['homoglyph'], disposition: 'false_positive' },
        { id: 'candidate-3', mutationFamilies: ['tld_substitution'], disposition: 'expected' },
      ],
    }), NOW);
    assert.equal(report.summary.reviewedCandidates, 3);
    assert.equal(report.summary.sampleState, 'insufficient');
    assert.equal(report.families.find((family) => family.id === 'homoglyph')?.reviewLeadRate, 0.5);
    assert.deepEqual(report.privacy, { candidateIdsRetained: 0, domainsRetained: 0, notesRetained: 0 });
    assert.doesNotMatch(JSON.stringify(report), /candidate-1/u);
    assert.match(report.limitations.join(' '), /never changes mutation generation/u);
  });

  test('rejects unreviewed labels, duplicate ids, and unbounded mutation lists', () => {
    const input = (records: unknown[]) => JSON.stringify({
      schema: LOOKALIKE_CALIBRATION_INPUT_SCHEMA,
      version: 1,
      records,
    });
    assert.throws(() => buildLookalikeCalibration(input([
      { id: 'candidate-1', mutationFamilies: ['homoglyph'], disposition: 'unreviewed' },
    ]), NOW), /supported reviewed disposition/u);
    assert.throws(() => buildLookalikeCalibration(input([
      { id: 'candidate-1', mutationFamilies: ['homoglyph'], disposition: 'expected' },
      { id: 'candidate-1', mutationFamilies: ['homoglyph'], disposition: 'expected' },
    ]), NOW), /duplicated/u);
  });
});
