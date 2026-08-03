import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import fc from 'fast-check';

import {
  CliUsageError,
  MAX_CLI_ARGUMENT_LENGTH,
  MAX_CLI_ARGUMENTS,
  parseCliArguments,
} from '../cli/arguments.mts';
import {
  normalizeBulkSessionStore,
  serializeBulkSessionStore,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';
import {
  WORKSPACE_ARCHIVE_SECTION_IDS,
  buildWorkspaceArchive,
  readWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import { fastCheckParameters } from './helpers/fast-check-config.mts';

const GENERATED_AT = '2026-08-03T00:00:00.000Z';

describe('saved-data and CLI contract properties', () => {
  test('keeps arbitrary CLI argument parsing bounded, pure, and explicitly rejected', () => {
    fc.assert(fc.property(
      fc.array(fc.string({ maxLength: MAX_CLI_ARGUMENT_LENGTH + 4 }), {
        maxLength: MAX_CLI_ARGUMENTS + 4,
      }),
      (argv) => {
        const original = structuredClone(argv);
        try {
          const parsed = parseCliArguments(argv);
          assert.equal(typeof parsed.action, 'string');
          assert.ok(JSON.stringify(parsed).length < 100_000);
        } catch (error) {
          assert.ok(error instanceof CliUsageError);
          assert.ok(error.message.length <= 500);
        }
        assert.deepEqual(argv, original);
      },
    ), fastCheckParameters(250));
  });

  test('normalizes arbitrary JSON-compatible Bulk stores idempotently', () => {
    fc.assert(fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
      const normalized = normalizeBulkSessionStore(value);
      assert.deepEqual(normalizeBulkSessionStore(normalized), normalized);
      assert.equal(serializeBulkSessionStore(value), JSON.stringify(normalized));
    }), fastCheckParameters(200));
  });

  test('round-trips bounded workspace settings through every declared archive section', async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom('dark', 'light', 'system'),
      fc.string({ maxLength: 140 }),
      async (theme, activeProfileId) => {
        const archive = await buildWorkspaceArchive({
          settings: { theme, activeProfileId },
        }, { generatedAt: GENERATED_AT });
        const parsed = await readWorkspaceArchive(archive);
        assert.equal(parsed.generatedAt, GENERATED_AT);
        assert.deepEqual(parsed.sections.map(({ id }) => id), [...WORKSPACE_ARCHIVE_SECTION_IDS]);
        assert.ok(parsed.sections.every(({ status }) => status === 'ready'));
      },
    ), fastCheckParameters(20));
  });
});
