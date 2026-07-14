const test = require('node:test');
const assert = require('node:assert/strict');

test('CLI CommonJS leaf entry points resolve to their typed implementations', () => {
  assert.strictEqual(require('../cli/arguments').parseCliArguments, require('../cli/arguments.mts').parseCliArguments);
  assert.strictEqual(require('../cli/arguments').CliUsageError, require('../cli/arguments.mts').CliUsageError);
  assert.strictEqual(require('../cli/bulk').runBulkLookups, require('../cli/bulk.mts').runBulkLookups);
  assert.strictEqual(
    require('../cli/saved-lookup').parseSavedLookupDocument,
    require('../cli/saved-lookup.mts').parseSavedLookupDocument,
  );
  assert.strictEqual(require('../cli/compare').parseCliLookupDocument, require('../cli/compare.mts').parseCliLookupDocument);
  assert.strictEqual(
    require('../cli/formatters/json').buildCliLookupDocument,
    require('../cli/formatters/json.mts').buildCliLookupDocument,
  );
  assert.strictEqual(
    require('../cli/export-evidence').buildCliEvidenceExport,
    require('../cli/export-evidence.mts').buildCliEvidenceExport,
  );
  assert.strictEqual(
    require('../cli/formatters/markdown').formatLookupEvidenceMarkdown,
    require('../cli/formatters/markdown.mts').formatLookupEvidenceMarkdown,
  );
  assert.strictEqual(
    require('../cli/formatters/html').formatLookupEvidenceHtml,
    require('../cli/formatters/html.mts').formatLookupEvidenceHtml,
  );
  assert.strictEqual(require('../cli/exit-codes'), require('../cli/exit-codes.mts').default);
  assert.strictEqual(
    require('../cli/errors').boundedCliErrorMessage,
    require('../cli/errors.mts').boundedCliErrorMessage,
  );
  assert.strictEqual(
    require('../cli/posture').normalizePostureSelectors,
    require('../cli/posture.mts').normalizePostureSelectors,
  );
  assert.strictEqual(
    require('../cli/http').buildHttpProbeResult,
    require('../cli/http.mts').buildHttpProbeResult,
  );
  assert.strictEqual(
    require('../cli/discover').normalizeDiscoveryTlds,
    require('../cli/discover.mts').normalizeDiscoveryTlds,
  );
});
