#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCaseSupportedContractBaseline,
  CASE_SUPPORTED_CONTRACT_BASELINE_SCHEMA,
  CASE_SUPPORTED_CONTRACT_BASELINE_VERSION,
  type CaseSupportedContractBaseline,
} from '../packages/contracts/case-supported-contract-baseline.mts';
import { parseBoundedJson } from '../lib/bounded-json.mts';

export const CASE_SUPPORTED_CONTRACT_BASELINE_PATH = 'docs/case-supported-contract-baseline-v1.json';
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(REPOSITORY_ROOT, CASE_SUPPORTED_CONTRACT_BASELINE_PATH);
const MAX_BASELINE_BYTES = 512 * 1024;

function serialise(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readBaseline(): CaseSupportedContractBaseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  return parseBoundedJson(raw, {
    label: 'Case supported-contract baseline',
    maximumBytes: MAX_BASELINE_BYTES,
  }) as CaseSupportedContractBaseline;
}

function assertBaselineShape(value: CaseSupportedContractBaseline): void {
  if (value.schema !== CASE_SUPPORTED_CONTRACT_BASELINE_SCHEMA
    || value.version !== CASE_SUPPORTED_CONTRACT_BASELINE_VERSION
    || !Array.isArray(value.commitments?.contracts)
    || !Array.isArray(value.removalRecords)) {
    throw new TypeError('The Case supported-contract baseline is malformed.');
  }
  const keys = value.commitments.contracts.map((contract) => contract.key);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError('The Case supported-contract baseline contains a duplicate contract commitment.');
  }
  for (const descriptor of value.commitments.compatibility) {
    for (const version of descriptor.supportedVersions) {
      if (!keys.includes(`${descriptor.id}@${version}`)) {
        throw new TypeError(`Compatibility descriptor ${descriptor.id} declares version ${version} without a durable lifecycle contract.`);
      }
    }
  }
}

function qualifyingRemovalRecords(
  baseline: CaseSupportedContractBaseline,
  compatibilityId: string,
  version: number,
): CaseSupportedContractBaseline['removalRecords'][number][] {
  return baseline.removalRecords.filter((record) => (
    record.reason === 'reviewed_support_window'
    && /^\d{4}-\d{2}-\d{2}$/u.test(record.reviewedAt)
    && record.supportWindow.firstRelease.length > 0
    && record.supportWindow.finalBroadReaderRelease.length > 0
    && record.supportWindow.removalRelease.length > 0
    && record.safePath.length > 0
    && record.evidence.fixturesUpdated
    && record.evidence.schemaInventoryUpdated
    && record.evidence.privacyDocumentationUpdated
    && record.evidence.cliGuidanceUpdated
    && record.contracts.some((contract) => contract.compatibilityId === compatibilityId && contract.versions.includes(version))
  ));
}

export function assertCaseSupportedContractTransition(
  previous: CaseSupportedContractBaseline,
  current: CaseSupportedContractBaseline,
): void {
  assertBaselineShape(previous);
  assertBaselineShape(current);
  const retained = new Set(current.commitments.contracts.map((contract) => contract.key));
  const previousRemovalRecords = new Set(previous.removalRecords.map((record) => JSON.stringify(record)));
  for (const contract of previous.commitments.contracts) {
    if (retained.has(contract.key)) continue;
    const freshRemoval = qualifyingRemovalRecords(current, contract.compatibilityId, contract.version)
      .some((record) => !previousRemovalRecords.has(JSON.stringify(record)));
    if (!freshRemoval) {
      throw new TypeError(
        `Supported contract ${contract.key} disappeared without a fresh explicit reviewed removal record, support window, safe path, and updated compatibility evidence.`,
      );
    }
  }
}

export function checkCaseSupportedContractBaseline(): CaseSupportedContractBaseline {
  const actual = readBaseline();
  if (!actual) throw new TypeError(`Missing ${CASE_SUPPORTED_CONTRACT_BASELINE_PATH}.`);
  assertBaselineShape(actual);
  const expected = buildCaseSupportedContractBaseline();
  assertBaselineShape(expected);
  assertCaseSupportedContractTransition(actual, expected);
  if (serialise(actual) !== serialise(expected)) {
    throw new TypeError(
      `${CASE_SUPPORTED_CONTRACT_BASELINE_PATH} has drifted. Review any removal, migration, fixture, privacy, and CLI effects before regenerating it.`,
    );
  }
  return expected;
}

export function writeCaseSupportedContractBaseline(): CaseSupportedContractBaseline {
  const previous = readBaseline();
  if (previous) assertBaselineShape(previous);
  const current = buildCaseSupportedContractBaseline();
  assertBaselineShape(current);
  if (previous) assertCaseSupportedContractTransition(previous, current);
  writeFileSync(BASELINE_PATH, serialise(current), 'utf8');
  return current;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  if (args.has('--write')) {
    const baseline = writeCaseSupportedContractBaseline();
    process.stdout.write(`Wrote ${CASE_SUPPORTED_CONTRACT_BASELINE_PATH} with ${baseline.commitments.contracts.length} durable contracts.\n`);
    return;
  }
  if (args.has('--check')) {
    const baseline = checkCaseSupportedContractBaseline();
    process.stdout.write(`Case supported-contract baseline verified: ${baseline.commitments.contracts.length} durable contracts.\n`);
    return;
  }
  process.stdout.write(serialise(buildCaseSupportedContractBaseline()));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
