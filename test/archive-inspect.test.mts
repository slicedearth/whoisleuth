import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatArchiveInspection,
  inspectWorkspaceArchive,
} from '../cli/archive-inspect.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import {
  buildWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import {
  encryptWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';

const NOW = '2026-07-29T10:00:00.000Z';
const DOMAIN = 'review-target.invalid';
const PASSPHRASE = 'fixture archive passphrase';

async function archive(domain = DOMAIN) {
  return buildWorkspaceArchive({
    shortlist: [{
      domain,
      availability: 'unknown',
      mutationTypes: [],
      savedAt: NOW,
    }],
    cases: [{
      id: 'case-one',
      domain,
      status: 'new',
      disposition: 'unreviewed',
      tags: [],
      notes: ['This private note must never be searched or printed.'],
      source: 'lookup',
      evidenceHistory: [],
      createdAt: NOW,
      updatedAt: NOW,
    }],
  }, { generatedAt: NOW });
}

describe('offline workspace archive inspection', () => {
  test('summarizes validated sections without printing retained contents', async () => {
    const report = await inspectWorkspaceArchive(JSON.stringify(await archive()));
    assert.equal(report.archive.encrypted, false);
    assert.ok(report.summary.sectionCount > 0);
    assert.ok(report.summary.recordCount >= 2);
    assert.match(report.summary.contentDigestSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(report.archive.version, 5);
    assert.equal(report.archive.readerVersion, 5);
    assert.equal(report.search.requested, false);
    const terminal = formatArchiveInspection(report);
    assert.doesNotMatch(terminal, new RegExp(DOMAIN, 'u'));
    assert.doesNotMatch(terminal, /private note/iu);
  });

  test('uses a stable content identity across formatting and enforces an expected digest', async () => {
    const value = await archive();
    const compact = await inspectWorkspaceArchive(JSON.stringify(value));
    const formatted = await inspectWorkspaceArchive(JSON.stringify(value, null, 2), {
      expectedContentDigest: compact.summary.contentDigestSha256,
    });
    assert.equal(formatted.summary.contentDigestSha256, compact.summary.contentDigestSha256);
    await assert.rejects(
      inspectWorkspaceArchive(JSON.stringify(value), {
        expectedContentDigest: `sha256:${'0'.repeat(64)}`,
      }),
      /did not match/iu,
    );
  });

  test('searches only exact allowlisted fields and redacts matches by default', async () => {
    const raw = JSON.stringify(await archive());
    const redacted = await inspectWorkspaceArchive(raw, { search: DOMAIN });
    assert.ok(redacted.search.matchCount >= 2);
    assert.equal(redacted.search.revealValues, false);
    assert.ok(redacted.search.results.every((result) => result.value === undefined));
    assert.doesNotMatch(JSON.stringify(redacted), new RegExp(DOMAIN, 'u'));
    assert.doesNotMatch(JSON.stringify(redacted), /private note/iu);

    const revealed = await inspectWorkspaceArchive(raw, { search: DOMAIN, reveal: true });
    assert.equal(revealed.search.revealValues, true);
    assert.ok(revealed.search.results.some((result) => result.value === DOMAIN));
    const privateNoteSearch = await inspectWorkspaceArchive(raw, { search: 'private note' });
    assert.equal(privateNoteSearch.search.matchCount, 0);
  });

  test('requires explicit authenticated decryption for encrypted archives', async () => {
    const encrypted = await encryptWorkspaceArchive(await archive(), PASSPHRASE);
    const raw = JSON.stringify(encrypted);
    await assert.rejects(inspectWorkspaceArchive(raw), /requires.*passphrase/iu);
    const report = await inspectWorkspaceArchive(raw, {
      passphrase: PASSPHRASE,
      search: DOMAIN,
    });
    assert.equal(report.archive.encrypted, true);
    assert.ok(report.search.matchCount >= 2);
  });

  test('runs through the CLI with redacted output by default', async () => {
    let stdout = '';
    let stderr = '';
    const code = await runCli([
      'inspect-archive',
      'workspace.json',
      '--search',
      DOMAIN,
      '--json',
    ], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
      readArtifactInput: async () => JSON.stringify(await archive()),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr, '');
    assert.equal(JSON.parse(stdout).search.matchCount >= 2, true);
    assert.doesNotMatch(stdout, new RegExp(DOMAIN, 'u'));
  });

  test('canonicalizes IDN searches and can require an exact match for automation', async () => {
    const ascii = 'xn--bcher-kva.invalid';
    const report = await inspectWorkspaceArchive(JSON.stringify(await archive(ascii)), {
      search: 'bücher.invalid',
      requireMatch: true,
    });
    assert.ok(report.search.matchCount >= 2);
    await assert.rejects(
      inspectWorkspaceArchive(JSON.stringify(await archive()), {
        search: 'missing.invalid',
        requireMatch: true,
      }),
      /no exact canonical match/iu,
    );
  });
});
