import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  MAX_RISK_CALIBRATION_RECORDS,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
  RISK_CALIBRATION_REPORT_SCHEMA,
  RISK_CALIBRATION_REPORT_VERSION,
  RISK_CALIBRATION_DATASET_COMPATIBILITY,
  RISK_CALIBRATION_REPORT_COMPATIBILITY,
  SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS,
  SUPPORTED_RISK_CALIBRATION_REPORT_VERSIONS,
} from '../packages/contracts/risk-calibration.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES as CLI_MAX_INPUT_BYTES,
  MAX_RISK_CALIBRATION_RECORDS as CLI_MAX_RECORDS,
  RISK_CALIBRATION_DATASET_SCHEMA as CLI_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION as CLI_DATASET_VERSION,
  RISK_CALIBRATION_REPORT_SCHEMA as CLI_REPORT_SCHEMA,
  RISK_CALIBRATION_REPORT_VERSION as CLI_REPORT_VERSION,
  SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS as CLI_SUPPORTED_DATASET_VERSIONS,
  parseRiskCalibrationDataset,
  type CalibrationDataset,
} from '../cli/risk-calibration.mts';
import {
  RISK_CALIBRATION_DATASET_SCHEMA as BROWSER_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION as BROWSER_DATASET_VERSION,
} from '../frontend/src/lib/analysis/risk-calibration-export.ts';
import {
  RISK_CALIBRATION_SUMMARY_SCHEMA,
  RISK_CALIBRATION_SUMMARY_VERSION,
} from '../lib/risk-calibration-summary.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PRODUCTION_ROOTS = Object.freeze(['bin', 'cli', 'frontend/src', 'lib', 'netlify', 'packages', 'tools']);
const TYPESCRIPT_SOURCE_RE = /\.(?:cts|mts|ts)$/u;

async function productionTypeScriptFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && TYPESCRIPT_SOURCE_RE.test(entry.name)) output.push(child);
    }
  }
  for (const directory of PRODUCTION_ROOTS) await visit(directory);
  return output.sort();
}

describe('canonical Risk calibration contract', () => {
  // This function is intentionally not invoked. Its successful compilation
  // preserves the mutable public type facade that pre-dates the readonly
  // canonical wire contract.
  function acceptsLegacyMutableFacade(dataset: CalibrationDataset): void {
    const first = dataset.records[0];
    if (!first) return;
    dataset.records.push(first);
    first.domain = 'updated.example';
    first.evidence.availability = 'unknown';
  }

  test('keeps stable CLI and browser facades on one schema owner', () => {
    assert.equal(typeof acceptsLegacyMutableFacade, 'function');
    assert.equal(CLI_DATASET_SCHEMA, RISK_CALIBRATION_DATASET_SCHEMA);
    assert.equal(BROWSER_DATASET_SCHEMA, RISK_CALIBRATION_DATASET_SCHEMA);
    assert.equal(CLI_DATASET_VERSION, RISK_CALIBRATION_DATASET_VERSION);
    assert.equal(BROWSER_DATASET_VERSION, RISK_CALIBRATION_DATASET_VERSION);
    assert.equal(CLI_REPORT_SCHEMA, RISK_CALIBRATION_REPORT_SCHEMA);
    assert.equal(RISK_CALIBRATION_SUMMARY_SCHEMA, RISK_CALIBRATION_REPORT_SCHEMA);
    assert.equal(CLI_REPORT_VERSION, RISK_CALIBRATION_REPORT_VERSION);
    assert.equal(RISK_CALIBRATION_SUMMARY_VERSION, RISK_CALIBRATION_REPORT_VERSION);
    assert.equal(CLI_MAX_INPUT_BYTES, MAX_RISK_CALIBRATION_INPUT_BYTES);
    assert.equal(CLI_MAX_RECORDS, MAX_RISK_CALIBRATION_RECORDS);
    assert.deepEqual(CLI_SUPPORTED_DATASET_VERSIONS, SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS);
  });

  test('freezes exact compatibility histories and canonical descriptors', () => {
    assert.deepEqual(SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS, [1, 2]);
    assert.deepEqual(SUPPORTED_RISK_CALIBRATION_REPORT_VERSIONS, [1, 2, 3]);
    assert.equal(Object.isFrozen(SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS), true);
    assert.equal(Object.isFrozen(SUPPORTED_RISK_CALIBRATION_REPORT_VERSIONS), true);
    assert.equal(Object.isFrozen(RISK_CALIBRATION_DATASET_COMPATIBILITY), true);
    assert.equal(Object.isFrozen(RISK_CALIBRATION_DATASET_COMPATIBILITY.supportedVersions), true);
    assert.equal(Object.isFrozen(RISK_CALIBRATION_REPORT_COMPATIBILITY), true);
    assert.deepEqual(RISK_CALIBRATION_DATASET_COMPATIBILITY.supportedVersions, [1, 2]);
    assert.deepEqual(RISK_CALIBRATION_REPORT_COMPATIBILITY.supportedVersions, [1, 2, 3]);
  });

  test('preserves legacy and current dataset reader semantics', () => {
    const base = {
      schema: RISK_CALIBRATION_DATASET_SCHEMA,
      records: [{
        id: 'case-1',
        domain: 'candidate.example',
        analystDisposition: 'false_positive',
        evidence: { availability: 'registered', scanDepth: 'deep' },
      }],
    };
    assert.equal(parseRiskCalibrationDataset(JSON.stringify({ ...base, version: 1 })).version, 1);
    assert.equal(parseRiskCalibrationDataset(JSON.stringify({ ...base, version: 2 })).version, 2);
    assert.throws(
      () => parseRiskCalibrationDataset(JSON.stringify({ ...base, version: 3 })),
      /version 1 or 2/u,
    );
  });

  test('keeps schema literals in the canonical production owner only', async () => {
    const matches: string[] = [];
    for (const relative of await productionTypeScriptFiles(ROOT)) {
      const source = await readFile(path.join(ROOT, relative), 'utf8');
      if (source.includes(RISK_CALIBRATION_DATASET_SCHEMA)
        || source.includes(RISK_CALIBRATION_REPORT_SCHEMA)) matches.push(relative);
    }
    assert.deepEqual(matches, ['packages/contracts/risk-calibration.mts']);
  });
});
