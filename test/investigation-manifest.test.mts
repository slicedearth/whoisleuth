import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import {
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
  INVESTIGATION_MANIFEST_SCHEMA,
  buildInvestigationManifest,
} from '../cli/investigation-manifest.mts';
import { MAX_BOUNDED_JSON_DEPTH } from '../cli/bounded-json.mts';

const NOW = '2026-08-05T08:00:00.000Z';

describe('investigation manifest', () => {
  test('records ordered content identities without retaining paths or values', async () => {
    const document = await buildInvestigationManifest({
      workflow: 'domain review',
      configurationDigestSha256: `sha256:${'a'.repeat(64)}`,
      artifacts: [
        { content: '{\n  "schema": "whoisleuth.fixture", "version": 1, "secretValue": "omitted from manifest"\n}' },
        { content: '{"schema":"whoisleuth.other-fixture","schemaVersion":2}' },
      ],
    }, NOW, '1.40.0');
    assert.equal(document.schema, INVESTIGATION_MANIFEST_SCHEMA);
    assert.deepEqual(document.artifacts.map((item) => item.sequence), [1, 2]);
    assert.equal(document.artifacts[0]?.schema, 'whoisleuth.fixture');
    assert.equal(document.artifacts[1]?.version, 2);
    assert.notEqual(document.artifacts[0]?.contentDigestSha256, document.artifacts[0]?.canonicalDigestSha256);
    assert.doesNotMatch(JSON.stringify(document), /secretValue|omitted from manifest|\.json/iu);
    assert.equal((await verifyOfflineArtifact(JSON.stringify(document))).state, 'verified');
  });

  test('rejects invalid JSON, duplicate keys, deep input, aggregate overflow, and malformed configuration digests', async () => {
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: 'not-json' }],
    }, NOW, '1.40.0'), /valid JSON/iu);
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null,
      artifacts: [{ content: '{"schema":"whoisleuth.fixture","schema":"whoisleuth.other"}' }],
    }, NOW, '1.40.0'), /duplicate object key/iu);
    const deep = `${'{"nested":'.repeat(MAX_BOUNDED_JSON_DEPTH + 1)}null${'}'.repeat(MAX_BOUNDED_JSON_DEPTH + 1)}`;
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: deep }],
    }, NOW, '1.40.0'), /nesting limit/iu);
    const large = JSON.stringify({ data: 'x'.repeat(Math.floor(MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES / 3) + 1) });
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null,
      artifacts: [{ content: large }, { content: large }, { content: large }],
    }, NOW, '1.40.0'), /combined limit/iu);
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: 'sha256:invalid', artifacts: [{ content: '{}' }],
    }, NOW, '1.40.0'), /configurationDigestSha256/iu);
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [],
    }, NOW, '1.40.0'), /between 1 and 16/iu);
  });

  test('uses the shared semantic-version boundary', async () => {
    const document = await buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: '{}' }],
    }, NOW, '1.40.0-rc.1+local.2');
    assert.equal(document.application.version, '1.40.0-rc.1+local.2');
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: '{}' }],
    }, NOW, '01.40.0'), /leading zeroes/iu);
  });
});
