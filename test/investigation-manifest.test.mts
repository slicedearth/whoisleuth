import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import {
  INVESTIGATION_MANIFEST_SCHEMA,
  buildInvestigationManifest,
} from '../cli/investigation-manifest.mts';

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
    assert.equal((await verifyOfflineArtifact(JSON.stringify(document))).valid, true);
  });

  test('rejects invalid JSON, duplicate-free limits, and malformed configuration digests', async () => {
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: 'not-json' }],
    }, NOW, '1.40.0'), /valid JSON/iu);
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: 'sha256:invalid', artifacts: [{ content: '{}' }],
    }, NOW, '1.40.0'), /configurationDigestSha256/iu);
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [],
    }, NOW, '1.40.0'), /between 1 and 16/iu);
  });
});
