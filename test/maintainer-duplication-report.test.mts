import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildMaintainerDuplicationReport,
  formatMaintainerDuplicationReport,
  main,
  MAX_MAINTAINER_TOOL_FILE_BYTES,
} from '../tools/maintainer-duplication-report.mts';
import {
  boundedControlFreeText,
  boundedNonNegativeInteger,
  boundedPositiveInteger,
  boundedPositiveTimeout,
  boundedSafeRelativePath,
  canonicalControlFreeTimestamp,
  exactObjectKeys,
  fixedRatio,
  jsonRecordOrEmpty,
  medianOneDecimal,
  optionalJsonRecord,
  requireJsonRecord,
  requiredOptionValue,
  sanitizedMaintainerText,
  sha256Bytes,
  sha256Text,
} from '../tools/maintainer-tool-helpers.mts';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'whoisleuth-maintainer-report-'));
  await mkdir(path.join(root, 'tools'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture',
    scripts: { alpha: 'node tools/alpha.mts' },
  }));
  await writeFile(path.join(root, 'tools/alpha.mts'), `#!/usr/bin/env node
import { shared } from './beta.mts';
function first(value: number) { if (!Number.isSafeInteger(value)) throw new TypeError('invalid'); return Number(value); }
export function main() { return first(shared()); }
void main();
`);
  await writeFile(path.join(root, 'tools/beta.mts'), `
function second(value: number) { if (!Number.isSafeInteger(value)) throw new TypeError('invalid'); return Number(value); }
export function shared() { return second(1); }
`);
  return root;
}

describe('maintainer-tool duplication report', () => {
  test('builds a deterministic value-free call and exact-clone inventory', async () => {
    const root = await fixture();
    try {
      const first = await buildMaintainerDuplicationReport({ repositoryRoot: root });
      const second = await buildMaintainerDuplicationReport({ repositoryRoot: root });
      assert.deepEqual(first, second);
      assert.deepEqual(first.scope, {
        root: 'tools/*.mts',
        fileCount: 2,
        entrypointCount: 1,
        totalBytes: first.scope.totalBytes,
        astNodeCount: first.scope.astNodeCount,
        topLevelFunctionCount: 4,
      });
      assert.equal(first.callGraph.edges.some((edge) => (
        edge.caller === 'tools/alpha.mts#main' && edge.callee === 'tools/beta.mts#shared'
      )), true);
      assert.equal(first.callGraph.edges.some((edge) => (
        edge.caller === 'tools/alpha.mts#main' && edge.callee === 'tools/alpha.mts#first'
      )), true);
      assert.equal(first.callGraph.edges.some((edge) => (
        edge.caller === 'tools/alpha.mts#<module>' && edge.callee === 'tools/alpha.mts#main'
      )), true);
      const clone = first.repeatedImplementations.exactClusters.find((cluster) => (
        cluster.members.some((member) => member.name === 'first')
      ));
      assert.deepEqual(clone?.members.map((member) => member.name), ['first', 'second']);
      const serialized = JSON.stringify(first);
      assert.doesNotMatch(serialized, new RegExp(root.replaceAll('\\', '\\\\'), 'u'));
      assert.doesNotMatch(serialized, /Number\.isSafeInteger/u);
      assert.match(formatMaintainerDuplicationReport(first), /2 modules · 1 entry points/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails closed on oversized modules and malformed command arguments', async () => {
    const root = await fixture();
    try {
      await writeFile(path.join(root, 'tools/oversized.mts'), 'x'.repeat(MAX_MAINTAINER_TOOL_FILE_BYTES + 1));
      await assert.rejects(
        buildMaintainerDuplicationReport({ repositoryRoot: root }),
        /exceeds its .*byte maximum/iu,
      );
      const stderr: string[] = [];
      assert.equal(await main(['--unknown'], { repositoryRoot: root, stderr: { write: (value) => stderr.push(value) } }), 2);
      assert.match(stderr.join(''), /Usage/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('measures the checked-out maintainer-tool inventory without source values', async () => {
    const report = await buildMaintainerDuplicationReport();
    assert.equal(report.scope.fileCount, 47);
    assert.equal(report.scope.entrypointCount, 42);
    assert.ok(report.callGraph.staticEdgeCount > 500);
    assert.equal(report.repeatedImplementations.exactClusterCount, 0);
    assert.equal(report.repeatedImplementations.repeatedLineCount, 0);
    assert.doesNotMatch(JSON.stringify(report), /\/Users\/|Documents\/GitHub/u);
  });

  test('shared helpers preserve the measured bounded behaviors', () => {
    assert.deepEqual(optionalJsonRecord({ value: 1 }), { value: 1 });
    assert.equal(optionalJsonRecord([]), null);
    assert.deepEqual(jsonRecordOrEmpty(null), {});
    assert.deepEqual(requireJsonRecord({ value: 1 }, 'Fixture'), { value: 1 });
    assert.throws(() => requireJsonRecord([], 'Fixture'), /must be a JSON object/iu);
    assert.doesNotThrow(() => exactObjectKeys({ known: true }, new Set(['known']), 'Fixture'));
    assert.throws(() => exactObjectKeys({ extra: true }, new Set(['known']), 'Fixture'), /extra/iu);
    assert.equal(boundedControlFreeText(' reviewed ', 'Fixture', 20), 'reviewed');
    assert.throws(() => boundedControlFreeText('bad\nvalue', 'Fixture', 20), /control-free/iu);
    assert.equal(sanitizedMaintainerText(' a\n b ', 'fallback', 20), 'a b');
    for (const unsafe of ['\u0085', '\u00ad', '\u034f']) {
      assert.throws(() => boundedControlFreeText(`bad${unsafe}value`, 'Fixture', 20), /control-free/iu);
      assert.equal(sanitizedMaintainerText(`a${unsafe}b`, 'fallback', 20), 'a b');
      assert.throws(() => boundedSafeRelativePath(`asset${unsafe}.js`, 'Fixture'), /safe relative path/iu);
    }
    assert.equal(boundedSafeRelativePath('assets/über.js', 'Fixture'), 'assets/über.js');
    assert.equal(canonicalControlFreeTimestamp('2026-01-15T12:00:00+01:00', 'Fixture'), '2026-01-15T11:00:00.000Z');
    assert.throws(() => canonicalControlFreeTimestamp('2026-01-15T12:00:00', 'Fixture'), /explicit timezone/iu);
    assert.equal(boundedNonNegativeInteger(0, 'Count', 1), 0);
    assert.equal(boundedPositiveInteger(1, 'Count', 1), 1);
    assert.equal(boundedPositiveTimeout(20, 10, 15), 15);
    assert.equal(medianOneDecimal([1, 2, 4, 8]), 3);
    assert.equal(requiredOptionValue(['--name', 'value'], '--name'), 'value');
    assert.equal(fixedRatio(1, 4), 0.25);
    assert.equal(sha256Text('fixture'), sha256Bytes(new TextEncoder().encode('fixture')));
  });
});
